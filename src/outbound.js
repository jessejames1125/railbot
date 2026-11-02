// Last look at anything about to leave. A draft can carry an outsider's words even
// when the judge behaved, so this reads the final text, not the model's intent.

const SECRET_PATTERNS = [
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'a GitHub token'],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/, 'an Anthropic key'],
  [/\bsk-[A-Za-z0-9]{32,}\b/, 'an API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
];

const URL = /\bhttps?:\/\/[^\s<>()"'`]+/gi;
// Domain endings that are rarely also code. Endings such as .to, .is and .js would hold
// every "app.query" in a release note, so a person reading the draft covers those.
const BARE_DOMAIN = /\b(?:www\.(?:[a-z0-9-]+\.)*[a-z]{2,}|(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|ai|app|xyz|ru|cn|co|info|biz|me|sh|gg|tv|cc|link|site|online|top|club|shop|store|live|click|pw|ws|tk|ml|ga|cf|gq|ly|uk|de|fr|eu|us))\b(?:\/[^\s]*)?/gi;
const NO_SCHEME = /(?:^|[\s(<"'])\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
const MENTION = /(^|[^\w`/.-])@([a-z0-9][a-z0-9-]*(?:\/[a-z0-9-]+)?)/gi;

function hostOf(url) {
  try {
    return new globalThis.URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * @param {any} action the final action
 * @param {{ fields?: string[], allowMentions?: string[], allowHosts?: string[], maxChars?: number } | undefined} rules
 * @returns {{ block: string[], hold: string[] }}
 */
export function checkOutbound(action, rules) {
  const result = { block: [], hold: [] };
  if (!rules) return result;
  const allowMentions = new Set((rules.allowMentions ?? []).map((m) => m.toLowerCase()));
  const allowHosts = new Set((rules.allowHosts ?? []).map((h) => h.toLowerCase()));

  for (const field of rules.fields ?? []) {
    const value = action?.[field];
    if (value === undefined || value === null) continue;
    const text = String(value);

    for (const [pattern, name] of SECRET_PATTERNS) {
      if (pattern.test(text)) result.block.push(`${field} contains what looks like ${name}`);
    }
    if (rules.maxChars && text.length > rules.maxChars) {
      result.hold.push(`${field} is ${text.length} characters, over the ${rules.maxChars} allowed`);
    }
    for (const match of text.matchAll(MENTION)) {
      if (!allowMentions.has(match[2].toLowerCase())) result.hold.push(`${field} mentions @${match[2]}, who is not on the list`);
    }
    const urls = text.match(URL) ?? [];
    for (const url of urls) {
      const host = hostOf(url);
      if (!host || !allowHosts.has(host)) result.hold.push(`${field} links to ${host ?? url}, which is not on the list`);
    }
    for (const match of text.matchAll(NO_SCHEME)) {
      if (!allowHosts.has(match[1].toLowerCase())) result.hold.push(`${field} links to ${match[1].toLowerCase()}, which is not on the list`);
    }
    for (const bare of text.replace(URL, ' ').match(BARE_DOMAIN) ?? []) {
      const host = bare.split('/')[0].toLowerCase();
      if (!allowHosts.has(host)) result.hold.push(`${field} names the site ${host}, which is not on the list`);
    }
  }
  return result;
}
