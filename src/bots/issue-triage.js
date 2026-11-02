// Suggests labels for unlabeled issues and spots likely duplicates. Labels come only
// from the repository's own list, and the suggestion comes from how the repository
// labeled similar issues in the past, so it works on any repo with no setup.
import { defineBot } from '../engine.js';
import { buildIndex, first, tokens } from './lib.js';

// Workflow labels say where an issue is in a process, not what it is about.
export const WORKFLOW = /^(needs?[\s:_-]|triage|untriaged|pending|new$|stale|wontfix|won't fix|invalid|duplicate|good first issue|help wanted|awaiting|waiting|in[\s-]progress|confirmed|accepted|p[0-9]\b|priority|status[:/]|closed|released|cla|size[:/]|hacktoberfest|no[\s-]?stale|autorelease|has[\s:-])/i;
const NEEDS_TRIAGE = /^(needs?[\s:_-]*(triage|review)|triage|untriaged|pending[\s-]triage|new)$/i;

const KIND_WORDS = [
  [/^(type[:/\s-]*)?(bug|defect|kind[:/]bug|🐛)/i, /\b(bug|crash(es|ed)?|exception|fail(s|ed|ure)?|broken|regression|panic|traceback|stack ?trace|segfault|unexpected)\b/i],
  [/^(type[:/\s-]*)?(enhancement|feature|feat|kind[:/](feature|enhancement)|proposal|request)/i, /\b(feature request|add support|would be (nice|great)|please add|proposal|ability to|support for|allow(ing)? )\b/i],
  [/^(type[:/\s-]*)?(doc|docs|documentation|kind[:/]doc)/i, /\b(docs?|documentation|readme|typo)\b/i],
  [/^(type[:/\s-]*)?(question|help|support|kind[:/]question)/i, /\b(how (do|can|to)|is it possible|question)\b|\?\s*$/i],
  [/^(type[:/\s-]*)?(perf|performance)/i, /\b(slow|performance|memory leak|latency|high cpu)\b/i],
];

const issuesOnly = (list) => list.filter((i) => !i.pull_request);
const labelNames = (i) => (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
const looksUnlabeled = (i) => labelNames(i).every((n) => NEEDS_TRIAGE.test(n));

/**
 * The no-AI label suggester: how similar past issues were labeled, plus plain word cues.
 * Exported so the label eval can score it against what maintainers really chose.
 */
export function suggestLabels(issue, usable, index) {
  const scores = new Map();
  const why = new Map();
  for (const { doc, score } of index.similar(issue, { limit: 8, exclude: issue.number })) {
    if (score < 0.12) continue;
    for (const name of labelNames(doc)) {
      if (!usable.has(name)) continue;
      scores.set(name, (scores.get(name) ?? 0) + score);
      if (!why.has(name)) why.set(name, `#${doc.number} is similar and has this label`);
    }
  }
  const text = `${issue.title}\n${first(issue.body, 1500)}`;
  for (const [labelPattern, words] of KIND_WORDS) {
    if (!words.test(text)) continue;
    for (const name of usable) {
      if (labelPattern.test(name)) {
        scores.set(name, (scores.get(name) ?? 0) + 0.35);
        if (!why.has(name)) why.set(name, 'the text uses words that fit this label');
      }
    }
  }
  const titleTokens = new Set(tokens(issue.title));
  for (const name of usable) {
    const parts = tokens(name.replace(/[:/_-]/g, ' '));
    if (parts.length && parts.every((p) => titleTokens.has(p))) {
      scores.set(name, (scores.get(name) ?? 0) + 0.5);
      why.set(name, 'the title names this label');
    }
  }
  return [...scores.entries()]
    .filter(([, s]) => s >= 0.3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, score]) => ({ name, score: Number(score.toFixed(2)), why: why.get(name) }));
}

