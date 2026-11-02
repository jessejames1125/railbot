// Hide the labels on issues maintainers already labeled, and see who puts them back.
//
//   frequent  always the label this repo uses most (the baseline)
//   rules     the triage bot's own no-AI suggester
//   claude    the triage bot's judge, through your `claude` program
//
//   node evals/labels/run.mjs                 (all three; asks the claude program)
//   node evals/labels/run.mjs --no-claude     (no AI, no account)
//   node evals/labels/run.mjs --report
//
// Only reads public repositories. Each method sees only issues older than the one it is
// labeling. Saved results hold issue numbers and label names, never anyone's text. The
// tripwire false-alarm count comes from the same issues.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { freemem, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WORKFLOW, suggestLabels, triageItem } from '../../src/bots/issue-triage.js';
import triageBot from '../../src/bots/issue-triage.js';
import { buildIndex } from '../../src/bots/lib.js';
import { readGitHub } from '../../src/github.js';
import { claudeCliJudge } from '../../src/judges/claude-cli.js';
import { tripwire } from '../../src/untrusted.js';
import { applyVerdict } from '../../src/verdict.js';

const REPOS = JSON.parse(readFileSync(new URL('./repos.json', import.meta.url), 'utf8'));
const PER_REPO = 20;
const RESULTS = new URL('./results/', import.meta.url);

const issuesOnly = (list) => list.filter((i) => !i.pull_request);
const names = (i) => (i.labels ?? []).map((l) => l.name);

/** Tells the methods apart on what a maintainer would feel: did the labels it put on belong there? */
export function scoreMethod(rows, pick) {
  let labeled = 0;
  let firstRight = 0;
  let right = 0;
  let applied = 0;
  for (const row of rows) {
    const labels = pick(row) ?? [];
    if (!labels.length) continue;
    labeled++;
    if (row.real.includes(labels[0])) firstRight++;
    applied += labels.length;
    right += labels.filter((l) => row.real.includes(l)).length;
  }
  return { total: rows.length, labeled, firstRight, right, applied };
}

function report(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const rows = data.rows;
  const line = (name, pick) => {
    const s = scoreMethod(rows, pick);
    console.log(`${name.padEnd(10)} ${`${s.labeled} of ${s.total}`.padEnd(12)} ${`${s.firstRight} of ${s.labeled}`.padEnd(14)} ${`${((100 * s.firstRight) / Math.max(1, s.labeled)).toFixed(0)}%`.padEnd(10)} ${s.right} of ${s.applied}`);
  };
  console.log(`${data.date}, ${rows.length} issues from ${new Set(rows.map((r) => r.repo)).size} repositories, ${data.model ?? 'no model'}, 1 run`);
  console.log('method     labeled      first right    share      all labels right');
  line('frequent', (r) => r.frequent);
  line('rules', (r) => r.rules);
  if (rows.some((r) => r.claude)) {
    line('claude', (r) => (r.claude?.decision === 'approve' ? r.claude.labels : []));
    const counts = {};
    for (const r of rows) counts[r.claude?.decision ?? 'none'] = (counts[r.claude?.decision ?? 'none'] ?? 0) + 1;
    console.log(`claude decisions: ${JSON.stringify(counts)}`);
  }
  console.log(`Tripwire on real issues: flagged ${data.tripwire.flagged} of ${data.tripwire.read} (${data.tripwire.examples.join(', ') || 'none'}).`);
}

async function main() {
  const { values } = parseArgs({ options: { 'no-claude': { type: 'boolean', default: false }, report: { type: 'boolean', default: false }, model: { type: 'string', default: 'sonnet' }, date: { type: 'string', default: new Date().toISOString().slice(0, 10) }, workers: { type: 'string', default: '2' } } });
  const file = new URL(`${values.date}.json`, RESULTS);
  if (values.report) return report(file);
  if (!values['no-claude'] && process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is set, so the claude program would bill that key. Unset it first if you did not mean that.');
  mkdirSync(RESULTS, { recursive: true });
  const github = readGitHub({ cacheDir: join(tmpdir(), 'railbot-label-eval'), cacheSeconds: 86_400 });
  const judge = claudeCliJudge({ model: values.model });
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const rows = saved?.rows ?? [];
  const tripwireStats = { read: 0, flagged: 0, examples: [] };
  const jobs = [];

  for (const repo of REPOS) {
    const labels = await github.getAll(`/repos/${repo}/labels?per_page=100`);
    const usable = new Set(labels.map((l) => l.name).filter((n) => !WORKFLOW.test(n)));
    const open = issuesOnly(await github.getAll(`/repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=100`, { maxPages: 3 }));
    const closed = issuesOnly(await github.getAll(`/repos/${repo}/issues?state=closed&sort=created&direction=desc&per_page=100`, { maxPages: 3 }));
    const all = [...open, ...closed].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    for (const issue of all) {
      tripwireStats.read++;
      if (tripwire({ title: issue.title, body: issue.body }).length) {
        tripwireStats.flagged++;
        if (tripwireStats.examples.length < 8) tripwireStats.examples.push(`${repo}#${issue.number}`);
      }
    }
    const test = all.filter((i) => names(i).some((n) => usable.has(n))).slice(0, PER_REPO);
    for (const issue of test) {
      const older = all.filter((i) => Date.parse(i.created_at) < Date.parse(issue.created_at));
      const counts = new Map();
      for (const i of older) for (const n of names(i)) if (usable.has(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
      const frequent = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 1).map(([n]) => n);
      const index = buildIndex(older.map((i) => ({ number: i.number, title: i.title, body: i.body, labels: i.labels, state: i.state })));
      const bare = { ...issue, labels: [] };
      const real = names(issue).filter((n) => usable.has(n));
      let row = rows.find((r) => r.repo === repo && r.number === issue.number);
      if (!row) {
        row = { repo, number: issue.number, real, frequent, rules: suggestLabels(bare, usable, index).map((s) => s.name) };
        rows.push(row);
      }
      if (!values['no-claude'] && !row.claude) jobs.push({ row, item: triageItem(bare, repo, usable, index) });
    }
  }

  const save = () => writeFileSync(file, `${JSON.stringify({ date: values.date, model: values['no-claude'] ? saved?.model : values.model, repos: REPOS, tripwire: tripwireStats, rows }, null, 1)}\n`);
  save();
  console.log(`${rows.length} issues, ${jobs.length} to ask about. GitHub requests: ${github.stats.requests}, ${github.stats.remaining ?? 'unknown'} left this hour.`);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { row, item } = jobs[next++];
      while (freemem() < 1.2e9) await new Promise((r) => setTimeout(r, 15_000));
      try {
        const raw = await judge.decide({ bot: triageBot, item });
        const { verdict, action } = applyVerdict(raw, item);
        row.claude = { decision: verdict.decision, labels: action.labels };
      } catch (e) {
        console.log(`${row.repo}#${row.number}: ${e.message}`);
        if (/limit|usage/i.test(e.message)) next = jobs.length;
      }
      save();
    }
  }
  await Promise.all(Array.from({ length: Number(values.workers) }, worker));
  report(file);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').slice(-3).join('/'))) await main();
