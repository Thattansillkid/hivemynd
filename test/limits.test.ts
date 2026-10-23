import { describe, expect, it } from 'vitest';
import { BRIDGE_LIMITS, BridgeStore, cleanMessage } from '../src/bridgestore';
import { LIMITS, readJsonBody, sendError, sendStatus } from '../src/server/http';
import { Concurrency, RateLimiter } from '../src/server/limits';
import { request, withServer } from './helpers';
import { MemAdapter } from './memadapter';

const ANTHROPIC = 'sk-ant-api03-' + 'Q'.repeat(10) + 'abcdefghij0123456789';

describe('RateLimiter', () => {
  it('allows a burst, then refuses, then refills over time', () => {
    let now = 0;
    const r = new RateLimiter(3, 2, () => now);
    expect([r.take('a'), r.take('a'), r.take('a'), r.take('a')]).toEqual([true, true, true, false]);
    expect(r.take('b')).toBe(true); // budgets are per key
    now += 500; // half a second at 2/s = one request
    expect([r.take('a'), r.take('a')]).toEqual([true, false]);
  });

  it('keeps a sustained flood at the refill rate', () => {
    let now = 0, ok = 0;
    const r = new RateLimiter(10, 50, () => now);
    for (let i = 0; i < 10_000; i++) { now += 1; if (r.take('flood')) ok++; } // 1000 req/s for 10 s
    expect(ok).toBeLessThanOrEqual(10 + 50 * 10 + 1);
  });
});

describe('Concurrency', () => {
  it('refuses past the limit and frees slots exactly once', () => {
    const c = new Concurrency(2);
    const a = c.enter()!, b = c.enter()!;
    expect(c.enter()).toBeNull();
    a(); a(); // double release must not open two slots
    expect(c.count).toBe(1);
    expect(c.enter()).not.toBeNull();
    expect(c.enter()).toBeNull();
    b();
  });
});

// Audit 6: oversized requests are refused.
describe('small-body routes', () => {
  it('refuse a 21 KB /policy-block style body with 413', async () => {
    await withServer((req, res) => {
      readJsonBody(req, LIMITS.small).then(() => sendStatus(res, 204), (err) => sendError(res, err));
    }, async (port) => {
      const big = JSON.stringify({ agent: 'x', detail: 'y'.repeat(21_000) });
      expect((await request(port, { method: 'POST', path: '/policy-block', body: big })).status).toBe(413);
      expect((await request(port, { method: 'POST', path: '/policy-block', body: '{"agent":"x"}' })).status).toBe(204);
    });
  });
});

describe('cleanMessage', () => {
  it('bounds every field and masks secrets', () => {
    const m = cleanMessage({ id: 'a', sender: 's'.repeat(500), body: `${ANTHROPIC} ${'b'.repeat(50_000)}`, reply_to: { evil: true }, ts: 1_790_000_000 })!;
    expect(m.sender).toHaveLength(60);
    expect(m.body.length).toBeLessThanOrEqual(BRIDGE_LIMITS.body);
    expect(m.body).not.toContain(ANTHROPIC);
    expect(m.reply_to).toBeNull();
    expect(m.t).toBe(1_790_000_000_000);
  });
  it('rejects things that are not messages', () => {
    for (const raw of [null, 1, 'x', {}, { id: '' }, { id: 5 }, { id: 'x'.repeat(200) }]) expect(cleanMessage(raw)).toBeNull();
  });
  it('does not let a far-future clock pin a message', () => {
    const now = Date.UTC(2026, 9, 22);
    expect(cleanMessage({ id: 'a', ts: 9e12 }, now)!.t).toBe(now + 60_000);
  });
});

const msg = (id: string, t: number, body = 'hi') => cleanMessage({ id, sender: 'claude', recipient: 'grok', body, ts: t / 1000 })!;
const DAY = Date.UTC(2026, 9, 22, 12);

describe('BridgeStore', () => {
  // Audit 9: success only after the message is on disk.
  it('rejects when the write fails, and keeps memory and disk in agreement', async () => {
    const disk = new MemAdapter();
    const store = new BridgeStore(disk.asAdapter(), 'p/bridge');
    disk.failWrites = true;
    await expect(store.add(msg('a', DAY))).rejects.toThrow(/ENOSPC/);
    expect(store.messages).toHaveLength(0);
    expect(store.has('a')).toBe(false);
    disk.failWrites = false;
    expect(await store.add(msg('a', DAY))).toBe('added'); // the retry goes through…
    expect(await store.add(msg('a', DAY))).toBe('duplicate'); // …exactly once
    expect(disk.dump().match(/"id":"a"/g)).toHaveLength(1);
  });

  it('keeps time order with out-of-order arrivals', async () => {
    const store = new BridgeStore(new MemAdapter().asAdapter(), 'p/bridge');
    for (const [id, t] of [['c', 3], ['a', 1], ['d', 4], ['b', 2]] as const) await store.add(msg(id, DAY + t));
    expect(store.messages.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  // Audit 6: memory stays within its bound under sustained traffic.
  it('holds at most the memory limit', async () => {
    const store = new BridgeStore(new MemAdapter().asAdapter(), 'p/bridge');
    for (let i = 0; i < BRIDGE_LIMITS.memory + 500; i++) await store.add(msg(`m${i}`, DAY + i));
    expect(store.messages).toHaveLength(BRIDGE_LIMITS.memory);
    expect(store.messages[0].id).toBe('m500');
    expect(store.has('m0')).toBe(false);
  });

  it('writes no text in metadata-only mode', async () => {
    const disk = new MemAdapter();
    const store = new BridgeStore(disk.asAdapter(), 'p/bridge');
    store.metadataOnly = true;
    await store.add(msg('a', DAY, 'private plan'));
    expect(disk.dump()).not.toContain('private plan');
    expect(store.messages[0].body).toBe('private plan'); // still visible this session
  });

  it('moves the 1.1 single file into day files and loads a bounded tail', async () => {
    const disk = new MemAdapter();
    const legacy = [msg('old1', DAY - 86_400_000), msg('old2', DAY)].map((m) => JSON.stringify(m)).join('\n') + '\n{torn';
    disk.files.set('p/bridge-messages.jsonl', legacy);
    const store = new BridgeStore(disk.asAdapter(), 'p/bridge', 'p/bridge-messages.jsonl');
    await store.load();
    expect(disk.files.has('p/bridge-messages.jsonl')).toBe(false);
    expect([...disk.files.keys()].sort()).toEqual(['p/bridge/2026-10-21.jsonl', 'p/bridge/2026-10-22.jsonl']);
    expect(store.messages.map((m) => m.id)).toEqual(['old1', 'old2']);
    expect(store.messages[0].t).toBe(DAY - 86_400_000); // stored times survive the move
  });

  it('prunes old days and purges everything', async () => {
    const disk = new MemAdapter();
    const store = new BridgeStore(disk.asAdapter(), 'p/bridge');
    await store.add(msg('old', Date.UTC(2026, 6, 1)));
    await store.add(msg('new', DAY));
    expect(await store.prune(30, DAY)).toBe(1);
    expect([...disk.files.keys()]).toEqual(['p/bridge/2026-10-22.jsonl']);
    await store.purge();
    expect(disk.files.size).toBe(0);
    expect(store.messages).toHaveLength(0);
  });
});
