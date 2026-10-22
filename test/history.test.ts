import { describe, expect, it } from 'vitest';
import { ChangeRecord, ChangeStore, DAY_FILE, diffStats, forHistory } from '../src/changes';
import { keptPurpose, maskSecrets } from '../src/extras';
import { MemAdapter } from './memadapter';

// Synthetic values only: shaped like real keys so the scanner finds them.
const ANTHROPIC = 'sk-ant-api03-' + 'Q'.repeat(10) + 'abcdefghij0123456789';
const AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7\n-----END RSA PRIVATE KEY-----';
const SECRETS = [ANTHROPIC, AWS, 'MIIEpAIBAAKCAQEA7'];

const rec = (before: string | null, after: string | null, extra: Partial<ChangeRecord> = {}): ChangeRecord =>
  ({ id: Math.random().toString(36).slice(2), t: Date.UTC(2026, 9, 22, 12), agent: 'claude', path: 'Notes/a.md', purpose: '', source: 'test', before, after, ...extra });

const leaks = (text: string) => SECRETS.filter((s) => text.includes(s));

describe('forHistory', () => {
  it('raw keeps text exactly', () => {
    const r = forHistory(rec('a', `key ${ANTHROPIC}`), 'raw');
    expect(r.after).toContain(ANTHROPIC);
    expect(r.stored).toBe('raw');
  });

  it('redacted masks secrets in both before and after', () => {
    const r = forHistory(rec(`old ${AWS}`, `new ${ANTHROPIC}\n${PEM}`), 'redacted');
    expect(leaks(JSON.stringify(r))).toEqual([]);
    expect(r.after).toContain('[masked by H!V3MYND]');
    expect(r.stored).toBe('redacted');
  });

  it('metadata keeps no text but keeps line counts and created/deleted', () => {
    const r = forHistory(rec('one\ntwo', `one\nthree ${ANTHROPIC}\nfour`), 'metadata');
    expect(r.before).toBe('');
    expect(r.after).toBe('');
    expect(diffStats(r)).toEqual({ added: 2, removed: 1 });
    expect(forHistory(rec(null, 'x'), 'metadata').before).toBeNull();
    expect(forHistory(rec('x', null), 'metadata').after).toBeNull();
  });
});

// Audit 3: masking must not leave the secret in history.
describe('ChangeStore persistence', () => {
  it('redacted (default): no synthetic secret reaches any history file, including the masking step', async () => {
    const disk = new MemAdapter();
    const store = new ChangeStore(disk.asAdapter(), 'p/changes');
    expect(store.mode).toBe('redacted');
    const written = `notes\n${ANTHROPIC}\n${AWS}\n${PEM}`;
    // The agent's write, then what main.ts's maskNote would record if it recorded the mask.
    await store.add(rec('notes', written));
    await store.add(rec(written, maskSecrets(written), { agent: 'H!V3MYND', id: 'mask' }));
    expect(leaks(disk.dump())).toEqual([]);
    expect(leaks(JSON.stringify(store.records))).toEqual([]);
  });

  it('metadata: no note text on disk at all', async () => {
    const disk = new MemAdapter();
    const store = new ChangeStore(disk.asAdapter(), 'p/changes');
    store.mode = 'metadata';
    await store.add(rec('private words', `more private words ${ANTHROPIC}`));
    expect(disk.dump()).not.toContain('private');
    expect(leaks(disk.dump())).toEqual([]);
  });

  it('raw: keeps the secret (the documented trade-off)', async () => {
    const disk = new MemAdapter();
    const store = new ChangeStore(disk.asAdapter(), 'p/changes');
    store.mode = 'raw';
    await store.add(rec('a', ANTHROPIC));
    expect(disk.dump()).toContain(ANTHROPIC);
  });

  it('reports a failed write instead of pretending it was saved', async () => {
    const disk = new MemAdapter();
    const store = new ChangeStore(disk.asAdapter(), 'p/changes');
    disk.failWrites = true;
    expect(await store.add(rec('a', 'b'))).toBe(false);
    disk.failWrites = false;
    expect(await store.add(rec('a', 'b'))).toBe(true);
  });

  it('prunes day files past retention and purges everything', async () => {
    const disk = new MemAdapter();
    const store = new ChangeStore(disk.asAdapter(), 'p/changes');
    disk.files.set('p/changes/2026-08-01.jsonl', '{}\n');
    disk.files.set('p/changes/2026-10-20.jsonl', '{}\n');
    disk.files.set('p/changes/notes.txt', 'not history');
    expect(await store.prune(30, Date.UTC(2026, 9, 22))).toBe(1);
    expect([...disk.files.keys()].sort()).toEqual(['p/changes/2026-10-20.jsonl', 'p/changes/notes.txt']);
    expect(await store.prune(0)).toBe(0);
    await store.purge();
    expect([...disk.files.keys()]).toEqual(['p/changes/notes.txt']);
  });

  it('only ever reads files named like day files', () => {
    expect(DAY_FILE.test('p/changes/2026-10-22.jsonl')).toBe(true);
    for (const f of ['p/changes/../2026-10-22.jsonl.bak', 'p/changes/x.jsonl', 'p/changes/2026-10-22.jsonl/..', 'p/changes/a2026-10-22.jsonl']) {
      expect(DAY_FILE.test(f), f).toBe(false);
    }
  });
});

// Audit 4: one rule for every store that keeps a purpose.
describe('keptPurpose', () => {
  it('keeps nothing when prompt storage is off', () => {
    expect(keptPurpose('refactor the billing notes', false)).toBe('');
  });
  it('keeps one masked line when on', () => {
    expect(keptPurpose(`  use ${ANTHROPIC} to call the API  `, true)).not.toContain(ANTHROPIC);
    expect(keptPurpose('x'.repeat(500), true)).toHaveLength(200);
    expect(keptPurpose(42, true)).toBe('');
  });
});
