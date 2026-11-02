// Rail: send limits live in code and count what started, not what finished.
import assert from 'node:assert/strict';
import test from 'node:test';
import { defineBot, runBot, Refused } from '../src/engine.js';
import { approveAll, item, realishJudge, switchOn, tempDir, testBot } from './helpers.js';

const many = (n) => Array.from({ length: n }, (_, i) => item(`i${i}`));
const live = (bot, dir, extra = {}) => runBot(bot, { dir, mode: 'live', judge: realishJudge(), approver: approveAll, attended: true, ...extra });

test('a run never sends more than the per-run limit, and the rest wait', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot(many(6), { limits: { perRun: 2, perDay: 50 } });
  switchOn(dir, bot);
  const first = await live(bot, dir);
  assert.equal(acted.length, 2);
  assert.match(first.limit, /per-run/);
  await live(bot, dir);
  assert.equal(acted.length, 4);
  assert.equal(new Set(acted).size, 4);
});

test('the 24-hour limit holds across runs', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot(many(10), { limits: { perRun: 3, perDay: 5 } });
  switchOn(dir, bot);
  for (let i = 0; i < 4; i++) await live(bot, dir);
  assert.equal(acted.length, 5);
});

test('the limit frees up only after 24 hours', async (t) => {
  const dir = tempDir(t);
  let now = new Date('2026-11-02T10:00:00Z');
  const clock = () => now;
  const { bot, acted } = testBot(many(4), { limits: { perRun: 2, perDay: 2 } });
  switchOn(dir, bot);
  await live(bot, dir, { clock });
  assert.equal(acted.length, 2);
  now = new Date('2026-11-03T09:59:00Z');
  await live(bot, dir, { clock });
  assert.equal(acted.length, 2);
  now = new Date('2026-11-03T10:01:00Z');
  await live(bot, dir, { clock });
  assert.equal(acted.length, 4);
});

test('moving the clock back does not free up sends', async (t) => {
  const dir = tempDir(t);
  let now = new Date('2026-11-02T10:00:00Z');
  const clock = () => now;
  const { bot, acted } = testBot(many(4), { limits: { perRun: 2, perDay: 2 } });
  switchOn(dir, bot);
  await live(bot, dir, { clock });
  now = new Date('2026-10-01T10:00:00Z');
  await live(bot, dir, { clock });
  assert.equal(acted.length, 2);
});

test('a failed send still counts, because it may have gone out', async (t) => {
  const dir = tempDir(t);
  const { bot } = testBot(many(3), {
    limits: { perRun: 2, perDay: 2 },
    act: async () => {
      throw new Error('network died halfway');
    },
  });
  switchOn(dir, bot);
  await live(bot, dir);
  const out = await live(bot, dir);
  assert.match(out.limit, /24 hours/);
});

test('an item that declares several sends counts as several', async (t) => {
  const dir = tempDir(t);
  const { bot, acted } = testBot([item('big', { sends: 5 }), item('small')], { limits: { perRun: 4, perDay: 10 } });
  switchOn(dir, bot);
  await live(bot, dir);
  assert.deepEqual(acted, []);
});

test('a bot cannot change its limits while running', async (t) => {
  const { bot } = testBot([]);
  assert.throws(() => {
    bot.limits.perRun = 1000;
  }, TypeError);
  assert.equal(bot.limits.perRun, 10);
  assert.ok(t);
});

test('limits are required, and must make sense', () => {
  const base = { name: 'x', propose: async () => [], judge: { instructions: 'x' } };
  assert.throws(() => defineBot(base), Refused);
  assert.throws(() => defineBot({ ...base, limits: { perRun: 1 } }), Refused);
  assert.throws(() => defineBot({ ...base, limits: { perRun: 0, perDay: 5 } }), Refused);
  assert.throws(() => defineBot({ ...base, limits: { perRun: Infinity, perDay: Infinity } }), Refused);
  assert.throws(() => defineBot({ ...base, limits: { perRun: 9, perDay: 5 } }), Refused);
});

test('raising a limit after going live is refused until go-live is repeated', async (t) => {
  const dir = tempDir(t);
  const { bot } = testBot([item('a')], { limits: { perRun: 2, perDay: 5 } });
  switchOn(dir, bot);
  const wider = testBot([item('a')], { limits: { perRun: 2, perDay: 500 } });
  await assert.rejects(live(wider.bot, dir), /limits.perDay is now 500 but go-live approved 5/);
  assert.deepEqual(wider.acted, []);
  assert.ok(bot);
});

test('practice obeys the same limits and keeps its own count', async (t) => {
  const dir = tempDir(t);
  const { bot } = testBot(many(5), { limits: { perRun: 2, perDay: 3 } });
  const first = await runBot(bot, { dir, judge: realishJudge(), approver: approveAll });
  assert.equal(first.sent, 2);
  const second = await runBot(bot, { dir, judge: realishJudge(), approver: approveAll });
  assert.equal(second.sent, 1);
  switchOn(dir, bot);
  const liveRun = await live(bot, dir);
  assert.equal(liveRun.sent, 2);
});
