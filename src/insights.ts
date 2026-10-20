// Pure analysis over the access log: agent status, collisions, heat/decay scores and
// context-budget totals. No DOM, no Obsidian; the views and plugin call these.

import type { AccessEntry } from './accesslog';

// ------------------------------------------------------------------ status board

export type AgentState = 'active' | 'idle' | 'quiet' | 'unseen';

export interface AgentStatus {
  agent: string;
  state: AgentState;
  lastSeen: number | null;
  task: string; // most recent purpose
  lastNote: string;
  reads: number;
  writes: number;
  searches: number;
  tokens: number;
}

const ACTIVE_MS = 2 * 60_000;
const IDLE_MS = 30 * 60_000;

export function agentStatuses(entries: AccessEntry[], agents: string[], now: number, dayStart: number): AgentStatus[] {
  const out = new Map<string, AgentStatus>();
  for (const a of agents) {
    out.set(a, { agent: a, state: 'unseen', lastSeen: null, task: '', lastNote: '', reads: 0, writes: 0, searches: 0, tokens: 0 });
  }
  for (const e of entries) {
    const s = out.get(e.agent);
    if (!s) continue;
    if (s.lastSeen === null || e.t >= s.lastSeen) {
      s.lastSeen = e.t;
      if (e.purpose) s.task = e.purpose;
      if (e.action !== 'search') s.lastNote = e.notes[0];
    }
    if (e.t < dayStart) continue;
    if (e.action === 'read') s.reads++;
    else if (e.action === 'write') s.writes++;
    else s.searches++;
    if (!isSynthetic(e)) s.tokens += e.tokens ?? 0;
  }
  for (const s of out.values()) {
    if (s.lastSeen === null) continue;
    const age = now - s.lastSeen;
    s.state = age < ACTIVE_MS ? 'active' : age < IDLE_MS ? 'idle' : 'quiet';
  }
  const rank: Record<AgentState, number> = { active: 0, idle: 1, quiet: 2, unseen: 3 };
  return [...out.values()].sort((a, b) => rank[a.state] - rank[b.state] || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

// ------------------------------------------------------------------ collisions

export type CollisionKind = 'write-write' | 'write-during-read' | 'watch' | 'blocked';

/** Monitor alert: two agents colliding on a note, or an agent touching a watched note. */
export interface Collision {
  t: number;
  kind: CollisionKind;
  note: string;
  writer: string; // the agent that triggered it
  other: string;
  otherAt: number;
  action?: string; // watch: read / write / search
  rule?: string; // watch: the matching watchlist prefix
}

const WRITE_WRITE_MS = 10 * 60_000; // two agents editing one note inside 10 minutes
const READ_WRITE_MS = 3 * 60_000; // an agent edits a note another agent just read

/**
 * Checks a new write against recent history. A write-write overlap is the serious
 * case (one agent may clobber the other); writing a note another agent is working
 * from is a warning (their copy is now stale).
 */
export function detectCollision(write: AccessEntry, history: AccessEntry[]): Collision | null {
  if (write.action !== 'write') return null;
  const note = write.notes[0];
  let readHit: AccessEntry | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (write.t - e.t > WRITE_WRITE_MS) break;
    if (e === write || e.agent === write.agent || e.notes[0] !== note) continue;
    if (e.action === 'write') return { t: write.t, kind: 'write-write', note, writer: write.agent, other: e.agent, otherAt: e.t };
    if (e.action === 'read' && !readHit && write.t - e.t <= READ_WRITE_MS) readHit = e;
  }
  return readHit ? { t: write.t, kind: 'write-during-read', note, writer: write.agent, other: readHit.agent, otherAt: readHit.t } : null;
}

// ------------------------------------------------------------------ heat & decay

export interface NoteHistory { score: number; lastAccess: number }

const HEAT_HALF_LIFE = 3 * 86_400_000;

/** Folds log entries into a recency-weighted access score and last-access time per note. */
export function foldHistory(entries: Iterable<AccessEntry>, now: number, into = new Map<string, NoteHistory>()) {
  for (const e of entries) {
    if (e.action === 'search') continue; // surfacing in a search isn't real use
    const w = Math.exp((-(now - e.t) * Math.LN2) / HEAT_HALF_LIFE);
    for (const n of e.notes) {
      const h = into.get(n) ?? { score: 0, lastAccess: 0 };
      h.score += w;
      h.lastAccess = Math.max(h.lastAccess, e.t);
      into.set(n, h);
    }
  }
  return into;
}

export const DECAY_START_DAYS = 30;
export const DECAY_FULL_DAYS = 90;

/**
 * heat 0..1: how much agents use the note lately (p95-normalised).
 * decay 0..1: 0 if touched (by an agent or by you editing it) within 30 days, 1 at 90+.
 */
export function heatAndDecay(paths: string[], history: Map<string, NoteHistory>, mtimes: Map<string, number>, now: number) {
  const heat = new Float32Array(paths.length);
  const decay = new Float32Array(paths.length);
  const scores = [...history.values()].map((h) => h.score).sort((a, b) => a - b);
  const p95 = scores.length ? scores[Math.min(scores.length - 1, Math.floor(scores.length * 0.95))] : 1;
  paths.forEach((p, i) => {
    const h = history.get(p);
    heat[i] = h ? Math.min(1, Math.sqrt(h.score / Math.max(p95, 1e-6))) : 0;
    const touched = Math.max(h?.lastAccess ?? 0, mtimes.get(p) ?? 0);
    const days = (now - touched) / 86_400_000;
    decay[i] = Math.min(1, Math.max(0, (days - DECAY_START_DAYS) / (DECAY_FULL_DAYS - DECAY_START_DAYS)));
  });
  return { heat, decay };
}

// ------------------------------------------------------------------ context budget

/** Rough tokens for text of a given byte size (English-ish markdown ≈ 4 bytes/token). */
export function tokensForBytes(bytes: number) {
  return Math.round(bytes / 4);
}

export const HEAVY_READ_TOKENS = 8000;

export interface BudgetRow { key: string; agent: string; tokens: number; reads: number; heavy: number }

/** Demo-button and test pulses: drawn in the brain, but not real agent work. */
export function isSynthetic(e: AccessEntry) {
  return /^demo$|\btest\b/i.test(e.source ?? '');
}

/** Context pulled in between from and to, grouped by agent + task, biggest first. */
export function budgetByTask(entries: AccessEntry[], from: number, to = Infinity) {
  const rows = new Map<string, BudgetRow>();
  const heavy: AccessEntry[] = [];
  for (const e of entries) {
    if (e.t < from || e.t >= to || !e.tokens || isSynthetic(e)) continue;
    const task = e.purpose || '(no purpose reported)';
    const key = `${e.agent}\u0000${task}`;
    const r = rows.get(key) ?? { key: task, agent: e.agent, tokens: 0, reads: 0, heavy: 0 };
    r.tokens += e.tokens;
    if (e.action === 'read') r.reads++;
    if (e.action === 'read' && e.tokens >= HEAVY_READ_TOKENS && !e.partial) { r.heavy++; heavy.push(e); }
    rows.set(key, r);
  }
  return { rows: [...rows.values()].sort((a, b) => b.tokens - a.tokens), heavy: heavy.sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0)) };
}

