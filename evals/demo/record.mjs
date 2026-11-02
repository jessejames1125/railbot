// Records the first run in a real pseudo-terminal, typing the answers a person would.
// Nothing here fakes output: it runs the same commands as the README against tarballs
// served from a throwaway local registry, because the package may not be published yet.
//
//   npm install --no-save node-pty @xterm/headless
//   node evals/demo/record.mjs out.cast
//
// The result is an asciicast v2 file. evals/demo/render.mjs turns it into docs/first-run.gif.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startRegistry } from '../first-run/local-registry.mjs';

const require = createRequire(process.env.DEMO_TOOLS ? join(process.env.DEMO_TOOLS, 'x.js') : import.meta.url);
const pty = require('node-pty');
const outFile = resolve(process.argv[2] ?? 'first-run.cast');

const work = mkdtempSync(join(tmpdir(), 'railbot-demo-'));
const server = await startRegistry(work);

const cols = 96;
const rows = 34;
const home = join(work, 'home');
const clean = join(work, 'clean');
mkdirSync(home);
mkdirSync(clean);

const events = [];
const started = Date.now();
const stamp = () => (Date.now() - started) / 1000;
const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
const term = pty.spawn(shell, process.platform === 'win32' ? ['/k', 'cls'] : ['--norc', '--noprofile'], {
  cols, rows, cwd: clean,
  env: {
    ...process.env, HOME: home, USERPROFILE: home, npm_config_registry: server.url, npm_config_cache: join(work, 'cache'),
    npm_config_update_notifier: 'false', PROMPT: '$$ ', PS1: '$ ', GITHUB_TOKEN: '', GH_TOKEN: '', npm_config_loglevel: 'error',
  },
});

let screen = '';
term.onData((d) => {
  events.push([stamp(), 'o', d]);
  screen += d;
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pattern, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pattern.test(screen)) {
      screen = '';
      return;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${pattern}\n--- screen ---\n${screen.slice(-1500)}`);
}
async function type(text) {
  for (const ch of text) {
    term.write(ch);
    await sleep(40);
  }
  term.write('\r');
}

try {
  await sleep(800);
  await type('npx create-railbot my-bot');
  await waitFor(/Ok to proceed/);
  await sleep(700);
  await type('y');
  await waitFor(/npm start/);
  await sleep(1200);
  await type('cd my-bot');
  await sleep(500);
  await type('npm start');
  for (const answer of ['a', 'a', 'a']) {
    await waitFor(/\[q\]uit/);
    await sleep(1100);
    await type(answer);
  }
  await waitFor(/Audit log/);
  await sleep(1200);
  await type('npx railbot audit --item reply-to-5-injection.txt');
  await waitFor(/closed/);
  await sleep(800);
  term.kill();
} finally {
  server.close();
  await sleep(200);
  writeFileSync(outFile, [JSON.stringify({ version: 2, width: cols, height: rows }), ...events.map((e) => JSON.stringify(e))].join('\n'));
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows holds the folder a moment longer after the shell goes. It is a temp folder.
  }
}
console.log(`Wrote ${outFile}: ${events.length} events over ${stamp().toFixed(1)}s`);
