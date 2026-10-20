// Turns free text from agent tool calls (JSON args, tool output, shell output)
// into vault note indices. Finds every ".md", then walks back to the longest
// known note name ending there, using the folder in front to break ties.

const BOUNDARY = new Set([' ', '"', "'", '(', '[', '<', '>', ':', '\t', '`', '*', '=', ',', '|', '{', '/']);

export class PathResolver {
  private byName = new Map<string, number[]>();
  private dirs: string[] = [];
  private base: string;

  constructor(paths: string[], vaultBase: string) {
    this.base = vaultBase.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    paths.forEach((p, i) => {
      const low = p.toLowerCase();
      const slash = low.lastIndexOf('/');
      this.dirs[i] = slash >= 0 ? low.slice(0, slash + 1) : '';
      const name = low.slice(slash + 1);
      const list = this.byName.get(name);
      if (list) list.push(i);
      else this.byName.set(name, [i]);
    });
    for (const list of this.byName.values()) list.sort((a, b) => this.dirs[b].length - this.dirs[a].length);
  }

  resolve(texts: string[], cap = 200): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const raw of texts) {
      if (typeof raw !== 'string') continue;
      const low = raw.replace(/\\+/g, '/').toLowerCase();
      let i = low.indexOf('.md');
      while (i >= 0 && out.length < cap) {
        const end = i + 3;
        const next = low.charCodeAt(end);
        const wordChar = (next >= 97 && next <= 122) || (next >= 48 && next <= 57);
        if (!wordChar) {
          const idx = this.match(low, end);
          if (idx >= 0 && !seen.has(idx)) { seen.add(idx); out.push(idx); }
        }
        i = low.indexOf('.md', end);
      }
    }
    return out;
  }

  private match(low: string, end: number): number {
    const lineStart = low.lastIndexOf('\n', end - 1) + 1;
    const pre = low.slice(Math.max(end - 320, lineStart), end);
    const slash = pre.lastIndexOf('/');
    const seg = pre.slice(slash + 1);
    const dir = pre.slice(0, slash + 1);

    // An absolute path that points outside this vault (another repo's README.md) is not ours.
    const abs = /[a-z]:\/[^"'\n]*$/.exec(dir);
    if (abs && !abs[0].startsWith(this.base + '/')) return -1;

    for (let k = 0; k < seg.length; k++) {
      if (k > 0 && !BOUNDARY.has(seg[k - 1])) continue;
      const ids = this.byName.get(seg.slice(k));
      if (!ids) continue;
      if (ids.length === 1) return ids[0];
      for (const id of ids) if (dir.endsWith(this.dirs[id])) return id;
      return ids[0];
    }
    return -1;
  }
}
