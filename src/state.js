// Rebuild what we know about every item by replaying the journal. Practice and
// live are kept apart, so a yes given in practice can never send anything live.

export const TERMINAL = new Set(['rejected', 'blocked', 'denied', 'done', 'failed', 'practiced', 'dropped', 'in-doubt']);

export function stateKey(mode, id) {
  return `${mode}:${id}`;
}

/** @param {any[]} events */
export function foldState(events) {
  /** @type {Map<string, any>} */
  const items = new Map();
  for (const e of events) {
    if (!e.id || !e.mode) continue;
    const key = stateKey(e.mode, e.id);
    const s = items.get(key) ?? { id: e.id, mode: e.mode, status: 'new' };
    switch (e.type) {
      case 'proposed':
        Object.assign(s, { status: 'proposed', hash: e.itemHash, item: e.item, action: e.item.action, verdict: null, flags: [], approvedHash: null });
        break;
      case 'judged':
        Object.assign(s, { status: 'judged', verdict: e.verdict, flags: e.flags, action: e.action, finalHash: e.finalHash, judgedBy: e.judge });
        break;
      case 'closed':
        Object.assign(s, { status: e.status, reason: e.reason });
        break;
      case 'queued':
      case 'reopened':
        Object.assign(s, { status: 'waiting', approvedHash: null });
        break;
      case 'human-approved':
        Object.assign(s, { status: 'approved', approvedHash: e.finalHash, note: e.note });
        break;
      case 'human-rejected':
        Object.assign(s, { status: 'denied', note: e.note });
        break;
      case 'act-start':
        // Until an outcome line lands, nobody knows whether the action happened.
        // That is what a crash leaves behind, and it is never retried by itself.
        Object.assign(s, { status: 'in-doubt', startedAt: e.ts });
        break;
      case 'act-done':
        Object.assign(s, { status: 'done', result: e.result });
        break;
      case 'practice-done':
        Object.assign(s, { status: 'practiced', wouldDo: e.wouldDo });
        break;
      case 'act-failed':
        Object.assign(s, { status: 'failed', error: e.error });
        break;
      case 'dropped':
        Object.assign(s, { status: 'dropped', reason: e.reason });
        break;
      case 'resolved':
        Object.assign(s, { status: e.outcome === 'done' ? 'done' : 'failed', note: e.note });
        break;
    }
    items.set(key, s);
  }
  return items;
}

/**
 * How many sends count against the limit. Counts anything started in the last
 * 24 hours, plus anything dated in the future, so moving the clock back buys nothing.
 * @param {any[]} events
 */
export function sendsInWindow(events, mode, now, hours = 24) {
  const from = now.getTime() - hours * 3600 * 1000;
  let total = 0;
  for (const e of events) {
    if (e.type === 'act-start' && e.mode === mode && Date.parse(e.ts) > from) total += e.sends ?? 1;
  }
  return total;
}
