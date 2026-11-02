// Calls the Anthropic Messages API with the user's own key from the environment.
// Plain fetch, because the package has no dependencies.
import { buildPrompt } from './prompt.js';
import { parseVerdictText, verdictSchema } from '../verdict.js';

export const DEFAULT_API_MODEL = 'claude-opus-5-5';

/**
 * @param {{ apiKey?: string, model?: string, baseUrl?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 */
export function anthropicJudge(opts = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const baseUrl = opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
  const model = opts.model ?? DEFAULT_API_MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    name: 'anthropic',
    model,
    canGoLive: true,
    async decide({ bot, item }) {
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
      const { system, user } = buildPrompt(bot, item);
      const res = await fetchImpl(`${baseUrl}/v1/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2026-10-21',
          // Lets a classifier refusal retry on another model inside the same call.
          'anthropic-beta': 'server-side-fallback-2026-07-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: verdictSchema(item) } },
          fallbacks: 'default',
        }),
      });
      if (!res.ok) throw new Error(`the Anthropic API answered ${res.status}`);
      const body = await res.json();
      if (body.stop_reason === 'refusal') throw new Error('the model declined to judge this item');
      if (body.stop_reason === 'max_tokens') throw new Error('the verdict was cut off');
      const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return parseVerdictText(text);
    },
  };
}
