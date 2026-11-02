// Rail: holes a security review found in the gates, each pinned by a test that failed first.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { notOptedOut } from '../src/checks.js';
import { defineBot, runBot } from '../src/engine.js';
import { nightly } from '../src/nightly.js';
import { realishJudge, switchOn, tempDir } from './helpers.js';

function bot(items, scope, extra = {}) {
  const acted = [];
  const b = defineBot({
    name: 'reviewed',
    limits: { perRun: 20, perDay: 50 },
    judge: { instructions: 'Approve good items.' },
    scope,
    propose: async () => items,
    act: async (it) => {
      acted.push(it.id);
      return { ok: true };
    },
    ...extra,
  });
  return { bot: b, acted };
}

const it = (id, type, extra = {}) => {
  const { action = {}, ...rest } = extra;
  return { id, title: `Do ${id}`, action: { type, body: `hello ${id}`, ...action }, ...rest };
};
const live = (dir, extra = {}) => ({ dir, mode: 'live', judge: realishJudge(), attended: true, ...extra });
const LOW = { actions: { tag: { risk: 'low', undo: 'remove the tag' } } };

test('a check that answers late, or with something unexpected, blocks', async (t) => {
  const answers = [
    async () => ({ block: 'async block' }),
    async () => {
      throw new Error('async boom');
    },
    () => false,
    () => true,
    () => ({ block: '' }),
    () => ({}),
    () => 7,
  ];
  for (const [n, check] of answers.entries()) {
    const dir = tempDir(t);
    const { bot: b, acted } = bot([it(`c${n}`, 'tag')], LOW, { checks: [check] });
    switchOn(dir, b);
    const out = await runBot(b, live(dir));
    assert.equal(out.items[0].status, 'blocked', `check ${n} should block`);
    assert.deepEqual(acted, []);
  }
});

test('an async check that passes or holds still works', async (t) => {
  const dir = tempDir(t);
  const { bot: b, acted } = bot([it('pass', 'tag'), it('hold', 'tag')], LOW, {
    checks: [async (item) => (item.id === 'hold' ? { hold: 'look at this' } : null)],
  });
  switchOn(dir, b);
  const out = await runBot(b, live(dir));
  assert.deepEqual(out.items.map((s) => s.status), ['done', 'waiting']);
  assert.deepEqual(acted, ['pass']);
});

test('the person\'s write list applies even when the bot declares none', async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'scope.json'), JSON.stringify({ writes: ['docs/**'] }));
  const { bot: b, acted } = bot(
    [
      it('ok', 'tag', { writes: ['docs/a.md'] }),
      it('out', 'tag', { writes: ['src/evil.js'] }),
      it('climb', 'tag', { writes: ['../x'] }),
      it('drive', 'tag', { writes: ['C:/x'] }),
    ],
    LOW,
  );
  switchOn(dir, b);
  const out = await runBot(b, live(dir));
  assert.deepEqual(out.items.map((s) => s.status), ['done', 'blocked', 'blocked', 'blocked']);
  assert.deepEqual(acted, ['ok']);
});

test('a locked subject is caught however the item spells it, and an unknown subject goes to a person', async (t) => {
  const dir = tempDir(t);
  const { bot: b, acted } = bot(
    [it('a', 'tag', { about: 'Refund' }), it('b', 'tag', { about: ' refunds ' }), it('c', 'tag', { about: 'PUBLIC-POST' }), it('d', 'tag', { about: 'refundz' }), it('e', 'tag')],
    LOW,
  );
  switchOn(dir, b);
  const out = await runBot(b, live(dir));
  assert.deepEqual(out.items.map((s) => s.status), ['waiting', 'waiting', 'waiting', 'waiting', 'done']);
  assert.deepEqual(acted, ['e']);
});

test('the checker counts as the author when it is the same model family under another name', async (t) => {
  const { bot: b } = bot([it('r', 'tag')], LOW, { author: 'claude:sonnet' });
  for (const judge of [
    { ...realishJudge(), name: 'anthropic', model: 'claude-sonnet-4-6' },
    { ...realishJudge(), name: 'claude', model: 'Sonnet' },
  ]) {
    await assert.rejects(runBot(b, { dir: tempDir(t), judge }), /same as the author/);
  }
  await runBot(b, { dir: tempDir(t), judge: { ...realishJudge(), name: 'claude', model: 'opus' } });
});

test('a high action with an empty or non-text undo cannot be lowered in scope.json', async (t) => {
  for (const undo of [' ', true]) {
    const dir = tempDir(t);
    writeFileSync(join(dir, 'scope.json'), JSON.stringify({ actions: { wire: 'low' } }));
    const { bot: b, acted } = bot([it('w', 'wire')], { actions: { wire: { risk: 'high', undo } } });
    switchOn(dir, b);
    const out = await runBot(b, live(dir));
    assert.equal(out.items[0].status, 'waiting');
    assert.ok(out.warnings.some((w) => /no way to undo/.test(w)));
    assert.deepEqual(acted, []);
  }
});

test('an action named after an object built-in is dropped when scope.json leaves it out', async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'scope.json'), JSON.stringify({ actions: { tag: 'low' } }));
  const { bot: b, acted } = bot([it('k', 'constructor'), it('t', 'tag')], { actions: { tag: { risk: 'low', undo: 'untag' }, constructor: { risk: 'low', undo: 'undo it' } } });
  switchOn(dir, b);
  const out = await runBot(b, live(dir));
  assert.deepEqual(out.items.map((s) => s.status), ['blocked', 'done']);
  assert.deepEqual(acted, ['t']);
});

test('the opt-out check reads every recipient of a list', () => {
  const check = notOptedOut(['gone@example.com']);
  assert.match(check({ action: { to: ['ok@example.com', 'Gone@Example.com'] } }).block, /gone@example.com opted out/);
  assert.equal(check({ action: { to: ['ok@example.com'] } }), null);
});

test('an item that cannot be checked three nights running stops the bot', async (t) => {
  const dir = tempDir(t);
  const { bot: b } = bot([it('t', 'tag')], LOW, { verify: async () => { throw new Error('offline'); }, undo: async () => {} });
  await runBot(b, { dir, judge: realishJudge() });
  const first = await nightly(b, { dir });
  const second = await nightly(b, { dir });
  assert.deepEqual([first.stopped, second.stopped], [null, null]);
  const third = await nightly(b, { dir });
  assert.match(third.stopped ?? '', /could not be checked on 3 nights/);
  assert.equal(third.undone.length, 0);
});
