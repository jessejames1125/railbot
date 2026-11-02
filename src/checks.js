// Deterministic checks a bot can list in `checks`. Each takes the item (with its final
// action) and returns null when fine, { hold: why } to ask a person, or { block: why }.
import { globTest } from './scope.js';

const pick = (obj, path) => String(path).split('.').reduce((v, k) => (v == null ? v : v[k]), obj);

/** Blocks a message to anyone on an opt-out list. The list is read on every check. */
export function notOptedOut(getList, field = 'action.to') {
  return (item) => {
    const to = String(pick(item, field) ?? '').trim().toLowerCase();
    const list = new Set([...(typeof getList === 'function' ? getList() : getList)].map((s) => String(s).trim().toLowerCase()));
    return to && list.has(to) ? { block: `${to} opted out` } : null;
  };
}

/** Blocks a number above a limit, where the limit can come from the item itself. */
export function atMost(field, limit, what = field) {
  return (item) => {
    const v = Number(pick(item, field));
    const max = typeof limit === 'function' ? Number(limit(item)) : Number(limit);
    if (!Number.isFinite(v)) return { block: `${what} is not a number` };
    if (!Number.isFinite(max)) return { block: `no limit known for ${what}` };
    return v > max ? { block: `${what} ${v} is over the limit of ${max}` } : null;
  };
}

/** Holds anything that writes a protected path, for a person to look at. */
export function protectedPaths(globs, field = 'writes') {
  const tests = globs.map(globTest);
  return (item) => {
    const hit = [...(pick(item, field) ?? [])].filter((f) => tests.some((t) => t(f)));
    return hit.length ? { hold: `touches protected paths: ${hit.join(', ')}` } : null;
  };
}

/** Holds a change larger than a person would call small. */
export function smallDiff(maxLines, field = 'facts.diffLines') {
  return (item) => {
    const n = Number(pick(item, field));
    if (!Number.isFinite(n)) return { hold: 'diff size unknown' };
    return n > maxLines ? { hold: `diff is ${n} lines, over ${maxLines}` } : null;
  };
}

const CLAIMY = /\d|%|\b(certif\w*|guarantee\w*|award\w*|best|only|fastest|cheapest|free|neutral|compliant|approved|proven|#1|number one|safe|secure)\b/i;
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();

/**
 * Holds a message whose factual-sounding sentences (numbers, "certified", "free" and the
 * like) are not on the approved claims list. It cannot tell true from false; it makes
 * sure a person has signed off on each claim once.
 */
export function claimsListed(getClaims, field = 'action.body') {
  return (item) => {
    const approved = new Set([...(typeof getClaims === 'function' ? getClaims() : getClaims)].map(norm));
    const text = String(pick(item, field) ?? '');
    const unlisted = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s && CLAIMY.test(s) && !approved.has(norm(s)));
    return unlisted.length ? { hold: `claims not on the approved list: ${unlisted.map((s) => `"${s}"`).join(', ')}` } : null;
  };
}

/** Blocks unless a fact the bot measured is true, such as tests passing. */
export function mustBeTrue(field, what = field) {
  return (item) => (pick(item, field) === true ? null : { block: `${what} is not true` });
}
