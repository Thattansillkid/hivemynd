import { AccessEntry, noteTitle } from './accesslog';
import { ChangeRecord, diffStats } from './changes';
import { TaskGroup } from './insights';

// Shared-work features for several agents on one vault:
//   claims    - who is working on which note right now, so agents don't edit in parallel
//   handoffs  - when one agent picks up where another left off, a pack of what happened
//   trust     - how far a note can be relied on (age, repeat reads, undone edits)
//   gap radar - what the vault is missing, ranked by agent time it would have saved
//   brief     - a daily summary note of what the agents did
// Everything here is pure: main.ts feeds it the access log and change records.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ------------------------------------------------------------------ claims

export interface Claim {
  agent: string;
  path: string;
  purpose: string;
  since: number;
  until: number;
  /** Claimed on purpose through the API, not just by editing the note. */
  explicit: boolean;
}

export class ClaimBoard {
  private claims = new Map<string, Claim>();
  private listeners = new Set<() => void>();

  constructor(private persist: (list: Claim[]) => void) {}

  load(list: Claim[]) {
    const now = Date.now();
    for (const c of list) if (c && typeof c.path === 'string' && c.until > now) this.claims.set(c.path, c);
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.persist(this.list());
    for (const fn of this.listeners) fn();
  }

  /** Active claims, newest first. */
  list(now = Date.now()): Claim[] {
    let pruned = false;
    for (const [p, c] of this.claims) if (c.until <= now) { this.claims.delete(p); pruned = true; }
    if (pruned) window.setTimeout(() => this.changed(), 0);
    return [...this.claims.values()].sort((a, b) => b.since - a.since);
  }

  holder(path: string, now = Date.now()): Claim | null {
    const c = this.claims.get(path);
    return c && c.until > now ? c : null;
  }

  /**
   * Claim a note for `minutes`. Renews the agent's own claim; returns the other
   * agent's claim instead when the note is already taken.
   */
  claim(agent: string, path: string, purpose: string, minutes: number, explicit: boolean, now = Date.now()): { claim: Claim } | { conflict: Claim } {
    const cur = this.holder(path, now);
    if (cur && cur.agent !== agent) return { conflict: cur };
    const c: Claim = {
      agent,
      path,
      purpose: purpose || cur?.purpose || '',
      since: cur?.since ?? now,
      until: Math.max(cur?.until ?? 0, now + minutes * MIN),
      explicit: explicit || !!cur?.explicit,
    };
    this.claims.set(path, c);
    this.changed();
    return { claim: c };
  }

  /** Release an agent's claims (all of them, or just these notes). */
  release(agent: string, paths?: string[]) {
    let n = 0;
    for (const [p, c] of this.claims) {
      if (c.agent !== agent || (paths && !paths.includes(p))) continue;
      this.claims.delete(p);
      n++;
    }
    if (n) this.changed();
    return n;
  }

  /** The user releases a claim from the Brain Monitor, whoever holds it. */
  releasePath(path: string) {
    if (this.claims.delete(path)) this.changed();
  }
}

// ------------------------------------------------------------------ handoffs

export interface Handoff {
  id: string;
  t: number;
  from: string;
  to: string;
  /** The note where the second agent picked up the work. */
  note: string;
  task: string;
  /** The first agent's notes in the order it first touched them (the trail). */
  trail: string[];
}

/** When an agent stepped away this long ago, picking up its notes counts as a handoff. */
export const HANDOFF_IDLE_MS = 10 * MIN;
/** Only work edited within this window can be handed off. */
export const HANDOFF_WINDOW_MS = 6 * HOUR;

/**
 * Is this access an agent picking up another agent's recent work? True when `e`
 * touches a note another agent edited in the last few hours and that agent has since
 * gone quiet. (Still active: that's a collision, not a handoff.)
 */
