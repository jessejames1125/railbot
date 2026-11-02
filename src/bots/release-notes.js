// Drafts release notes for everything merged since the last release: grouped, with
// breaking changes first, dependency bumps collapsed, and a suggested version number.
// Live, it only ever creates a draft release, which is not visible until you publish it.
import { defineBot } from '../engine.js';
import { first } from './lib.js';

const CONVENTIONAL = /^(?<type>[a-z]+)(\((?<scope>[^)]*)\))?(?<bang>!)?:\s*(?<rest>.+)$/i;
const GROUPS = [
  ['breaking', 'Breaking changes'],
  ['feature', 'New'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['docs', 'Docs'],
  ['deps', 'Dependencies'],
  ['internal', 'Internal'],
];

/** Sort one change into a group. Labels win over the title's wording. */
export function classify(title, labels = []) {
  const names = labels.map((l) => String(l).toLowerCase());
  const has = (re) => names.some((n) => re.test(n));
  const m = CONVENTIONAL.exec(title);
  const type = m?.groups.type.toLowerCase();
  if (m?.groups.bang || /\bBREAKING\b/.test(title) || has(/breaking/)) return 'breaking';
  if (has(/depend|renovate|dependabot/) || /^(bump|update|upgrade)\b.* (from|to) v?\d/i.test(title) || type === 'deps' || /^(chore|fix|build)\(deps(-dev)?\)/i.test(title)) return 'deps';
  if (has(/^(type[:/\s-]*)?(feature|feat|enhancement)/)) return 'feature';
  if (has(/^(type[:/\s-]*)?(bug|fix)/)) return 'fix';
  if (has(/doc/)) return 'docs';
  if (type) {
    if (['feat', 'feature'].includes(type)) return 'feature';
    if (['fix', 'bugfix', 'hotfix'].includes(type)) return 'fix';
    if (['perf'].includes(type)) return 'perf';
    if (['docs', 'doc'].includes(type)) return 'docs';
    return 'internal';
  }
  if (/^(fix(es|ed)?|correct|resolve|repair|prevent)\b/i.test(title)) return 'fix';
  if (/^(add(s|ed)?|support|implement|introduce|allow|enable|new)\b/i.test(title)) return 'feature';
  if (/^(doc(s|ument)?|readme)\b/i.test(title)) return 'docs';
  if (/^(perf|speed|optimi[sz]e)\b/i.test(title)) return 'perf';
  return 'internal';
}

/** The next version a reader should expect from these changes. */
export function nextVersion(tag, counts) {
  const m = /^(v?)(\d+)\.(\d+)\.(\d+)$/.exec(tag ?? '');
  if (!m) return null;
  const [, v, a, b, c] = m;
  if (counts.breaking && Number(a) > 0) return `${v}${Number(a) + 1}.0.0`;
  if (counts.breaking || counts.feature) return `${v}${a}.${Number(b) + 1}.0`;
  return `${v}${a}.${b}.${Number(c) + 1}`;
}

// An @name in a commit title should not ping anyone from a release page.
const quietMentions = (text) => text.replace(/(^|[\s(])@([\w/-]+)/g, '$1`@$2`');
const cleanTitle = (title) => {
  const m = CONVENTIONAL.exec(title);
  const rest = m ? m.groups.rest : title;
  return quietMentions(rest.replace(/\s*\(#\d+\)\s*$/, '').trim());
};

export function buildNotes(changes, { base, repo }) {
  const lines = [];
  const counts = {};
  for (const [key, heading] of GROUPS) {
    const group = changes.filter((c) => c.group === key);
    counts[key] = group.length;
    if (!group.length) continue;
    lines.push(`### ${heading}`);
    if (key === 'deps' && group.length > 3) {
      lines.push(`- Updated ${group.length} dependencies.`);
    } else if (key === 'internal' && group.length > 5) {
      lines.push(`- ${group.length} internal changes (tests, tooling, cleanup).`);
    } else {
      for (const c of group) lines.push(`- ${cleanTitle(c.title)}${c.pr ? ` (#${c.pr})` : ''}${c.author && !c.isBot ? ` by @${c.author}` : ''}`);
    }
    lines.push('');
  }
  lines.push(`Full list: https://github.com/${repo}/compare/${base}...HEAD`);
  return { body: lines.join('\n'), counts };
}

export default defineBot({
  name: 'release-notes',
  limits: { perRun: 1, perDay: 3 },
  judge: {
    instructions: `You judge draft release notes before they become a draft GitHub release.
Approve when the notes are an honest, readable account of the listed changes, grouped sensibly.
Reject only when nothing here is worth a release.
Hold when a change looks risky enough that a maintainer should word it, or the grouping looks badly wrong.
You may rewrite "body" so a user of this project can see what changed for them: fix misfiled items, move anything breaking to the top, lead each line with the effect on the user. Base every line on the listed changes. Never invent a change, a fix or a number. Keep the PR numbers, the "by @name" credits and the last "Full list" line exactly as they are, and add no other links.`,
  },

  async propose(ctx) {
    const repo = ctx.params.repo;
    if (!repo) throw new Error('This bot needs --repo owner/repo.');
    const gh = ctx.read.github;
    const info = await gh.get(`/repos/${repo}`);
    let base;
    try {
      base = (await gh.get(`/repos/${repo}/releases/latest`)).tag_name;
    } catch {
      base = (await gh.getAll(`/repos/${repo}/tags?per_page=1`))[0]?.name;
    }
    if (!base) {
      ctx.log('No release or tag found, so there is nothing to compare against.');
      return [];
    }
    const compare = await gh.get(`/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(info.default_branch)}?per_page=100`);
    if (!compare.commits?.length) {
      ctx.log(`Nothing has landed since ${base}.`);
      return [];
    }
    const merged = await gh.getAll(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`);
    const byNumber = new Map(merged.map((pr) => [pr.number, pr]));
    const head = compare.commits.at(-1).sha;

    const seen = new Set();
    const changes = [];
    for (const commit of compare.commits) {
      const subject = commit.commit.message.split('\n')[0];
      if (/^Merge (branch|remote)/.test(subject)) continue;
      const number = Number(/\(#(\d+)\)\s*$/.exec(subject)?.[1] ?? /^Merge pull request #(\d+)/.exec(subject)?.[1] ?? 0);
      if (number && seen.has(number)) continue;
      if (number) seen.add(number);
      const pr = number ? byNumber.get(number) : null;
      const title = pr?.title ?? (/^Merge pull request/.test(subject) ? commit.commit.message.split('\n')[2] ?? subject : subject);
      const author = pr?.user?.login ?? commit.author?.login ?? null;
      changes.push({ title, pr: number || null, author, isBot: pr?.user?.type === 'Bot' || /\[bot\]$/.test(author ?? ''), group: classify(title, (pr?.labels ?? []).map((l) => l.name)) });
    }

    const { body, counts } = buildNotes(changes, { base, repo });
    const version = nextVersion(base, counts);
    const truncated = compare.total_commits > compare.commits.length;
    const authors = [...new Set(changes.map((c) => c.author).filter(Boolean))];
    const preview = `Create a draft release ${version ?? '(version not worked out)'} on ${repo}:\n\n${body}`;
    return [
      {
        id: `release-notes-${base}-to-${head.slice(0, 12)}`,
        title: `Notes for ${repo} since ${base}: ${changes.length} changes`,
        action: { type: 'github.draft-release', repo, tag: version ?? `${base}-next`, name: version ?? `${base}-next`, body },
        facts: { base, head, totalCommits: compare.total_commits, readCommits: compare.commits.length, truncated, counts, suggestedVersion: version, changes: changes.slice(0, 120) },
        untrusted: { commit_and_pr_titles: changes.map((c) => c.title).join('\n') },
        editable: { body: { type: 'text', maxChars: 20_000 } },
        outbound: { fields: ['body'], allowMentions: authors, allowHosts: ['github.com'], maxChars: 25_000 },
        rulesVerdict: truncated
          ? { decision: 'hold', reason: `Only the first ${compare.commits.length} of ${compare.total_commits} commits could be read, so a person should finish these.` }
          : { decision: 'approve', reason: `${changes.length} changes since ${base}, sorted by label and title wording.` },
        preview,
      },
    ];
  },

  summary: (e) => {
    const f = e.item.facts;
    const parts = Object.entries(f.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
    return `${parts.join(', ')}; suggested next version ${f.suggestedVersion ?? 'unknown'}`;
  },

  async act(item, { github }) {
    const { repo, tag, name, body } = item.action;
    const r = await github.send('POST', `/repos/${repo}/releases`, { tag_name: tag, name, body, draft: true });
    return { url: r.html_url, draft: true };
  },
});
