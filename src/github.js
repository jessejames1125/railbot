// A GitHub client split in two. Bots read through readGitHub, which has no way to
// send anything but GET. Only act() ever receives writeGitHub, and only in a live run.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = () => process.env.RAILBOT_GITHUB_API ?? 'https://api.github.com';
const token = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

export class RateLimited extends Error {}
export class NotFound extends Error {}

function headers(auth) {
  const h = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'railbot' };
  if (auth) h.authorization = `Bearer ${auth}`;
  return h;
}

function rateError(res) {
  const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0);
  const minutes = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : '?';
  const tip = token() ? '' : ' Without a token GitHub allows 60 requests an hour; set GITHUB_TOKEN to any token for 5,000 (it needs no scopes for public repos).';
  return new RateLimited(`GitHub's rate limit ran out; it resets in about ${minutes} minutes.${tip}`);
}

/**
 * @param {{ fetchImpl?: typeof fetch, cacheDir?: string, cacheSeconds?: number }} [opts]
 */
export function readGitHub(opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const stats = { requests: 0, fromCache: 0, remaining: null };

  async function raw(path) {
    const url = path.startsWith('http') ? path : `${API()}${path}`;
    const cacheFile = opts.cacheDir ? join(opts.cacheDir, `${createHash('sha256').update(url).digest('hex').slice(0, 24)}.json`) : null;
    if (cacheFile && existsSync(cacheFile)) {
      const age = (Date.now() - statSync(cacheFile).mtimeMs) / 1000;
      if (age < (opts.cacheSeconds ?? 600)) {
        stats.fromCache++;
        return JSON.parse(readFileSync(cacheFile, 'utf8'));
      }
    }
    stats.requests++;
    const res = await fetchImpl(url, { method: 'GET', headers: headers(token()), signal: AbortSignal.timeout(30_000) });
    stats.remaining = res.headers.get('x-ratelimit-remaining');
    if ((res.status === 403 || res.status === 429) && (stats.remaining === '0' || res.headers.get('retry-after'))) throw rateError(res);
    if (res.status === 404) throw new NotFound(`GitHub has no public ${path.split('?')[0]}`);
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path.split('?')[0]}`);
    const out = { json: await res.json(), link: res.headers.get('link') };
    if (cacheFile) {
      mkdirSync(opts.cacheDir, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(out));
    }
    return out;
  }

  return {
    stats,
    /** @param {string} path */
    async get(path) {
      return (await raw(path)).json;
    },
    /** @param {string} path @param {{ maxPages?: number }} [o] */
    async getAll(path, o = {}) {
      const items = [];
      let next = path;
      for (let page = 0; next && page < (o.maxPages ?? 1); page++) {
        const res = await raw(next);
        items.push(...res.json);
        next = /<([^>]+)>;\s*rel="next"/.exec(res.link ?? '')?.[1] ?? null;
      }
      return items;
    },
  };
}

/** Only handed to act() in a live run. */
export function writeGitHub({ fetchImpl = fetch } = {}) {
  const auth = token();
  return {
    /** @param {'POST'|'PATCH'|'PUT'} method @param {string} path @param {any} body */
    async send(method, path, body) {
      if (!auth) throw new Error('Set GITHUB_TOKEN to a token with write access to this repository.');
      const res = await fetchImpl(`${API()}${path}`, {
        method,
        headers: { ...headers(auth), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status} to ${method} ${path}`);
      return res.json();
    },
  };
}

/** Accepts owner/repo or a github.com link. */
export function parseRepo(text) {
  const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(String(text ?? '').trim());
  if (!m || m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], repo: m[2], full: `${m[1]}/${m[2]}` };
}
