// HR helper template. Written by an engineer without domain expertise; adapt it with
// someone who knows employment law and your own policies before you rely on it.
//
// It only drafts and organizes. It lists applications in the order they came in, with no
// score, and drafts the message a person has already decided to send. Anything that goes
// to a candidate or employee is locked to a person: scope.json cannot change that.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { defineBot } from 'railbot';

// Words that suggest the draft is ranking or judging a person. A hit sends it to you.
const JUDGING = /\b(score[ds]?|scoring|rank(ed|ing)?|rating|top \d+|percentile|not a (good )?fit|weak candidate|strong candidate)\b/i;

export default defineBot({
  name: '{{name}}',
  limits: { perRun: 5, perDay: 20 },
  scope: {
    reads: [],
    actions: {
      'write-summary': { risk: 'low', undo: 'delete hr-notes/applications.md' },
      'draft-message': { risk: 'high', about: 'employment' },
    },
    writes: ['hr-notes/**', 'drafts/**'],
  },
  checks: [(item) => (JUDGING.test(JSON.stringify(item.action)) ? { hold: 'the text reads like a judgment of a person; this bot never ranks or rejects anyone' } : null)],
  judge: {
    instructions: `You check an HR helper bot. It may only organize applications and draft messages a person already decided to send.
Reject anything that ranks, scores, screens, rejects or recommends a person, or that states a reason for a decision about someone.
Reject a message whose content goes beyond the decision recorded in decisions.json.
Approve a neutral, accurate draft.`,
  },

  async propose() {
    const files = readdirSync('applications').filter((f) => f.endsWith('.txt')).sort();
    const rows = files.map((f) => `| ${f} | ${readFileSync(`applications/${f}`, 'utf8').split('\n')[0].replace(/\|/g, '/').trim()} |`);
    const summary = `# Applications, in the order received\n\nListed as they came in. A person reads each one.\n\n| File | First line |\n|---|---|\n${rows.join('\n')}\n`;
    const items = [{ id: `summary-${files.length}`, title: `List ${files.length} applications in hr-notes/applications.md`, action: { type: 'write-summary', text: summary }, writes: ['hr-notes/applications.md'], untrusted: { applications: rows.join('\n') } }];
    for (const d of JSON.parse(readFileSync('decisions.json', 'utf8'))) {
      const body = d.decision === 'interview'
        ? `Hi ${d.name}, thanks for applying for the ${d.role} role. We would like to talk. ${d.slots}. Which works for you?`
        : `Hi ${d.name}, thanks for applying for the ${d.role} role. We have decided not to move forward. Thank you for your time.`;
      items.push({ id: `message-${d.id}`, title: `Draft the ${d.decision} message ${d.decidedBy} decided to send to ${d.name}`, action: { type: 'draft-message', to: d.email, body }, facts: { decision: d.decision, decided_by: d.decidedBy }, writes: [`drafts/${d.id}.txt`] });
    }
    return items;
  },

  async act(item) {
    // Drafts only. Nothing here sends anything to anyone.
    if (item.action.type === 'write-summary') {
      mkdirSync('hr-notes', { recursive: true });
      writeFileSync('hr-notes/applications.md', item.action.text);
      return { wrote: 'hr-notes/applications.md' };
    }
    mkdirSync('drafts', { recursive: true });
    writeFileSync(item.writes[0], `To: ${item.action.to}\n\n${item.action.body}\n`);
    return { wrote: item.writes[0] };
  },
});
