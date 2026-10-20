import { App, TFile } from 'obsidian';

// Meaning map: lays the brain out by what notes are about instead of how they're
// linked. Each note becomes a TF-IDF vector of its words (title, aliases, tags and
// headings count extra); every note is then tied to its few most similar notes, and
// those ties drive the force layout. Runs locally: no model, no network.

const STOP = new Set(('the and for with that this from into about what when where which how why are was were has have had not but you your our their its can will would should could all any some more most less one two use using used make need want get set new old also than then them they there here just like only very each other such been being does done over under after before between because while within without per via etc yes not into onto out off see note notes file files page').split(' '));

export interface MeaningProgress { (done: number, total: number): void }

/** Undirected edges [a, b] between each note and its k most similar notes. */
export async function meaningLinks(app: App, paths: string[], k = 6, progress?: MeaningProgress): Promise<[number, number][]> {
  const n = paths.length;
  const docs: Map<string, number>[] = [];
  const df = new Map<string, number>();

  // 1. Term counts per note.
  for (let i = 0; i < n; i++) {
    const tf = new Map<string, number>();
    const f = app.vault.getAbstractFileByPath(paths[i]);
    if (f instanceof TFile) {
      const cache = app.metadataCache.getFileCache(f);
      const add = (text: string, w: number) => {
        for (const t of text.toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^\p{L}\p{N}]+/u)) {
          if (t.length < 3 || t.length > 30 || STOP.has(t) || /^\d+$/.test(t)) continue;
          tf.set(t, (tf.get(t) ?? 0) + w);
        }
      };
      add(f.basename, 4);
      add(([] as unknown[]).concat(cache?.frontmatter?.aliases ?? []).join(' '), 3);
      add([...(cache?.tags ?? []).map((t) => t.tag), ...([] as unknown[]).concat(cache?.frontmatter?.tags ?? []).map(String)].join(' '), 3);
      add((cache?.headings ?? []).map((h) => h.heading).join(' '), 2);
      const text = await app.vault.cachedRead(f);
      add(text.slice(0, 20_000), 1);
    }
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    docs.push(tf);
    if (i % 200 === 0) { progress?.(i, n * 2); await idle(); }
  }

  // 2. Weighted, normalised vectors: top terms only. Words in nearly every note or
  //    in just one carry no signal for "what is this near".
  const maxDf = Math.max(3, n * 0.5);
  const vecs: { t: string; w: number }[][] = [];
  for (const tf of docs) {
    const v: { t: string; w: number }[] = [];
    for (const [t, c] of tf) {
      const d = df.get(t)!;
      if (d < 2 || d > maxDf) continue;
      v.push({ t, w: (1 + Math.log(c)) * Math.log(n / d) });
    }
    v.sort((a, b) => b.w - a.w);
    v.length = Math.min(v.length, 40);
    const norm = Math.hypot(...v.map((x) => x.w)) || 1;
    v.forEach((x) => { x.w /= norm; });
    vecs.push(v);
  }

  // 3. Inverted index, then nearest neighbours by cosine similarity.
  const post = new Map<string, { i: number; w: number }[]>();
  vecs.forEach((v, i) => { for (const x of v) (post.get(x.t) ?? post.set(x.t, []).get(x.t)!).push({ i, w: x.w }); });
  const edges = new Set<number>();
  const out: [number, number][] = [];
  const score = new Float32Array(n);
  const touched: number[] = [];
  for (let i = 0; i < n; i++) {
    for (const x of vecs[i]) {
      for (const p of post.get(x.t)!) {
        if (p.i === i) continue;
        if (score[p.i] === 0) touched.push(p.i);
        score[p.i] += x.w * p.w;
      }
    }
    touched.sort((a, b) => score[b] - score[a]);
    for (const j of touched.slice(0, k)) {
      if (score[j] < 0.08) break;
      const key = Math.min(i, j) * n + Math.max(i, j);
      if (!edges.has(key)) { edges.add(key); out.push([i, j]); }
    }
    for (const j of touched) score[j] = 0;
    touched.length = 0;
    if (i % 300 === 0) { progress?.(n + i, n * 2); await idle(); }
  }
  progress?.(n * 2, n * 2);
  return out;
}

const idle = () => new Promise<void>((r) => window.setTimeout(r, 0));
