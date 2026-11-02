// What a bot may read, do and write, and how much each action needs before it runs.
//
// The bot's code declares the most it can do. The person running it narrows that in
// scope.json next to bot.js. Anything outside the result is refused in code.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RISKS = ['low', 'medium', 'high'];

/**
 * Subjects that always go to a person. Neither scope.json nor a bot's own risk setting
 * can lower them; changing that means editing this file.
 */
export const LOCKED = Object.freeze({
  employment: 'decisions about hiring, pay, discipline or someone\'s job go to a person',
  refund: 'refunds go to a person',
  account: 'changes to a customer\'s account go to a person',
  'legal-safety': 'legal and safety messages go to a person',
  'public-post': 'nothing is posted publicly without a person',
});

const ACTION_NAME = /^[a-z][a-z0-9-]{0,40}$/;

/** A real undo is words saying how; an empty string or true is not one. */
const hasUndo = (a) => typeof a?.undo === 'string' && a.undo.trim().length > 0;

/**
 * The locked subject an item names, however it is spelled ("Refund", " refunds "). An
 * unknown subject comes back as itself, and gateFor sends it to a person.
 */
export function lockedSubject(about) {
  if (typeof about !== 'string' || !about.trim()) return null;
  const s = about.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (Object.hasOwn(LOCKED, s)) return s;
  if (s.endsWith('s') && Object.hasOwn(LOCKED, s.slice(0, -1))) return s.slice(0, -1);
  return s;
}

/** Checks the bot's own declaration. Returns the problem, or null. */
export function scopeProblem(scope) {
  if (scope == null) return null;
  if (typeof scope !== 'object') return 'scope must be an object';
  const actions = scope.actions;
  if (!actions || typeof actions !== 'object' || !Object.keys(actions).length) return 'scope.actions must name at least one action type';
  for (const [type, a] of Object.entries(actions)) {
    if (!ACTION_NAME.test(type)) return `action type "${type}" must be lowercase letters, digits and hyphens`;
    if (!RISKS.includes(a?.risk)) return `scope.actions.${type}.risk must be low, medium or high`;
    if (a.about != null && !LOCKED[a.about]) return `scope.actions.${type}.about must be one of: ${Object.keys(LOCKED).join(', ')}`;
    if (a.about && a.risk !== 'high') return `scope.actions.${type} is about ${a.about}, so its risk must be high: ${LOCKED[a.about]}`;
    if (a.risk !== 'high' && !hasUndo(a)) {
      return `scope.actions.${type} runs without a person (${a.risk} risk), so it must say how it is undone in undo. An automatic action must be undoable, or it must not be automatic`;
    }
  }
  for (const key of ['reads', 'writes']) {
    if (scope[key] != null && !(Array.isArray(scope[key]) && scope[key].every((s) => typeof s === 'string' && s))) return `scope.${key} must be a list of names`;
  }
  return null;
}

/** The scope a bot has with no declaration: every action goes to a person. */
const OPEN = Object.freeze({ declared: false, actions: null, reads: null, writes: null, limits: {}, warnings: [] });

/**
 * Combines the bot's declaration with the person's scope.json. The result can only be
 * narrower or more careful than the bot's, apart from risk levels the person lowers on
 * purpose, and never for a locked subject.
 */
