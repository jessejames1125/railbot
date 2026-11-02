// One run: propose, judge, ask a human, act. Every step lands in the journal before
// the next one starts, so a crash at any point leaves a state the next run understands.
import { createHash } from 'node:crypto';
import { checkOutbound } from './outbound.js';
import { Journal } from './journal.js';
import { paths, readLive, stopReason, takeLock } from './files.js';
import { TERMINAL, foldState, sendsInWindow, stateKey } from './state.js';
import { tripwire } from './untrusted.js';
import { applyVerdict } from './verdict.js';

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export class Refused extends Error {}

/** @param {any} def */
export function defineBot(def) {
  const fail = (why) => {
    throw new Refused(`This bot can't run: ${why}`);
  };
  if (!NAME.test(def?.name ?? '')) fail('name must be lowercase letters, digits and hyphens');
  if (typeof def.propose !== 'function') fail('it needs a propose(ctx) function');
  if (typeof def.judge?.instructions !== 'string' || !def.judge.instructions.trim()) {
    fail('judge.instructions must say what a good item looks like');
  }
  for (const key of ['perRun', 'perDay']) {
    if (!Number.isInteger(def.limits?.[key]) || def.limits[key] < 1) fail(`limits.${key} must be a whole number of 1 or more`);
  }
  if (def.limits.perRun > def.limits.perDay) fail('limits.perRun is larger than limits.perDay');
  return Object.freeze({
    ...def,
    limits: Object.freeze({ perRun: def.limits.perRun, perDay: def.limits.perDay, judgeCallsPerRun: def.limits.judgeCallsPerRun ?? 25 }),
    judge: Object.freeze({ ...def.judge }),
  });
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function normalizeItem(raw) {
  if (typeof raw?.id !== 'string' || !raw.id || raw.id.length > 200) throw new Error('an item needs a string id of 200 characters or fewer');
  if (typeof raw.title !== 'string' || !raw.title) throw new Error(`item ${raw.id} needs a title`);
  if (!raw.action || typeof raw.action !== 'object') throw new Error(`item ${raw.id} needs an action object`);
  const sends = raw.sends ?? 1;
  if (!Number.isInteger(sends) || sends < 1) throw new Error(`item ${raw.id} has a bad sends count`);
  return {
    id: raw.id,
    title: raw.title,
    action: raw.action,
    facts: raw.facts ?? {},
    untrusted: raw.untrusted ?? {},
    touches: raw.touches ?? ['people'],
    sends,
    editable: raw.editable ?? {},
    outbound: raw.outbound ?? null,
    rulesVerdict: raw.rulesVerdict ?? null,
    preview: raw.preview ?? null,
  };
}

/** Refuses unless every condition for sending real things holds. */
export function liveRefusal(bot, judge, p, attended, journalProblems = []) {
  if (typeof bot.act !== 'function') return 'this bot has no act() function, so it can only practice';
  if (!judge.canGoLive) return `the ${judge.name} judge is for practice only; use --judge claude or --judge anthropic`;
  if (judge.needsAttendedLive && !attended) {
    return `the ${judge.name} judge runs on a personal subscription and needs someone at the terminal for a live run; use --judge anthropic with your own API key for unattended runs`;
  }
  const live = readLive(p.live);
  if (!live) return 'the live switch is off; run "railbot go-live" in a terminal first';
  if (live.bot !== bot.name) return `the live switch was set for ${live.bot}, not ${bot.name}`;
  for (const key of ['perRun', 'perDay']) {
    if (!(bot.limits[key] <= live.limits?.[key])) {
      return `limits.${key} is now ${bot.limits[key]} but go-live approved ${live.limits?.[key]}; run "railbot go-live" again to approve the new limit`;
    }
  }
  if (journalProblems.length) return `the audit log fails its check: ${journalProblems[0]}`;
  return null;
}

/**
 * @param {any} bot from defineBot
 * @param {{
 *   dir: string, judge: any, mode?: 'practice'|'live', approver?: any, params?: any,
 *   readTools?: any, writeTools?: any, ui?: (event: any) => void, clock?: () => Date, attended?: boolean,
 * }} opts
 */
export async function runBot(bot, opts) {
  const mode = opts.mode ?? 'practice';
  const clock = opts.clock ?? (() => new Date());
  const ui = opts.ui ?? (() => {});
  const p = paths(opts.dir, bot.name);
  const judge = opts.judge;

  const release = takeLock(p.lock, 'run');
  const onExit = () => release();
  process.once('exit', onExit);
  const summary = { mode, judge: judge.name, stopped: null, proposed: 0, skipped: 0, items: [], currentIds: [], sent: 0, limit: null, inDoubt: [] };

  let journal;
  try {
    journal = new Journal(p.journal, { clock });
    if (mode === 'live') {
      const why = liveRefusal(bot, judge, p, opts.attended === true);
      if (why) throw new Refused(`Live run refused: ${why}.`);
    }
    journal.append('run-start', { bot: bot.name, mode, judge: judge.name, limits: bot.limits });
    const halted = () => {
      const why = stopReason(p);
      if (why) {
        journal.append('stopped', { mode, reason: why });
        summary.stopped = why;
        ui({ type: 'stopped', reason: why });
      }
      return Boolean(why);
    };

    if (!halted()) {
      await proposeAndJudge({ bot, journal, judge, mode, opts, summary, ui, halted, clock });
      if (!summary.stopped) await review({ journal, mode, opts, summary, ui, halted });
      if (!summary.stopped) await perform({ bot, journal, mode, opts, summary, ui, halted, clock });
    }

    const final = foldState(journal.events);
    for (const s of final.values()) {
      if (s.mode === mode && s.status === 'in-doubt') summary.inDoubt.push(s.id);
    }
    summary.items = [...final.values()].filter((s) => s.mode === mode);
    journal.append('run-end', { mode, sent: summary.sent, stopped: summary.stopped });
    return summary;
  } catch (e) {
    if (journal && !(e instanceof Refused)) journal.append('run-failed', { mode, error: e.message });
    throw e;
  } finally {
    process.removeListener('exit', onExit);
    release();
  }
}

async function proposeAndJudge({ bot, journal, judge, mode, opts, summary, ui, halted, clock }) {
  const ctx = Object.freeze({ params: opts.params ?? {}, read: opts.readTools ?? {}, now: clock(), mode, log: (text) => ui({ type: 'log', text }) });
  const raw = await bot.propose(ctx);
  let calls = 0;
  for (const rawItem of raw ?? []) {
    if (halted()) return;
    let item;
    try {
      item = normalizeItem(rawItem);
    } catch (e) {
      journal.append('invalid-item', { mode, error: e.message });
      ui({ type: 'invalid', error: e.message });
      continue;
    }
    summary.currentIds.push(item.id);
    const state = foldState(journal.events).get(stateKey(mode, item.id));
    const hash = hashJson({ action: item.action, untrusted: item.untrusted, facts: item.facts });
    // An id that has reached an end state is never acted on again, whatever the text says now.
    if (state && TERMINAL.has(state.status)) {
      summary.skipped++;
      ui({ type: 'skipped', id: item.id, status: state.status });
      continue;
    }
    // Same item and no change: keep the answer, unless a different judge should read what still waits.
    if (state && state.hash === hash && (state.status === 'approved' || (state.status === 'waiting' && state.judgedBy === judge.name && !state.verdict?.failed))) {
      summary.skipped++;
      continue;
    }
    if (calls >= bot.limits.judgeCallsPerRun) {
      ui({ type: 'deferred', id: item.id, why: `only ${bot.limits.judgeCallsPerRun} judge calls per run` });
      continue;
    }

    summary.proposed++;
    journal.append('proposed', { mode, id: item.id, itemHash: hash, item });
    ui({ type: 'proposed', item });

    const flags = tripwire(item.untrusted);
    let verdict;
    let action = item.action;
    calls++;
    try {
      const applied = applyVerdict(await judge.decide({ bot, item }), item);
      verdict = applied.verdict;
      action = applied.action;
      flags.push(...applied.flags);
    } catch (e) {
      // A judge that fails never lets anything through. The item waits for a person.
      verdict = { decision: 'hold', reason: `The judge could not decide: ${e.message}`, failed: true };
    }

    const outbound = checkOutbound(action, item.outbound);
    flags.push(...outbound.hold, ...outbound.block);
    const finalHash = hashJson(action);
    journal.append('judged', { mode, id: item.id, judge: judge.name, verdict, flags, action, finalHash });
    ui({ type: 'judged', item, verdict, flags, action });

    if (outbound.block.length) {
      journal.append('closed', { mode, id: item.id, status: 'blocked', reason: outbound.block.join('; ') });
    } else if (verdict.decision === 'reject') {
      journal.append('closed', { mode, id: item.id, status: 'rejected', reason: verdict.reason });
    } else if (verdict.decision === 'approve' && !flags.length && !item.touches.length && bot.autoApprove?.(item) === true) {
      // Only items that touch no person and no money can skip the human, and only clean ones.
      journal.append('queued', { mode, id: item.id });
      journal.append('human-approved', { mode, id: item.id, finalHash, note: 'auto: touches nothing outside', by: 'code' });
    } else {
      journal.append('queued', { mode, id: item.id });
    }
  }
}

async function review({ journal, mode, opts, summary, ui, halted }) {
  const approver = opts.approver;
  const waiting = () => [...foldState(journal.events).values()].filter((s) => s.mode === mode && s.status === 'waiting');
  const queue = waiting();
  if (!queue.length) return;
  if (!approver) {
    ui({ type: 'waiting', count: queue.length });
    return;
  }
  let i = 0;
  for (const entry of queue) {
    i++;
    if (halted()) return;
    const answer = await approver.ask(entry, { position: i, total: queue.length, mode });
    if (answer.decision === 'approve') {
      journal.append('human-approved', { mode, id: entry.id, finalHash: entry.finalHash, note: answer.note ?? '', by: approver.name ?? 'terminal' });
    } else if (answer.decision === 'reject') {
      journal.append('human-rejected', { mode, id: entry.id, note: answer.note ?? '', by: approver.name ?? 'terminal' });
    } else if (answer.decision === 'quit') {
      ui({ type: 'waiting', count: queue.length - i + 1 });
      return;
    }
  }
}

async function perform({ bot, journal, mode, opts, summary, ui, halted, clock }) {
  const ready = () => [...foldState(journal.events).values()].filter((s) => s.mode === mode && s.status === 'approved');
  let sentThisRun = 0;
  for (const entry of ready()) {
    if (halted()) return;
    const sends = entry.item.sends ?? 1;
    const inWindow = sendsInWindow(journal.events, mode, clock());
    if (sentThisRun + sends > bot.limits.perRun) {
      summary.limit = `per-run limit of ${bot.limits.perRun} reached`;
    } else if (inWindow + sends > bot.limits.perDay) {
      summary.limit = `limit of ${bot.limits.perDay} in 24 hours reached`;
    }
    if (summary.limit) {
      journal.append('limit-hit', { mode, id: entry.id, reason: summary.limit, inWindow, sentThisRun });
      ui({ type: 'limit', reason: summary.limit, left: ready().length });
      return;
    }
    if (entry.approvedHash !== entry.finalHash || hashJson(entry.action) !== entry.finalHash) {
      journal.append('closed', { mode, id: entry.id, status: 'blocked', reason: 'the action no longer matches what was approved' });
      continue;
    }

    const item = { ...entry.item, action: entry.action };
    if (typeof bot.recheck === 'function' && mode === 'live') {
      let why = null;
      try {
        why = await bot.recheck(item, { read: opts.readTools ?? {} });
      } catch (e) {
        why = `could not re-check: ${e.message}`;
      }
      if (why) {
        journal.append('dropped', { mode, id: item.id, reason: String(why) });
        ui({ type: 'dropped', item, reason: String(why) });
        continue;
      }
    }

    if (typeof bot.recheck === 'function' && mode === 'live' && halted()) return;

    // The intent reaches the disk before the action does. If the process dies between
    // here and the outcome line, the next run sees an unresolved start and will not retry.
    journal.append('act-start', { mode, id: item.id, sends, finalHash: entry.finalHash });
    if (mode === 'practice') {
      const wouldDo = bot.preview ? bot.preview(item) : item.preview ?? JSON.stringify(item.action);
      journal.append('practice-done', { mode, id: item.id, wouldDo });
      summary.sent += sends;
      sentThisRun += sends;
      ui({ type: 'practiced', item, wouldDo });
      continue;
    }
    try {
      const result = await bot.act(item, { ...(opts.writeTools ?? {}), idempotencyKey: item.id });
      journal.append('act-done', { mode, id: item.id, result: result ?? null });
      summary.sent += sends;
      sentThisRun += sends;
      ui({ type: 'acted', item, result });
    } catch (e) {
      // It may have half happened, so this stays closed until a person reopens it.
      journal.append('act-failed', { mode, id: item.id, error: e.message });
      sentThisRun += sends;
      ui({ type: 'act-failed', item, error: e.message });
    }
  }
}
