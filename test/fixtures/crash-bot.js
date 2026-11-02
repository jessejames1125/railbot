// A bot that dies at a chosen moment, run as its own process by the crash tests.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineBot, runBot } from '../../src/engine.js';
import { writeJsonAtomic, paths } from '../../src/files.js';

const [dir, where] = process.argv.slice(2);
const perDay = where === 'limit-one' ? 1 : 50;
const bot = defineBot({
  name: 'crash-bot',
  limits: { perRun: Math.min(10, perDay), perDay },
  judge: { instructions: 'Approve.' },
  propose: async () => [
    { id: 'first', title: 'First', action: { to: 'first' } },
    { id: 'second', title: 'Second', action: { to: 'second' } },
  ],
  act: async (item) => {
    if (where === 'hang' && item.id === 'first') {
      writeFileSync(join(dir, 'started'), 'yes');
      await new Promise(() => setInterval(() => {}, 1000));
    }
    if (where === 'before-effect' && item.id === 'first') process.exit(42);
    appendFileSync(join(dir, 'effects.txt'), `sent:${item.id}\n`);
    if (where === 'after-effect' && item.id === 'first') process.exit(42);
    return { ok: true };
  },
});

writeJsonAtomic(paths(dir, bot.name).live, { bot: bot.name, limits: { perRun: 50, perDay: 50 } });
const judge = { name: 'test-judge', canGoLive: true, decide: async () => ({ decision: 'approve', reason: 'ok', injection_seen: false }) };
const approver = { ask: async () => ({ decision: 'approve' }) };

try {
  const out = await runBot(bot, { dir, mode: 'live', judge, approver, attended: true });
  console.log(`sent=${out.sent} inDoubt=${out.inDoubt.join(',')} limit=${out.limit}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
