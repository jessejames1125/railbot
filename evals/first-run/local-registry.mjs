// Just enough of the npm registry to serve this repo's two packages from tarballs, so the
// README's commands can run for real before anything is published.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** @param {string} work a temp folder for the tarballs */
export async function startRegistry(work) {
  const pack = (dir) => join(work, spawnSync(`npm pack --silent --pack-destination "${work}"`, { cwd: dir, shell: true, encoding: 'utf8' }).stdout.trim().split('\n').at(-1));
  const tarballs = { railbot: pack(ROOT), 'create-railbot': pack(join(ROOT, 'packages/create-railbot')) };
  const server = createServer((req, res) => {
    const name = decodeURIComponent(req.url.slice(1)).split('?')[0];
    if (name.endsWith('.tgz')) return res.end(readFileSync(tarballs[name.replace(/-\d.*$/, '')]));
    if (!tarballs[name]) return res.writeHead(404).end('{}');
    const manifest = JSON.parse(readFileSync(join(ROOT, name === 'railbot' ? '' : 'packages/create-railbot', 'package.json'), 'utf8'));
    const shasum = createHash('sha1').update(readFileSync(tarballs[name])).digest('hex');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ name, 'dist-tags': { latest: manifest.version }, versions: { [manifest.version]: { ...manifest, dist: { tarball: `http://127.0.0.1:${server.address().port}/${name}-${manifest.version}.tgz`, shasum } } } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}
