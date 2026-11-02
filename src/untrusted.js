// Text from outside (an issue body, an email, a commit message) is data. It reaches
// the judge JSON-encoded inside a tag with a random name, and it reaches the terminal
// with control characters removed. The tripwire below only ever adds a human look;
// nothing relies on it to catch everything.
import { randomBytes } from 'node:crypto';

// C0 and C1 controls except tab and newline, zero-width and direction-override
// characters of every kind, and the invisible Unicode "tag" block used to hide text from readers.
const INVISIBLE = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;
const ANSI = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[@-Z\\-_])/g;
const CONTROL = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;

export function hasInvisible(text) {
  return new RegExp(INVISIBLE.source, 'u').test(text);
}

/** Safe to print: an outsider's text cannot repaint the screen or fake a prompt. */
export function safeForTerminal(text) {
  return String(text ?? '').replace(ANSI, '').replace(INVISIBLE, '').replace(CONTROL, '');
}

export function cleanText(text, maxChars = 6000) {
  const clean = safeForTerminal(text).normalize('NFKC');
  if (clean.length <= maxChars) return { text: clean, truncated: false };
  return { text: clean.slice(0, maxChars), truncated: true };
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} [nonce]
 */
export function wrapUntrusted(fields, nonce = randomBytes(8).toString('hex')) {
  /** @type {Record<string, string>} */
  const cleaned = {};
  const truncated = [];
  for (const [key, value] of Object.entries(fields ?? {})) {
    const { text, truncated: cut } = cleanText(value);
    cleaned[key] = text.split(nonce).join('');
    if (cut) truncated.push(key);
  }
  const tag = `outside_text_${nonce}`;
  return { tag, truncated, block: `<${tag}>\n${JSON.stringify(cleaned, null, 2)}\n</${tag}>` };
}

const TRIPWIRES = [
  [/\b(ignore|disregard|forget|override)\b.{0,40}\b(instruction|prompt|rule|guideline|direction)s?\b/i, 'tells the reader to ignore instructions'],
  [/\b(previous|prior|above|earlier)\s+(instruction|prompt|message)s?\b/i, 'refers to earlier instructions'],
  [/\b(system|developer)\s+(prompt|message|instruction)s?\b/i, 'mentions a system prompt'],
  [/\byou\s+are\s+now\b|\bact\s+as\s+(an?\s+)?(admin|root|system|developer)\b|\bnew\s+instructions?\b/i, 'tries to give the reader a new role'],
  [/<\/?(system|assistant|user|instructions?|tool_use|function_calls?)\b[^>]*>|<\|[a-z_]+\|>|\[\/?INST\]/i, 'contains chat or tool markup'],
  [/\b(as|to|dear)\s+the\s+(ai|bot|assistant|judge|llm|model)\b|\b(ai|bot|assistant|judge|llm)\s*[:,]\s*(please\s+)?(approve|reject|label|close|merge|send|reply|ignore)\b/i, 'speaks to the bot directly'],
  [/\b(approve|merge|close|delete)\s+(this|it|all|every)\b.{0,40}\b(immediately|now|without|automatically|right away)\b/i, 'orders an action'],
  [/\b(curl|wget)\b[^\n]{0,120}\|\s*(ba|z)?sh\b|\bpowershell\b[^\n]{0,60}\b(iex|invoke-expression)\b/i, 'contains a download-and-run command'],
  [/\b(send|forward|post|exfiltrate|leak|reveal|print)\b.{0,40}\b(token|secret|password|api\s*key|credential|\.env)s?\b/i, 'asks for secrets'],
];

/**
 * Flags for a human, based on the raw outside text.
 * @param {Record<string, unknown>} fields
 * @returns {string[]}
 */
export function tripwire(fields) {
  const flags = new Set();
  for (const [key, value] of Object.entries(fields ?? {})) {
    const raw = String(value ?? '');
    if (hasInvisible(raw)) flags.add(`${key} contains invisible characters`);
    const seen = raw.replace(INVISIBLE, '').normalize('NFKC');
    for (const [pattern, why] of TRIPWIRES) {
      if (pattern.test(seen)) flags.add(`${key} ${why}`);
    }
  }
  return [...flags];
}
