// `railbot try owner/repo`: run every built-in bot read-only and show what they found.
// Nothing here can write: no approver, no write tools, and the mode is fixed to practice.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runBot } from './engine.js';
import { shortPath } from './files.js';
import { parseRepo, readGitHub } from './github.js';
import { bold, describeAction, dim, green, red, wrap, yellow } from './ui.js';
import { safeForTerminal as safe } from './untrusted.js';
import staleBot from './bots/stale-prs.js';
import triageBot from './bots/issue-triage.js';
import releaseBot from './bots/release-notes.js';

export const BUILT_IN = { 'stale-prs': staleBot, 'issue-triage': triageBot, 'release-notes': releaseBot };

const paint = { approve: green, reject: red, hold: yellow };

function printBot(write, bot, result, logs) {
  write('');
  write(bold(bot.name.toUpperCase().replace('-', ' ')));
  for (const line of logs) write(dim(`  ${safe(line)}`));
  if (result.error) {
    write(red(`  Could not finish: ${safe(result.error)}`));
    return;
  }
  const seen = result.items.filter((s) => result.currentIds.includes(s.id));
  if (!seen.length) write('  Nothing to do here.');
  for (const s of seen) {
    write('');
    write(`  ${bold(safe(s.item.title))}`);
    if (s.item.facts?.url) write(dim(`  ${safe(s.item.facts.url)}`));
    if (bot.summary) write(`  ${wrap(safe(bot.summary(s)), 2)}`);
    const decision = s.verdict?.decision ?? 'hold';
    write(`  ${(paint[decision] ?? yellow)(decision)}: ${wrap(safe(s.verdict?.reason ?? ''), 2, { label: 9 })}`);
    for (const flag of s.flags ?? []) write(`  ${red('flag:')} ${safe(flag)}`);
    if (decision !== 'reject') {
      const text = s.action?.body ?? (s.action?.comment ? `Comment: ${s.action.comment}` : null);
      if (text) write(dim(describeAction(text)));
    }
  }
}

/**
 * @param {{ repo: string, judge: any, write?: (line: string) => void, botNames?: string[], max?: number, stateDir?: string, fetchImpl?: typeof fetch }} opts
 */
export async function tryRepo(opts) {
  const write = opts.write ?? ((l) => console.log(l));
  const parsed = parseRepo(opts.repo);
  if (!parsed) throw new Error(`"${opts.repo}" is not a repository. Use owner/repo.`);
  const names = opts.botNames?.length ? opts.botNames : Object.keys(BUILT_IN);
  const repoDir = opts.stateDir ?? join(homedir(), '.railbot', 'try', `${parsed.owner}__${parsed.repo}`);
  const dir = join(repoDir, opts.judge.name);
  const github = readGitHub({ cacheDir: join(repoDir, 'cache'), fetchImpl: opts.fetchImpl });
  const started = Date.now();

  write(`${bold(`railbot try ${parsed.full}`)}  ${dim('read-only, practice mode, nothing is sent')}`);
  write(dim(opts.judge.name === 'rules' ? 'Judge: rules (the bots\' own code, no AI). Add --judge claude to have Claude read each thread.' : `Judge: ${opts.judge.name}${opts.judge.model ? ` (${opts.judge.model})` : ''}. It reads each thread as data and has no tools.`));

  const results = await Promise.all(
    names.map(async (name) => {
      const bot = BUILT_IN[name];
      if (!bot) throw new Error(`There is no built-in bot called ${name}. Choose from: ${Object.keys(BUILT_IN).join(', ')}.`);
      const logs = [];
      try {
        const result = await runBot(bot, {
          dir,
          mode: 'practice',
          judge: opts.judge,
          params: { repo: parsed.full, max: opts.max ?? 5, idleDays: opts.idleDays ?? 14 },
          readTools: { github },
          ui: (e) => {
            if (e.type === 'log') logs.push(e.text);
          },
        });
        return { bot, result, logs };
      } catch (e) {
        return { bot, result: { error: e.message }, logs };
      }
    }),
  );
  for (const { bot, result, logs } of results) printBot(write, bot, result, logs);

  const failed = results.filter((r) => r.result.error);
  write('');
  write(green('Nothing was sent.') + dim(`  ${((Date.now() - started) / 1000).toFixed(1)}s, ${github.stats.requests} GitHub requests${github.stats.remaining !== null ? `, ${github.stats.remaining} left this hour` : ''}.`));
  write(dim(`Audit log for each bot: ${shortPath(join(dir, '.railbot'))}`));
  write(`Keep one: ${bold('npx create-railbot my-bot --bot stale-prs --repo ' + parsed.full)}`);
  return { dir, results, failed: failed.length };
}
