// The two judges that need no account. Neither is allowed to go live.
import { existsSync, readFileSync } from 'node:fs';

/**
 * Replays verdicts saved from an earlier real run. An item with no recording waits
 * for a person, so changing the bot can't silently approve anything.
 * @param {string} file
 */
export function recordedJudge(file) {
  const book = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { verdicts: {} };
  return {
    name: 'recorded',
    canGoLive: false,
    source: book.recordedWith ?? 'unknown',
    async decide({ item }) {
      const saved = book.verdicts?.[item.id];
      if (!saved) return { decision: 'hold', reason: 'No recording exists for this item, so a person has to look.', injection_seen: false };
      return saved;
    },
  };
}

/** The bot's own code gives its opinion. No AI is involved, and the output says so. */
export function rulesJudge() {
  return {
    name: 'rules',
    canGoLive: false,
    async decide({ item }) {
      return item.rulesVerdict
        ? { injection_seen: false, ...item.rulesVerdict }
        : { decision: 'hold', reason: 'This bot has no rule for this item, so a person has to look.', injection_seen: false };
    },
  };
}
