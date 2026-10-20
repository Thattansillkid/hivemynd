import type { TouchMode } from './renderer';

// Read-only web viewer server. Off by default. Serves the brain (note paths, links,
// positions, live agent pulses) to a browser on this computer or, if allowed, the
// local network. It has its own key, separate from the agent listener key, and no
// route that writes anything or returns note contents.

declare const __VIEWER_JS__: string;

export interface ViewerSource {
  graph(): Promise<unknown>;
  keyOk(given: string): boolean;
}

const MAX_CLIENTS = 8;
const TICKET_MS = 30_000;

export class WebViewer {
  private server: any = null;
  private clients = new Set<any>();
  private tickets = new Map<string, number>();
  private ping: number | null = null;

  constructor(private src: ViewerSource) {}

  get running() { return !!this.server; }

  start(port: number, lan: boolean, onError: (msg: string) => void) {
    this.stop();
    const http = (window as any).require?.('http');
    if (!http) return;
    const server = http.createServer((req: any, res: any) => void this.handle(req, res));
    server.on('error', (err: any) => { onError(err?.code === 'EADDRINUSE' ? `port ${port} is in use` : String(err?.message ?? err)); this.server = null; });
    server.listen(port, lan ? '0.0.0.0' : '127.0.0.1');
    this.server = server;
    // Keeps idle connections (and proxies) from timing out.
    this.ping = window.setInterval(() => { for (const c of this.clients) c.write(': ping\n\n'); }, 25_000);
  }

  stop() {
    for (const c of this.clients) { try { c.end(); } catch { /* gone */ } }
    this.clients.clear();
    if (this.ping !== null) window.clearInterval(this.ping);
    this.ping = null;
    try { this.server?.close(); } catch { /* not listening */ }
    this.server = null;
  }

  /** Live pulse from an agent: forwarded to every open viewer. */
  touch(indices: number[], agent: string, kind: TouchMode) {
    if (!this.clients.size || !indices.length) return;
    const line = `data: ${JSON.stringify({ i: indices.slice(0, 80), a: agent, k: kind })}\n\n`;
    for (const c of this.clients) c.write(line);
  }

  private async handle(req: any, res: any) {
    const url = new URL(req.url ?? '/', 'http://viewer');
    const head = {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    };
    if (req.method === 'GET' && url.pathname === '/') {
      // The page itself holds nothing private; the key in ?key= is read by the script
      // and removed from the address bar.
      res.writeHead(200, { ...head, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" });
      res.end(PAGE);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      res.writeHead(200, { ...head, 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(__VIEWER_JS__);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/graph') {
      if (!this.src.keyOk(String(req.headers['x-hivemynd-view'] ?? ''))) { res.writeHead(401, head); res.end(); return; }
      res.writeHead(200, { ...head, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(await this.src.graph()));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/ticket') {
      if (!this.src.keyOk(String(req.headers['x-hivemynd-view'] ?? ''))) { res.writeHead(401, head); res.end(); return; }
      const now = Date.now();
      for (const [t, exp] of this.tickets) if (exp < now) this.tickets.delete(t);
      const b = new Uint8Array(18);
      crypto.getRandomValues(b);
      const t = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      this.tickets.set(t, now + TICKET_MS);
      res.writeHead(200, { ...head, 'Content-Type': 'text/plain' });
      res.end(t);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      const t = url.searchParams.get('ticket') ?? '';
      const exp = this.tickets.get(t);
      this.tickets.delete(t); // single use
      if (!exp || exp < Date.now()) { res.writeHead(401, head); res.end(); return; }
      if (this.clients.size >= MAX_CLIENTS) { res.writeHead(503, head); res.end(); return; }
      res.writeHead(200, { ...head, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    res.writeHead(404, head);
    res.end();
  }
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="referrer" content="no-referrer">
<title>H!V3MYND</title>
<style>
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
#host { position: fixed; inset: 0; }
#status { position: fixed; right: 12px; bottom: 10px; text-align: right; font: 12px system-ui, sans-serif; color: #8fb3b0; letter-spacing: .04em; pointer-events: none; z-index: 5; }
</style></head>
<body><div id="host"></div><div id="status">Loading…</div><script src="app.js"></script></body></html>`;