export function detectHandoff(e: AccessEntry, entries: AccessEntry[], tasks: () => TaskGroup[]): Omit<Handoff, 'id'> | null {
  if (e.action === 'search') return null;
  const note = e.notes[0];
  let prior: AccessEntry | null = null;
  const lastSeen = new Map<string, number>();
  for (let i = entries.length - 1; i >= 0; i--) {
    const x = entries[i];
    if (e.t - x.t > HANDOFF_WINDOW_MS) break;
    if (x === e || x.t > e.t) continue;
    if (!lastSeen.has(x.agent)) lastSeen.set(x.agent, x.t);
    if (!prior && x.agent !== e.agent && x.action === 'write' && x.notes[0] === note) prior = x;
  }
  if (!prior) return null;
  if (e.t - (lastSeen.get(prior.agent) ?? 0) < HANDOFF_IDLE_MS) return null;
  const group = tasks().find((g) => g.agent === prior.agent && g.start <= prior.t && g.end >= prior.t && g.notes.some((n) => n.path === note));
  const trail = group ? [...group.notes].sort((a, b) => a.first - b.first).map((n) => n.path) : [note];
  return { t: e.t, from: prior.agent, to: e.agent, note, task: group?.purpose || prior.purpose || '', trail };
}

export interface PackInput {
  from: string;
  to?: string;
  task?: string;
  entries: AccessEntry[];
  changes: ChangeRecord[];
  claims: Claim[];
  misses: { t: number; agent: string; query: string }[];
  now?: number;
}

/** A markdown handoff pack: what an agent did recently, for the agent taking over. */
export function buildHandoffPack(o: PackInput): string {
  const now = o.now ?? Date.now();
  const since = now - HANDOFF_WINDOW_MS;
  let mine = o.entries.filter((e) => e.agent === o.from && e.t >= since);
  if (o.task) mine = mine.filter((e) => (e.purpose || '') === o.task);
  const link = (p: string) => `[[${p.replace(/\.md$/i, '')}|${noteTitle(p)}]]`;
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const out: string[] = [];
  out.push(`# Handoff: ${o.from}${o.to ? ` → ${o.to}` : ''}`);
  out.push(`_Built by H!V3MYND on ${new Date(now).toLocaleString([], { hour12: false })} from the last ${HANDOFF_WINDOW_MS / HOUR} hours of ${o.from}'s work._`);
  out.push('');
  if (!mine.length) {
    out.push(`${o.from} hasn't touched the vault in the last ${HANDOFF_WINDOW_MS / HOUR} hours.`);
    return out.join('\n');
  }
  const tasks = [...new Set(mine.map((e) => e.purpose).filter(Boolean))];
  out.push(`**Working on:** ${o.task || tasks.slice(-3).join(' · ') || 'no task recorded'}`);
  out.push(`**Active:** ${time(mine[0].t)}–${time(mine[mine.length - 1].t)} · last seen ${agoText(now - mine[mine.length - 1].t)} ago`);
  out.push('');

  const changed = o.changes.filter((c) => c.agent === o.from && c.t >= since && !c.restoreOf);
  const undone = new Set(o.changes.filter((c) => c.restoreOf).map((c) => c.restoreOf));
  const written = [...new Set(mine.filter((e) => e.action === 'write').map((e) => e.notes[0]))];
  out.push(`## What ${o.from} changed`);
  if (!written.length) out.push('- Nothing; it only read.');
  for (const p of written) {
    const recs = changed.filter((c) => c.path === p);
    let add = 0, del = 0;
    for (const r of recs) { const s = diffStats(r); add += s.added; del += s.removed; }
    const created = recs.some((r) => r.before === null);
    const wasUndone = recs.some((r) => undone.has(r.id));
    out.push(`- ${link(p)}${created ? ' (new)' : ''}${recs.length ? ` · +${add} −${del} lines` : ''}${wasUndone ? ' · ⚠ the user undid part of this' : ''}`);
  }
  out.push('');

  const reads = new Map<string, number>();
  for (const e of mine) if (e.action === 'read') reads.set(e.notes[0], (reads.get(e.notes[0]) ?? 0) + 1);
  out.push(`## What ${o.from} read`);
  if (!reads.size) out.push('- Nothing recorded.');
  for (const [p, n] of [...reads].sort((a, b) => b[1] - a[1]).slice(0, 25)) out.push(`- ${link(p)}${n > 1 ? ` ×${n}` : ''}`);
  out.push('');

  const held = o.claims.filter((c) => c.agent === o.from);
  if (held.length) {
    out.push(`## Still claimed by ${o.from}`);
    for (const c of held) out.push(`- ${link(c.path)} until ${time(c.until)}${c.purpose ? ` · ${c.purpose}` : ''}`);
    out.push('');
  }

  const dead = [...new Set(o.misses.filter((m) => m.agent === o.from && m.t >= since).map((m) => m.query))];
  if (dead.length) {
    out.push('## Dead ends (searched the vault, found nothing)');
    for (const q of dead.slice(0, 10)) out.push(`- "${q}"`);
    out.push('');
  }
  out.push(`Pick up from the most recent change above. Check with the user before undoing anything ${o.from} wrote.`);
  return out.join('\n');
}

