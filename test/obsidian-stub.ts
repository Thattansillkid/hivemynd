// The parts of the obsidian runtime that Obsidian-free modules touch at import time.
export function normalizePath(p: string) {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || '/';
}
