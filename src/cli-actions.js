// The commands a person runs between bot runs. Each one takes the lock and writes
// to the log, so the record shows who changed what, and when.
import { rmSync } from 'node:fs';
import { Journal } from './journal.js';
import { paths, takeLock, writeJsonAtomic } from './files.js';
import { foldState, stateKey } from './state.js';

const withJournal = (dir, botName, fn) => {
  const p = paths(dir, botName);
  const release = takeLock(p.lock, 'command');
  try {
    return fn(new Journal(p.journal), p);
  } finally {
    release();
  }
};

/** @param {string} words what the person typed */
export function goLive(dir, bot, words) {
  const expected = `live ${bot.name}`;
  if (words.trim() !== expected) throw new Error(`Live mode stays off: type exactly "${expected}".`);
  return withJournal(dir, bot.name, (journal, p) => {
    const limits = { perRun: bot.limits.perRun, perDay: bot.limits.perDay };
    writeJsonAtomic(p.live, { bot: bot.name, limits, words, at: new Date().toISOString() });
    journal.append('live-on', { bot: bot.name, limits, words });
    return limits;
  });
}

export function goPractice(dir, bot) {
  withJournal(dir, bot.name, (journal, p) => {
    rmSync(p.live, { force: true });
    journal.append('live-off', { bot: bot.name });
  });
}

function findItem(journal, botName, id, modes) {
  const items = foldState(journal.events);
  for (const mode of modes) {
    const found = items.get(stateKey(mode, id));
    if (found) return found;
  }
  throw new Error(`${botName} has no item "${id}".`);
}

/** A person says what really happened to an item left in doubt by a crash. */
export function resolveItem(dir, botName, id, outcome, note = '') {
  if (!['done', 'failed'].includes(outcome)) throw new Error('Say "done" (it went out) or "failed" (it did not).');
  return withJournal(dir, botName, (journal) => {
    const entry = findItem(journal, botName, id, ['live', 'practice']);
    if (entry.status !== 'in-doubt') throw new Error(`"${id}" is ${entry.status}, not in doubt.`);
    journal.append('resolved', { mode: entry.mode, id, outcome, note, by: 'terminal' });
  });
}

/**
 * Sends a closed item back to the approval queue. It needs a fresh yes.
 * @param {{ attended?: boolean }} [opts] whether a person is at a terminal
 */
export function reopenItem(dir, botName, id, note = '', { attended = false } = {}) {
  return withJournal(dir, botName, (journal) => {
    const entry = findItem(journal, botName, id, ['live', 'practice']);
    if (entry.status === 'denied') throw new Error(`A person said no to "${id}", and that is final.`);
    if (entry.status === 'blocked') throw new Error(`"${id}" was blocked by the outbound check or a changed draft, so it stays closed. Change the bot and let it propose again under a new id.`);
    if (entry.status === 'rejected' && !attended) throw new Error(`The judge rejected "${id}". Overriding that takes a person at a real terminal.`);
    if (entry.status === 'in-doubt') throw new Error(`"${id}" is in doubt. Run "railbot resolve ${id} done" or "failed" first, so the record says what happened.`);
    if (entry.status === 'done') throw new Error(`"${id}" already went out. Reopening it could send it twice, so that is refused.`);
    journal.append('reopened', { mode: entry.mode, id, note, by: 'terminal' });
  });
}
