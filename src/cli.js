#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { defineBot, runBot, Refused } from './engine.js';
import { goLive, goPractice, reopenItem, resolveItem } from './cli-actions.js';
import { Busy, paths, stopReason, takeLock, writeStop } from './files.js';
import { parseRepo, readGitHub, writeGitHub } from './github.js';
import { Journal, JournalCorrupt, readJournal } from './journal.js';
import { makeJudge, recordingJudge } from './judges/index.js';
import { findClaude } from './judges/claude-cli.js';
import { scaffold, TEMPLATES } from './scaffold.js';
import { foldState } from './state.js';
import { BUILT_IN, tryRepo } from './try.js';
import { bold, dim, eventPrinter, green, red, terminalApprover, yellow } from './ui.js';
import { safeForTerminal as safe } from './untrusted.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const say = (line = '') => console.log(line);

const HELP = `railbot ${VERSION}: AI bots with rails. Practice mode unless you say otherwise.

Start here
  railbot try owner/repo           Run the built-in bots read-only on a public repo.
  railbot new my-bot               Make a bot folder. Then: cd my-bot, npm start.
    --bot stale-prs|issue-triage|release-notes|inbox    --repo owner/repo
    --describe "what it should do"    --build-with claude

Run a bot
  railbot run [bot.js]             One run. In a terminal it asks you about each item.
    --judge recorded|rules|claude|anthropic    --model name    --repo owner/repo
    --set key=value    --record file.json    --live
  railbot review                   Answer items waiting for a person.
  railbot check [bot.js]           Prove a bot loads and proposes valid items.

Safety
  railbot stop ["why"] [--all]     Halt this bot's folder, or every bot on this machine.
  railbot resume [--all]           Remove the stop file.
  railbot go-live [bot.js]         Allow live runs. You type the bot's name to confirm.
  railbot practice [bot.js]        Turn live runs off again.
  railbot resolve <id> done|failed Say what really happened after a crash.
  railbot reopen <id>              Send a closed item back for a fresh yes.

Look
  railbot queue                    What is waiting, approved, or in doubt.
  railbot audit [--verify] [--item id]    Read the log, or check nobody changed it.
  railbot doctor                   Check Node, judges, tokens and stop files.

Exit codes: 0 fine, 1 error, 2 bad usage, 3 stopped by a stop file, 4 live run refused.`;

