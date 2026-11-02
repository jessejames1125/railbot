// Times the README's first run on a clean folder with an empty npm cache: from typing
// `npx create-railbot my-bot` to the first run's result on screen.
//
//   node evals/first-run/run.mjs [runs]          uses a local stand-in registry
//   node evals/first-run/run.mjs [runs] --npm    uses the real npm registry, once published
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRegistry } from './local-registry.mjs';

const runs = Number(process.argv[2] ?? 3);
const useNpm = process.argv.includes('--npm');

const sh = (command, cwd, env) => new Promise((done) => {
  const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('close', (status) => done({ status, out }));
});

const times = [];
for (let i = 0; i < runs; i++) {
  const work = mkdtempSync(join(tmpdir(), 'railbot-first-run-'));
  const registry = useNpm ? null : await startRegistry(work);
  const clean = join(work, 'clean');
  const home = join(work, 'home');
  mkdirSync(clean);
  mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, npm_config_cache: join(work, 'cache'), npm_config_update_notifier: 'false', GITHUB_TOKEN: '', GH_TOKEN: '', ...(registry ? { npm_config_registry: registry.url } : {}) };
  const started = Date.now();
  const made = await sh('npx --yes create-railbot my-bot', clean, env);
  if (made.status !== 0) throw new Error(made.out);
  const first = await sh('npm start', join(clean, 'my-bot'), env);
  if (first.status !== 0 || !/waiting for a person/.test(first.out)) throw new Error(first.out);
  const seconds = (Date.now() - started) / 1000;
  times.push(seconds);
  console.log(`Run ${i + 1}: ${seconds.toFixed(1)}s`);
  registry?.close();
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows can hold a temp folder a moment longer.
  }
}
console.log(`${useNpm ? 'npm registry' : 'Local stand-in registry'}, Node ${process.version}, ${process.platform}: fastest ${Math.min(...times).toFixed(1)}s, slowest ${Math.max(...times).toFixed(1)}s over ${runs} runs.`);
