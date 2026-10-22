import type { ChangeRecord } from './changes';

// Pure helpers for the 1.1.0 extras: secret scanning (F4), authorship badges (F12)
// and the agent task board (F5). main.ts does the wiring.

// ------------------------------------------------------------------ secrets (F4)

export interface SecretHit { kind: string; start: number; end: number }

const PATTERNS: [string, RegExp, boolean][] = [
  // [what it is, pattern, mask only capture group 1]
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, false],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, false],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g, false],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g, false],
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g, false],
  ['Stripe key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g, false],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, false],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/g, false],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, false],
  ['secret value', /\b(?:api[_-]?key|secret|token|passw(?:or)?d|bearer)\b["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+/=.]{20,})/gi, true],
];

/** Obvious placeholders and already-masked values are not secrets. */
function placeholder(s: string) {
  return /masked|redacted|example|your[_-]?|xxxx|\*\*\*\*|••••|<[^>]*>|\$\{/i.test(s) || /^(.)\1+$/.test(s);
}

/** Keys, tokens and private keys in a piece of text (non-overlapping, in order). */
export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const [kind, re, group] of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const value = group ? m[1] : m[0];
      if (!value || placeholder(value)) continue;
      const start = group ? m.index + m[0].lastIndexOf(value) : m.index;
      hits.push({ kind, start, end: start + value.length });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: SecretHit[] = [];
  for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
  return out;
}

/** Replace every secret with a short, clearly marked stub. */
export function maskSecrets(text: string, hits = findSecrets(text)) {
  let out = '';
  let at = 0;
  for (const h of hits) {
    const value = text.slice(h.start, h.end);
    out += text.slice(at, h.start) + (h.kind === 'private key' ? '[private key masked by H!V3MYND]' : `${value.slice(0, 4)}…[masked by H!V3MYND]`);
    at = h.end;
  }
  return out + text.slice(at);
}

/** Secrets in `after` that weren't already in `before` (so old notes aren't re-flagged). */
export function newSecrets(before: string | null, after: string): SecretHit[] {
  const old = new Set(findSecrets(before ?? '').map((h) => (before ?? '').slice(h.start, h.end)));
  return findSecrets(after).filter((h) => !old.has(after.slice(h.start, h.end)));
}

// ------------------------------------------------------------------ authorship (F12)

export interface Authorship { total: number; agent: number; human: number; byAgent: Record<string, number> }

/**
 * How much of a note's current text was written by agents. Each line is credited to
 * whoever last introduced it in the change history (agents vs "you"); lines with no
 * recorded origin are the human's.
 */
export function authorship(current: string, changes: ChangeRecord[]): Authorship {
  const owner = new Map<string, string>();
  for (const c of [...changes].sort((a, b) => a.t - b.t)) {
    if (c.after === null) continue;
    const before = new Set((c.before ?? '').split('\n').map((l) => l.trim()));
    for (const raw of c.after.split('\n')) {
      const l = raw.trim();
      if (l && !before.has(l)) owner.set(l, c.agent);
    }
  }
  const out: Authorship = { total: 0, agent: 0, human: 0, byAgent: {} };
  for (const raw of current.split('\n')) {
    const l = raw.trim();
    if (!l || l === '---') continue;
    out.total++;
    const who = owner.get(l);
    if (who && who !== 'you' && who !== 'H!V3MYND') { out.agent++; out.byAgent[who] = (out.byAgent[who] ?? 0) + 1; }
    else out.human++;
  }
  return out;
}

// ------------------------------------------------------------------ agent tasks (F5)

export type TaskStatus = 'proposed' | 'open' | 'claimed' | 'done';

export interface AgentTask {
  id: string;
  title: string;
  detail: string;
  /** The note to work in (a gap's starter note or thin note). */
  path?: string;
  status: TaskStatus;
  /** Who created it: "you" (approved already) or an agent (needs your approval). */
  by: string;
  created: number;
  agent?: string;
  claimed?: number;
  done?: number;
  result?: string;
}

export class TaskBoard {
  private tasks: AgentTask[] = [];
  private listeners = new Set<() => void>();

  constructor(private persist: (list: AgentTask[]) => void) {}

  load(list: AgentTask[]) { this.tasks = Array.isArray(list) ? list.filter((t) => t && t.id) : []; }
  list() { return [...this.tasks].sort((a, b) => order(a.status) - order(b.status) || b.created - a.created); }
  get(id: string) { return this.tasks.find((t) => t.id === id) ?? null; }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.persist(this.tasks);
    for (const fn of this.listeners) fn();
  }

  add(t: Omit<AgentTask, 'id' | 'created' | 'status'> & { status?: TaskStatus }) {
    const task: AgentTask = { ...t, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, created: Date.now(), status: t.status ?? 'open' };
    this.tasks.push(task);
    this.changed();
    return task;
  }

  update(id: string, patch: Partial<AgentTask>) {
    const t = this.get(id);
    if (!t) return null;
    Object.assign(t, patch);
    this.changed();
    return t;
  }

  remove(id: string) {
    const n = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length !== n) this.changed();
  }
}

function order(s: TaskStatus) { return s === 'proposed' ? 0 : s === 'open' ? 1 : s === 'claimed' ? 2 : 3; }
