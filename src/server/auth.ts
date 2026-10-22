// Listener credentials and what each one may do.
//
// Every request carries a key (header X-Hivemynd-Key). Each key belongs to one
// credential with a scope and, for agent keys, the one agent it speaks for. The
// server takes the agent's identity from the credential, never from the request, so
// a key handed to one agent can't read as another.
//
//   observer  report activity only (pulses, hook payloads, prompts) — nothing readable
//   agent     + pre-write checks, context packs, tasks, claims, handoffs, trust, briefs
//   bridge    + may name the agent per request (the bridge authenticates its own
//             agents), approvals, policy blocks and bridge messages
//   admin     + developer tooling routes (also need Developer mode)
//
// The legacy shared key from 1.1.x, while still accepted, has bridge scope.

import { HttpError, parseTarget } from './http';

export type Scope = 'observer' | 'agent' | 'bridge' | 'admin';

export const SCOPES: Scope[] = ['observer', 'agent', 'bridge', 'admin'];
const RANK: Record<Scope, number> = { observer: 0, agent: 1, bridge: 2, admin: 3 };

export interface Credential {
  id: string;
  label: string;
  /** The agent this key speaks for (lowercase). Ignored for bridge and admin keys, which name it per request. */
  agent: string;
  scope: Scope;
  key: string;
  created: number;
  /** The 1.1.x shared key, accepted until the user retires it. */
  legacy?: boolean;
}

/** A credential as stored in data.json: the key itself lives in SecretStorage. */
export type CredentialMeta = Omit<Credential, 'key'>;

export function hasScope(c: Pick<Credential, 'scope'>, need: Scope) {
  return RANK[c.scope] >= RANK[need];
}

/** Whether this credential may say which agent a request is for. */
export function canAssertAgent(c: Pick<Credential, 'scope'>) {
  return hasScope(c, 'bridge');
}

/** Constant-time comparison: the time taken doesn't depend on where the strings differ. */
export function constantTimeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0 && a.length > 0;
}

/** The credential a key belongs to, or null. Every credential is compared, so timing reveals nothing. */
export function authenticate(given: string, creds: readonly Credential[]): Credential | null {
  let found: Credential | null = null;
  for (const c of creds) if (constantTimeEqual(c.key, given) && !found) found = c;
  return found;
}

export function newKey(bytes = 24) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function newCredential(label: string, agent: string, scope: Scope): Credential {
  return { id: newKey(6), label: label.trim().slice(0, 60) || agent || scope, agent: cleanAgent(agent), scope, key: newKey(), created: Date.now() };
}

