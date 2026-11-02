// Rail: the audit log is append-only and shows when someone changed it.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Journal, JournalCorrupt, readJournal } from '../src/journal.js';
import { runBot } from '../src/engine.js';
import { approveAll, item, realishJudge, switchOn, tempDir, testBot } from './helpers.js';

test('every step of an action is in the log with its reason', async (t) => {
  const dir = tempDir(t);
  const { bot } = testBot([item('a')]);
  switchOn(dir, bot);
  await runBot(bot, { dir, mode: 'live', judge: realishJudge(), approver: approveAll, attended: true });
  const { events } = readJournal(join(dir, '.railbot', 'test-bot', 'journal.jsonl'));
  const types = events.filter((e) => e.id === 'a').map((e) => e.type);
  assert.deepEqual(types, ['proposed', 'judged', 'gated', 'queued', 'human-approved', 'act-start', 'act-done']);
  assert.equal(events.find((e) => e.type === 'judged').verdict.reason, 'fine');
});

test('changing any byte of an old line is caught', (t) => {
  const file = join(tempDir(t), 'j.jsonl');
  const j = new Journal(file);
  j.append('one', { value: 'send to alice' });
  j.append('two');
  writeFileSync(file, readFileSync(file, 'utf8').replace('alice', 'mallory'));
  assert.throws(() => new Journal(file), JournalCorrupt);
});

test('deleting a line from the middle is caught', (t) => {
  const file = join(tempDir(t), 'j.jsonl');
  const j = new Journal(file);
  j.append('one');
  j.append('two');
  j.append('three');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.splice(1, 1);
  writeFileSync(file, lines.join('\n'));
  assert.throws(() => new Journal(file), JournalCorrupt);
});

test('a line torn by a crash is recorded, not hidden, and the log keeps working', (t) => {
  const file = join(tempDir(t), 'j.jsonl');
  const j = new Journal(file);
  j.append('one');
  appendFileSync(file, '{"seq":2,"ts":"2026-11-02T00:00:00.000Z","type":"act-do');
  const again = new Journal(file);
  assert.equal(again.events.at(-1).type, 'recovered');
  again.append('next');
  const read = readJournal(file);
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.events.map((e) => e.type), ['one', 'recovered', 'next']);
});

test('a garbled line in the middle that was never recovered is caught', (t) => {
  const file = join(tempDir(t), 'j.jsonl');
  const j = new Journal(file);
  j.append('one');
  j.append('two');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines[0] = 'garbage';
  writeFileSync(file, lines.join('\n'));
  assert.ok(readJournal(file).problems.length > 0);
});
