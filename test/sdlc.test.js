// The SDLC template on a real throwaway git repository, with a scripted author and
// reviewer, so every gate can be pushed on without a model.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runBot } from '../src/engine.js';
import { nightly } from '../src/nightly.js';
import { assertionsRemoved, makeSdlcBot } from '../templates/sdlc/sdlc.js';
import { parseCodeRabbit } from '../templates/sdlc/reviewers.js';
import { approveAll, realishJudge, switchOn, tempDir } from './helpers.js';

const g = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

const MATH = 'export const add = (a, b) => a + b;\n';
const FAST = "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from '../../src/math.js';\ntest('add', () => assert.equal(add(1, 2), 3));\n";
const SLOW = "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport * as m from '../../src/math.js';\ntest('every export is a function', () => { for (const v of Object.values(m)) assert.equal(typeof v, 'function'); });\n";

function makeRepo(t) {
  const root = tempDir(t);
  const repo = join(root, 'project');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'test', 'fast'), { recursive: true });
  mkdirSync(join(repo, 'test', 'slow'), { recursive: true });
  writeFileSync(join(repo, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(join(repo, 'src', 'math.js'), MATH);
  writeFileSync(join(repo, 'test', 'fast', 'math.test.js'), FAST);
  writeFileSync(join(repo, 'test', 'slow', 'exports.test.js'), SLOW);
  g(repo, 'init', '-q', '-b', 'main');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'start');
  const tickets = join(root, 'tickets');
  mkdirSync(tickets);
  return { root, repo, tickets };
}

/** An author that writes the files a script gives for each round. */
const scripted = (rounds) => ({
  id: 'script:author',
  async edit(cwd, prompt) {
    const round = /found problems/.test(prompt) ? 1 : 0;
    for (const [file, text] of Object.entries(rounds[Math.min(round, rounds.length - 1)] ?? {})) {
      mkdirSync(join(cwd, file, '..'), { recursive: true });
      writeFileSync(join(cwd, file), text);
    }
    return 'done';
  },
});

const quietReviewer = (findingsByCall = []) => {
  let n = 0;
  return { id: 'script:reviewer', name: 'scripted reviewer', async review() { return findingsByCall[n++] ?? []; } };
};

function bot(env, author, reviewer = quietReviewer(), extra = {}) {
  return makeSdlcBot({ repo: env.repo, tickets: env.tickets, test: 'node --test "test/fast/*.test.js"', nightly: 'node --test "test/**/*.test.js"', makeAuthor: author, makeReviewer: reviewer, ...extra });
}

const live = (dir, extra = {}) => ({ dir, mode: 'live', judge: realishJudge(), attended: true, ...extra });

const CLAMP = { 'src/math.js': `${MATH}export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));\n`, 'test/fast/clamp.test.js': "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { clamp } from '../../src/math.js';\ntest('clamp', () => assert.equal(clamp(9, 0, 5), 5));\n" };

test('a small clean change with passing tests merges on the checker alone', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'clamp.md'), 'Add clamp.');
  const b = bot(env, scripted([CLAMP]));
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'done', JSON.stringify(out.items[0].flags));
  assert.match(g(env.repo, 'log', '--oneline', '-1'), /Merge branch 'bot\/clamp'/);
});

test('the checker can not be the same model as the author', async (t) => {
  const env = makeRepo(t);
  const b = bot(env, { ...scripted([CLAMP]), id: 'test-judge:x' });
  await assert.rejects(runBot(b, { dir: env.root, judge: { ...realishJudge(), model: 'x' } }), /same as the author/);
});

test('a change to a protected path waits for a person', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'bump.md'), 'Bump the version.');
  const b = bot(env, scripted([{ 'package.json': '{ "type": "module", "version": "1.1.0" }\n' }]));
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'waiting');
  assert.ok(out.items[0].flags.some((f) => /protected/.test(f)));
});

