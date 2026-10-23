// What an agent key may see of team data (claims, handoffs, tasks, gaps, trust). A
// note in a folder hidden from that agent is left out everywhere, so its name and
// existence don't reach the agent through the teamwork routes either.

export type Hidden = (path: string | undefined | null) => boolean;

/** Hides nothing (bridge and admin keys, and agents without hidden folders). */
export const SHOW_ALL: Hidden = () => false;

export function visibleClaims<T extends { path: string }>(list: T[], hidden: Hidden) {
  return list.filter((c) => !hidden(c.path));
}

export function visibleHandoffs<T extends { note: string; trail: string[] }>(list: T[], hidden: Hidden) {
  return list.filter((h) => !hidden(h.note)).map((h) => ({ ...h, trail: h.trail.filter((p) => !hidden(p)) }));
}

export function visibleTasks<T extends { path?: string }>(list: T[], hidden: Hidden) {
  return list.filter((t) => !hidden(t.path));
}

/** Log entries with hidden notes removed; an entry left with no notes is dropped. */
export function visibleEntries<T extends { notes: string[] }>(list: T[], hidden: Hidden) {
  const out: T[] = [];
  for (const e of list) {
    const notes = e.notes.filter((p) => !hidden(p));
    if (notes.length) out.push(notes.length === e.notes.length ? e : { ...e, notes });
  }
  return out;
}

export function visiblePaths<T extends { path?: string }>(list: T[], hidden: Hidden) {
  return list.filter((x) => !hidden(x.path));
}
