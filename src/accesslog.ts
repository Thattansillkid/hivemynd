import { DataAdapter, normalizePath } from 'obsidian';

// Durable record of which agent touched which note, when, and why. Stored as one
// JSONL file per day inside the plugin folder (not a note, so it never joins the
// graph), with an optional human-readable daily digest note in the vault.

export type AccessAction = 'read' | 'write' | 'search';

export interface AccessEntry {
  t: number; // epoch ms
  agent: string;
  action: AccessAction;
  notes: string[]; // vault paths; one for read/write, many for a search
  purpose: string; // what the agent was working on, if known
  source: string; // how it reached us: hook tool name, bridge route, ...
  tokens?: number; // estimated tokens this access pulled into the agent's context
  partial?: boolean; // a ranged read (offset/limit), not the whole file
}

const MEMORY_LIMIT = 5000;

export class AccessLog {
  readonly entries: AccessEntry[] = []; // oldest first
  private listeners = new Set<(e: AccessEntry) => void>();
  private pendingJson = new Map<string, string[]>();
  private pendingDigest = new Map<string, string[]>();
  private flushTimer: number | null = null;
  private digestTimer: number | null = null;

  constructor(
    private adapter: DataAdapter,
    private dir: string,
    private digest: () => { enabled: boolean; folder: string },
  ) {}

  async load() {
    try {
      if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86_400_000);
      for (const d of [yesterday, today]) {
        const path = this.jsonPath(d);
        if (!(await this.adapter.exists(path))) continue;
        for (const line of (await this.adapter.read(path)).split('\n')) {
          if (!line.trim()) continue;
          try { this.entries.push(JSON.parse(line)); } catch { /* skip a torn line */ }
        }
      }
      this.entries.sort((a, b) => a.t - b.t);
      if (this.entries.length > MEMORY_LIMIT) this.entries.splice(0, this.entries.length - MEMORY_LIMIT);
    } catch (err) {
      console.warn('H!V3MYND: could not load access log', err);
    }
  }

  /** Every logged entry from the last `days` days, read from disk (for heat & decay). */
  async history(days: number): Promise<AccessEntry[]> {
    const out: AccessEntry[] = [];
    try {
      if (!(await this.adapter.exists(this.dir))) return out;
      const cutoff = dayKey(new Date(Date.now() - days * 86_400_000));
      const { files } = await this.adapter.list(this.dir);
      for (const f of files) {
        const name = f.split('/').pop()!.replace(/\.jsonl$/, '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(name) || name < cutoff) continue;
        for (const line of (await this.adapter.read(f)).split('\n')) {
          if (!line.trim()) continue;
          try { out.push(JSON.parse(line)); } catch { /* torn line */ }
        }
      }
    } catch (err) {
      console.warn('H!V3MYND: could not read access history', err);
    }
    // Entries still waiting in the write buffer are in memory only.
    const seen = new Set(out.map((e) => `${e.t}|${e.agent}|${e.notes[0]}`));
    for (const e of this.entries) if (!seen.has(`${e.t}|${e.agent}|${e.notes[0]}`)) out.push(e);
    return out;
  }

  private dayCache = new Map<string, AccessEntry[]>();

  /**
   * Entries from the `days` days before today, read from disk once per day file and
   * cached (finished days never change). Today's entries come from `entries`.
   */
  async pastDays(days: number): Promise<AccessEntry[]> {
    const today = dayKey(new Date());
    const cutoff = dayKey(new Date(Date.now() - days * 86_400_000));
    const out: AccessEntry[] = [];
    try {
      if (!(await this.adapter.exists(this.dir))) return out;
      const { files } = await this.adapter.list(this.dir);
      for (const f of files) {
        const name = f.split('/').pop()!.replace(/\.jsonl$/, '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(name) || name < cutoff || name >= today) continue;
        let list = this.dayCache.get(name);
        if (!list) {
          list = [];
          for (const line of (await this.adapter.read(f)).split('\n')) {
            if (!line.trim()) continue;
            try { list.push(JSON.parse(line)); } catch { /* torn line */ }
          }
          this.dayCache.set(name, list);
        }
        for (const e of list) out.push(e);
      }
    } catch (err) {
      console.warn('H!V3MYND: could not read past access days', err);
    }
    return out;
  }

  onEntry(fn: (e: AccessEntry) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  add(entry: AccessEntry) {
    this.entries.push(entry);
    if (this.entries.length > MEMORY_LIMIT) this.entries.shift();
    const day = dayKey(new Date(entry.t));
    push(this.pendingJson, this.jsonPath(new Date(entry.t)), JSON.stringify(entry));
    if (this.digest().enabled) push(this.pendingDigest, day, digestRow(entry));
    for (const fn of this.listeners) fn(entry);
    // Batch disk writes: the log can see dozens of entries a second during a search spree.
    this.flushTimer ??= window.setTimeout(() => void this.flushJson(), 1500);
    this.digestTimer ??= window.setTimeout(() => void this.flushDigest(), 20_000);
  }

  async flushAll() {
    await this.flushJson();
    await this.flushDigest();
  }

  private async flushJson() {
    this.flushTimer = null;
    const batches = [...this.pendingJson];
    this.pendingJson.clear();
    for (const [path, lines] of batches) {
      try { await this.adapter.append(path, lines.join('\n') + '\n'); } catch (err) { console.warn('H!V3MYND: access log write failed', err); }
    }
  }

  private async flushDigest() {
    this.digestTimer = null;
    const { enabled, folder } = this.digest();
    const batches = [...this.pendingDigest];
    this.pendingDigest.clear();
    if (!enabled) return;
    for (const [day, rows] of batches) {
      const dir = normalizePath(folder);
      const path = normalizePath(`${folder}/${day}.md`);
      try {
        if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
        if (!(await this.adapter.exists(path))) await this.adapter.write(path, digestHeader(day));
        await this.adapter.append(path, rows.join('\n') + '\n');
      } catch (err) {
        console.warn('H!V3MYND: access digest write failed', err);
      }
    }
  }

  private jsonPath(d: Date) { return `${this.dir}/${dayKey(d)}.jsonl`; }
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function dayKey(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function clock(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function noteTitle(path: string) {
  return path.split('/').pop()!.replace(/\.md$/i, '');
}

// Digest notes deliberately use plain text, not [[links]]: links would wire the log
// into the graph and the backlinks of every note it mentions.
function cell(s: string) {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function digestHeader(day: string) {
  return [
    '---',
    'hivemynd: access-log',
    `date: ${day}`,
    '---',
    `# Access log — ${day}`,
    '',
    'Every note an agent read, wrote or searched today, newest at the bottom. Written by H!V3MYND and kept outside the brain (no links).',
    '',
    '| Time | Agent | Action | Note | For |',
    '| --- | --- | --- | --- | --- |',
    '',
  ].join('\n');
}

function digestRow(e: AccessEntry) {
  const notes = e.action === 'search'
    ? `${e.notes.length} notes: ${e.notes.slice(0, 4).map(noteTitle).join(', ')}${e.notes.length > 4 ? ', …' : ''}`
    : e.notes[0].replace(/\.md$/i, '');
  return `| ${clock(e.t)} | ${cell(e.agent)} | ${e.action} | ${cell(notes)} | ${cell(e.purpose || '—')} |`;
}
