// Finds open pull requests that went quiet and works out who they are waiting on,
// then drafts one polite nudge to that person. Reading the timeline is what makes it
// more than a date filter: most stale PRs are waiting on someone specific.
import { defineBot } from '../engine.js';
import { daysSince, first } from './lib.js';

const HOLD_LABEL = /(^|[\s:/-])(blocked|on[\s-]?hold|wip|work in progress|do[\s-]not[\s-]merge|waiting|stale|needs[\s-]discussion|parked|icebox)($|[\s:/-])/i;
const BLOCKED_WORDS = /\b(blocked (by|on)|on hold|waiting (for|on)|wait for|depends on|not now|until (the )?(next|after)|after #\d+|postpone|park(ed|ing) this|let'?s hold)\b/i;
const MAINTAINER = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const isBot = (user) => user?.type === 'Bot' || /\[bot\]$/.test(user?.login ?? '');

/** Works out who the PR is waiting on from its timeline. Exported for tests. */
export function readTimeline(pr, timeline, now) {
  const when = (e) => Date.parse(e.submitted_at ?? e.created_at ?? e.committer?.date ?? e.author?.date ?? 0) || 0;
  const pushes = timeline.filter((e) => e.event === 'committed' || e.event === 'head_ref_force_pushed').map(when);
  const lastPush = pushes.length ? Math.max(...pushes) : Date.parse(pr.created_at);
  const reviews = timeline.filter((e) => e.event === 'reviewed' && e.state !== 'pending' && !isBot(e.user) && e.user?.login !== pr.user?.login);
  const lastChanges = Math.max(0, ...reviews.filter((r) => r.state === 'changes_requested').map(when));
  const lastApproval = Math.max(0, ...reviews.filter((r) => r.state === 'approved').map(when));
  const comments = timeline
    .filter((e) => e.event === 'commented' && !isBot(e.user))
    .map((e) => ({ by: e.user?.login, role: e.author_association, at: when(e), body: e.body ?? '' }));
  const lastMaintainer = [...comments].reverse().find((c) => MAINTAINER.has(c.role) && c.by !== pr.user?.login);
  const authorSpoke = Math.max(0, ...comments.filter((c) => c.by === pr.user?.login).map((c) => c.at));
  const botChatter = timeline.filter((e) => e.event === 'commented' && isBot(e.user)).length;

  let waitingOn;
  if (lastChanges > lastPush && lastChanges > lastApproval) waitingOn = 'author';
  else if (lastApproval > lastPush) waitingOn = 'merge';
  else if (lastMaintainer && lastMaintainer.at > lastPush && lastMaintainer.at > authorSpoke) waitingOn = 'author-reply';
  else if (reviews.length === 0 && !lastMaintainer) waitingOn = 'first-review';
  else waitingOn = 're-review';

  const daysAgo = (ms) => (ms ? Math.floor((now.getTime() - ms) / 86_400_000) : null);
  return {
    waitingOn,
    lastPushDays: daysAgo(lastPush),
    changesRequestedDays: daysAgo(lastChanges),
    approvedDays: daysAgo(lastApproval),
    reviewCount: reviews.length,
    commentCount: comments.length,
    botComments: botChatter,
    lastMaintainer: lastMaintainer ? { by: lastMaintainer.by, days: daysAgo(lastMaintainer.at), body: lastMaintainer.body } : null,
    recentComments: comments.slice(-5),
  };
}

/** How long the person it waits on has had it, which can be far longer than the last activity. */
export function waitingDays(read, ageDays) {
  switch (read.waitingOn) {
    case 'author': return read.changesRequestedDays;
    case 'merge': return read.approvedDays;
    case 'author-reply': return read.lastMaintainer?.days ?? ageDays;
    case 'first-review': return ageDays;
    default: return read.lastPushDays;
  }
}

function draft({ waitingOn, author, reviewers, idle, facts }) {
  const who = reviewers.length ? reviewers.map((r) => `@${r}`).join(' ') : null;
  const sig = '\n\n(Drafted by a bot and approved by a maintainer.)';
  switch (waitingOn) {
    case 'author':
      return `This has been quiet for ${idle} days. @${author}, it looks like it is waiting on you: changes were requested ${facts.waitingDays} days ago. Are you still working on it? If not, say so and a maintainer can take it over or close it.${sig}`;
    case 'author-reply':
      return `The last word here came from a maintainer ${facts.waitingDays} days ago. @${author}, is this still moving? If not, say so and a maintainer can take it over or close it.${sig}`;
    case 'merge':
      return `This was approved ${facts.waitingDays} days ago and has not been merged. Is something blocking it?${who ? ` ${who}` : ''}${sig}`;
    case 'first-review':
      return `This has been waiting ${facts.waitingDays} days for a first review.${who ? ` ${who}, could you take a look, or say who should?` : ' Could a maintainer take a look, or say who should?'}${sig}`;
    default:
      return `New commits landed ${facts.waitingDays} days ago and have not been re-reviewed.${who ? ` ${who}, could you take another look?` : ' Could a maintainer take another look?'}${sig}`;
  }
}

function ruleOpinion(facts) {
  const m = facts.lastMaintainer;
  if (m && BLOCKED_WORDS.test(m.body)) {
    return { decision: 'reject', reason: `Maintainer ${m.by} said something like "blocked" or "waiting" ${m.days} days ago, so a nudge would be noise.` };
  }
  if (facts.botComments > 0 && facts.commentCount === 0) {
    return { decision: 'hold', reason: 'Only bots have commented here, so a person should decide if it is worth reviving.' };
  }
  return { decision: 'approve', reason: `Waiting on ${facts.waitingOn.replace('-', ' ')} for ${facts.waitingDays} days, and no maintainer has said it is blocked.` };
}

export default defineBot({
  name: 'stale-prs',
  limits: { perRun: 5, perDay: 10 },
  judge: {
    instructions: `You judge whether to post one polite nudge on a quiet pull request.
Approve when the PR is real work that a nudge could move forward and the nudge is aimed at the right person.
Reject when the thread shows a nudge would be noise or rude: someone said it is blocked, waiting on another change or a release, deliberately parked, abandoned on purpose, replaced by another PR, or the author already replied and is waiting too.
Hold when you can't tell.
The facts say who code thinks it is waiting on. Code can't read the discussion, so correct it if the thread says otherwise.
You may rewrite "body" if the draft misreads the thread, but keep it under 80 words, name the same people or fewer, and keep the last line saying a bot drafted it. Never add links.`,
  },

  async propose(ctx) {
    const repo = ctx.params.repo;
    if (!repo) throw new Error('This bot needs --repo owner/repo.');
    const idleDays = Number(ctx.params.idleDays ?? 14);
    const max = Number(ctx.params.max ?? 5);
    const gh = ctx.read.github;
    const prs = await gh.getAll(`/repos/${repo}/pulls?state=open&sort=updated&direction=asc&per_page=100`);
    const quiet = prs.filter((pr) => {
      if (pr.draft || isBot(pr.user)) return false;
      if ((pr.labels ?? []).some((l) => HOLD_LABEL.test(l.name))) return false;
      return daysSince(pr.updated_at, ctx.now) >= idleDays;
    });
    ctx.log(`${prs.length} open PRs read, ${quiet.length} quiet for ${idleDays}+ days, looking at the ${Math.min(max, quiet.length)} quietest.`);

    const items = [];
    for (const pr of quiet.slice(0, max)) {
      const timeline = await gh.getAll(`/repos/${repo}/issues/${pr.number}/timeline?per_page=100`, { maxPages: 2 });
      const read = readTimeline(pr, timeline, ctx.now);
      const author = pr.user.login;
      const reviewers = (pr.requested_reviewers ?? []).map((r) => r.login).filter(Boolean);
      const idle = daysSince(pr.updated_at, ctx.now);
      const ageDays = daysSince(pr.created_at, ctx.now);
      const facts = {
        pr: pr.number, url: pr.html_url, author, authorRole: pr.author_association, idleDays: idle, waitingDays: waitingDays(read, ageDays),
        ageDays, requestedReviewers: reviewers, labels: (pr.labels ?? []).map((l) => l.name),
        ...read, recentComments: undefined, lastMaintainer: read.lastMaintainer ? { by: read.lastMaintainer.by, days: read.lastMaintainer.days } : null,
      };
      const nudged = ['author', 'author-reply'].includes(read.waitingOn) ? `@${author}` : reviewers.length ? reviewers.map((r) => `@${r}`).join(' ') : 'maintainers';
      items.push({
        // Tied to the last activity: a nudge moves updated_at, so the same quiet spell is never nudged twice.
        id: `pr-${pr.number}-quiet-since-${pr.updated_at.slice(0, 10)}`,
        title: `#${pr.number} ${first(pr.title, 70)}`,
        action: { type: 'github.comment', repo, number: pr.number, body: draft({ waitingOn: read.waitingOn, author, reviewers, idle, facts }) },
        facts: { ...facts, nudges: nudged },
        untrusted: {
          title: pr.title,
          body: first(pr.body, 1500),
          ...Object.fromEntries(read.recentComments.map((c, i) => [`comment_${i + 1}_by_${c.by}_${c.role}`, first(c.body, 800)])),
        },
        editable: { body: { type: 'text', maxChars: 700 } },
        outbound: { fields: ['body'], allowMentions: [author, ...reviewers], allowHosts: ['github.com'], maxChars: 800 },
        rulesVerdict: ruleOpinion({ ...facts, lastMaintainer: read.lastMaintainer }),
        preview: `Comment on ${repo}#${pr.number}:\n${draft({ waitingOn: read.waitingOn, author, reviewers, idle, facts })}`,
      });
    }
    return items;
  },

  summary: (e) => `waiting on ${e.item.facts.waitingOn.replace('-', ' ')} for ${e.item.facts.waitingDays}d, last activity ${e.item.facts.idleDays}d ago; would nudge ${e.item.facts.nudges}`,

  async recheck(item, { read }) {
    const pr = await read.github.get(`/repos/${item.action.repo}/pulls/${item.action.number}`);
    if (pr.state !== 'open') return `the PR is now ${pr.state}`;
    if (!item.id.endsWith(pr.updated_at.slice(0, 10))) return 'the PR has seen activity since this was approved';
    return null;
  },

  async act(item, { github }) {
    const c = await github.send('POST', `/repos/${item.action.repo}/issues/${item.action.number}/comments`, { body: item.action.body });
    return { url: c.html_url };
  },
});
