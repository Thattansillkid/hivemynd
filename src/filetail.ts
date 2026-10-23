import type { DataAdapter } from 'obsidian';

// Reading big plugin logs without loading them whole. A busy day's file can be tens of
// megabytes; reading it in one go on every load crashed Obsidian's window.

interface Fs {
  statSync(p: string): { size: number };
  openSync(p: string, flags: string): number;
  readSync(fd: number, buf: Uint8Array, off: number, len: number, pos: number | null): number;
  closeSync(fd: number): void;
}

function direct(adapter: DataAdapter): { fs: Fs; base: string } | null {
  const base = (adapter as { getBasePath?: () => string }).getBasePath?.();
  const req = typeof window === 'undefined' ? undefined : (window as unknown as { require?: (m: string) => unknown }).require;
  return base && req ? { fs: req('fs') as Fs, base } : null;
}

/** The last `bytes` of a file (starting at a line boundary). */
export async function readTail(adapter: DataAdapter, path: string, bytes: number): Promise<string> {
  const h = direct(adapter);
  if (!h) {
    const text = await adapter.read(path);
    if (text.length <= bytes) return text;
    const cut = text.slice(-bytes);
    return cut.slice(cut.indexOf('\n') + 1);
  }
  const full = `${h.base}/${path}`;
  const size = h.fs.statSync(full).size;
  if (size <= bytes) return adapter.read(path);
  const fd = h.fs.openSync(full, 'r');
  try {
    const buf = new Uint8Array(bytes);
    h.fs.readSync(fd, buf, 0, bytes, size - bytes);
    const text = new TextDecoder().decode(buf);
    return text.slice(text.indexOf('\n') + 1);
  } finally { h.fs.closeSync(fd); }
}

/** Calls `fn` for each line of a file without holding the whole file in memory. */
export async function eachLine(adapter: DataAdapter, path: string, fn: (line: string) => void) {
  const h = direct(adapter);
  if (!h) { for (const l of (await adapter.read(path)).split('\n')) if (l.trim()) fn(l); return; }
  const fd = h.fs.openSync(`${h.base}/${path}`, 'r');
  try {
    const chunk = new Uint8Array(1 << 20);
    const dec = new TextDecoder();
    let rest = '';
    for (;;) {
      const n = h.fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      const parts = (rest + dec.decode(chunk.subarray(0, n), { stream: true })).split('\n');
      rest = parts.pop() ?? '';
      for (const l of parts) if (l.trim()) fn(l);
      await new Promise((r) => window.setTimeout(r, 0)); // let the window breathe
    }
    if (rest.trim()) fn(rest);
  } finally { h.fs.closeSync(fd); }
}
