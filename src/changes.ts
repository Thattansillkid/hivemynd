import type { DataAdapter } from 'obsidian';
import { dayKey } from './accesslog';
import { maskSecrets } from './extras';

// Before/after snapshots of every agent write, so each change can be diffed and
// undone. One JSONL file per day in the plugin folder (outside the vault graph).

export interface ChangeRecord {
  id: string;
  t: number;
  agent: string;
  path: string; // vault-relative
  purpose: string;
  source: string;
  before: string | null; // null: the write created the note
  after: string | null; // null: the note was gone afterwards
  restoreOf?: string; // set when this record is an undo of another change
  /** How the note text was kept (absent in records from 1.1: raw). */
  stored?: HistoryMode;
  /** Line counts, kept when the text itself isn't (metadata mode). */
  lines?: { added: number; removed: number };
}

/**
 * What change history keeps of each write:
 *   raw       the note text exactly, so undo restores it exactly (secrets included)
 *   redacted  the note text with keys and tokens masked before it is saved; undo
 *             restores the masked text (the default)
 *   metadata  who, when, which note and how many lines; no text, no undo
 */
export type HistoryMode = 'raw' | 'redacted' | 'metadata';

/** A change record as `mode` allows it to be saved. Runs before anything reaches disk. */
export function forHistory(c: ChangeRecord, mode: HistoryMode): ChangeRecord {
  if (mode === 'raw') return { ...c, stored: 'raw' };
  if (mode === 'redacted') {
    const mask = (t: string | null) => (t === null ? null : maskSecrets(t));
    return { ...c, before: mask(c.before), after: mask(c.after), stored: 'redacted' };
  }
  // '' (not null) keeps "created" and "deleted" distinguishable without keeping text.
  return { ...c, lines: diffStats(c), before: c.before === null ? null : '', after: c.after === null ? null : '', stored: 'metadata' };
}

/** Day files are named YYYY-MM-DD.jsonl; nothing else in the folder is ever read. */
export const DAY_FILE = /(^|\/)\d{4}-\d{2}-\d{2}\.jsonl$/;

const MEMORY_LIMIT = 300;

export class ChangeStore {
  readonly records: ChangeRecord[] = []; // oldest first
  private listeners = new Set<(c: ChangeRecord) => void>();

  constructor(private adapter: DataAdapter, private dir: string) {}

  async load() {
    try {
      if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
      const { files } = await this.adapter.list(this.dir);
      const recent = files.filter((f) => DAY_FILE.test(f)).sort().slice(-3);
      // Only the newest records are kept in memory, so read just the end of each file.
      // (A busy day's file can be tens of megabytes; reading it whole on every load
      // crashed Obsidian's window after a few plugin reloads.)
      for (const f of recent) {
        for (const line of (await this.readTail(f, 6_000_000)).split('\n')) {
          if (!line.trim()) continue;
          try { this.records.push(JSON.parse(line)); } catch { /* torn line */ }
        }
      }
      this.records.sort((a, b) => a.t - b.t);
      if (this.records.length > MEMORY_LIMIT) this.records.splice(0, this.records.length - MEMORY_LIMIT);
    } catch (err) {
      console.warn('H!V3MYND: could not load change history', err);
    }
  }

  /** Every recorded change grouped by note, across all days (for authorship). */
  async indexByPath(): Promise<Map<string, ChangeRecord[]>> {
    const out = new Map<string, ChangeRecord[]>();
    // Keep only what authorship needs: the lines each change added. Stored as a record
    // with no "before", so every line in "after" counts as added. Full copies of every
    // note version would cost tens of megabytes.
    const add = (c: ChangeRecord) => {
      if (c.after === null) return;
      const before = new Set((c.before ?? '').split('\n').map((l) => l.trim()));
      const added = c.after.split('\n').filter((l) => l.trim() && !before.has(l.trim()));
      const l = out.get(c.path) ?? [];
      l.push({ id: c.id, t: c.t, agent: c.agent, path: c.path, purpose: '', source: '', before: null, after: added.join('\n') });
      out.set(c.path, l);
    };
    try {
      const { files } = await this.adapter.list(this.dir);
      for (const f of files.filter((x) => DAY_FILE.test(x))) await this.eachLine(f, (line) => { try { add(JSON.parse(line)); } catch { /* torn line */ } });
    } catch { /* no history yet */ }
    this.onChange(add);
    return out;
  }

  private fs(): any {
    const base = (this.adapter as { getBasePath?: () => string }).getBasePath?.();
    const req = (window as unknown as { require?: (m: string) => unknown }).require;
    return base && req ? { fs: req('fs'), base } : null;
  }

