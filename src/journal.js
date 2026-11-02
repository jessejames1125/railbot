// The audit log and the state store are the same file: one append-only line per
// event, each line carrying the hash of the line before it. State is rebuilt by
// reading the file, so there is nothing else to get out of sync after a crash.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const GENESIS = '0'.repeat(64);

export class JournalCorrupt extends Error {
  constructor(file, problems) {
    super(`The audit log at ${file} fails its check: ${problems[0]}. Refusing to run on it.`);
    this.problems = problems;
  }
}

function hashOf(json) {
  return createHash('sha256').update(json).digest('hex');
}

/** Read a journal file without changing it. */
export function readJournal(file) {
  const out = { events: [], problems: [], lastHash: GENESIS, seq: 0, tornLine: null, missingNewline: false };
  if (!existsSync(file)) return out;
  const text = readFileSync(file, 'utf8');
  out.missingNewline = text.length > 0 && !text.endsWith('\n');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  let unparsed = null;
  lines.forEach((line, i) => {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      // A crash can tear only the last line. Anywhere else it has to be followed
      // by the recovery record that the next open wrote.
      if (unparsed) out.problems.push(`line ${unparsed.at} is not valid and was never recovered`);
      unparsed = { at: i + 1, text: line };
      return;
    }
    const { hash, ...rest } = rec;
    if (hash !== hashOf(JSON.stringify(rest))) {
      out.problems.push(`line ${i + 1} was changed after it was written`);
      return;
    }
    if (rec.prev !== out.lastHash) out.problems.push(`line ${i + 1} does not follow the line before it`);
    if (rec.seq !== out.seq + 1) out.problems.push(`line ${i + 1} is out of sequence`);
    if (unparsed && rec.type !== 'recovered') {
      out.problems.push(`line ${unparsed.at} is not valid and was never recovered`);
    }
    unparsed = null;
    out.events.push(rec);
    out.lastHash = hash;
    out.seq = rec.seq;
  });
  if (unparsed) out.tornLine = unparsed;
  return out;
}

export class Journal {
  /**
   * @param {string} file
   * @param {{ clock?: () => Date, allowProblems?: boolean }} [opts]
   */
  constructor(file, opts = {}) {
    this.file = file;
    this.clock = opts.clock ?? (() => new Date());
    mkdirSync(dirname(file), { recursive: true });
    const read = readJournal(file);
    if (read.problems.length && !opts.allowProblems) throw new JournalCorrupt(file, read.problems);
    this.events = read.events;
    this.lastHash = read.lastHash;
    this.seq = read.seq;
    if (read.missingNewline) this.#write('\n');
    if (read.tornLine) {
      this.append('recovered', {
        reason: 'the last write was cut short, most likely by a crash',
        tornLine: read.tornLine.at,
        tornSha256: hashOf(read.tornLine.text),
      });
    }
  }

  #write(text) {
    const fd = openSync(this.file, 'a');
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Write one event and force it to disk before returning. */
  append(type, fields = {}) {
    const rec = { seq: this.seq + 1, ts: this.clock().toISOString(), type, ...fields, prev: this.lastHash };
    const json = JSON.stringify(rec);
    const hash = hashOf(json);
    const line = JSON.stringify({ ...rec, hash });
    this.#write(`${line}\n`);
    const stored = { ...rec, hash };
    this.events.push(stored);
    this.lastHash = hash;
    this.seq = rec.seq;
    return stored;
  }
}
