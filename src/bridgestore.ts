import type { DataAdapter } from 'obsidian';
import { dayKey } from './accesslog';
import { maskSecrets } from './extras';
import { readTail } from './filetail';

// Messages relayed by the Agent Bridge (Brain Monitor → Team). One JSONL file per day
// in the plugin folder, so old days can be dropped; a bounded number kept in memory.

export interface BridgeMessage {
  id: string;
  sender: string;
  recipient: string;
  body: string;
  reply_to: string | null;
  t: number;
  important: boolean;
}

export const BRIDGE_LIMITS = {
  memory: 2000, // messages held in memory
  body: 20_000, // characters of one message kept
  loadBytes: 2_000_000, // read from the end of each day file at startup
  loadDays: 3,
};

const DAY_FILE = /(^|\/)\d{4}-\d{2}-\d{2}\.jsonl$/;

/** A message from the bridge as it may be kept, or null if it isn't one. */
export function cleanMessage(raw: unknown, now = Date.now()): BridgeMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 120) return null;
  // The bridge sends ts (seconds) or timestamp (ISO); stored messages carry t (ms).
  const t = typeof r.t === 'number' && Number.isFinite(r.t) ? r.t
    : typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts * 1000
      : Date.parse(typeof r.timestamp === 'string' ? r.timestamp : '') || now;
  const text = (v: unknown, n: number, fallback: string) => (typeof v === 'string' && v ? v.slice(0, n) : fallback);
  return {
    id: r.id,
    sender: text(r.sender, 60, 'other'),
    recipient: text(r.recipient, 60, 'all'),
    body: maskSecrets(text(r.body ?? r.text, BRIDGE_LIMITS.body, '')),
    reply_to: typeof r.reply_to === 'string' ? r.reply_to.slice(0, 120) : null,
    t: Math.min(t, now + 60_000), // a clock far in the future can't pin a message to the top
    important: !!r.important,
  };
}

export class BridgeStore {
  readonly messages: BridgeMessage[] = []; // oldest first
  private ids = new Set<string>();
  /** Keep only sender, recipient and time on disk (text stays in memory). */
  metadataOnly = false;

  constructor(private adapter: DataAdapter, private dir: string, private legacyFile?: string) {}

  async load() {
    const a = this.adapter;
    try {
      if (!(await a.exists(this.dir))) await a.mkdir(this.dir);
      // 1.1 kept one ever-growing file: move its recent end into day files, then drop it.
      if (this.legacyFile && (await a.exists(this.legacyFile))) {
        const moved = this.parse(await readTail(a, this.legacyFile, BRIDGE_LIMITS.loadBytes));
        const byDay = new Map<string, string>();
        for (const m of moved) byDay.set(dayKey(new Date(m.t)), (byDay.get(dayKey(new Date(m.t))) ?? '') + JSON.stringify(m) + '\n');
        for (const [day, text] of byDay) await a.append(`${this.dir}/${day}.jsonl`, text);
        await a.remove(this.legacyFile);
      }
      const { files } = await a.list(this.dir);
      for (const f of files.filter((x) => DAY_FILE.test(x)).sort().slice(-BRIDGE_LIMITS.loadDays)) {
        for (const m of this.parse(await readTail(a, f, BRIDGE_LIMITS.loadBytes))) this.insert(m);
      }
    } catch (err) {
      console.warn('H!V3MYND: could not load bridge messages', err);
    }
  }

  private parse(text: string): BridgeMessage[] {
    const out: BridgeMessage[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { const m = cleanMessage(JSON.parse(line)); if (m) out.push(m); } catch { /* torn line */ }
    }
    return out;
  }

  has(id: string) { return this.ids.has(id); }

  /** Inserts in time order (messages mostly arrive in order, so this is usually a push). */
  private insert(m: BridgeMessage): boolean {
    if (this.ids.has(m.id)) return false;
    const list = this.messages;
    let i = list.length;
    if (i && list[i - 1].t > m.t) {
      let lo = 0, hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].t <= m.t) lo = mid + 1; else hi = mid; }
      i = lo;
    }
    list.splice(i, 0, m);
    this.ids.add(m.id);
    while (list.length > BRIDGE_LIMITS.memory) this.ids.delete(list.shift()!.id);
    return true;
  }

  /**
   * Adds a message and waits until it is on disk. Resolves to the stored message
   * ("added"), "duplicate" for an id already kept (safe to retry), or rejects if it
   * could not be written; the message is then not kept in memory either, so memory
   * and disk don't disagree.
   */
  async add(m: BridgeMessage): Promise<'added' | 'duplicate'> {
    if (this.ids.has(m.id)) return 'duplicate';
    const kept = this.metadataOnly ? { ...m, body: '' } : m;
    await this.adapter.append(`${this.dir}/${dayKey(new Date(m.t))}.jsonl`, JSON.stringify(kept) + '\n');
    this.insert(m);
    return 'added';
  }

  /** Deletes day files older than `days` days. */
  async prune(days: number, now = Date.now()) {
    if (!(days > 0)) return 0;
    const cutoff = dayKey(new Date(now - days * 86_400_000));
    let n = 0;
    try {
      const { files } = await this.adapter.list(this.dir);
      for (const f of files) {
        const day = /(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f)?.[1];
        if (day && DAY_FILE.test(f) && day < cutoff) { await this.adapter.remove(f); n++; }
      }
    } catch { /* no folder yet */ }
    return n;
  }

  async purge() {
    this.messages.length = 0;
    this.ids.clear();
    try {
      const { files } = await this.adapter.list(this.dir);
      for (const f of files.filter((x) => DAY_FILE.test(x))) await this.adapter.remove(f);
    } catch { /* no folder */ }
  }
}
