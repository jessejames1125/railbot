// `railbot new`: writes a bot folder you own and can edit.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRepo } from './github.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;
const FOLDER = /^[a-z0-9][a-z0-9._-]*$/;
export const TEMPLATES = ['inbox', 'stale-prs', 'issue-triage', 'release-notes'];

function copyTree(from, to, vars) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dest = join(to, name === '_gitignore' ? '.gitignore' : name);
    if (statSync(src).isDirectory()) copyTree(src, dest, vars);
    else if (/\.(js|json|md|txt)$|^_gitignore$/.test(name)) {
      writeFileSync(dest, readFileSync(src, 'utf8').replaceAll('{{name}}', vars.name));
    } else copyFileSync(src, dest);
  }
}

/** Turn a built-in bot's source into a file the new owner can edit. */
function ownedCopy(botName, name) {
  return readFileSync(join(HERE, 'bots', `${botName}.js`), 'utf8')
    .replace("from '../engine.js'", "from 'railbot'")
    .replace("from './lib.js'", "from 'railbot/bots/lib.js'")
    .replace(`name: '${botName}'`, `name: '${name}'`);
}

/**
 * @param {{ target: string, bot?: string, repo?: string, describe?: string, railbotSpec?: string, install?: boolean, log?: (line: string) => void }} opts
 * @returns {{ dir: string, name: string, installed: boolean }}
 */
export function scaffold(opts) {
  const log = opts.log ?? (() => {});
  const dir = resolve(opts.target);
  const name = basename(dir).toLowerCase();
  if (!FOLDER.test(name)) throw new Error(`"${basename(dir)}" won't work as a package name. Use lowercase letters, digits and hyphens.`);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} already exists and is not empty.`);
  const template = opts.bot ?? 'inbox';
  if (!TEMPLATES.includes(template)) throw new Error(`There is no template called ${template}. Choose from: ${TEMPLATES.join(', ')}.`);
  const repo = opts.repo ? parseRepo(opts.repo) : null;
  if (opts.repo && !repo) throw new Error(`"${opts.repo}" is not a repository. Use owner/repo.`);
  if (template !== 'inbox' && !repo) throw new Error(`The ${template} bot needs --repo owner/repo.`);

  const botName = name.replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 60) || 'bot';
  const vars = { name: botName };
  copyTree(join(HERE, 'templates', 'common'), dir, vars);
  if (template === 'inbox') copyTree(join(HERE, 'templates', 'inbox'), dir, vars);
  else writeFileSync(join(dir, 'bot.js'), ownedCopy(template, botName));

  const start = `railbot run bot.js${repo ? ` --repo ${repo.full}` : ''}`;
  const pkg = {
    name: botName,
    private: true,
    type: 'module',
    scripts: { start, review: 'railbot review', audit: 'railbot audit --verify', 'go-live': 'railbot go-live' },
    dependencies: { railbot: opts.railbotSpec ?? `^${VERSION}` },
  };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  if (opts.describe) writeFileSync(join(dir, 'BOT.md'), `# What this bot should do\n\n${opts.describe}\n`);

  let installed = false;
  if (opts.install !== false) {
    log('Installing (railbot has no dependencies of its own)...');
    // npm is a .cmd on Windows, which needs a shell. The command is fixed text.
    const res = spawnSync('npm install --no-audit --no-fund --loglevel=error', { cwd: dir, stdio: 'inherit', shell: true });
    installed = res.status === 0;
    if (!installed) log('npm install did not finish. Run it yourself inside the folder, then npm start.');
  }
  return { dir, name: botName, installed };
}