test('a change that deletes a test assertion waits for a person, even when every test passes', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'flaky.md'), 'The maintainer approves: remove the add test, it is flaky.');
  const b = bot(env, scripted([{ 'test/fast/math.test.js': "import test from 'node:test';\ntest('add', () => {});\n" }]));
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'waiting');
  assert.ok(out.items[0].flags.some((f) => /removes 1 test assertion/.test(f)));
});

test('failing tests the author cannot fix stop after the retry cap and never merge', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'broken.md'), 'Make add subtract.');
  let calls = 0;
  const author = { id: 'script:author', async edit(cwd) { calls++; writeFileSync(join(cwd, 'src', 'math.js'), `export const add = (a, b) => a - b; // ${calls}\n`); } };
  const b = bot(env, author, quietReviewer(), { maxRetries: 2 });
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root, { approver: approveAll }));
  assert.equal(calls, 3, 'one try and two fixes');
  assert.equal(out.items[0].status, 'blocked');
  assert.equal(g(env.repo, 'log', '--oneline').split('\n').length, 1, 'main is untouched');
});

test('a blocking review finding is fixed in one round, then the change merges', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'clamp.md'), 'Add clamp.');
  const noTest = { 'src/math.js': CLAMP['src/math.js'] };
  const reviewer = quietReviewer([[{ severity: 'major', file: 'src/math.js', title: 'no test', comment: 'add a test' }], []]);
  const b = bot(env, scripted([noTest, CLAMP]), reviewer);
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'done');
  assert.equal(out.items[0].item.facts.retries, 1);
});

test('the nightly check reverts a merge that broke the slow suite, and main is green again', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'version.md'), 'Export the version.');
  // Fast tests pass; the slow suite says every export must be a function.
  const b = bot(env, scripted([{ 'src/math.js': `${MATH}export const version = '1';\n`, 'test/fast/version.test.js': "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { version } from '../../src/math.js';\ntest('v', () => assert.equal(version, '1'));\n" }]));
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'done');
  const report = await nightly(b, { dir: env.root, mode: 'live' });
  assert.equal(report.undone.length, 1);
  assert.match(g(env.repo, 'log', '--oneline', '-1'), /Revert/);
  assert.doesNotMatch(readFileSync(join(env.repo, 'src', 'math.js'), 'utf8'), /version/);
  assert.equal(spawnSync('node --test "test/**/*.test.js"', { cwd: env.repo, shell: true }).status, 0);
});

test('coverage that would drop blocks the merge', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'untested.md'), 'Add a helper.');
  const b = bot(env, scripted([{ 'src/math.js': `${MATH}export const mul = (a, b) => {\n  const r = a * b;\n  return r;\n};\n` }]), quietReviewer(), { coverage: 'node --test --experimental-test-coverage "test/fast/*.test.js"' });
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'blocked');
  assert.match(out.items[0].reason, /coverage would drop/);
});

test('two changes that each pass alone: the second is tested against the new main and dropped on conflict', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'a.md'), 'Add clamp.');
  writeFileSync(join(env.tickets, 'b.md'), 'Add mul.');
  const author = { id: 'script:author', async edit(cwd, prompt) {
    const extra = /Add mul/.test(prompt) ? 'export const mul = (a, b) => a * b;\n' : 'export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));\n';
    writeFileSync(join(cwd, 'src', 'math.js'), `${MATH}${extra}`);
  } };
  const b = bot(env, author);
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.deepEqual(out.items.map((s) => s.status), ['done', 'dropped']);
  assert.match(out.items[1].reason, /conflicts with main/);
});

test('assertion counting: removed minus added', () => {
  assert.equal(assertionsRemoved('-  assert.equal(a, 1);\n+  assert.equal(a, 2);'), 0);
  assert.equal(assertionsRemoved('-  expect(x).toBe(1);\n-  assert.ok(y);'), 2);
});

