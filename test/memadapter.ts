import type { DataAdapter } from 'obsidian';

/** An in-memory DataAdapter with just what the stores use. Set `failWrites` to simulate a full disk. */
export class MemAdapter {
  files = new Map<string, string>();
  failWrites = false;

  async exists(p: string) { return this.files.has(p) || [...this.files.keys()].some((k) => k.startsWith(p + '/')); }
  async read(p: string) { const v = this.files.get(p); if (v === undefined) throw new Error(`ENOENT ${p}`); return v; }
  async write(p: string, d: string) { this.check(); this.files.set(p, d); }
  async append(p: string, d: string) { this.check(); this.files.set(p, (this.files.get(p) ?? '') + d); }
  async remove(p: string) { this.files.delete(p); }
  async mkdir() { /* folders are implicit */ }
  async list(dir: string) {
    const files = [...this.files.keys()].filter((k) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'));
    return { files, folders: [] as string[] };
  }

  /** Everything on "disk", for leak checks. */
  dump() { return [...this.files.values()].join('\n'); }

  asAdapter() { return this as unknown as DataAdapter; }

  private check() { if (this.failWrites) throw new Error('ENOSPC: no space left on device'); }
}