/** Agent names are short lowercase tokens, as in /hook/<agent>. */
export function cleanAgent(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

// ------------------------------------------------------------------ routes

const DEV = ['/replay', '/focus', '/music', '/system-audio-probe', '/audio-probe', '/audio-levels', '/audio-devices', '/report', '/meaning', '/heat', '/open-monitor', '/reload', '/snapshot', '/span/on', '/span/off'];

/** Routes that only answer in Developer mode (and to admin keys). */
export const DEV_ROUTES = new Set(DEV);

const ROUTES: Record<string, Scope> = {
  'GET /health': 'observer',
  'POST /pulse': 'observer',
  'POST /hook/*': 'observer',
  'POST /prompt/*': 'observer',

  'POST /prewrite/*': 'agent',
  'GET /context-pack': 'agent',
  'GET /tasks': 'agent',
  'POST /tasks': 'agent',
  'POST /tasks/claim': 'agent',
  'POST /tasks/done': 'agent',
  'POST /tasks/withdraw': 'agent',
  'GET /authorship': 'agent',
  'GET /hud': 'agent',
  'GET /claims': 'agent',
  'GET /handoffs': 'agent',
  'GET /handoff': 'agent',
  'GET /check': 'agent',
  'GET /trust': 'agent',
  'GET /gaps': 'agent',
  'POST /claim': 'agent',
  'POST /release': 'agent',
  'POST /brief/now': 'agent',

  'POST /approve': 'bridge',
  'POST /policy-block': 'bridge',
  'POST /bridge-message': 'bridge',

  'POST /replay': 'admin',
  'POST /focus': 'admin',
  'POST /music': 'admin',
  'GET /system-audio-probe': 'admin',
  'GET /audio-probe': 'admin',
  'GET /audio-levels': 'admin',
  'GET /audio-devices': 'admin',
  'POST /report': 'admin',
  'POST /meaning': 'admin',
  'POST /heat': 'admin',
  'POST /open-monitor': 'admin',
  'POST /reload': 'admin',
  'GET /snapshot': 'admin',
  'POST /span/on': 'admin',
  'POST /span/off': 'admin',
};

const AGENT_SEGMENT = /^\/(hook|prompt|prewrite)\/([a-z0-9_-]{1,40})$/i;

export interface Route {
  /** The route key, e.g. "POST /hook/*". */
  key: string;
  scope: Scope;
  /** The agent named in the path (/hook/<agent>), lowercased. */
  pathAgent?: string;
}

/** The route a request maps to, or null for an unknown route (404). */
export function matchRoute(method: string, pathname: string): Route | null {
  const m = AGENT_SEGMENT.exec(pathname);
  const key = m ? `${method} /${m[1].toLowerCase()}/*` : `${method} ${pathname}`;
  const scope = ROUTES[key];
  if (!scope) return null;
  return m ? { key, scope, pathAgent: m[2].toLowerCase() } : { key, scope };
}

/**
 * The agent a request acts as. Bridge and admin keys may name it (falling back to
 * the credential's agent, then "other"). Every other key acts as its own agent, and
 * naming a different one is refused (403) rather than silently corrected, so a
 * misconfigured hook shows up.
 */
export function resolveAgent(c: Credential, requested: string | undefined | null, alias: (name: string) => string = (n) => n.toLowerCase()): string {
  const asked = requested ? alias(String(requested)) : '';
  if (canAssertAgent(c)) return asked || (c.agent ? alias(c.agent) : 'other');
  const own = alias(c.agent || 'other');
  if (asked && asked !== own) throw new HttpError(403, `this key belongs to agent "${own}"`);
  return own;
}

// ------------------------------------------------------------------ the gate

export interface GateContext {
  credentials: readonly Credential[];
  developerMode: boolean;
  alias?: (name: string) => string;
}

export type GateResult =
  | { ok: true; url: URL; cred: Credential; route: Route; who: (requested?: unknown) => string }
  | { ok: false; status: number; body?: unknown; text?: string };

/**
 * Everything a request must pass before any route runs: no browser origin, a usable
 * target, a known key in the X-Hivemynd-Key header (never the URL, which ends up in
 * logs), a known route, Developer mode for tooling routes, and a key whose scope
 * covers the route. An agent named in the path must be the key's own agent.
 */
export function gate(req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined> }, ctx: GateContext): GateResult {
  if (req.headers.origin) return { ok: false, status: 403 };
  const url = parseTarget(req.url);
  if (!url) return { ok: false, status: 400 };
  const header = req.headers['x-hivemynd-key'];
  const cred = authenticate(typeof header === 'string' ? header : '', ctx.credentials);
  if (!cred) {
    // Without a key only a bare liveness answer is given.
    if (req.method === 'GET' && url.pathname === '/health') return { ok: false, status: 200, body: { ok: true } };
    return { ok: false, status: 401 };
  }
  const route = matchRoute(String(req.method), url.pathname);
  if (!route || (!ctx.developerMode && DEV_ROUTES.has(url.pathname))) return { ok: false, status: 404 };
  if (!hasScope(cred, route.scope)) return { ok: false, status: 403, text: `this key can't use ${route.key}` };
  const who = (requested?: unknown) => resolveAgent(cred, typeof requested === 'string' ? requested : null, ctx.alias);
  if (route.pathAgent) {
    try { who(route.pathAgent); } catch (err) { return { ok: false, status: 403, text: err instanceof Error ? err.message : '' }; }
  }
  return { ok: true, url, cred, route, who };
}

// ------------------------------------------------------------------ read policy

export interface DenyPolicy { deny: string }

function denyList(p: DenyPolicy | undefined) {
  return (p?.deny ?? '').split(',').map((d) => d.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()).filter(Boolean);
}

/**
 * Folders an agent may not read. An agent with no rule of its own gets every folder
 * any agent is denied (the most restrictive rule there is), never an empty list.
 */
export function denyListFor(policies: Record<string, DenyPolicy>, agent: string): string[] {
  if (policies[agent]) return denyList(policies[agent]);
  return [...new Set(Object.values(policies).flatMap(denyList))];
}

export function isDenied(path: string, deny: readonly string[]) {
  const l = path.replace(/\\/g, '/').toLowerCase();
  return deny.some((d) => l === d || l.startsWith(d + '/'));
}
