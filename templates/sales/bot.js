// Sales follow-up template. Written by an engineer without domain expertise; adapt it with
// someone who knows sales and the email laws where you sell before you rely on it.
//
// It drafts one follow-up to each lead who asked about something, using only sentences
// from claims.md, skips anyone in optout.txt, and in a live run appends to outbox/.
// Swap act() for your email service when you are ready; the gates stay the same.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { claimsListed, defineBot, notOptedOut } from 'railbot';

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l && !l.startsWith('#')) : []);
const claims = () => lines('claims.md');

export default defineBot({
  name: '{{name}}',
  // Low on purpose. Raise them only after a few weeks of clean runs.
  limits: { perRun: 5, perDay: 20 },
  scope: {
    reads: [],
    actions: { email: { risk: 'high', undo: 'retract: send a short correction and add the person to optout.txt' } },
  },
  checks: [notOptedOut(() => lines('optout.txt'), 'action.to'), claimsListed(claims, 'action.body')],
  judge: {
    instructions: `You check a sales follow-up email before it goes out.
Approve only when the person asked about what the email answers, the email is short and polite, and every claim in it appears in the approved claims.
Reject an email to someone who did not ask, or one with a claim that is not approved.
The email must say who it is from and how to stop getting emails.`,
  },

  async propose() {
    const approved = claims();
    const [head, ...rows] = readFileSync('leads.csv', 'utf8').trim().split('\n');
    const cols = head.split(',');
    return rows.map((row) => Object.fromEntries(row.split(',').map((v, i) => [cols[i], v.trim()]))).filter((l) => l.asked_about).map((lead) => ({
      id: `follow-up-${lead.email}`,
      title: `Follow up with ${lead.name} about ${lead.asked_about}`,
      action: {
        type: 'email',
        to: lead.email,
        body: [`Hi ${lead.name}, you asked about ${lead.asked_about}.`, ...approved.slice(0, 2), 'Reply with a question any time, or reply "stop" and we will not email you again.'].join('\n'),
      },
      facts: { asked_about: lead.asked_about, approved_claims: approved },
    }));
  },

  async act(item) {
    mkdirSync('outbox', { recursive: true });
    appendFileSync('outbox/sent.jsonl', `${JSON.stringify({ key: item.id, ...item.action })}\n`);
    return { wroteTo: 'outbox/sent.jsonl' };
  },
});
