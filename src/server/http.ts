// Small, Obsidian-free helpers for the agent listener. Kept apart from main.ts so the
// request handling can be tested under plain Node.

import type { IncomingMessage, ServerResponse } from 'http';

/** An error that maps straight to an HTTP status. */
export class HttpError extends Error {
  constructor(readonly status: number, message = '') {
    super(message || String(status));
  }
}

/** Byte caps per kind of body. Anything bigger is refused with 413. */
export const LIMITS = {
  small: 20_000, // approvals, policy blocks, focus
  json: 200_000, // tasks, claims, briefs
  message: 256_000, // bridge messages
  event: 1_000_000, // pulses and raw hook payloads
} as const;

/**
 * Reads a request body up to `limit` bytes. Rejects with HttpError(413) as soon as the
 * limit is passed (the rest of the upload is discarded), and with 400 on a stream error.
 */
export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { req.resume(); reject(new HttpError(413)); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer | string) => {
      if (done) return;
      const b = typeof c === 'string' ? Buffer.from(c) : c;
      size += b.length;
      if (size > limit) { done = true; chunks.length = 0; req.resume(); reject(new HttpError(413)); return; }
      chunks.push(b);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', () => { if (!done) { done = true; reject(new HttpError(400)); } });
  });
}

/** Reads and parses a JSON body; an empty body is `{}`. Bad JSON is HttpError(400). */
export async function readJsonBody(req: IncomingMessage, limit: number): Promise<any> {
  const text = await readBody(req, limit);
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'invalid JSON'); }
}

export function sendJson(res: ServerResponse, body: unknown, status = 200) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function sendStatus(res: ServerResponse, status: number, text = '') {
  if (res.headersSent) { if (!res.writableEnded) res.end(); return; }
  res.writeHead(status, text ? { 'Content-Type': 'text/plain; charset=utf-8' } : undefined);
  res.end(text);
}

/** Turns any thrown value into a response: HttpError keeps its status, the rest is 500. */
export function sendError(res: ServerResponse, err: unknown) {
  sendStatus(res, err instanceof HttpError ? err.status : 500, err instanceof HttpError ? err.message : '');
}

/** Parses a request target without throwing; null when it isn't a usable path. */
export function parseTarget(raw: string | undefined): URL | null {
  if (!raw || raw[0] !== '/' || raw.startsWith('//')) return null;
  try { return new URL(raw, 'http://local'); } catch { return null; }
}
