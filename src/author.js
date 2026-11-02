// An AI author for bots that change files: your own `claude` program, limited to reading
// and editing files in one folder. It never runs commands; the bot runs the tests itself.
import { spawn } from 'node:child_process';
import { childEnv, explainFailure, findClaude } from './judges/claude-cli.js';

/**
 * @param {{ model?: string, timeoutMs?: number, found?: {file: string, shim: boolean} | null, spawnImpl?: typeof spawn }} [opts]
 */
export function claudeAuthor(opts = {}) {
  const model = opts.model ?? 'sonnet';
  if (!/^[\w.:[\]-]+$/.test(model)) throw new Error("that model name can't be passed safely");
  return {
    id: `claude:${model}`,
    model,
    /** Edits files under cwd to do what the prompt asks. Resolves with what the program said. */
    edit(cwd, prompt) {
      const found = opts.found === undefined ? findClaude() : opts.found;
      if (!found) return Promise.reject(new Error('the claude program is not on PATH'));
      const args = ['-p', '--safe-mode', '--restricted', '--no-session-persistence', '--tools', 'Read,Edit,Write,Glob,Grep', '--allowedTools', 'Read,Edit,Write,Glob,Grep', '--permission-mode', 'acceptEdits', '--model', model];
      const spawnImpl = opts.spawnImpl ?? spawn;
      const options = { cwd, env: childEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
      return new Promise((resolve, reject) => {
        const child = found.shim ? spawnImpl([`"${found.file}"`, ...args].join(' '), [], { ...options, shell: true }) : spawnImpl(found.file, args, { ...options, shell: false });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`the author gave no answer in ${Math.round((opts.timeoutMs ?? 600_000) / 1000)} seconds`));
        }, opts.timeoutMs ?? 600_000);
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(stdout.trim());
          else reject(new Error(`the author failed: ${explainFailure(stdout, stderr)}`));
        });
        child.stdin.end(prompt);
      });
    },
  };
}