function missingInfo(issue) {
  const body = String(issue.body ?? '');
  if (!/\b(bug|crash|error|exception|fails?|broken|regression)\b/i.test(`${issue.title} ${body}`)) return null;
  const hasVersion = /\bv?\d+\.\d+(\.\d+)?\b|\bversion\b/i.test(body);
  const hasSteps = /```|\bsteps?\b|\breproduc|\bexpected\b|\bactual\b/i.test(body);
  const missing = [];
  if (!hasVersion) missing.push('the version you are using');
  if (!hasSteps) missing.push('the steps that trigger it');
  return missing.length ? missing : null;
}

/** The proposal for one issue. Exported so the label eval scores exactly what the bot would send. */
export function triageItem(issue, repo, usable, index) {
  const suggested = suggestLabels(issue, usable, index);
  const near = index.similar(issue, { limit: 1, exclude: issue.number })[0];
  const duplicate = near && near.score >= 0.45 ? { number: near.doc.number, state: near.doc.state, score: Number(near.score.toFixed(2)) } : null;
  const missing = missingInfo(issue);
  const sentences = [];
  if (duplicate) sentences.push(`This looks close to #${duplicate.number}. If it is the same problem, please add your details there.`);
  if (missing) sentences.push(`To help reproduce this, could you add ${missing.join(' and ')}?`);
  const comment = sentences.join(' ');
  const names = suggested.map((s) => s.name);
  return {
    id: `issue-${issue.number}-triage`,
    title: `#${issue.number} ${first(issue.title, 70)}`,
    action: { type: 'github.triage', repo, number: issue.number, labels: names, comment },
    facts: {
      issue: issue.number, url: issue.html_url, reporter: issue.user?.login, reporterRole: issue.author_association, comments: issue.comments,
      suggestedBecause: suggested, likelyDuplicate: duplicate, missing, allLabels: [...usable],
    },
    untrusted: { title: issue.title, body: first(issue.body, 3000) },
    editable: { labels: { type: 'subset', of: [...usable] }, comment: { type: 'text', maxChars: 500 } },
    outbound: { fields: ['comment'], allowMentions: [], allowHosts: [], maxChars: 500 },
    rulesVerdict: names.length
      ? { decision: 'approve', reason: `${names[0]}: ${suggested[0].why}.` }
      : { decision: 'hold', reason: 'No label fits with enough confidence, so a person should look.' },
    preview: `Add labels [${names.join(', ')}] to ${repo}#${issue.number}${comment ? ` and comment:\n${comment}` : ''}`,
  };
}

export default defineBot({
  name: 'issue-triage',
  limits: { perRun: 10, perDay: 30 },
  judge: {
    instructions: `You judge a proposed triage of one GitHub issue: labels to add, and maybe a short comment.
Approve when the labels describe the issue and the comment (if any) helps the reporter.
Reject when the issue is spam or nonsense, or when no label fits and a comment would add nothing.
Hold when a maintainer's knowledge is needed.
Use "edits.labels" to give the right labels, chosen only from the allowed list. Prefer the labels this repo actually uses for this kind of issue, and name one or two rather than many.
A likely duplicate is listed in the facts with a similarity score. Keep the duplicate sentence in the comment only if the two issues really describe the same problem; otherwise rewrite "edits.comment" without it, or set it to an empty string if nothing useful is left.
Never promise a fix or a timeline, never add links, and never mention people.`,
  },

  async propose(ctx) {
    const repo = ctx.params.repo;
    if (!repo) throw new Error('This bot needs --repo owner/repo.');
    const max = Number(ctx.params.max ?? 5);
    const gh = ctx.read.github;
    const open = issuesOnly(await gh.getAll(`/repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=100`));
    const closed = issuesOnly(await gh.getAll(`/repos/${repo}/issues?state=closed&sort=updated&direction=desc&per_page=100`));
    const labels = await gh.getAll(`/repos/${repo}/labels?per_page=100`);
    const usable = new Set(labels.map((l) => l.name).filter((n) => !WORKFLOW.test(n)));
    const index = buildIndex([...open, ...closed].map((i) => ({ number: i.number, title: i.title, body: i.body, labels: i.labels, state: i.state })));

    const waiting = open.filter(looksUnlabeled);
    ctx.log(`${open.length} open issue${open.length === 1 ? '' : 's'} read, ${waiting.length} with no real label, looking at the newest ${Math.min(max, waiting.length)}.`);

    return waiting.slice(0, max).map((issue) => triageItem(issue, repo, usable, index));
  },

  summary: (e) => {
    const f = e.item.facts;
    const dup = f.likelyDuplicate ? `; maybe the same as #${f.likelyDuplicate.number} (${f.likelyDuplicate.state}, similarity ${f.likelyDuplicate.score})` : '';
    const labels = e.action.labels?.length ? e.action.labels.join(', ') : 'no label fits';
    return `labels: ${labels}${dup}${f.missing ? `; missing ${f.missing.join(' and ')}` : ''}`;
  },

  async recheck(item, { read }) {
    const issue = await read.github.get(`/repos/${item.action.repo}/issues/${item.action.number}`);
    if (issue.state !== 'open') return 'the issue is closed now';
    if (!looksUnlabeled(issue)) return 'someone labeled it in the meantime';
    return null;
  },

  async act(item, { github }) {
    const { repo, number, labels, comment } = item.action;
    if (labels.length) await github.send('POST', `/repos/${repo}/issues/${number}/labels`, { labels });
    if (comment) await github.send('POST', `/repos/${repo}/issues/${number}/comments`, { body: comment });
    return { labels, commented: Boolean(comment) };
  },
});
