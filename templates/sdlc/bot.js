// SDLC flow template: tickets in tickets/, changes in the git repo named in sdlc.json.
// The flow and its gates are in sdlc.js; your settings are in sdlc.json.
import { readFileSync } from 'node:fs';
import { makeSdlcBot } from './sdlc.js';

const config = JSON.parse(readFileSync('sdlc.json', 'utf8'));
export default makeSdlcBot({ name: '{{name}}', tickets: 'tickets', ...config, log: (s) => console.log(s) });
