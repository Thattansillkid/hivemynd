import { describe, expect, it } from 'vitest';
import { Credential, authenticate, constantTimeEqual, denyListFor, gate, isDenied, matchRoute, newCredential, resolveAgent } from '../src/server/auth';
import { HttpError } from '../src/server/http';

const cred = (scope: Credential['scope'], agent: string, key: string): Credential => ({ id: key, label: key, agent, scope, key, created: 0 });
const observer = cred('observer', 'telemetry', 'k-observer');
const claude = cred('agent', 'claude', 'k-claude');
const grok = cred('agent', 'grok', 'k-grok');
const bridge = cred('bridge', 'bridge', 'k-bridge');
const admin = cred('admin', '', 'k-admin');
const creds = [observer, claude, grok, bridge, admin];

const req = (method: string, url: string, key?: string, extra: Record<string, string> = {}) =>
  ({ method, url, headers: { ...(key ? { 'x-hivemynd-key': key } : {}), ...extra } });
const run = (method: string, url: string, key?: string, developerMode = false, extra?: Record<string, string>) =>
  gate(req(method, url, key, extra), { credentials: creds, developerMode });

describe('authenticate', () => {
  it('finds the credential a key belongs to', () => {
    expect(authenticate('k-grok', creds)).toBe(grok);
    expect(authenticate('k-gro', creds)).toBeNull();
    expect(authenticate('', creds)).toBeNull();
  });
  it('never matches an empty key', () => {
    expect(constantTimeEqual('', '')).toBe(false);
    expect(authenticate('', [cred('agent', 'x', '')])).toBeNull();
  });
  it('makes keys that are unique and long', () => {
    const a = newCredential('a', 'Claude!', 'agent'), b = newCredential('b', 'claude', 'agent');
    expect(a.key).toHaveLength(48);
    expect(a.key).not.toBe(b.key);
    expect(a.agent).toBe('claude');
  });
});

describe('gate', () => {
  it('rejects requests from a browser (Origin header)', () => {
    expect(run('POST', '/pulse', 'k-admin', true, { origin: 'https://evil.example' })).toMatchObject({ ok: false, status: 403 });
  });

  it('answers a keyless /health with liveness only, and 401 otherwise', () => {
    expect(run('GET', '/health')).toEqual({ ok: false, status: 200, body: { ok: true } });
    expect(run('POST', '/pulse')).toMatchObject({ ok: false, status: 401 });
    expect(run('POST', '/pulse', 'wrong')).toMatchObject({ ok: false, status: 401 });
  });

  // Audit 10: query-string credentials.
  it('ignores a key in the query string', () => {
    expect(run('GET', '/context-pack?key=k-admin&q=x')).toMatchObject({ ok: false, status: 401 });
  });

  // Audit 10: URL parsing before authentication.
  it('turns malformed request targets into 400 instead of throwing', () => {
    for (const url of ['', 'pulse', '//evil/x', 'http://x/pulse', '/%']) {
      expect(() => run('POST', url, 'k-admin')).not.toThrow();
    }
    expect(run('POST', '//evil/x', 'k-admin')).toMatchObject({ ok: false, status: 400 });
  });

  it('answers unknown routes with 404', () => {
    expect(run('GET', '/nope', 'k-admin', true)).toMatchObject({ ok: false, status: 404 });
    expect(run('DELETE', '/pulse', 'k-admin', true)).toMatchObject({ ok: false, status: 404 });
  });

  // Audit 2: an observer credential can report but do nothing else.
  it('limits an observer key to reporting activity', () => {
    expect(run('POST', '/pulse', 'k-observer')).toMatchObject({ ok: true });
    expect(run('POST', '/hook/telemetry', 'k-observer')).toMatchObject({ ok: true });
    expect(run('GET', '/health', 'k-observer')).toMatchObject({ ok: true });
    for (const [m, u] of [
      ['GET', '/context-pack?q=x'], ['GET', '/tasks'], ['POST', '/tasks'], ['POST', '/tasks/claim'], ['POST', '/tasks/done'],
      ['POST', '/claim'], ['POST', '/release'], ['GET', '/handoff?from=claude'], ['GET', '/authorship?path=a.md'],
      ['POST', '/prewrite/telemetry'], ['POST', '/brief/now'], ['POST', '/approve'], ['POST', '/bridge-message'], ['POST', '/policy-block'],
    ]) expect(run(m, u, 'k-observer'), `${m} ${u}`).toMatchObject({ ok: false, status: 403 });
  });

  it('keeps bridge-only routes from agent keys', () => {
    for (const u of ['/approve', '/policy-block', '/bridge-message']) {
      expect(run('POST', u, 'k-claude')).toMatchObject({ ok: false, status: 403 });
      expect(run('POST', u, 'k-bridge')).toMatchObject({ ok: true });
    }
  });

  it('serves developer routes only to admin keys, and only in Developer mode', () => {
    expect(run('POST', '/reload', 'k-admin', false)).toMatchObject({ ok: false, status: 404 });
    expect(run('POST', '/reload', 'k-bridge', true)).toMatchObject({ ok: false, status: 403 });
    expect(run('POST', '/reload', 'k-admin', true)).toMatchObject({ ok: true });
    expect(run('GET', '/snapshot', 'k-claude', true)).toMatchObject({ ok: false, status: 403 });
  });

  // Audit 1: an agent key can't act as another agent through the path.
  it('refuses an agent key that names another agent in the path', () => {
    expect(run('POST', '/hook/claude', 'k-claude')).toMatchObject({ ok: true });
    expect(run('POST', '/hook/CLAUDE', 'k-claude')).toMatchObject({ ok: true });
    for (const u of ['/hook/grok', '/prompt/grok', '/prewrite/grok', '/hook/other', '/hook/unrestricted']) {
      expect(run('POST', u, 'k-claude'), u).toMatchObject({ ok: false, status: 403 });
    }
    expect(run('POST', '/hook/grok', 'k-bridge')).toMatchObject({ ok: true });
  });
});