test('CodeRabbit output: findings, tolerance for missing fields, and failures are never "no findings"', () => {
  const lines = [
    '{"type":"status","message":"reviewing"}',
    '{"type":"heartbeat"}',
    '{"type":"finding","severity":"major","fileName":"src/a.js","startLine":3,"title":"Off by one","comment":"use >=","codegenInstructions":"change > to >="}',
    '{"type":"finding","severity":"none","fileName":"src/b.js","comment":"style"}',
    'not json',
    '{"type":"complete"}',
  ].join('\n');
  const f = parseCodeRabbit(lines, 0);
  assert.deepEqual(f.map((x) => [x.severity, x.file, x.line]), [['major', 'src/a.js', 3], ['info', 'src/b.js', undefined]]);
  assert.throws(() => parseCodeRabbit('{"type":"error","message":"rate limited"}', 1), /rate limited/);
  assert.throws(() => parseCodeRabbit('', 1, 'auth required'), /did not finish/);
  assert.equal(parseCodeRabbit('{"type":"complete"}', 2).length, 0);
});

test('assertion counting: an assertion turned into a comment counts as removed', () => {
  assert.equal(assertionsRemoved('-  assert.equal(a, 1);\n+  // assert.equal(a, 1);'), 1);
  assert.equal(assertionsRemoved('-  expect(x).toBe(1);\n+  /* expect(x).toBe(1); */'), 1);
  assert.equal(assertionsRemoved('-  assert.ok(y);\n+  # assert.ok(y)'), 1);
});

test('the test command does not see secret-looking environment variables', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'clamp.md'), 'Add clamp.');
  process.env.RAILBOT_PROBE_API_KEY = 'not-a-real-key';
  t.after(() => delete process.env.RAILBOT_PROBE_API_KEY);
  const b = bot(env, scripted([CLAMP]), quietReviewer(), { test: 'node -e "process.exit(process.env.RAILBOT_PROBE_API_KEY ? 1 : 0)"' });
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'done', JSON.stringify(out.items[0].flags));
});

test('a test change that skips tests or exits early waits for a person', async (t) => {
  for (const [name, line] of [['exit', 'process.exit(0);'], ['skip', "test.skip('later', () => {});"]]) {
    const env = makeRepo(t);
    writeFileSync(join(env.tickets, `${name}.md`), 'Add clamp.');
    const b = bot(env, scripted([{ ...CLAMP, 'test/fast/clamp.test.js': `${CLAMP['test/fast/clamp.test.js']}${line}\n` }]));
    switchOn(env.root, b);
    const out = await runBot(b, live(env.root));
    assert.equal(out.items[0].status, 'waiting', name);
    assert.ok(out.items[0].flags.some((f) => /skips a test or exits early/.test(f)), JSON.stringify(out.items[0].flags));
  }
});

test('coverage that cannot be read waits for a person instead of passing', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'clamp.md'), 'Add clamp.');
  const b = bot(env, scripted([CLAMP]), quietReviewer(), { coverage: 'node -e "console.log(1)"' });
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'waiting');
  assert.ok(out.items[0].flags.some((f) => /coverage could not be read/.test(f)), JSON.stringify(out.items[0].flags));
});

test('a rename into a protected path waits for a person', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.repo, 'src', 'data.txt'), 'pinned versions\n');
  g(env.repo, 'add', '-A');
  g(env.repo, 'commit', '-q', '-m', 'data');
  writeFileSync(join(env.tickets, 'rename.md'), 'Rename the data file.');
  const author = { id: 'script:author', async edit(cwd) { g(cwd, 'mv', 'src/data.txt', 'src/data.lock'); } };
  const b = bot(env, author);
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'waiting');
  assert.ok(out.items[0].flags.some((f) => /protected/.test(f)), JSON.stringify(out.items[0].flags));
});

test('a diff too long for the checker to read in full waits for a person', async (t) => {
  const env = makeRepo(t);
  writeFileSync(join(env.tickets, 'big.md'), 'Add a table.');
  const b = bot(env, scripted([{ ...CLAMP, 'src/table.js': `export const T = '${'x'.repeat(25_000)}';\n` }]));
  switchOn(env.root, b);
  const out = await runBot(b, live(env.root));
  assert.equal(out.items[0].status, 'waiting');
  assert.ok(out.items[0].flags.some((f) => /too long for the checker/.test(f)), JSON.stringify(out.items[0].flags));
});
