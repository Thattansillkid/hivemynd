import type { DataAdapter } from 'obsidian';
import { dayKey } from './accesslog';

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
}

const MEMORY_LIMIT = 300;

export class ChangeStore {
  readonly records: ChangeRecord[] = []; // oldest first
  private listeners = new Set<(c: ChangeRecord) => void>();

  constructor(private adapter: DataAdapter, private dir: string) {}

  async load() {
    try {
      if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
      const { files } = await this.adapter.list(this.dir);
      const recent = files.filter((f) => f.endsWith('.jsonl')).sort().slice(-3);
      for (const f of recent) {
        for (const line of (await this.adapter.read(f)).split('\n')) {
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

  onChange(fn: (c: ChangeRecord) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async add(c: ChangeRecord) {
    this.records.push(c);
    if (this.records.length > MEMORY_LIMIT) this.records.shift();
    try {
      await this.adapter.append(`${this.dir}/${dayKey(new Date(c.t))}.jsonl`, JSON.stringify(c) + '\n');
    } catch (err) {
      console.warn('H!V3MYND: could not save change', err);
    }
    for (const fn of this.listeners) fn(c);
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
