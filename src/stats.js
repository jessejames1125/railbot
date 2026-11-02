// How much a bot asks of people. Too many approvals and people stop reading them; too few
// and nothing is checked. This counts where every proposal went.

/** @param {any[]} events journal events */
export function approvalLoad(events, mode = 'practice') {
  const routes = new Map();
  for (const e of events) if (e.type === 'gated' && e.mode === mode) routes.set(e.id, e.route);
  const count = { proposals: routes.size, refused: 0, blocked: 0, rejected: 0, auto: 0, checker: 0, person: 0 };
  for (const r of routes.values()) if (r in count) count[r]++;
  let personAnswers = 0;
  for (const e of events) {
    if (e.mode !== mode) continue;
    if ((e.type === 'human-approved' && !['code'].includes(e.by) && !String(e.by).startsWith('checker:')) || e.type === 'human-rejected') personAnswers++;
  }
  const per100 = (n) => (count.proposals ? Math.round((1000 * n) / count.proposals) / 10 : 0);
  return { ...count, personAnswers, personPer100: per100(count.person), autoPer100: per100(count.auto + count.checker) };
}
