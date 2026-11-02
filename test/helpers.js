import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineBot } from '../src/engine.js';
import { writeJsonAtomic, paths } from '../src/files.js';

export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'railbot-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const item = (id, extra = {}) => ({
  id,
  title: `Do ${id}`,
  action: { type: 'test', target: id, body: `hello ${id}` },
  ...extra,
});

export const approveAll = { name: 'test', async ask() { return { decision: 'approve' }; } };

/** A judge that can go live, for tests. Nothing about it is sent anywhere. */
export const realishJudge = (decide = async () => ({ decision: 'approve', reason: 'fine', injection_seen: false })) => ({
  name: 'test-judge',
  canGoLive: true,
  decide,
});

export function testBot(items, extra = {}) {
  const acted = [];
  const bot = defineBot({
    name: 'test-bot',
    limits: { perRun: 10, perDay: 50 },
    judge: { instructions: 'Approve good items.' },
    propose: async () => (typeof items === 'function' ? items() : items),
    act: async (it) => {
      acted.push(it.id);
      return { ok: true };
    },
    ...extra,
  });
  return { bot, acted };
}

export function switchOn(dir, bot) {
  writeJsonAtomic(paths(dir, bot.name).live, { bot: bot.name, limits: { perRun: bot.limits.perRun, perDay: bot.limits.perDay }, at: new Date().toISOString() });
}
