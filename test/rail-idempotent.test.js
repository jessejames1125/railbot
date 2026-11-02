// Rail: state on disk survives a crash, and an action never happens twice.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { approveAll, item, realishJudge, switchOn, tempDir, testBot } from './helpers.js';
import { runBot } from '../src/engine.js';
import { takeLock } from '../src/files.js';
import { readJournal } from '../src/journal.js';
import { resolveItem, reopenItem } from '../src/cli-actions.js';

const CRASHER = fileURLToPath(new URL('./fixtures/crash-bot.js', import.meta.url));
const crash = (dir, where) => spawnSync(process.execPath, [CRASHER, dir, where], { encoding: 'utf8' });
const effects = (dir) => (existsSync(join(dir, 'effects.txt')) ? readFileSync(join(dir, 'effects.txt'), 'utf8').trim().split('\n') : []);
const statusOf = (dir, id) => {
  const { events } = readJournal(join(dir, '.railbot', 'crash-bot', 'journal.jsonl'));
  return events.filter((e) => e.id === id).map((e) => e.type);
};

test('a repeated run does not repeat anything', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('a'), item('b')]);
  switchOn(dir, bot);
  const opts = { dir, mode: 'live', judge: realishJudge(), approver: approveAll, attended: true };
  await runBot(bot, opts);
  const judged = [];
  await runBot(bot, { ...opts, judge: realishJudge(async ({ item: it }) => (judged.push(it.id), { decision: 'approve', reason: 'x', injection_seen: false })) });
  await runBot(bot, opts);
  assert.deepEqual(acted, ['a', 'b']);
  assert.deepEqual(judged, [], 'finished items are not judged again, so they cost nothing');
});

test('a done item stays done even if its text changes later', async (t) => {
  const dir = tempDir(t);
  let body = 'one';
  const { bot, acted } = testBot(() => [item('a', { action: { type: 'test', body } })]);
  switchOn(dir, bot);
  const opts = { dir, mode: 'live', judge: realishJudge(), approver: approveAll, attended: true };
  await runBot(bot, opts);
  body = 'two';
  await runBot(bot, opts);
  assert.deepEqual(acted, ['a']);
});

test('crash after the effect but before the outcome: the rerun does not repeat it', (t) => {
  const dir = tempDir(t);
  assert.equal(crash(dir, 'after-effect').status, 42);
  assert.deepEqual(effects(dir), ['sent:first']);
  assert.equal(statusOf(dir, 'first').at(-1), 'act-start');
  const rerun = crash(dir, 'none');
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.deepEqual(effects(dir), ['sent:first', 'sent:second'], 'the second item goes out, the first does not repeat');
  assert.match(rerun.stdout, /inDoubt=first/);
});

test('crash before the effect: still not retried by itself, and a person can reopen it', async (t) => {
  const dir = tempDir(t);
  assert.equal(crash(dir, 'before-effect').status, 42);
  assert.deepEqual(effects(dir), []);
  crash(dir, 'none');
  assert.deepEqual(effects(dir), ['sent:second']);
  resolveItem(dir, 'crash-bot', 'first', 'failed', 'checked: it never went out');
  reopenItem(dir, 'crash-bot', 'first', 'send it again');
  const rerun = crash(dir, 'none');
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.deepEqual(effects(dir), ['sent:second', 'sent:first']);
});

test('a hard kill in the middle of act leaves the item in doubt', async (t) => {
  const dir = tempDir(t);
  const child = spawn(process.execPath, [CRASHER, dir, 'hang'], { stdio: 'pipe' });
  const started = join(dir, 'started');
  while (!existsSync(started)) await new Promise((r) => setTimeout(r, 25));
  child.kill('SIGKILL');
  await new Promise((r) => child.on('close', r));
  assert.deepEqual(effects(dir), []);
  assert.equal(statusOf(dir, 'first').at(-1), 'act-start');
  const rerun = crash(dir, 'none');
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /inDoubt=first/);
  assert.deepEqual(effects(dir), ['sent:second']);
});

test('sends started before a crash still count against the limit', (t) => {
  const dir = tempDir(t);
  crash(dir, 'after-effect');
  const out = crash(dir, 'limit-one');
  assert.match(out.stdout, /limit=limit of 1 in 24 hours reached/);
  assert.deepEqual(effects(dir), ['sent:first']);
});

test('a second run at the same time is refused while the first is alive', async (t) => {
  const dir = tempDir(t);
  const child = spawn(process.execPath, [CRASHER, dir, 'hang'], { stdio: 'pipe' });
  t.after(() => child.kill('SIGKILL'));
  while (!existsSync(join(dir, 'started'))) await new Promise((r) => setTimeout(r, 25));
  const second = crash(dir, 'none');
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /in progress/);
  assert.deepEqual(effects(dir), []);
});

test('a lock left by a dead process does not block the next run', (t) => {
  const dir = tempDir(t);
  crash(dir, 'after-effect');
  const again = crash(dir, 'none');
  assert.equal(again.status, 0, again.stderr);
});

test('a torn last line does not lose the item or repeat it', (t) => {
  const dir = tempDir(t);
  crash(dir, 'after-effect');
  const file = join(dir, '.railbot', 'crash-bot', 'journal.jsonl');
  writeFileSync(file, `${readFileSync(file, 'utf8')}{"seq":99,"type":"act-do`);
  const rerun = crash(dir, 'none');
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.deepEqual(effects(dir), ['sent:first', 'sent:second']);
});

test('releasing a lock leaves one that belongs to someone else', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'lock');
  const release = takeLock(file, 'run');
  writeFileSync(file, JSON.stringify({ pid: 999999, host: 'other', what: 'run' }));
  release();
  assert.equal(existsSync(file), true);
});

test('taking a lock leaves nothing else behind, and an unreadable one is cleared', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'lock');
  writeFileSync(file, 'torn');
  const release = takeLock(file, 'run');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, process.pid);
  assert.deepEqual(readdirSync(dir), ['lock']);
  assert.throws(() => takeLock(file, 'run'), /in progress/);
  release();
  assert.deepEqual(readdirSync(dir), []);
});
