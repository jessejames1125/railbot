// Runs the user's own unmodified `claude` program. railbot never reads, stores or
// passes on any login: the program signs in by itself. All tools are switched off
// and the outside text goes in on stdin, so it never touches a command line.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { buildPrompt } from './prompt.js';
import { parseVerdictText, verdictSchema } from '../verdict.js';

export const DEFAULT_CLI_MODEL = 'sonnet';

/** Find the program on PATH. Returns its path and whether it is a Windows shim. */
export function findClaude(env = process.env, platform = process.platform) {
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const file = join(dir, name);
      if (existsSync(file)) return { file, shim: name.endsWith('.cmd') };
    }
  }
  return null;
}

/** The environment the program gets: no repository tokens, and none of our own settings. */
export function childEnv(env = process.env) {
  const out = { ...env };
  for (const key of ['GITHUB_TOKEN', 'GH_TOKEN', 'CLAUDECODE']) delete out[key];
  return out;
}

/**
 * @param {{ model?: string, effort?: string, timeoutMs?: number, spawnImpl?: typeof spawn, found?: {file: string, shim: boolean} }} [opts]
 */
export function claudeCliJudge(opts = {}) {
  const model = opts.model ?? DEFAULT_CLI_MODEL;
  const spawnImpl = opts.spawnImpl ?? spawn;
  return {
    name: 'claude',
    model,
    canGoLive: true,
    needsAttendedLive: true,
    async decide({ bot, item }) {
      const found = opts.found ?? findClaude();
      if (!found) throw new Error('the claude program is not on PATH');
      const { system, user } = buildPrompt(bot, item);
      // An empty folder, so no project file or setting can reach the judge.
      const cwd = mkdtempSync(join(tmpdir(), 'railbot-judge-'));
      try {
        const args = [
          '-p',
          '--safe-mode',
          '--tools', '',
          '--no-session-persistence',
          '--output-format', 'json',
          '--model', model,
        ];
        if (opts.effort) args.push('--effort', opts.effort);
        let input = user;
        if (found.shim) {
          // A .cmd can only run through cmd.exe, so nothing but fixed words may be an argument.
          const promptFile = join(cwd, 'system.txt');
          writeFileSync(promptFile, system);
          args[args.indexOf('--tools') + 1] = '""';
          args.push('--system-prompt-file', promptFile);
          input = `${user}\n\nAnswer with JSON only: {"decision": "approve|reject|hold", "reason": "...", "injection_seen": true|false, "edits": {...}}`;
        } else {
          args.push('--system-prompt', system, '--json-schema', JSON.stringify(verdictSchema(item)));
        }
        const out = await runProgram(spawnImpl, found, args, input, cwd, opts.timeoutMs ?? 180_000);
        return readCliResult(out);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  };
}

function runProgram(spawnImpl, found, args, input, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(found.file, args, { cwd, env: childEnv(), shell: found.shim, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the claude program gave no answer in ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`the claude program exited with ${code}: ${firstLine(stderr || stdout)}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function firstLine(text) {
  return String(text).trim().split('\n')[0].slice(0, 200);
}

/** @param {string} out the program's stdout in --output-format json */
export function readCliResult(out) {
  const wrapper = JSON.parse(out);
  if (wrapper.is_error) throw new Error(`the claude program reported an error: ${firstLine(wrapper.result ?? wrapper.subtype)}`);
  if (wrapper.structured_output) return wrapper.structured_output;
  return parseVerdictText(wrapper.result);
}
