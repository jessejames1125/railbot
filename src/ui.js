// Everything a person reads. All outside text passes through safeForTerminal here,
// so an issue title can't move the cursor or draw a fake prompt.
import { createInterface } from 'node:readline/promises';
import { safeForTerminal as safe } from './untrusted.js';

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor() ? `\x1b[${code}m${text}\x1b[0m` : text);
export const green = paint('32');
export const red = paint('31');
export const yellow = paint('33');
export const dim = paint('2');
export const bold = paint('1');

const paintDecision = { approve: green, reject: red, hold: yellow };
const decisionWord = (d) => (paintDecision[d] ?? ((x) => x))(String(d).padEnd(7));

/** Wrap on spaces so a long reason doesn't break mid-word. Takes clean text, no colors. */
export function wrap(text, indent = 0, { width = process.stdout.columns || 100, label = 0 } = {}) {
  const room = Math.max(30, width - indent - 1);
  const pad = ' '.repeat(indent);
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const used = line.length + (out.length === 0 ? label : 0);
      if (line && used + word.length + 1 > room) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out.map((l, i) => (i === 0 ? l : `${pad}${l}`)).join('\n');
}

export function describeAction(action) {
  const text = safe(typeof action === 'string' ? action : JSON.stringify(action, null, 2));
  return `    ${wrap(text, 4)}`;
}

/**
 * @param {(line: string) => void} write
 * @param {{ reasons?: 'all'|'closed' }} [opts] with a person about to see each card, only closed items need their reason here
 */
export function eventPrinter(write, { reasons = 'all' } = {}) {
  const quiet = false;
  return (e) => {
    switch (e.type) {
      case 'log':
        if (!quiet) write(dim(safe(e.text)));
        break;
      case 'judged': {
        write(`${decisionWord(e.verdict.decision)} ${safe(e.item.title)}`);
        if (reasons === 'all' || e.verdict.decision === 'reject') write(`        ${dim(wrap(safe(e.verdict.reason), 8))}`);
        for (const flag of e.flags) write(`        ${red('flag:')} ${safe(flag)}`);
        break;
      }
      case 'skipped':
        if (!quiet) write(dim(`Skipped   ${safe(e.id)} (already ${e.status})`));
        break;
      case 'deferred':
        if (!quiet) write(dim(`Later     ${safe(e.id)}: ${safe(e.why)}`));
        break;
      case 'invalid':
        write(red(`Bad item  ${safe(e.error)}`));
        break;
      case 'waiting':
        write(`\n${yellow(`${e.count} waiting for a person.`)} Run ${bold('railbot review')} in a terminal to answer.`);
        break;
      case 'practiced':
        write(`\n${green('Practice')}  would do: ${safe(e.item.title)}, and did nothing.`);
        break;
      case 'acted':
        write(`\n${green('Done')}      ${safe(e.item.title)}`);
        break;
      case 'act-failed':
        write(`\n${red('Failed')}    ${safe(e.item.title)}: ${safe(e.error)}. It stays closed until you run "railbot reopen".`);
        break;
      case 'dropped':
        write(`\n${yellow('Dropped')}   ${safe(e.item.title)}: ${safe(e.reason)}`);
        break;
      case 'limit':
        write(`\n${yellow('Limit')}     ${e.reason}. ${e.left} approved item(s) wait for the next run.`);
        break;
      case 'stopped':
        write(`\n${red('Stopped')}   ${safe(e.reason)}`);
        break;
    }
  };
}

/**
 * A real prompt in a real terminal.
 * @param {{ input?: any, output?: any }} [io]
 */
export function terminalApprover(io = {}) {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const rl = createInterface({ input, output });
  return {
    name: 'terminal',
    close: () => rl.close(),
    async ask(entry, { position, total, mode }) {
      const lines = [
        '',
        bold(`Your call, ${position} of ${total}: ${safe(entry.item.title)}`),
        mode === 'practice' ? dim('  Practice mode: approving records the answer and sends nothing.') : red('  LIVE: approving this does it for real.'),
        '  It would do:',
        describeAction(entry.item.preview && mode === 'practice' ? entry.item.preview : entry.action),
        `  Judge says ${safe(entry.verdict?.decision ?? 'nothing')}: ${wrap(safe(entry.verdict?.reason ?? ''), 2, { label: 22 })}`,
      ];
      for (const flag of entry.flags ?? []) lines.push(`  ${red('Flag:')} ${safe(flag)}`);
      output.write(`${lines.join('\n')}\n`);
      for (;;) {
        const raw = await rl.question('  [a]pprove  [r]eject  [s]kip  [q]uit > ');
        const answer = raw.trim().toLowerCase();
        if (['a', 'approve', 'y', 'yes'].includes(answer)) return { decision: 'approve' };
        if (['r', 'reject', 'n', 'no'].includes(answer)) return { decision: 'reject' };
        if (['s', 'skip', ''].includes(answer)) return { decision: 'skip' };
        if (['q', 'quit'].includes(answer)) return { decision: 'quit' };
      }
    },
  };
}
