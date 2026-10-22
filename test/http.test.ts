import { describe, expect, it } from 'vitest';
import { HttpError, parseTarget, readBody, readJsonBody, sendError, sendJson } from '../src/server/http';
import { request, withServer } from './helpers';

describe('readBody', () => {
  const echo = (limit: number) => withServer.bind(null, (req, res) => {
    readBody(req, limit).then((b) => sendJson(res, { len: b.length }), (err) => sendError(res, err));
  });

  it('returns a body under the limit', async () => {
    await echo(100)(async (port) => {
      const r = await request(port, { method: 'POST', path: '/', body: 'x'.repeat(100) });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).len).toBe(100);
    });
  });

  it('refuses a body over the limit with 413', async () => {
    await echo(100)(async (port) => {
      const r = await request(port, { method: 'POST', path: '/', body: 'x'.repeat(101) });
      expect(r.status).toBe(413);
    });
  });

  it('refuses early on an oversized Content-Length', async () => {
    await echo(100)(async (port) => {
      const r = await request(port, { method: 'POST', path: '/', headers: { 'Content-Length': '5000' }, body: 'x'.repeat(5000) });
      expect(r.status).toBe(413);
    });
  });

  it('counts bytes, not characters', async () => {
    await echo(10)(async (port) => {
      const r = await request(port, { method: 'POST', path: '/', body: 'é'.repeat(6) }); // 12 bytes
      expect(r.status).toBe(413);
    });
  });
});

describe('readJsonBody', () => {
  const run = withServer.bind(null, (req, res) => {
    readJsonBody(req, 1000).then((b) => sendJson(res, b), (err) => sendError(res, err));
  });

  it('parses JSON and treats empty as {}', async () => {
    await run(async (port) => {
      expect(JSON.parse((await request(port, { method: 'POST', path: '/', body: '{"a":1}' })).body)).toEqual({ a: 1 });
      expect(JSON.parse((await request(port, { method: 'POST', path: '/', body: '' })).body)).toEqual({});
    });
  });

  it('answers bad JSON with 400', async () => {
    await run(async (port) => {
      expect((await request(port, { method: 'POST', path: '/', body: '{nope' })).status).toBe(400);
    });
  });
});

describe('parseTarget', () => {
  it('parses normal targets', () => {
    expect(parseTarget('/pulse?x=1')?.pathname).toBe('/pulse');
  });
  it('returns null instead of throwing on unusable targets', () => {
    for (const t of [undefined, '', 'pulse', '//evil.example/x', 'http://x/', '/%']) {
      expect(() => parseTarget(t)).not.toThrow();
    }
    expect(parseTarget('//evil.example/x')).toBeNull();
    expect(parseTarget('http://x/')).toBeNull();
  });
});

describe('sendError', () => {
  it('keeps HttpError status and hides other errors as 500', async () => {
    await withServer((req, res) => sendError(res, req.url === '/a' ? new HttpError(429, 'slow down') : new Error('secret detail')), async (port) => {
      const a = await request(port, { path: '/a' });
      expect(a.status).toBe(429);
      expect(a.body).toBe('slow down');
      const b = await request(port, { path: '/b' });
      expect(b.status).toBe(500);
      expect(b.body).not.toContain('secret');
    });
  });
});
