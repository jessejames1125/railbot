// Rail: practice is the default, and going live takes several deliberate steps.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runBot, Refused } from '../src/engine.js';
import { recordedJudge, rulesJudge } from '../src/judges/index.js';
import { goLive, goPractice } from '../src/cli-actions.js';
import { approveAll, item, realishJudge, switchOn, tempDir, testBot } from './helpers.js';

test('the default mode never calls act', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a')]);
  const out = await runBot(bot, { dir, judge: realishJudge(), approver: approveAll });
  assert.equal(out.mode, 'practice');
  assert.deepEqual(acted, []);
  assert.equal(out.items[0].status, 'practiced');
});

test('--live without the switch is refused', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a')]);
  await assert.rejects(runBot(bot, { dir, mode: 'live', judge: realishJudge(), approver: approveAll, attended: true }), /live switch is off/);
  assert.deepEqual(acted, []);
});

test('the offline judges can never go live', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a')]);
  switchOn(dir, bot);
  for (const judge of [rulesJudge(), recordedJudge(join(dir, 'none.json'))]) {
    await assert.rejects(runBot(bot, { dir, mode: 'live', judge, approver: approveAll, attended: true }), /for practice only/);
  }
  assert.deepEqual(acted, []);
});

test('a bot with no act() can only practice', async (t) => {
  const dir = tempDir(t);
  const { bot } = testBot([item('a')], { act: undefined });
  switchOn(dir, bot);
  await assert.rejects(runBot(bot, { dir, mode: 'live', judge: realishJudge(), approver: approveAll, attended: true }), Refused);
});

test('a yes in practice does not carry over to live', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a')]);
  await runBot(bot, { dir, judge: realishJudge(), approver: approveAll });
  switchOn(dir, bot);
  const out = await runBot(bot, { dir, mode: 'live', judge: realishJudge(), attended: true });
  assert.deepEqual(acted, []);
  assert.equal(out.items.find((i) => i.id === 'a').status, 'waiting');
});

test('the switch is set for one bot only', async (t) => {
  const dir = tempDir(t);
  const { bot } = testBot([item('a')]);
  switchOn(dir, bot);
  const { writeJsonAtomic, paths } = await import('../src/files.js');
  writeJsonAtomic(paths(dir, bot.name).live, { bot: 'another-bot', limits: { perRun: 10, perDay: 50 } });
  await assert.rejects(runBot(bot, { dir, mode: 'live', judge: realishJudge(), approver: approveAll, attended: true }), /set for another-bot/);
});

test('go-live needs the exact words typed, and practice turns it off', (t) => {
  const dir = tempDir(t);
  const { bot } = testBot([]);
  assert.throws(() => goLive(dir, bot, 'yes'), /type exactly/);
  assert.equal(existsSync(join(dir, '.railbot', 'test-bot', 'live.json')), false);
  goLive(dir, bot, 'live test-bot');
  assert.equal(existsSync(join(dir, '.railbot', 'test-bot', 'live.json')), true);
  goPractice(dir, bot);
  assert.equal(existsSync(join(dir, '.railbot', 'test-bot', 'live.json')), false);
});