// ------------------------------------------------------------------ trust

export interface Trust { score: number; band: 'ok' | 'caution' | 'low'; reasons: string[] }

export interface NoteFacts { mtime: number; size: number }

/**
 * 0-100: how far an agent can rely on a note. Starts at 100 and loses points for age,
 * for agents having to read it over and over (unclear or incomplete), for edits to it
 * that were undone, and for being nearly empty.
 */
export function trustScore(path: string, facts: NoteFacts | null, recent: AccessEntry[], changes: ChangeRecord[], now = Date.now()): Trust {
  const reasons: string[] = [];
  let score = 100;
  if (facts) {
    const days = (now - facts.mtime) / DAY;
    if (days > 365) { score -= 35; reasons.push(`last edited ${Math.round(days / 30)} months ago`); }
    else if (days > 180) { score -= 25; reasons.push(`last edited ${Math.round(days / 30)} months ago`); }
    else if (days > 90) { score -= 15; reasons.push(`last edited ${Math.round(days / 30)} months ago`); }
    else if (days > 30) { score -= 5; }
    if (facts.size < 200) { score -= 10; reasons.push('almost empty'); }
  }
  const perAgent = new Map<string, number>();
  for (const e of recent) if (e.action === 'read' && e.notes[0] === path) perAgent.set(e.agent, (perAgent.get(e.agent) ?? 0) + 1);
  let extra = 0;
  for (const n of perAgent.values()) extra += Math.max(0, n - 2);
  if (extra) { score -= Math.min(20, extra * 3); if (extra >= 3) reasons.push(`agents re-read it ${extra} extra times this week`); }
  const edits = changes.filter((c) => c.path === path && !c.restoreOf && c.agent !== 'you');
  const undone = new Set(changes.filter((c) => c.path === path && c.restoreOf).map((c) => c.restoreOf));
  const undoneEdits = edits.filter((c) => undone.has(c.id)).length;
  if (undoneEdits) {
    score -= Math.min(45, 15 * undoneEdits + Math.round(25 * (undoneEdits / Math.max(1, edits.length))));
    reasons.push(`${undoneEdits} of ${edits.length} agent edits to it were undone`);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, band: score >= 70 ? 'ok' : score >= 40 ? 'caution' : 'low', reasons };
}

// ------------------------------------------------------------------ gap radar

export interface Gap {
  kind: 'missing' | 'thin';
  key: string;
  title: string;
  /** Rough agent time lost: higher = more worth fixing. */
  score: number;
  agents: string[];
  detail: string;
  path?: string;
}

/**
 * The vault's holes, ranked by how much agent time they cost this week: searches
 * that kept coming back empty (missing notes), and notes agents kept going back to
 * that are too thin to answer the question.
 */