// Audit 1: identity comes from the credential, not the request.
describe('resolveAgent', () => {
  it('gives an agent key its own identity whatever is asked', () => {
    expect(resolveAgent(claude, undefined)).toBe('claude');
    expect(resolveAgent(claude, '')).toBe('claude');
    expect(resolveAgent(claude, 'Claude')).toBe('claude');
    for (const other of ['grok', 'other', 'admin', 'unknown-agent']) {
      expect(() => resolveAgent(claude, other)).toThrow(HttpError);
    }
  });
  it('applies aliases before comparing', () => {
    const alias = (n: string) => (n.toLowerCase() === 'bot2' ? 'claude' : n.toLowerCase());
    expect(resolveAgent(claude, 'bot2', alias)).toBe('claude');
  });
  it('lets the bridge name the agent', () => {
    expect(resolveAgent(bridge, 'grok')).toBe('grok');
    expect(resolveAgent(bridge, undefined)).toBe('bridge');
    expect(resolveAgent({ ...admin }, undefined)).toBe('other');
  });
});

describe('read policy', () => {
  const policies = { claude: { deny: 'Finance/, Personal' }, grok: { deny: 'Health' }, codex: { deny: '' } };

  it('applies an agent its own deny list', () => {
    expect(denyListFor(policies, 'claude')).toEqual(['finance', 'personal']);
    expect(denyListFor(policies, 'codex')).toEqual([]);
  });

  // Audit 1: an unknown identity gets the most restrictive rule, never an empty list.
  it('gives agents without a rule every denied folder', () => {
    expect(denyListFor(policies, 'unrestricted').sort()).toEqual(['finance', 'health', 'personal']);
  });

  it('matches folders and their contents, not lookalikes', () => {
    const deny = denyListFor(policies, 'claude');
    expect(isDenied('Finance/Budget.md', deny)).toBe(true);
    expect(isDenied('finance', deny)).toBe(true);
    expect(isDenied('Personal\\Diary.md', deny)).toBe(true);
    expect(isDenied('FinanceNotes.md', deny)).toBe(false);
  });

  it('end to end: a claude key asking for an unrestricted pack still gets the claude rule', () => {
    const g = run('GET', '/context-pack?q=x&agent=unrestricted', 'k-claude');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(() => g.who(g.url.searchParams.get('agent'))).toThrow(HttpError);
    expect(g.who(null)).toBe('claude');
    expect(isDenied('Finance/a.md', denyListFor(policies, g.who(null)))).toBe(true);
  });
});

describe('matchRoute', () => {
  it('extracts the path agent', () => {
    expect(matchRoute('POST', '/hook/Grok-2')).toMatchObject({ key: 'POST /hook/*', scope: 'observer', pathAgent: 'grok-2' });
    expect(matchRoute('POST', '/hook/a/b')).toBeNull();
    expect(matchRoute('POST', '/hook/' + 'x'.repeat(41))).toBeNull();
  });
});
