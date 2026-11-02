// Product notes template. Written by an engineer without product-management expertise;
// adapt it with someone who runs product before you rely on it.
//
// It collects customer feedback from feedback/ into one file (low risk, undo by
// reverting the file) and drafts a changelog entry for each line in shipped.md (public,
// so a person always says yes first, and it is only written to drafts/).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { defineBot } from 'railbot';

export default defineBot({
  name: '{{name}}',
  limits: { perRun: 5, perDay: 20 },
  scope: {
    reads: [],
    actions: {
      'update-notes': { risk: 'low', undo: 'revert notes/feedback.md with git' },
      'draft-changelog': { risk: 'high', about: 'public-post' },
    },
    writes: ['notes/**', 'drafts/**'],
  },
  judge: {
    instructions: `You check a product bot. Feedback notes must quote customers accurately and add no conclusions.
A changelog entry must describe only what shipped.md says shipped, in plain words, with no promises about the future.`,
  },

  async propose() {
    const files = readdirSync('feedback').filter((f) => f.endsWith('.txt')).sort();
    const quotes = files.map((f) => `- ${readFileSync(`feedback/${f}`, 'utf8').trim().replace(/\s+/g, ' ')} (${f})`);
    const items = [{ id: `notes-${files.length}`, title: `Collect ${files.length} pieces of feedback in notes/feedback.md`, action: { type: 'update-notes', text: `# Customer feedback\n\nQuoted as written. Read the source file before drawing a conclusion.\n\n${quotes.join('\n')}\n` }, writes: ['notes/feedback.md'], untrusted: { feedback: quotes.join('\n') } }];
    const shipped = existsSync('shipped.md') ? readFileSync('shipped.md', 'utf8').split('\n').filter((l) => l.startsWith('- ')) : [];
    for (const line of shipped) {
      const what = line.slice(2).trim();
      items.push({ id: `changelog-${what.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`, title: `Draft a changelog entry: ${what}`, action: { type: 'draft-changelog', text: `New: ${what}.` }, writes: ['drafts/changelog.md'] });
    }
    return items;
  },

  async act(item) {
    const file = item.writes[0];
    mkdirSync(file.split('/')[0], { recursive: true });
    const before = item.action.type === 'draft-changelog' && existsSync(file) ? readFileSync(file, 'utf8') : '';
    writeFileSync(file, item.action.type === 'draft-changelog' ? `${before}${item.action.text}\n` : item.action.text);
    return { wrote: file };
  },
});
