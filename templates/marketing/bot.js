// Marketing drafts template. Written by an engineer without domain expertise; adapt it with
// someone who knows marketing and advertising rules before you rely on it.
//
// It turns each line of ideas.md into a draft post in drafts/, and marks a post ready
// in ready-to-post/ once a person says yes. Nothing here posts anywhere: you copy the
// text to your channel yourself. Claims must come from claims.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { claimsListed, defineBot } from 'railbot';

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l && !l.startsWith('#')) : []);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export default defineBot({
  name: '{{name}}',
  limits: { perRun: 5, perDay: 10 },
  scope: {
    reads: [],
    actions: {
      draft: { risk: 'low', undo: 'delete the draft file' },
      'mark-ready': { risk: 'high', about: 'public-post' },
    },
    writes: ['drafts/**', 'ready-to-post/**'],
  },
  checks: [claimsListed(() => lines('claims.md'), 'action.text')],
  judge: {
    instructions: `You check a marketing post before a person decides to publish it.
Approve when every claim in it appears in the approved claims and it does not mislead.
Reject a post with a claim that is not approved, or that compares to a competitor without support.`,
  },

  async propose() {
    return lines('ideas.md').flatMap((idea) => {
      const file = `${slug(idea)}.md`;
      const text = `${idea}\n\n${lines('claims.md')[0] ?? ''}`.trim();
      const drafted = existsSync(`drafts/${file}`);
      return [
        drafted
          ? { id: `ready-${file}`, title: `Mark "${idea}" ready to post`, action: { type: 'mark-ready', text: readFileSync(`drafts/${file}`, 'utf8') }, writes: [`ready-to-post/${file}`] }
          : { id: `draft-${file}`, title: `Draft a post: ${idea}`, action: { type: 'draft', text }, writes: [`drafts/${file}`] },
      ];
    });
  },

  async act(item) {
    const file = item.writes[0];
    mkdirSync(file.split('/')[0], { recursive: true });
    writeFileSync(file, item.action.text);
    return { wrote: file };
  },
});
