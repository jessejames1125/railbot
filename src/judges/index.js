import { writeFileSync } from 'node:fs';
import { anthropicJudge } from './anthropic.js';
import { claudeCliJudge } from './claude-cli.js';
import { recordedJudge, rulesJudge } from './offline.js';

/** @param {{ judge: string, model?: string, recordings?: string, effort?: string }} opts */
export function makeJudge(opts) {
  switch (opts.judge) {
    case 'recorded':
      return recordedJudge(opts.recordings ?? 'judge-recordings.json');
    case 'rules':
      return rulesJudge();
    case 'anthropic':
      return anthropicJudge({ model: opts.model });
    case 'claude':
      return claudeCliJudge({ model: opts.model, effort: opts.effort });
    default:
      throw new Error(`Unknown judge "${opts.judge}". Use recorded, rules, claude or anthropic.`);
  }
}

/** Wraps a real judge and saves each verdict so a stranger can replay it with no account. */
export function recordingJudge(inner, file) {
  const book = { recordedWith: `${inner.name} ${inner.model ?? ''} on ${new Date().toISOString().slice(0, 10)}`.replace('  ', ' '), verdicts: {} };
  return {
    ...inner,
    async decide(call) {
      const raw = await inner.decide(call);
      book.verdicts[call.item.id] = raw;
      writeFileSync(file, `${JSON.stringify(book, null, 2)}\n`);
      return raw;
    },
  };
}

export { anthropicJudge, claudeCliJudge, recordedJudge, rulesJudge };
