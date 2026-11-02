// Draws docs/sim.svg from a simulation summary: planted faults left standing, good actions
// blocked, and how often a person was asked, for each way of gating the work.
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
const clean = (s.actions - s.faults) * s.seeds.length;
// Good actions blocked are few next to the clean total, so that panel scales to the largest row.
const mostBlocked = Math.max(1, ...rows.map((r) => r.blocked));

const W = 920;
const rowH = 34;
const top = 74;
const label = 160;
const panel = 170;
const xs = [label, label + panel + 110, label + 2 * panel + 200];
const H = top + rows.length * rowH + 76;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const bar = (x, y, w, color) => `<rect x="${x}" y="${y}" width="${Math.max(w, 1.5)}" height="18" rx="2" fill="${color}"/>`;

let body = '';
rows.forEach((r, i) => {
  const y = top + i * rowH;
  const strong = r.config === 'both';
  body += `<text x="${label - 10}" y="${y + 14}" text-anchor="end" font-weight="${strong ? 700 : 400}">${esc(NAMES[r.config])}</text>`;
  const cells = [
    [(panel * r.standing) / faults, '#c2410c', `${r.standing} of ${faults}${r.undone ? ` (+${r.undone} undone)` : ''}`],
    [(panel * r.blocked) / mostBlocked, '#6b7280', `${r.blocked} of ${clean}`],
    [(panel * r.asked) / 100, '#1d4ed8', Number.isInteger(r.asked) ? r.asked : r.asked.toFixed(1)],
  ];
  cells.forEach(([w, color, text], k) => {
    body += bar(xs[k], y, w, color);
    body += `<text x="${xs[k] + Math.max(w, 1.5) + 6}" y="${y + 14}">${text}</text>`;
  });
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="#1f2937">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="16" y="24" font-size="15" font-weight="700">A simulated shop, ${s.seeds.length} days of ${s.actions} actions, ${s.faults} planted faults a day</text>
<text x="${xs[0]}" y="${top - 12}" font-weight="700">Planted faults left standing</text>
<text x="${xs[1]}" y="${top - 12}" font-weight="700">Good actions blocked</text>
<text x="${xs[2]}" y="${top - 12}" font-weight="700">Person asked, per 100</text>
${body}
<text x="16" y="${H - 48}" fill="#4b5563">SIMULATED. Checker: ${esc(s.model)} through the claude program, ${esc(s.date)}, generator version ${s.version ?? 1}.</text>
<text x="16" y="${H - 30}" fill="#4b5563">Proposals and the person are scripted (the person reads the first ${s.attention} items a day with care, then approves without reading).</text>
<text x="16" y="${H - 12}" fill="#4b5563">Not evidence that a real company would see these numbers. Rerun: node evals/sim/run.mjs --replay</text>
</svg>
`;
writeFileSync(output, svg);
console.log(`Wrote ${output}`);
