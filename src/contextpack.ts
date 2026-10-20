import { App, TFile } from 'obsidian';
import { AccessEntry, noteTitle } from './accesslog';
import { taskGroups, tokensForBytes } from './insights';

// Context pack: the notes most relevant to a task, trimmed to a token budget, so an
// agent can load what it needs in one call instead of searching and reading note by
// note. Relevance = words of the task in the title / aliases / tags / headings / path,
// then notes linked to those, then notes agents used together with them before.

export interface PackNote { path: string; title: string; why: string; tokens: number; truncated: boolean; text: string }
export interface Pack { query: string; budget: number; tokens: number; notes: PackNote[]; skipped: number }

const STOP = new Set('the and for with that this from into about what when where which how why are was were has have had not but you your our their its can will would should could all any some more most less one two use using make need want get set new old'.split(' '));

export async function buildPack(app: App, paths: string[], links: [number, number][], entries: AccessEntry[], query: string, budget: number, denied: (path: string) => boolean): Promise<Pack> {
  const terms = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))];
  const pack: Pack = { query, budget, tokens: 0, notes: [], skipped: 0 };
  if (!terms.length) return pack;

  const score = new Map<number, { s: number; why: string }>();
  const bump = (i: number, s: number, why: string) => {
    const cur = score.get(i);
    if (!cur) score.set(i, { s, why });
    else { cur.s += s; if (s > 1 && !cur.why.startsWith('matches')) cur.why = why; }
  };

  // 1. Direct matches.
  paths.forEach((p, i) => {
    const f = app.vault.getAbstractFileByPath(p);
    const c = f instanceof TFile ? app.metadataCache.getFileCache(f) : null;
    const title = noteTitle(p).toLowerCase();
    const aliases = ([] as unknown[]).concat(c?.frontmatter?.aliases ?? []).join(' ').toLowerCase();
    const tags = [...(c?.tags ?? []).map((t) => t.tag), ...([] as unknown[]).concat(c?.frontmatter?.tags ?? []).map(String)].join(' ').toLowerCase();
    const hs = c?.headings ?? [];
    const heads = hs.map((h) => h.heading).join(' ').toLowerCase();
    // Long logs have hundreds of headings that mention everything; weigh them down.
    const headW = 1.2 * Math.min(1, 12 / Math.max(1, hs.length));
    const folder = p.toLowerCase();
    let s = 0;
    const hit: string[] = [];
    for (const t of terms) {
      if (title.includes(t)) { s += 3; hit.push(t); }
      else if (aliases.includes(t) || tags.includes(t)) { s += 2; hit.push(t); }
      else if (heads.includes(t)) { s += headW; if (headW > 0.6) hit.push(t); }
      else if (folder.includes(t)) s += 0.6;
    }
    // Reward covering more of the task, not one word many ways.
    if (s > 0) bump(i, s * (0.5 + hit.length / terms.length), hit.length ? `matches "${hit.join(', ')}"` : 'folder or headings match');
  });
  const seeds = [...score].sort((a, b) => b[1].s - a[1].s).slice(0, 12);
  if (!seeds.length) return pack;

  // 2. Linked neighbours of the best matches.
  const adj = new Map<number, number[]>();
  for (const [a, b] of links) { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); }
  // Hubs (indexes, logs) link to everything, so their pull is scaled down by degree.
  const hubDamp = (j: number) => 1 / Math.sqrt(Math.max(1, (adj.get(j)?.length ?? 0) / 8));
  for (const [i, { s }] of seeds) for (const j of (adj.get(i) ?? []).slice(0, 40)) bump(j, s * 0.25 * hubDamp(j), `linked with ${noteTitle(paths[i])}`);

  // 3. Notes agents used together with the matches in earlier tasks.
  const index = new Map(paths.map((p, i) => [p, i]));
  const seedPaths = new Set(seeds.map(([i]) => paths[i]));
  const together = new Map<number, { n: number; with: string }>();
  const usedIn = new Map<string, number>(); // how many tasks touched a note at all
  const tasks = taskGroups(entries);
  for (const t of tasks) {
    const ns = t.notes.map((n) => n.path);
    for (const p of ns) usedIn.set(p, (usedIn.get(p) ?? 0) + 1);
    const overlap = ns.find((p) => seedPaths.has(p));
    if (!overlap) continue;
    for (const p of ns) {
      const i = index.get(p);
      if (i === undefined || seedPaths.has(p)) continue;
      const c = together.get(i) ?? { n: 0, with: overlap };
      c.n++;
      together.set(i, c);
    }
  }
  // Notes that turn up in most tasks (logs, indexes) say little about this one.
  for (const [i, c] of together) {
    const spread = (usedIn.get(paths[i]) ?? 0) / Math.max(1, tasks.length);
    if (spread > 0.25) continue;
    bump(i, Math.min(3, c.n) * 0.4, `used with ${noteTitle(c.with)} before`);
  }

  // 4. Fill the budget, best first. A note that doesn't fit is cut to what's left.
  const ranked = [...score].sort((a, b) => b[1].s - a[1].s).slice(0, 60);
  const perNote = Math.max(1500, Math.round(budget * 0.4)); // no single note takes the whole pack
  for (const [i, { why }] of ranked) {
    const remaining = Math.min(perNote, budget - pack.tokens);
    if (budget - pack.tokens < 150) break;
    const path = paths[i];
    if (denied(path)) { pack.skipped++; continue; }
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) continue;
    const raw = await app.vault.cachedRead(f);
    const fmEnd = app.metadataCache.getFileCache(f)?.frontmatterPosition?.end.offset;
    let text = (fmEnd ? raw.slice(fmEnd) : raw).trim();
    let tokens = tokensForBytes(new TextEncoder().encode(text).length);
    let truncated = false;
    if (tokens > remaining) {
      if (remaining < 400) continue; // too little room for a useful slice; try a smaller note
      text = text.slice(0, Math.floor(text.length * (remaining / tokens))) + '\n…';
      tokens = remaining;
      truncated = true;
    }
    pack.notes.push({ path, title: noteTitle(path), why, tokens, truncated, text });
    pack.tokens += tokens;
  }
  return pack;
}
