import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/** Runs `handler` on an ephemeral 127.0.0.1 port for the duration of `fn`. */
export async function withServer<T>(handler: Handler, fn: (port: number) => Promise<T>): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn((server.address() as AddressInfo).port);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

export interface Reply { status: number; body: string; headers: http.IncomingHttpHeaders }

/** A raw request, so tests can send things fetch() would refuse (bad targets, odd headers). */
export function request(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