export function gapRadar(misses: { t: number; agent: string; query: string }[], recent: AccessEntry[], sizeOf: (path: string) => number | null, now = Date.now()): Gap[] {
  const out: Gap[] = [];
  const week = now - 7 * DAY;
  const q = new Map<string, { query: string; n: number; agents: Set<string> }>();
  for (const m of misses) {
    if (m.t < week) continue;
    const k = m.query.trim().toLowerCase().replace(/\s+/g, ' ');
    // Code-style search patterns (regex alternations, flags, escapes) aren't topics.
    if (!k || /\||\(\?|\\|^\^|\$$/.test(k)) continue;
    const c = q.get(k) ?? { query: m.query.trim(), n: 0, agents: new Set<string>() };
    c.n++;
    c.agents.add(m.agent);
    q.set(k, c);
  }
  for (const [k, c] of q) {
    out.push({
      kind: 'missing', key: `q:${k}`, title: c.query, score: c.n * 3 + c.agents.size * 2, agents: [...c.agents],
      detail: `searched ${c.n}× with no result`,
    });
  }
  const reads = new Map<string, { n: number; agents: Set<string> }>();
  for (const e of recent) {
    if (e.action !== 'read' || e.t < week) continue;
    const r = reads.get(e.notes[0]) ?? { n: 0, agents: new Set<string>() };
    r.n++;
    r.agents.add(e.agent);
    reads.set(e.notes[0], r);
  }
  for (const [p, r] of reads) {
    const size = sizeOf(p);
    if (size === null) continue;
    const thin = size < 600;
    if (r.n < (thin ? 3 : 6)) continue;
    out.push({
      kind: 'thin', key: `p:${p}`, title: noteTitle(p), path: p, agents: [...r.agents],
      score: thin ? r.n * 2 : r.n,
      detail: thin ? `opened ${r.n}× this week but only ${size} bytes long` : `opened ${r.n}× this week; agents keep coming back to it`,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Starter note for a gap: what agents looked for, so the next one can fill it in. */
export function gapStub(g: Gap, related: string[], now = Date.now()): string {
  const link = (p: string) => `[[${p.replace(/\.md$/i, '')}|${noteTitle(p)}]]`;
  return [
    '---',
    'status: stub',
    'created-by: H!V3MYND gap radar',
    `created: ${new Date(now).toISOString().slice(0, 10)}`,
    '---',
    '',
    `# ${g.title}`,
    '',
    `> [!todo] Starter note from the gap radar`,
    `> ${g.agents.join(', ')} ${g.kind === 'missing' ? `searched the vault for "${g.title}"` : 'kept going back to a thin note on this'} (${g.detail}). Fill this in so the next agent finds the answer first time.`,
    '',
    '## What agents needed',
    '- ',
    '',
    '## Answer',
    '',
    '',
    ...(related.length ? ['## Related notes', ...related.slice(0, 8).map((p) => `- ${link(p)}`), ''] : []),
  ].join('\n');
}

// ------------------------------------------------------------------ daily brief

export interface BriefInput {
  day: Date;
  entries: AccessEntry[];
  changes: ChangeRecord[];
  handoffs: Handoff[];
  collisions: { t: number; note: string; writer: string; other: string }[];
  gaps: Gap[];
  lowTrust: { path: string; trust: Trust }[];
  timelapse: string | null;
  timelapseNote: string;
}

/** The overnight brief: one readable note about a day of agent work. */
export function buildBrief(o: BriefInput): string {
  const start = new Date(o.day.getFullYear(), o.day.getMonth(), o.day.getDate()).getTime();
  const end = start + DAY;
  const day = o.entries.filter((e) => e.t >= start && e.t < end);
  const link = (p: string) => `[[${p.replace(/\.md$/i, '')}|${noteTitle(p)}]]`;
  const label = o.day.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const out: string[] = ['---', 'type: hivemynd-brief', `date: ${new Date(start).toISOString().slice(0, 10)}`, '---', '', `# Brain brief · ${label}`, ''];
  if (!day.length) {
    out.push('No agent touched the vault this day.');
    return out.join('\n');
  }
  const agents = [...new Set(day.map((e) => e.agent))];
  const reads = day.filter((e) => e.action === 'read').length;
  const writes = day.filter((e) => e.action === 'write');
  const searches = day.filter((e) => e.action === 'search').length;
  const tokens = day.reduce((n, e) => n + (e.tokens ?? 0), 0);

  // Busiest areas: top-level folder (or the note itself at the root).
  const area = (p: string) => (p.includes('/') ? p.split('/').slice(0, p.split('/').length > 2 ? 2 : 1).join('/') : '(vault root)');
  const areas = new Map<string, { n: number; agents: Map<string, number> }>();
  const notes = new Map<string, number>();
  // Reads and writes only: a search lists many notes it never opened.
  for (const e of day) for (const p of e.action === 'search' ? [] : e.notes) {
    notes.set(p, (notes.get(p) ?? 0) + 1);
    const a = areas.get(area(p)) ?? { n: 0, agents: new Map<string, number>() };
    a.n++;
    a.agents.set(e.agent, (a.agents.get(e.agent) ?? 0) + 1);
    areas.set(area(p), a);
  }
  const topAreas = [...areas].sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  const lead = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const changes = o.changes.filter((c) => c.t >= start && c.t < end);
  const undos = changes.filter((c) => c.restoreOf).length;
  const created = new Set(changes.filter((c) => c.before === null && !c.restoreOf).map((c) => c.path)).size;
  const edited = new Set(writes.map((e) => e.notes[0])).size;

  out.push('## In short');
  const busiest = topAreas[0];
  out.push(`${agents.length} agent${agents.length === 1 ? '' : 's'} (${agents.join(', ')}) made ${reads} reads, ${writes.length} writes and ${searches} searches${tokens ? `, pulling about ${Math.round(tokens / 1000)}k tokens of notes into context` : ''}. ` +
    `The busiest area was **${busiest[0]}** (${busiest[1].n} touches, mostly ${lead(busiest[1].agents)}). ` +
    `${edited} note${edited === 1 ? '' : 's'} changed${created ? `, ${created} new` : ''}${undos ? `, and you undid ${undos} change${undos === 1 ? '' : 's'}` : ''}.`);
  out.push('');
  if (o.timelapse) { out.push(`![[${o.timelapse}]]`, ''); }
  else if (o.timelapseNote) { out.push(`_${o.timelapseNote}_`, ''); }

  out.push('## Busiest areas');
  for (const [name, a] of topAreas) out.push(`- **${name}** · ${a.n} touches · ${[...a.agents].sort((x, y) => y[1] - x[1]).map(([g, n]) => `${g} ${n}`).join(', ')}`);
  out.push('');
  out.push('## Most used notes');
  for (const [p, n] of [...notes].sort((a, b) => b[1] - a[1]).slice(0, 10)) out.push(`- ${link(p)} · ${n}×`);
  out.push('');

  out.push('## By agent');
  for (const g of agents) {
    const mine = day.filter((e) => e.agent === g);
    const tasks = [...new Set(mine.map((e) => e.purpose).filter(Boolean))];
    const wrote = [...new Set(mine.filter((e) => e.action === 'write').map((e) => e.notes[0]))];
    out.push(`### ${g}`);
    out.push(`${mine.length} access${mine.length === 1 ? '' : 'es'} between ${clockOf(mine[0].t)} and ${clockOf(mine[mine.length - 1].t)}.`);
    if (tasks.length) out.push(`Tasks: ${tasks.slice(0, 6).map((t) => `“${t}”`).join(', ')}`);
    if (wrote.length) out.push(`Changed: ${wrote.slice(0, 12).map(link).join(', ')}${wrote.length > 12 ? ` and ${wrote.length - 12} more` : ''}`);
    out.push('');
  }

  const hand = o.handoffs.filter((h) => h.t >= start && h.t < end);
  const coll = o.collisions.filter((c) => c.t >= start && c.t < end);
  if (hand.length || coll.length) {
    out.push('## Teamwork');
    for (const h of hand) out.push(`- ${clockOf(h.t)} · ${h.to} picked up ${h.from}'s work at ${link(h.note)}${h.task ? ` (“${h.task}”)` : ''}`);
    for (const c of coll) out.push(`- ${clockOf(c.t)} · ⚠ ${c.writer} and ${c.other} both worked on ${link(c.note)}`);
    out.push('');
  }
  if (o.gaps.length) {
    out.push('## Gaps worth filling');
    for (const g of o.gaps.slice(0, 5)) out.push(`- ${g.path ? link(g.path) : `“${g.title}”`} · ${g.detail}`);
    out.push('');
  }
  if (o.lowTrust.length) {
    out.push('## Notes to double-check');
    for (const t of o.lowTrust.slice(0, 5)) out.push(`- ${link(t.path)} · trust ${t.trust.score}/100 · ${t.trust.reasons.join('; ')}`);
    out.push('');
  }
  return out.join('\n');
}

function clockOf(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function agoText(ms: number) {
  const m = Math.round(ms / MIN);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}