// ------------------------------------------------------------------ task context map

export interface TaskGroup {
  key: string;
  agent: string;
  purpose: string;
  start: number;
  end: number;
  notes: { path: string; first: number; reads: number; writes: number; searches: number }[];
  tokens: number;
}

/**
 * Groups the log into tasks: one per agent + purpose. Entries without a purpose fall
 * into per-agent sessions split by 20-minute gaps, so they still form usable groups.
 */
export function taskGroups(entries: AccessEntry[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  const lastUnnamed = new Map<string, { key: string; t: number }>();
  for (const e of [...entries].sort((a, b) => a.t - b.t)) {
    let key: string;
    let purpose = e.purpose;
    if (purpose) key = `${e.agent}\u0000${purpose}`;
    else {
      const prev = lastUnnamed.get(e.agent);
      key = prev && e.t - prev.t < 20 * 60_000 ? prev.key : `${e.agent}\u0000~${e.t}`;
      lastUnnamed.set(e.agent, { key, t: e.t });
      purpose = '';
    }
    const g = groups.get(key) ?? { key, agent: e.agent, purpose, start: e.t, end: e.t, notes: [], tokens: 0 };
    g.end = Math.max(g.end, e.t);
    g.tokens += e.tokens ?? 0;
    for (const p of e.notes) {
      let n = g.notes.find((x) => x.path === p);
      if (!n) { n = { path: p, first: e.t, reads: 0, writes: 0, searches: 0 }; g.notes.push(n); }
      if (e.action === 'read') n.reads++;
      else if (e.action === 'write') n.writes++;
      else n.searches++;
    }
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.end - a.end);
}

// ------------------------------------------------------------------ knowledge gaps

export interface Reread { agent: string; path: string; count: number; last: number }

/** Notes one agent read three or more times today: candidates for a summary or memory entry. */
export function rereads(entries: AccessEntry[], dayStart: number, min = 3): Reread[] {
  const m = new Map<string, Reread>();
  for (const e of entries) {
    if (e.t < dayStart || e.action !== 'read') continue;
    for (const p of e.notes) {
      const k = `${e.agent}\u0000${p}`;
      const r = m.get(k) ?? { agent: e.agent, path: p, count: 0, last: 0 };
      r.count++;
      r.last = Math.max(r.last, e.t);
      m.set(k, r);
    }
  }
  return [...m.values()].filter((r) => r.count >= min).sort((a, b) => b.count - a.count);
}

export interface LinkSuggestion { a: string; b: string; together: number; tasks: string[] }

/**
 * Pairs of notes that agents keep reading in the same task but that don't link to each
 * other: the strongest evidence that a link (or a hub note) is missing.
 */
export function linkSuggestions(tasks: TaskGroup[], linked: (a: string, b: string) => boolean, max = 20): LinkSuggestion[] {
  const pairs = new Map<string, LinkSuggestion>();
  for (const t of tasks) {
    const notes = t.notes.filter((n) => n.reads + n.writes > 0).map((n) => n.path).slice(0, 25);
    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length; j++) {
        const [a, b] = notes[i] < notes[j] ? [notes[i], notes[j]] : [notes[j], notes[i]];
        if (linked(a, b)) continue;
        const k = `${a}\u0000${b}`;
        const s = pairs.get(k) ?? { a, b, together: 0, tasks: [] };
        s.together++;
        if (t.purpose && s.tasks.length < 3 && !s.tasks.includes(t.purpose)) s.tasks.push(t.purpose);
        pairs.set(k, s);
      }
    }
  }
  return [...pairs.values()].filter((s) => s.together >= 2).sort((a, b) => b.together - a.together).slice(0, max);
}

// ------------------------------------------------------------------ watchlist

export interface WatchRule { prefix: string; actions: Set<string> }

/** Parses "Finance/Payments/ : write" style lines; no action list means read+write. */
export function parseWatchlist(text: string): WatchRule[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [prefix, acts] = l.split(':').map((s) => s.trim());
    const actions = new Set((acts || 'read, write').split(/[,\s]+/).map((a) => a.toLowerCase()).filter(Boolean));
    return { prefix: prefix.replace(/^\/+/, ''), actions };
  });
}

export function watchMatch(rules: WatchRule[], path: string, action: string): WatchRule | null {
  const low = path.toLowerCase();
  return rules.find((r) => low.startsWith(r.prefix.toLowerCase()) && (r.actions.has(action) || r.actions.has('any'))) ?? null;
}
