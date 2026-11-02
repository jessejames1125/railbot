// Draws docs/sim.svg from a simulation summary: planted faults left standing, and how
// often a person was asked, for each way of gating the work.
//
//   node evals/sim/chart.mjs evals/sim/results/<date>-<model>-summary.json docs/sim.svg
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
const s = JSON.parse(readFileSync(input, 'utf8'));
const NAMES = { none: 'No gates', deterministic: 'Code checks only', ai: 'Second AI only', both: 'railbot defaults', person: 'Person approves all' };
const rows = Object.keys(NAMES).map((config) => {
  const runs = s.seeds.map((seed) => s.runs[`${config}|${seed}|${s.attention}`]);
  return {
    config,
    standing: runs.reduce((n, r) => n + r.standing, 0),
    undone: runs.reduce((n, r) => n + r.undone, 0),
    asked: runs.reduce((n, r) => n + r.personAsked, 0) / runs.length,
    blocked: runs.reduce((n, r) => n + r.falseBlocks, 0),
  };
});
const faults = s.faults * s.seeds.length;

const W = 760;
const rowH = 34;
const top = 74;
const label = 170;
const panel = 250;
const gap = 40;
const H = top + rows.length * rowH + 58;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const bar = (x, y, w, color) => `<rect x="${x}" y="${y}" width="${Math.max(w, 1.5)}" height="18" rx="2" fill="${color}"/>`;

let body = '';
rows.forEach((r, i) => {
  const y = top + i * rowH;
  const strong = r.config === 'both';
  body += `<text x="${label - 10}" y="${y + 14}" text-anchor="end" font-weight="${strong ? 700 : 400}">${esc(NAMES[r.config])}</text>`;
  const x1 = label;
  body += bar(x1, y, (panel * r.standing) / faults, '#c2410c');
  body += `<text x="${x1 + (panel * r.standing) / faults + 6}" y="${y + 14}">${r.standing} of ${faults}${r.undone ? ` (+${r.undone} undone at night)` : ''}</text>`;
  const x2 = label + panel + gap + 60;
  body += bar(x2, y, (panel * r.asked) / 100, '#1d4ed8');
  body += `<text x="${x2 + (panel * r.asked) / 100 + 6}" y="${y + 14}">${Number.isInteger(r.asked) ? r.asked : r.asked.toFixed(1)}</text>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="#1f2937">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="16" y="24" font-size="15" font-weight="700">A simulated shop, ${s.seeds.length} days of 100 actions, ${s.faults} planted faults a day</text>
<text x="${label}" y="${top - 12}" font-weight="700">Planted faults that went through</text>
<text x="${label + panel + gap + 60}" y="${top - 12}" font-weight="700">Times a person was asked, per 100</text>
${body}
<text x="16" y="${H - 30}" fill="#4b5563">SIMULATED. Checker: ${esc(s.model)} through the claude program, ${esc(s.date)}. Proposals and the person are scripted (careful for the first ${s.attention} a day).</text>
<text x="16" y="${H - 12}" fill="#4b5563">Not evidence that a real company would see these numbers. Rerun: node evals/sim/run.mjs --replay</text>
</svg>
`;
writeFileSync(output, svg);
console.log(`Wrote ${output}`);