const OPTIONS = {
  judge: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' }, repo: { type: 'string' }, live: { type: 'boolean' },
  set: { type: 'string', multiple: true }, record: { type: 'string' }, bot: { type: 'string' }, max: { type: 'string' },
  describe: { type: 'string' }, 'build-with': { type: 'string' }, 'railbot-spec': { type: 'string' }, 'no-install': { type: 'boolean' },
  verify: { type: 'boolean' }, item: { type: 'string' }, json: { type: 'boolean' }, all: { type: 'boolean' }, 'idle-days': { type: 'string' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
};

class Usage extends Error {}

async function loadBot(spec = 'bot.js') {
  if (BUILT_IN[spec]) return BUILT_IN[spec];
  const file = resolve(spec);
  if (!existsSync(file)) throw new Usage(`No bot at ${file}. Run this inside a bot folder, or name a file or one of: ${Object.keys(BUILT_IN).join(', ')}.`);
  const mod = await import(pathToFileURL(file).href);
  return mod.default?.limits ? mod.default : defineBot(mod.default);
}

/** Commands that act on state need a bot's name; a folder with one bot needs nothing more. */
function botNameInFolder(dir, given) {
  if (given) return given;
  const root = join(dir, '.railbot');
  const names = existsSync(root) ? readdirSync(root) : [];
  if (names.length === 1) return names[0];
  if (!names.length) throw new Usage('Nothing has run in this folder yet.');
  throw new Usage(`This folder has several bots: ${names.join(', ')}. Say which with --bot.`);
}

function defaultJudge(values) {
  if (values.judge) return values.judge;
  return existsSync('judge-recordings.json') ? 'recorded' : 'rules';
}

function parseSet(pairs = []) {
  const out = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at < 1) throw new Usage(`--set takes key=value, not "${pair}".`);
    out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

function footer(summary, p) {
  const count = (status) => summary.items.filter((i) => i.status === status).length;
  const parts = [];
  if (summary.mode === 'practice') parts.push(`${count('practiced')} practiced`);
  else parts.push(`${count('done')} done`);
  for (const [status, word] of [['waiting', 'waiting for you'], ['approved', 'approved, waiting for the next run'], ['rejected', 'rejected by the judge'], ['denied', 'rejected by you'], ['blocked', 'blocked'], ['failed', 'failed'], ['in-doubt', 'in doubt']]) {
    const n = count(status);
    if (n) parts.push(`${n} ${word}`);
  }
  say('');
  say(`${bold(summary.mode === 'practice' ? 'Practice run finished, nothing real happened.' : 'Live run finished.')} ${parts.join(', ')}.`);
  if (summary.inDoubt.length) {
    say(red(`In doubt after a crash, and not retried: ${summary.inDoubt.map(safe).join(', ')}.`));
    say(`Check by hand, then run: railbot resolve ${safe(summary.inDoubt[0])} done (or failed)`);
  }
  say(dim(`Audit log: ${p.journal}`));
}

async function cmdRun(args, values) {
  const bot = await loadBot(args[0]);
  const dir = process.cwd();
  const p = paths(dir, bot.name);
  const mode = values.live ? 'live' : 'practice';
  let judge = makeJudge({ judge: defaultJudge(values), model: values.model, effort: values.effort });
  if (values.record) judge = recordingJudge(judge, values.record);
  const params = { ...parseSet(values.set) };
  if (values.repo) {
    const repo = parseRepo(values.repo);
    if (!repo) throw new Usage(`"${values.repo}" is not a repository. Use owner/repo.`);
    params.repo = repo.full;
  }
  if (values.max) params.max = values.max;
  if (values['idle-days']) params.idleDays = values['idle-days'];

  const attended = Boolean(process.stdin.isTTY);
  say(mode === 'practice'
    ? `${green('Practice mode.')} Nothing real will happen. Judge: ${judge.name}${judge.source ? dim(` (${judge.source})`) : ''}. Limits: ${bot.limits.perRun} a run, ${bot.limits.perDay} a day.`
    : `${red('LIVE RUN.')} Approved items will really happen. Judge: ${judge.name}. Limits: ${bot.limits.perRun} a run, ${bot.limits.perDay} a day.`);
  const approver = attended ? terminalApprover() : null;
  try {
    const summary = await runBot(bot, {
      dir, mode, judge, params, attended, approver,
      readTools: { github: readGitHub() },
      writeTools: mode === 'live' ? { github: writeGitHub() } : {},
      ui: eventPrinter(say),
    });
    footer(summary, p);
    return summary.stopped ? 3 : 0;
  } finally {
    approver?.close();
  }
}

async function cmdReview(values) {
  if (!process.stdin.isTTY) {
    say(red('A person has to answer these, so this needs a real terminal.'));
    say('It refuses to run from a script or an AI agent on purpose.');
    return 2;
  }
  const dir = process.cwd();
  const name = botNameInFolder(dir, values.bot);
  const p = paths(dir, name);
  const release = takeLock(p.lock, 'review');
  const approver = terminalApprover();
  try {
    const journal = new Journal(p.journal);
    const waiting = [...foldState(journal.events).values()].filter((s) => s.status === 'waiting');
    if (!waiting.length) say('Nothing is waiting for you.');
    let i = 0;
    let yes = 0;
    for (const entry of waiting) {
      i++;
      const answer = await approver.ask(entry, { position: i, total: waiting.length, mode: entry.mode });
      if (answer.decision === 'quit') break;
      if (answer.decision === 'approve') {
        yes++;
        journal.append('human-approved', { mode: entry.mode, id: entry.id, finalHash: entry.finalHash, note: '', by: 'terminal' });
      } else if (answer.decision === 'reject') {
        journal.append('human-rejected', { mode: entry.mode, id: entry.id, note: '', by: 'terminal' });
      }
    }
    if (yes) say(`${yes} approved. The next run does them, within its limits.`);
    return 0;
  } finally {
    approver.close();
    release();
  }
}

function cmdQueue(values) {
  const dir = process.cwd();
  const name = botNameInFolder(dir, values.bot);
  const { events } = readJournal(paths(dir, name).journal);
  const rows = [...foldState(events).values()].filter((s) => ['waiting', 'approved', 'in-doubt', 'failed'].includes(s.status));
  if (values.json) {
    say(JSON.stringify(rows.map((s) => ({ id: s.id, mode: s.mode, status: s.status, title: s.item?.title, verdict: s.verdict, flags: s.flags })), null, 2));
    return 0;
  }
  if (!rows.length) say('Nothing is waiting, approved or in doubt.');
  for (const s of rows) say(`${s.status.padEnd(9)} ${s.mode.padEnd(8)} ${safe(s.id)}  ${dim(safe(s.item?.title ?? ''))}`);
  return 0;
}

function cmdAudit(values) {
  const dir = process.cwd();
  const name = botNameInFolder(dir, values.bot);
  const file = paths(dir, name).journal;
  const read = readJournal(file);
  if (values.verify) {
    if (read.problems.length) {
      say(red(`FAILED: ${read.problems.length} problem(s) in ${file}`));
      for (const problem of read.problems) say(`  ${problem}`);
      return 1;
    }
    say(green(`Verified: ${read.events.length} events, every line chained to the one before it.`));
    say(dim(`Head hash: ${read.lastHash}`));
    say(dim('Keep the head hash somewhere else if you need to catch someone cutting lines off the end.'));
    return 0;
  }
  for (const e of read.events) {
    if (values.item && e.id !== values.item) continue;
    if (values.json) {
      say(JSON.stringify(e));
      continue;
    }
    const detail = e.verdict ? `${e.verdict.decision}: ${safe(e.verdict.reason)}` : safe(e.note ?? e.reason ?? e.error ?? (e.wouldDo ? `would do: ${String(e.wouldDo).split('\n')[0]}` : ''));
    say(`${dim(e.ts)} ${e.type.padEnd(15)} ${safe(e.id ?? '').padEnd(24)} ${detail}`);
  }
  return 0;
}

async function cmdGoLive(args) {
  const bot = await loadBot(args[0]);
  if (!process.stdin.isTTY) {
    say(red('Going live needs a person at a real terminal. It refuses to run from a script or an AI agent on purpose.'));
    return 2;
  }
  say(red(`This allows live runs of ${bot.name}.`));
  say(`Up to ${bot.limits.perRun} a run and ${bot.limits.perDay} a day, each one approved by you first.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const words = await rl.question(`Type "live ${bot.name}" to confirm: `);
    goLive(process.cwd(), bot, words);
  } finally {
    rl.close();
  }
  say(green('Live runs are allowed.') + ` Each still needs --live. Undo with: railbot practice`);
  return 0;
}

function cmdStop(args, values, resume = false) {
  const p = paths(process.cwd(), 'unused');
  const file = values.all ? p.globalStop : p.stop;
  if (resume) {
    rmSync(file, { force: true });
    const still = stopReason(p);
    say(still ? yellow(`Removed ${file}, but still stopped: ${still}`) : green('Stop file removed.'));
    return 0;
  }
  writeStop(file, args.join(' '));
  say(red(`Stopped. ${file} now exists, and ${values.all ? 'every bot on this machine' : 'every bot in this folder'} halts at its next step.`));
  return 0;
}

function withName(values) {
  return botNameInFolder(process.cwd(), values.bot);
}

function cmdDoctor() {
  const row = (ok, text) => say(`${ok === null ? yellow('note') : ok ? green(' ok ') : red('FAIL')}  ${text}`);
  const major = Number(process.versions.node.split('.')[0]);
  row(major >= 22, `Node ${process.versions.node} (needs 22 or newer)`);
  row(true, 'First run needs no account: "railbot try owner/repo" and the recorded judge work with nothing set up.');
  const claude = findClaude();
  if (claude) {
    const res = claude.shim
      ? spawnSync(`"${claude.file}" --version`, { encoding: 'utf8', shell: true, windowsHide: true, timeout: 20_000 })
      : spawnSync(claude.file, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    row(res.status === 0, `claude program: ${res.stdout?.trim() || claude.file}. It signs itself in; railbot never reads its login.`);
  } else row(null, 'claude program not found. --judge claude will not work until it is installed.');
  if (process.env.ANTHROPIC_API_KEY) row(null, 'ANTHROPIC_API_KEY is set. --judge anthropic bills that key, and so does --judge claude, because the claude program prefers the key over your plan.');
  else row(null, 'ANTHROPIC_API_KEY is not set. --judge anthropic will hold every item until it is.');
  row(null, process.env.GITHUB_TOKEN || process.env.GH_TOKEN ? 'A GitHub token is set: 5,000 reads an hour.' : 'No GitHub token: GitHub allows 60 reads an hour. One try uses about 14.');
  const p = paths(process.cwd(), 'unused');
  const stop = stopReason(p);
  row(stop ? null : true, stop ? `Stopped: ${stop}` : 'No stop file.');
  return major >= 22 ? 0 : 1;
}

async function cmdCheck(args, values) {
  const bot = await loadBot(args[0]);
  say(`${green('Loads:')} ${bot.name}, limits ${bot.limits.perRun} a run and ${bot.limits.perDay} a day.`);
  say(typeof bot.act === 'function' ? 'Has act(), so it can go live after go-live.' : 'Has no act(), so it can only practice.');
  const scratch = mkdtempSync(join(tmpdir(), 'railbot-check-'));
  const cwdBefore = process.cwd();
  try {
    const params = parseSet(values.set);
    if (values.repo) params.repo = parseRepo(values.repo)?.full;
    const invalid = [];
    const summary = await runBot(bot, {
      dir: scratch,
      mode: 'practice',
      judge: makeJudge({ judge: 'rules' }),
      params,
      readTools: { github: readGitHub() },
      ui: (e) => {
        if (e.type === 'invalid') invalid.push(e.error);
      },
    });
    say(`Proposed ${summary.proposed} item(s).`);
    for (const s of summary.items.slice(0, 5)) say(`  ${safe(s.item?.title ?? s.id)}${s.flags?.length ? red(`  flagged: ${s.flags.map(safe).join('; ')}`) : ''}`);
    if (invalid.length) {
      for (const problem of invalid) say(red(`Bad item: ${safe(problem)}`));
      return 1;
    }
    say(green('Valid. Nothing was sent, and nothing was written outside a temp folder.'));
    return 0;
  } finally {
    process.chdir(cwdBefore);
    rmSync(scratch, { recursive: true, force: true });
  }
}

function buildWithClaude(dir, describe) {
  const found = findClaude();
  if (!found) throw new Error('--build-with claude needs the claude program on your PATH.');
  const prompt = `Change bot.js in this folder so the bot does this:\n\n${describe}\n\nRead BUILDING.md first and follow its rules. Edit only bot.js. Keep defineBot, keep limits low, put every piece of outside text in "untrusted", keep "act" as the only place that sends anything, and give every item a stable id. Keep the code short. When the bot needs a service you can't reach from here, leave act() writing to outbox/sent.jsonl with a one-line comment saying what to swap in.`;
  const args = ['-p', '--allowedTools', 'Read,Edit,Write', '--permission-mode', 'acceptEdits'];
  const options = { cwd: dir, input: prompt, encoding: 'utf8', windowsHide: true, timeout: 300_000 };
  const res = found.shim ? spawnSync(`"${found.file}" ${args.join(' ')}`, { ...options, shell: true }) : spawnSync(found.file, args, options);
  if (res.status !== 0) throw new Error(`The claude program could not build it: ${(res.stderr || res.stdout || '').trim().split('\n')[0]}`);
  return res.stdout.trim();
}

async function cmdNew(args, values) {
  const target = args[0];
  if (!target) throw new Usage(`Say what to call it: railbot new my-bot. Templates: ${TEMPLATES.join(', ')}.`);
  const made = scaffold({ target, bot: values.bot, repo: values.repo, describe: values.describe, railbotSpec: values['railbot-spec'], install: !values['no-install'], log: say });
  if (values['build-with'] === 'claude' && values.describe) {
    say('Asking the claude program to change bot.js. It is limited to reading and editing files in this folder.');
    say(dim(buildWithClaude(made.dir, values.describe)));
    if (made.installed) {
      const check = spawnSync(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'check', 'bot.js', ...(values.repo ? ['--repo', values.repo] : [])], { cwd: made.dir, stdio: 'inherit' });
      if (check.status !== 0) say(red('The new bot.js did not pass "railbot check". Read the message above.'));
    }
  } else if (values.describe) {
    say(`Saved your description in BOT.md. In Claude Code, run /railbot:new-bot here, or add --build-with claude next time.`);
  }
  say('');
  say(green(`Made ${made.dir}`));
  say(`  cd ${target}`);
  if (!made.installed) say('  npm install');
  say('  npm start');
  return 0;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true });
  } catch (e) {
    say(red(e.message));
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    say(VERSION);
    return 0;
  }
  const [command, ...args] = positionals;
  if (!command || values.help || command === 'help') {
    say(HELP);
    return 0;
  }
  switch (command) {
    case 'try': {
      if (!args[0]) throw new Usage('Say which repo: railbot try owner/repo');
      const judge = makeJudge({ judge: values.judge ?? 'rules', model: values.model, effort: values.effort });
      const out = await tryRepo({ repo: args[0], judge, max: values.max ? Number(values.max) : 5, idleDays: values['idle-days'] ? Number(values['idle-days']) : 14, botNames: values.bot ? [values.bot] : [] });
      return out.failed === out.results.length ? 1 : 0;
    }
    case 'new': return cmdNew(args, values);
    case 'run': return cmdRun(args, values);
    case 'review': return cmdReview(values);
    case 'queue': return cmdQueue(values);
    case 'audit': return cmdAudit(values);
    case 'check': return cmdCheck(args, values);
    case 'doctor': return cmdDoctor();
    case 'go-live': return cmdGoLive(args);
    case 'practice': {
      const bot = await loadBot(args[0]);
      goPractice(process.cwd(), bot);
      say(green('Live runs are off.'));
      return 0;
    }
    case 'stop': return cmdStop(args, values);
    case 'resume': return cmdStop(args, values, true);
    case 'resolve': {
      if (args.length < 2) throw new Usage('railbot resolve <id> done|failed');
      resolveItem(process.cwd(), withName(values), args[0], args[1], args.slice(2).join(' '));
      say(green(`Recorded: ${args[0]} ${args[1]}.`));
      return 0;
    }
    case 'reopen': {
      if (!args[0]) throw new Usage('railbot reopen <id>');
      reopenItem(process.cwd(), withName(values), args[0], args.slice(1).join(' '));
      say(green(`${args[0]} is back in the queue and needs a fresh yes.`));
      return 0;
    }
    default:
      throw new Usage(`Unknown command "${command}". Run railbot --help.`);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    if (e instanceof Refused) {
      say(red(e.message));
      process.exitCode = 4;
    } else if (e instanceof Usage) {
      say(red(e.message));
      process.exitCode = 2;
    } else if (e instanceof Busy || e instanceof JournalCorrupt) {
      say(red(e.message));
      process.exitCode = 1;
    } else {
      say(red(`Error: ${e.message}`));
      process.exitCode = 1;
    }
  });


