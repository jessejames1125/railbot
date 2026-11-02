// Rail: a stop file halts everything, at every step, with no argument possible.
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { paths, writeStop } from '../src/files.js';
import { runBot } from '../src/engine.js';
import { readJournal } from '../src/journal.js';
import { approveAll, item, realishJudge, switchOn, tempDir, testBot } from './helpers.js';

const liveOpts = (dir, extra = {}) => ({ dir, mode: 'live', judge: realishJudge(), approver: approveAll, attended: true, ...extra });

test('present at the start: nothing is proposed, judged or sent', async (t) => {
  const dir = tempDir(t);
  let proposed = false;
  const { bot, acted } = testBot(() => ((proposed = true), [item('a')]));
  switchOn(dir, bot);
  writeStop(paths(dir, bot.name).stop, 'on-call says stop');
  const out = await runBot(bot, liveOpts(dir));
  assert.match(out.stopped, /on-call says stop/);
  assert.equal(proposed, false);
  assert.deepEqual(acted, []);
});

test('created while the judge is working: the next step halts', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a'), item('b')]);
  switchOn(dir, bot);
  const p = paths(dir, bot.name);
  const judge = realishJudge(async ({ item: it }) => {
    if (it.id === 'a') writeStop(p.stop);
    return { decision: 'approve', reason: 'ok', injection_seen: false };
  });
  const out = await runBot(bot, liveOpts(dir, { judge }));
  assert.ok(out.stopped);
  assert.deepEqual(acted, []);
});

test('created during approval: nothing approved goes out', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a')]);
  switchOn(dir, bot);
  const p = paths(dir, bot.name);
  const approver = { ask: async () => (writeStop(p.stop), { decision: 'approve' }) };
  const out = await runBot(bot, liveOpts(dir, { approver }));
  assert.ok(out.stopped);
  assert.deepEqual(acted, []);
});

test('created between two sends: the second does not go', async (t) => {
  const dir = tempDir(t);
  const p = () => paths(dir, 'test-bot');
  const acted = [];
  const { bot } = testBot([item('a'), item('b')], {
    act: async (it) => {
      acted.push(it.id);
      writeStop(p().stop);
    },
  });
  switchOn(dir, bot);
  const out = await runBot(bot, liveOpts(dir));
  assert.deepEqual(acted, ['a']);
  assert.ok(out.stopped);
});

test('removing it lets work continue where it left off, without repeats', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a')]);
  switchOn(dir, bot);
  const p = paths(dir, bot.name);
  writeStop(p.stop);
  await runBot(bot, liveOpts(dir));
  rmSync(p.stop);
  await runBot(bot, liveOpts(dir));
  assert.deepEqual(acted, ['a']);
});

test('the machine-wide stop file halts every bot', async (t) => {
  const home = tempDir(t);
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => Object.assign(process.env, saved));
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a')]);
  switchOn(dir, bot);
  writeStop(join(home, '.railbot', 'STOP'));
  assert.ok(existsSync(paths(dir, bot.name).globalStop));
  const out = await runBot(bot, liveOpts(dir));
  assert.ok(out.stopped);
  assert.deepEqual(acted, []);
});

test('every stop is written to the log', async (t) => {
  const dir = tempDir(t);
  const { bot } = testBot([item('a')]);
  const p = paths(dir, bot.name);
  writeStop(p.stop, 'testing');
  await runBot(bot, { dir, judge: realishJudge() });
  const { readJournal } = await import('../src/journal.js');
  assert.ok(readJournal(p.journal).events.some((e) => e.type === 'stopped' && e.reason.includes('testing')));
});

test('created during the last check before a send: it does not go', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a')], {
    async recheck() {
      writeStop(paths(dir, bot.name).stop, 'too late');
      return null;
    },
  });
  switchOn(dir, bot);
  const out = await runBot(bot, liveOpts(dir));
  assert.ok(out.stopped);
  assert.deepEqual(acted, []);
  assert.equal(readJournal(paths(dir, bot.name).journal).events.some((e) => e.type === 'act-start'), false);
});
