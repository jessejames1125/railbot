// The after-the-fact check. Failure is expected sometimes; what matters is that it is
// found and undone. Each action that ran gets the bot's verify(); anything that broke is
// undone if it ran without a person, and otherwise stops the bot until someone looks.
import { Journal } from './journal.js';
import { paths, takeLock, writeStop } from './files.js';
import { foldState } from './state.js';

const AUTOMATIC = new Set(['auto', 'checker']);

/**
 * @param {any} bot from defineBot, with verify(item, ctx) and optionally undo(item, ctx)
 * @param {{ dir: string, mode?: 'practice'|'live', readTools?: any, writeTools?: any, clock?: () => Date, ui?: (e: any) => void }} opts
 */
export async function nightly(bot, opts) {
  const mode = opts.mode ?? 'practice';
  const ui = opts.ui ?? (() => {});
  const p = paths(opts.dir, bot.name);
  const out = { checked: 0, ok: 0, undone: [], broken: [], unchecked: [], stopped: null };
  if (typeof bot.verify !== 'function') return { ...out, note: 'this bot has no verify(), so there is nothing to check' };
  const release = takeLock(p.lock, 'nightly');
  try {
    const journal = new Journal(p.journal, { clock: opts.clock });
    const routes = new Map();
    for (const e of journal.events) if (e.type === 'gated' && e.mode === mode) routes.set(e.id, e);
    const ran = [...foldState(journal.events).values()].filter((s) => s.mode === mode && (s.status === 'done' || s.status === 'practiced') && !s.verifiedAt);
    journal.append('nightly-start', { mode, items: ran.length });
    for (const s of ran) {
      out.checked++;
      const item = { ...s.item, action: s.action };
      const gated = routes.get(s.id) ?? {};
      let why;
      try {
        why = await bot.verify(item, { read: opts.readTools ?? {}, result: s.result ?? null, mode });
      } catch (e) {
        out.unchecked.push({ id: s.id, error: e.message });
        ui({ type: 'nightly-unchecked', id: s.id, error: e.message });
        continue;
      }
      if (!why) {
        out.ok++;
        journal.append('verified', { mode, id: s.id });
        continue;
      }
      const reason = String(why);
      const undoText = gated.undo ?? 'no undo was declared';
      if (AUTOMATIC.has(gated.route) && typeof bot.undo === 'function') {
        try {
          if (mode === 'live') await bot.undo(item, { ...(opts.writeTools ?? {}), result: s.result ?? null });
          journal.append('undone', { mode, id: s.id, reason, how: undoText, ...(mode === 'practice' ? { practice: true } : {}) });
          out.undone.push({ id: s.id, reason });
          ui({ type: 'nightly-undone', id: s.id, reason, how: undoText });
          continue;
        } catch (e) {
          journal.append('broken', { mode, id: s.id, reason: `${reason}; undo failed: ${e.message}` });
          out.broken.push({ id: s.id, reason: `${reason}; undo failed: ${e.message}`, how: undoText });
          continue;
        }
      }
      journal.append('broken', { mode, id: s.id, reason });
      out.broken.push({ id: s.id, reason, how: undoText });
    }
    if (out.broken.length) {
      const first = out.broken[0];
      out.stopped = `nightly check: ${out.broken.length} broken, first ${first.id}: ${first.reason}. Undo by hand: ${first.how}`;
      writeStop(p.stop, out.stopped);
      journal.append('stopped', { mode, reason: out.stopped });
      ui({ type: 'stopped', reason: out.stopped });
    }
    journal.append('nightly-end', { mode, ok: out.ok, undone: out.undone.length, broken: out.broken.length });
    return out;
  } finally {
    release();
  }
}