export function effectiveScope(bot, dir) {
  if (!bot.scope) return OPEN;
  const warnings = [];
  const file = join(dir, 'scope.json');
  let human = null;
  if (existsSync(file)) {
    try {
      human = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`scope.json is not valid JSON: ${e.message}`);
    }
    if (human?.bot && human.bot !== bot.name) {
      throw new Error(`scope.json is for ${human.bot}, not ${bot.name}`);
    }
  }
  const actions = {};
  for (const [type, declared] of Object.entries(bot.scope.actions)) {
    const asked = human?.actions && Object.hasOwn(human.actions, type) ? human.actions[type] : undefined;
    if (human?.actions && asked === undefined) continue; // the person listed actions and left this one out
    if (asked === false) continue;
    let risk = declared.risk;
    const wanted = typeof asked === 'string' ? asked : asked?.risk;
    if (wanted != null) {
      if (!RISKS.includes(wanted)) throw new Error(`scope.json: ${type} risk must be low, medium or high`);
      if (declared.about && wanted !== 'high') {
        warnings.push(`LOCKED: scope.json tried to set ${type} to ${wanted} risk. Ignored: ${LOCKED[declared.about]}. This cannot be changed in scope.json.`);
      } else if (wanted !== 'high' && !hasUndo(declared)) {
        warnings.push(`scope.json tried to set ${type} to ${wanted} risk, but the bot gives no way to undo it. Kept at high.`);
      } else {
        risk = wanted;
      }
    }
    actions[type] = Object.freeze({ ...declared, risk });
  }
  for (const type of Object.keys(human?.actions ?? {})) {
    if (!bot.scope.actions[type]) warnings.push(`scope.json allows ${type}, which this bot cannot do. Ignored.`);
  }
  const narrow = (key) => {
    const mine = bot.scope[key] ?? null;
    const theirs = human?.[key] ?? null;
    if (!mine) return theirs;
    return theirs ? mine.filter((x) => theirs.includes(x)) : mine;
  };
  const limits = {};
  for (const key of ['perRun', 'perDay']) {
    const v = human?.limits?.[key];
    if (v != null) {
      if (!Number.isInteger(v) || v < 1) throw new Error(`scope.json: limits.${key} must be a whole number of 1 or more`);
      limits[key] = v;
    }
  }
  return Object.freeze({ declared: true, actions: Object.freeze(actions), reads: narrow('reads'), writes: narrow('writes'), writesHuman: human?.writes ?? null, limits, warnings });
}

/** How one item must be gated, or why it is refused. */
export function gateFor(scope, item) {
  if (!scope.declared) return { risk: 'high', locked: null, undo: null };
  const type = item.action?.type;
  const a = typeof type === 'string' && Object.hasOwn(scope.actions, type) ? scope.actions[type] : null;
  if (!a) return { refused: `"${type}" is outside this bot's scope (allowed: ${Object.keys(scope.actions).join(', ') || 'nothing'})` };
  const about = a.about ?? lockedSubject(item.about);
  if (about) {
    const locked = Object.hasOwn(LOCKED, about) ? LOCKED[about] : `the item says it is about "${about}", which is not a subject railbot knows, so a person decides`;
    return { risk: 'high', locked, undo: a.undo ?? null };
  }
  return { risk: a.risk, locked: null, undo: a.undo ?? null };
}

/** Read tools the bot may use. Anything else throws when touched. */
export function scopedReads(tools, scope) {
  if (!scope.declared || !scope.reads) return tools;
  const allowed = new Set(scope.reads);
  return new Proxy(tools, {
    get(target, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (!allowed.has(key)) throw new Error(`reading "${key}" is outside this bot's scope (allowed: ${[...allowed].join(', ') || 'nothing'})`);
      return target[key];
    },
  });
}

/** Turns a simple glob (*, **, ?) into a test. Paths use forward slashes. */
export function globTest(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i++;
      if (pattern[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const rx = new RegExp(`^${re}$`, 'i');
  return (path) => rx.test(String(path).replace(/\\/g, '/').replace(/^\.\//, ''));
}

/** Paths an item writes that fall outside the scope's write list, for the bot and the person. */
export function writesOutside(scope, files = []) {
  if (!scope.declared || !scope.writes) return [];
  const lists = [scope.writes, scope.writesHuman].filter(Boolean).map((l) => l.map(globTest));
  return files.filter((f) => {
    const clean = String(f).replace(/\\/g, '/');
    if (clean.split('/').includes('..') || /^([a-z]:|\/)/i.test(clean)) return true;
    return lists.some((tests) => !tests.some((t) => t(clean)));
  });
}