  /** The last `bytes` of a file (starting at a line boundary). */
  private async readTail(path: string, bytes: number): Promise<string> {
    const h = this.fs();
    if (!h) return this.adapter.read(path);
    const full = `${h.base}/${path}`;
    const size = h.fs.statSync(full).size;
    if (size <= bytes) return this.adapter.read(path);
    const fd = h.fs.openSync(full, 'r');
    try {
      const buf = new Uint8Array(bytes);
      h.fs.readSync(fd, buf, 0, bytes, size - bytes);
      const text = new TextDecoder().decode(buf);
      return text.slice(text.indexOf('\n') + 1);
    } finally { h.fs.closeSync(fd); }
  }

  /** Call `fn` for each line of a file without holding the whole file in memory. */
  private async eachLine(path: string, fn: (line: string) => void) {
    const h = this.fs();
    if (!h) { for (const l of (await this.adapter.read(path)).split('\n')) if (l.trim()) fn(l); return; }
    const fd = h.fs.openSync(`${h.base}/${path}`, 'r');
    try {
      const chunk = new Uint8Array(1 << 20);
      const dec = new TextDecoder();
      let rest = '';
      for (;;) {
        const n = h.fs.readSync(fd, chunk, 0, chunk.length, null);
        if (!n) break;
        const parts = (rest + dec.decode(chunk.subarray(0, n), { stream: true })).split('\n');
        rest = parts.pop() ?? '';
        for (const l of parts) if (l.trim()) fn(l);
        await new Promise((r) => window.setTimeout(r, 0)); // let the window breathe
      }
      if (rest.trim()) fn(rest);
    } finally { h.fs.closeSync(fd); }
  }

  onChange(fn: (c: ChangeRecord) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** How new records are kept; see HistoryMode. */
  mode: HistoryMode = 'redacted';

  /** Saves a change as the history mode allows. Resolves false if it couldn't be written. */
  async add(raw: ChangeRecord): Promise<boolean> {
    const c = forHistory(raw, this.mode);
    this.records.push(c);
    if (this.records.length > MEMORY_LIMIT) this.records.shift();
    let ok = true;
    try {
      await this.adapter.append(`${this.dir}/${dayKey(new Date(c.t))}.jsonl`, JSON.stringify(c) + '\n');
    } catch (err) {
      ok = false;
      console.warn('H!V3MYND: could not save change', err);
    }
    for (const fn of this.listeners) fn(c);
    return ok;
  }

  /** Deletes day files older than `days` days. Returns how many were removed. */
  async prune(days: number, now = Date.now()): Promise<number> {
    if (!(days > 0)) return 0;
    const cutoff = dayKey(new Date(now - days * 86_400_000));
    let n = 0;
    try {
      const { files } = await this.adapter.list(this.dir);
      for (const f of files) {
        const day = /(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f)?.[1];
        if (day && DAY_FILE.test(f) && day < cutoff) { await this.adapter.remove(f); n++; }
      }
    } catch (err) {
      console.warn('H!V3MYND: could not prune change history', err);
    }
    return n;
  }

  /** Deletes all change history, on disk and in memory. */
  async purge() {
    this.records.length = 0;
    const { files } = await this.adapter.list(this.dir);
    for (const f of files.filter((x) => DAY_FILE.test(x))) await this.adapter.remove(f);
  }
}

// ------------------------------------------------------------------ line diff

export type DiffOp = { kind: 'same' | 'add' | 'del'; text: string; a?: number; b?: number };

/** Myers O(ND) line diff. Returns every line tagged same/add/del with 1-based line numbers. */
export function diffLines(beforeText: string, afterText: string): DiffOp[] {
  const a = beforeText.split('\n');
  const b = afterText.split('\n');
  const n = a.length, m = b.length, max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
    if (d > 4000) return coarse(a, b); // pathological: fall back to whole-block replace
  }
  // Backtrack.
  const ops: DiffOp[] = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ kind: 'same', text: a[x - 1], a: x, b: y }); x--; y--; }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: 'add', text: b[y - 1], b: y });
      else ops.push({ kind: 'del', text: a[x - 1], a: x });
    }
    x = prevX; y = prevY;
  }
  return ops.reverse();
}

function coarse(a: string[], b: string[]): DiffOp[] {
  return [
    ...a.map((text, i) => ({ kind: 'del' as const, text, a: i + 1 })),
    ...b.map((text, i) => ({ kind: 'add' as const, text, b: i + 1 })),
  ];
}

export function diffStats(c: ChangeRecord) {
  if (c.lines) return c.lines;
  if (c.before === null && c.after !== null) return { added: c.after.split('\n').length, removed: 0 };
  if (c.after === null && c.before !== null) return { added: 0, removed: c.before.split('\n').length };
  if (c.before === null || c.after === null) return { added: 0, removed: 0 };
  let added = 0, removed = 0;
  for (const op of diffLines(c.before, c.after)) {
    if (op.kind === 'add') added++;
    else if (op.kind === 'del') removed++;
  }
  return { added, removed };
}
