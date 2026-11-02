// Where a bot keeps its files, the stop file, the run lock and the live switch.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const paths = (dir, botName) => {
  const state = join(dir, '.railbot', botName);
  return {
    state,
    journal: join(state, 'journal.jsonl'),
    lock: join(state, 'lock'),
    live: join(state, 'live.json'),
    stop: join(dir, 'STOP'),
    globalStop: join(homedir(), '.railbot', 'STOP'),
  };
};

/** Returns why everything must halt, or null. */
export function stopReason(p) {
  for (const file of [p.stop, p.globalStop]) {
    if (existsSync(file)) {
      const words = readFileSync(file, 'utf8').trim();
      return `${file} exists${words ? `: ${words}` : ''}`;
    }
  }
  return null;
}

export function writeStop(file, reason = '') {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, reason ? `${reason}\n` : '');
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export class Busy extends Error {}

/** One writer per bot. A dead process's lock is taken over, a live one's is not. */
export function takeLock(file, what = 'run') {
  mkdirSync(dirname(file), { recursive: true });
  const body = JSON.stringify({ pid: process.pid, host: hostname(), what, at: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, body, { flag: 'wx' });
      return () => rmSync(file, { force: true });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = null;
      try {
        held = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // Unreadable means it was torn by a crash at the moment of writing.
      }
      if (held && held.host === hostname() && pidAlive(held.pid)) {
        throw new Busy(`Another ${held.what} of this bot is in progress (process ${held.pid}). Wait for it to finish.`);
      }
      if (held && held.host !== hostname()) {
        throw new Busy(`Another machine holds this bot's lock (${held.host}). Delete ${file} only if you are sure it is gone.`);
      }
      rmSync(file, { force: true });
    }
  }
  throw new Busy(`Could not take the lock at ${file}.`);
}

export function readLive(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}
