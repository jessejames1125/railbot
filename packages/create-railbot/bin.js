#!/usr/bin/env node
// A thin door so that `npx create-railbot my-bot` works. The work lives in railbot itself.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cli = require.resolve('railbot/package.json').replace(/package\.json$/, 'src/cli.js');
const res = spawnSync(process.execPath, [cli, 'new', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = res.status ?? 1;
