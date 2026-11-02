// The starting templates: each one loads, stays inside its scope, and keeps its locks.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { runBot } from '../src/engine.js';
import { rulesJudge } from '../src/judges/index.js';
import { scaffold } from '../src/scaffold.js';
import { approveAll, tempDir } from './helpers.js';

const INDEX = pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.js')).href;

/** Makes the template, points its import at this checkout, and runs it from inside the folder. */
async function fromTemplate(t, name, setup = () => {}) {
  // Registered first so it runs before the temp folder is removed.
  const before = process.cwd();
  t.after(() => process.chdir(before));
  const dir = scaffold({ target: join(tempDir(t), `my-${name}`), bot: name, install: false }).dir;
  const file = join(dir, 'bot.js');
  writeFileSync(file, readFileSync(file, 'utf8').replace("from 'railbot'", `from '${INDEX}'`));
  setup(dir);
  process.chdir(dir);
  const bot = (await import(`${pathToFileURL(file).href}?${Date.now()}`)).default;
  const run = (extra = {}) => runBot(bot, { dir, judge: rulesJudge(), approver: approveAll, ...extra });
  return { dir, bot, run };
}

const byId = (out) => Object.fromEntries(out.items.map((s) => [s.id, s.status]));

test('every template README carries the no-expertise label', () => {
  for (const name of ['inbox', 'hr', 'sales', 'marketing', 'product']) {
    const text = readFileSync(join(import.meta.dirname, '..', 'templates', name, 'README.md'), 'utf8');
    assert.match(text, /Written by an engineer without/, name);
  }
});

test('hr: lists applications by itself and drafts decided messages only with a yes', async (t) => {
  const { run } = await fromTemplate(t, 'hr');
  const asked = [];
  const out = await run({ approver: { name: 'you', ask: async (e) => (asked.push(e.id), { decision: 'approve' }) } });
  assert.equal(byId(out)['summary-3'], 'practiced');
  assert.deepEqual(asked.sort(), ['message-jamie-no', 'message-sam-interview']);
});

test('hr: scope.json cannot unlock messages to candidates', async (t) => {
  const { run } = await fromTemplate(t, 'hr', (dir) => writeFileSync(join(dir, 'scope.json'), JSON.stringify({ actions: { 'write-summary': 'low', 'draft-message': 'low' } })));
  const out = await run({ approver: undefined });
  assert.ok(out.warnings.some((w) => w.startsWith('LOCKED')));
  assert.equal(byId(out)['message-sam-interview'], 'waiting');
});

test('hr: a draft that ranks a person goes to a person even if a judge approves', async (t) => {
  const { run } = await fromTemplate(t, 'hr', (dir) => {
    const d = JSON.parse(readFileSync(join(dir, 'decisions.json'), 'utf8'));
    d[0].slots = 'You ranked 2nd of 12, so Tuesday at 10';
    writeFileSync(join(dir, 'decisions.json'), JSON.stringify(d));
  });
  const out = await run({ approver: undefined });
  const ranked = out.items.find((s) => s.id === 'message-sam-interview');
  assert.ok(ranked.flags.some((f) => /never ranks/.test(f)));
});

test('sales: opted-out leads are blocked whatever their case, and unapproved claims are held', async (t) => {
  const { run } = await fromTemplate(t, 'sales', (dir) => writeFileSync(join(dir, 'claims.md'), '- Orders of 50 or more get 15% off.\n'));
  const out = await run({ approver: undefined });
  const s = byId(out);
  assert.equal(s['follow-up-CASEY@example.net'], 'blocked');
  assert.equal(s['follow-up-morgan@example.com'], 'waiting');
  assert.equal(Object.keys(s).length, 2, 'a lead who asked nothing gets nothing');
});

test('sales: a claim slipped into the body is held for a person', async (t) => {
  const { bot } = await fromTemplate(t, 'sales');
  const check = bot.checks[1];
  assert.equal(check({ action: { body: 'Orders of 50 or more get 15% off.' } }), null);
  assert.match(check({ action: { body: 'We are SOC 2 certified.' } }).hold, /SOC 2/);
});

test('marketing: drafts run by themselves, and nothing can be marked for posting without a yes', async (t) => {
  const { run } = await fromTemplate(t, 'marketing');
  const out = await run({ approver: undefined });
  assert.deepEqual(Object.values(byId(out)), ['practiced', 'practiced']);
});

test('product: notes update by themselves; changelog drafts wait', async (t) => {
  const { run } = await fromTemplate(t, 'product');
  const out = await run({ approver: undefined });
  const s = byId(out);
  assert.equal(s['notes-2'], 'practiced');
  assert.equal(s['changelog-saved-carts-keep-for-30-days'], 'waiting');
});
