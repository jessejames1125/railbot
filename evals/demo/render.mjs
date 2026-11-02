// Turns the asciicast from record.mjs into a GIF by replaying it through a real terminal
// emulator and photographing the screen. Needs @xterm/headless, a Chrome and ffmpeg.
//
//   CHROME=/path/to/chrome node evals/demo/render.mjs first-run.cast docs/first-run.gif
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.DEMO_TOOLS ? join(process.env.DEMO_TOOLS, 'x.js') : import.meta.url);
const { Terminal } = require('@xterm/headless');
const [castFile, outFile] = [resolve(process.argv[2]), resolve(process.argv[3])];
const chrome = process.env.CHROME ?? 'chrome';

const lines = readFileSync(castFile, 'utf8').trim().split('\n');
const header = JSON.parse(lines[0]);
const events = lines.slice(1).map((l) => JSON.parse(l));
const term = new Terminal({ cols: header.width, rows: header.height, scrollback: 0, allowProposedApi: true });

const PALETTE = ['#0d1117', '#ff7b72', '#7ee787', '#e3b341', '#79c0ff', '#d2a8ff', '#a5d6ff', '#c9d1d9', '#8b949e', '#ffa198', '#a6f0b0', '#f2cc60', '#a5d6ff', '#e2c5ff', '#b6e3ff', '#f0f6fc'];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function snapshot() {
  const buffer = term.buffer.active;
  const rows = [];
  const cell = buffer.getNullCell();
  for (let y = 0; y < term.rows; y++) {
    const line = buffer.getLine(buffer.viewportY + y);
    let html = '';
    let run = '';
    let style = '';
    const flush = () => {
      if (run) html += style ? `<span style="${style}">${esc(run)}</span>` : esc(run);
      run = '';
    };
    for (let x = 0; x < term.cols; x++) {
      line.getCell(x, cell);
      const paletted = cell.isFgPalette();
      const fg = paletted ? PALETTE[cell.getFgColor()] ?? '' : '';
      const next = `${fg ? `color:${fg};` : ''}${cell.isBold() ? 'font-weight:700;' : ''}${cell.isDim() ? 'opacity:.62;' : ''}`;
      if (next !== style) {
        flush();
        style = next;
      }
      run += cell.getChars() || ' ';
    }
    flush();
    rows.push(html.replace(/\s+$/, ''));
  }
  return rows.join('\n');
}

const page = (screen) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#0d1117}
pre{margin:0;padding:14px 16px;font:14px/19px Consolas,Menlo,'DejaVu Sans Mono',monospace;color:#c9d1d9;white-space:pre}
</style><pre>${screen}</pre>`;

const work = mkdtempSync(join(tmpdir(), 'railbot-frames-'));
const STEP = 0.25;
const frames = [];
let index = 0;
const end = events.at(-1)[0];
for (let t = 0; t <= end + STEP; t += STEP) {
  while (index < events.length && events[index][0] <= t) {
    await new Promise((r) => term.write(events[index][2], r));
    index++;
  }
  const screen = snapshot();
  if (frames.length && frames.at(-1).screen === screen) frames.at(-1).duration += STEP;
  else frames.push({ screen, duration: STEP });
}
frames.at(-1).duration += 4;
console.log(`${frames.length} distinct frames over ${end.toFixed(1)}s`);

const width = Math.ceil(header.width * 7.71) + 40;
const height = header.height * 19 + 28;
const shoot = (i) => new Promise((done, fail) => {
  const html = join(work, `f${i}.html`);
  writeFileSync(html, page(frames[i].screen));
  const png = join(work, `f${String(i).padStart(4, '0')}.png`);
  const child = spawn(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-sandbox', '--force-device-scale-factor=1', `--user-data-dir=${join(work, `profile${i % 3}`)}`, `--window-size=${width},${height}`, `--screenshot=${png}`, `file:///${html.replace(/\\/g, '/')}`], { stdio: 'ignore' });
  child.on('close', (code) => (code === 0 ? done() : fail(new Error(`chrome exited ${code} on frame ${i}`))));
});
for (let i = 0; i < frames.length; i += 3) await Promise.all([i, i + 1, i + 2].filter((n) => n < frames.length).map(shoot));

const list = frames.map((f, i) => `file 'f${String(i).padStart(4, '0')}.png'\nduration ${f.duration.toFixed(2)}`).join('\n');
writeFileSync(join(work, 'list.txt'), `${list}\nfile 'f${String(frames.length - 1).padStart(4, '0')}.png'\n`);
const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=48:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', outFile], { cwd: work, encoding: 'utf8' });
if (res.status !== 0) throw new Error(res.stderr);
rmSync(work, { recursive: true, force: true });
console.log(`Wrote ${outFile}`);
