// Where a bot keeps its files, the stop file, the run lock and the live switch.
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

/** A path for people to read: short, and free of the machine's user folder. */
export function shortPath(file, cwd = process.cwd()) {
  const rel = relative(cwd, file);
  if (!rel.startsWith('..')) return rel || '.';
  const home = homedir();
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}

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
      return `${shortPath(file)} exists${words ? `: ${words}` : ''}`;
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

/** Creates the lock whole: no other process can ever read a half-written one. */
function placeLock(file, body) {
  const tmp = `${file}.${process.pid}.new`;
  writeFileSync(tmp, body);
  try {
    linkSync(tmp, file);
  } catch (e) {
    // Some network and removable drives have no hard links.
    if (e.code === 'EEXIST') throw e;
    writeFileSync(file, body, { flag: 'wx' });
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Clears a dead lock only if it is still the one we looked at. */
function clearDeadLock(file, seen) {
  const grave = `${file}.${process.pid}.dead`;
  try {
    renameSync(file, grave);
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  const moved = readFileSync(grave, 'utf8');
  if (moved !== seen) {
    try {
      linkSync(grave, file);
    } finally {
      rmSync(grave, { force: true });
    }
    return;
  }
  rmSync(grave, { force: true });
}

/** One writer per bot. A dead process's lock is taken over, a live one's is not. */
export function takeLock(file, what = 'run') {
  mkdirSync(dirname(file), { recursive: true });
  const body = JSON.stringify({ pid: process.pid, host: hostname(), what, at: new Date().toISOString() });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      placeLock(file, body);
      return () => {
        // Only ever removes our own.
        if (existsSync(file) && readFileSync(file, 'utf8') === body) rmSync(file, { force: true });
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let text = '';
      let held = null;
      try {
        text = readFileSync(file, 'utf8');
        held = JSON.parse(text);
      } catch {
        // Unreadable means an older crash tore it.
      }
      if (held && held.host === hostname() && pidAlive(held.pid)) {
        throw new Busy(`Another ${held.what} of this bot is in progress (process ${held.pid}). Wait for it to finish.`);
      }
      if (held && held.host !== hostname()) {
        throw new Busy(`Another machine holds this bot's lock (${held.host}). Delete ${file} only if you are sure it is gone.`);
      }
      clearDeadLock(file, text);
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
