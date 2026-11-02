// What a judge is allowed to say. Anything it says beyond this is thrown away, so a
// talked-into model still can't change the target, the limits or the approval step.

export const DECISIONS = ['approve', 'reject', 'hold'];

export function verdictSchema(item) {
  /** @type {Record<string, any>} */
  const editProps = {};
  for (const [key, rule] of Object.entries(item.editable ?? {})) {
    editProps[key] = rule.type === 'subset' ? { type: 'array', items: { type: 'string' } } : { type: 'string' };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['decision', 'reason', 'injection_seen'],
    properties: {
      decision: { type: 'string', enum: DECISIONS },
      reason: { type: 'string' },
      injection_seen: { type: 'boolean' },
      edits: { type: 'object', additionalProperties: false, properties: editProps },
    },
  };
}

/** Pull the verdict out of a model's text and refuse anything malformed. */
export function parseVerdictText(text) {
  const trimmed = String(text ?? '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('the judge did not return JSON');
  return JSON.parse(trimmed.slice(start, end + 1));
}

/**
 * Validate a raw verdict and apply only the edits the bot allowed for this item.
 * @returns {{ verdict: any, action: any, flags: string[] }}
 */
export function applyVerdict(raw, item) {
  const flags = [];
  if (!raw || typeof raw !== 'object' || !DECISIONS.includes(raw.decision)) {
    throw new Error(`the judge returned an unknown decision: ${JSON.stringify(raw?.decision)}`);
  }
  if (typeof raw.reason !== 'string' || !raw.reason.trim()) throw new Error('the judge gave no reason');
  const verdict = {
    decision: raw.decision,
    reason: raw.reason.slice(0, 600),
    injectionSeen: raw.injection_seen === true,
  };
  if (verdict.injectionSeen) flags.push('the judge saw an attempt to instruct it');

  const action = structuredClone(item.action);
  const applied = [];
  for (const [key, value] of Object.entries(raw.edits ?? {})) {
    const rule = item.editable?.[key];
    if (!rule) {
      flags.push(`the judge tried to change "${key}", which it may not change`);
      continue;
    }
    if (rule.type === 'subset') {
      const allowed = new Set(rule.of);
      const list = Array.isArray(value) ? value.map(String) : [];
      const outside = list.filter((v) => !allowed.has(v));
      if (outside.length) flags.push(`the judge asked for ${key} outside the list: ${outside.join(', ')}`);
      action[key] = list.filter((v) => allowed.has(v));
    } else {
      if (typeof value !== 'string') {
        flags.push(`the judge sent ${key} in the wrong form`);
        continue;
      }
      if (rule.maxChars && value.length > rule.maxChars) {
        flags.push(`the judge's ${key} was too long and was not used`);
        continue;
      }
      action[key] = value;
    }
    applied.push(key);
  }
  if (applied.length) verdict.edited = applied;
  return { verdict, action, flags };
}
