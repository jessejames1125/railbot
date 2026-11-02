// The README's commands, for real: npx from a throwaway local registry, npm install,
// npm start, the audit command. No package is published anywhere.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { tempDir } from './helpers.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const npm = (args, opts) => spawnSync(`npm ${args}`, { encoding: 'utf8', shell: true, ...opts });

function pack(dir, into) {
  const res = npm(`pack --silent --pack-destination "${into}"`, { cwd: dir });
  assert.equal(res.status, 0, res.stderr);
  return join(into, res.stdout.trim().split('\n').at(-1));
}

/** Just enough of the npm registry protocol to serve two local tarballs. */
async function localRegistry(t, tarballs) {
  const server = createServer((req, res) => {
    const name = decodeURIComponent(req.url.slice(1)).split('?')[0];
    const base = `http://127.0.0.1:${server.address().port}`;
    if (name.endsWith('.tgz')) {
      const file = tarballs[name.replace(/-\d.*$/, '')];
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(readFileSync(file));
    }
    const file = tarballs[name];
    if (!file) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{}');
    }
    const bytes = readFileSync(file);
    const manifest = JSON.parse(readFileSync(join(ROOT, name === 'railbot' ? '' : 'packages/create-railbot', 'package.json'), 'utf8'));
    const version = manifest.version;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      name,
      'dist-tags': { latest: version },
      versions: { [version]: { ...manifest, dist: { tarball: `${base}/${name}-${version}.tgz`, shasum: createHash('sha1').update(bytes).digest('hex') } } },
    }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/`;
}

function run(command, cwd, env) {
  return new Promise((done) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (status) => done({ status, out }));
  });
}

test('npx create-railbot my-bot, then npm start, on a clean folder', { timeout: 180_000 }, async (t) => {
  const work = tempDir(t);
  const tarballs = { railbot: pack(ROOT, work), 'create-railbot': pack(join(ROOT, 'packages', 'create-railbot'), work) };
  const registry = await localRegistry(t, tarballs);
  const clean = join(work, 'clean');
  mkdirSync(clean);
  const env = {
    ...process.env,
    npm_config_registry: registry,
    npm_config_cache: join(work, 'npm-cache'),
    npm_config_update_notifier: 'false',
    HOME: work,
    USERPROFILE: work,
    NO_COLOR: '1',
  };

  const made = await run('npx --yes create-railbot my-bot', clean, env);
  assert.equal(made.status, 0, made.out);
  const bot = join(clean, 'my-bot');
  assert.ok(existsSync(join(bot, 'node_modules', 'railbot', 'package.json')));
  assert.deepEqual(readdirSync(join(bot, 'node_modules')).filter((n) => !n.startsWith('.')), ['railbot'], 'railbot brings nothing else');

  const started = await run('npm start', bot, env);
  assert.equal(started.status, 0, started.out);
  assert.match(started.out, /Practice mode/);
  assert.match(started.out, /Judge: recorded \(claude sonnet/);
  assert.match(started.out, /reject\s+Reply to billing-admin/);
  assert.match(started.out, /The message is a prompt-injection attempt/);
  assert.match(started.out, /flag: message tells the reader to ignore instructions/);
  assert.match(started.out, /3 waiting for a person/);
  assert.equal(existsSync(join(bot, 'outbox')), false, 'practice wrote nothing to the outbox');

  const audit = await run('npm run audit', bot, env);
  assert.equal(audit.status, 0, audit.out);
  assert.match(audit.out, /Verified: \d+ events/);

  // Approving from a script is refused on purpose.
  const review = await run('npx railbot review', bot, env);
  assert.notEqual(review.status, 0);
  assert.match(review.out, /real terminal/);
  const goLive = await run('npx railbot go-live', bot, env);
  assert.notEqual(goLive.status, 0);
  const live = await run('npx railbot run bot.js --live', bot, env);
  assert.equal(live.status, 4);
  assert.match(live.out, /for practice only/);

  const stop = await run('npx railbot stop "testing the stop"', bot, env);
  assert.equal(stop.status, 0, stop.out);
  const stopped = await run('npm start', bot, env);
  assert.notEqual(stopped.status, 0);
  assert.match(stopped.out, /testing the stop/);
  await run('npx railbot resume', bot, env);

  const check = await run('npx railbot check bot.js', bot, env);
  assert.equal(check.status, 0, check.out);
  assert.match(check.out, /Valid/);
});

test('a project made from a built-in bot is a file you own that imports only railbot', (t) => {
  const work = tempDir(t);
  const cli = join(ROOT, 'src', 'cli.js');
  const res = spawnSync(process.execPath, [cli, 'new', 'keep-prs', '--bot', 'stale-prs', '--repo', 'o/r', '--no-install'], { cwd: work, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const source = readFileSync(join(work, 'keep-prs', 'bot.js'), 'utf8');
  assert.match(source, /from 'railbot'/);
  assert.match(source, /from 'railbot\/bots\/lib.js'/);
  assert.match(source, /name: 'keep-prs'/);
  assert.equal(source.includes('../engine.js'), false);
  const pkg = JSON.parse(readFileSync(join(work, 'keep-prs', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'railbot run bot.js --repo o/r');
});

test('new refuses a non-empty folder and bad names', (t) => {
  const work = tempDir(t);
  const cli = join(ROOT, 'src', 'cli.js');
  writeFileSync(join(work, 'x'), '');
  mkdirSync(join(work, 'full'));
  writeFileSync(join(work, 'full', 'keep.txt'), 'mine');
  const full = spawnSync(process.execPath, [cli, 'new', 'full', '--no-install'], { cwd: work, encoding: 'utf8' });
  assert.notEqual(full.status, 0);
  assert.match(full.stdout + full.stderr, /not empty/);
  const bad = spawnSync(process.execPath, [cli, 'new', 'Bad Name!', '--no-install'], { cwd: work, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
});
