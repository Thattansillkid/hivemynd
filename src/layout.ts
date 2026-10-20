import { forceSimulation, forceManyBody, forceLink, forceX, forceY, forceZ } from 'd3-force-3d';

interface SimNode { x: number; y: number; z: number }
interface Link { source: { index: number }; target: { index: number } }

/** Notes with more links than this are treated as indexes, not neurons. */
export const hubThreshold = (n: number) => Math.max(60, n * 0.01);

// Built by esbuild from src/layout.worker.ts and inlined as a string (see esbuild.config.mjs).
declare const __LAYOUT_WORKER__: string;

export interface LayoutRunner {
  done: boolean;
  /** True when positions changed since the last writeTo. */
  fresh: boolean;
  step(budgetMs: number): void;
  writeTo(out: Float32Array): void;
  dispose(): void;
}

// 3D force simulation. A 6k-note vault costs ~45 ms per tick, so normally this
// runs in a worker and streams positions back while the network visibly unfolds.
export type LayoutMode = 'links' | 'meaning';

export function createSim(n: number, links: [number, number][], cached: (number[] | null)[], mode: LayoutMode = 'links') {
  const known = cached.reduce((c, p) => c + (p ? 1 : 0), 0);
  const warm = n > 0 && known >= n * 0.8;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of links) { adj[a].push(b); adj[b].push(a); }

  const hub = hubThreshold(n);
  const hubDeg = (l: Link) => Math.max(adj[l.source.index].length, adj[l.target.index].length);

  // Start at roughly the settled scale so a cold start condenses into structure
  // instead of exploding out of a white-hot ball.
  const spread = 60 * Math.cbrt(Math.max(n, 1));
  const nodes: SimNode[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = cached[i];
    if (c) { nodes[i] = { x: c[0], y: c[1], z: c[2] }; continue; }
    const nb = adj[i].find((j) => cached[j]);
    const base = nb !== undefined ? cached[nb]! : null;
    if (base) {
      nodes[i] = { x: base[0] + jitter(15), y: base[1] + jitter(15), z: base[2] + jitter(15) };
    } else {
      const r = spread * Math.cbrt(Math.random());
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      nodes[i] = { x: r * s * Math.cos(th), y: r * s * Math.sin(th), z: r * u };
    }
  }

  if (mode === 'meaning') {
    // Similarity ties: every note has a handful, all equally real, so uniform springs.
    // Tuned offline on a 6k-note vault: same-folder notes end up ~2.3x closer than
    // random pairs (default link physics on the same ties: ~1.5x).
    const sim = forceSimulation(nodes, 3)
      .force('charge', forceManyBody().strength(-25).theta(0.95).distanceMax(500))
      .force('link', forceLink(links.map(([source, target]) => ({ source, target }))).distance(18).strength(0.6))
      .force('x', forceX(0).strength(0.02))
      .force('y', forceY(0).strength(0.02))
      .force('z', forceZ(0).strength(0.02))
      .velocityDecay(0.4)
      .alphaDecay(warm ? 0.06 : 0.02)
      .alpha(warm ? 0.12 : 1)
      .stop();
    return { sim, write: writer(nodes) };
  }

  const sim = forceSimulation(nodes, 3)
    .force('charge', forceManyBody().strength(-60).theta(0.95).distanceMax(900))
    // Index notes (one note linking to thousands) would crush their leaves into a
    // single blinding ball. Give hub spokes longer, much looser springs so leaves
    // settle by their own links and drift as a cloud around the index.
    .force('link', forceLink(links.map(([source, target]) => ({ source, target })))
      .distance((l: Link) => 34 + 7 * Math.sqrt(hubDeg(l)))
      .strength((l: Link) => (1 / Math.min(adj[l.source.index].length, adj[l.target.index].length)) * (hubDeg(l) > hub ? 0.12 : 1)))
    .force('x', forceX(0).strength(0.015))
    .force('y', forceY(0).strength(0.015))
    .force('z', forceZ(0).strength(0.015))
    .velocityDecay(0.4)
    .alphaDecay(warm ? 0.06 : 0.025)
    .alpha(warm ? 0.12 : 1)
    .stop();

  return { sim, write: writer(nodes) };
}

const writer = (nodes: SimNode[]) => (out: Float32Array) => {
  for (let i = 0; i < nodes.length; i++) {
    out[i * 3] = nodes[i].x;
    out[i * 3 + 1] = nodes[i].y;
    out[i * 3 + 2] = nodes[i].z;
  }
};

export function startLayout(n: number, links: [number, number][], cached: (number[] | null)[], mode: LayoutMode = 'links'): LayoutRunner {
  // A graph refresh (a note edited or added) keeps everyone where they are; new notes
  // drop in beside a linked neighbour. Re-running physics here made the whole view jump.
  const known = cached.reduce((c, p) => c + (p ? 1 : 0), 0);
  if (n > 0 && known >= n * 0.97) return new FrozenLayout(n, links, cached);
  if (typeof Worker !== 'undefined' && typeof __LAYOUT_WORKER__ === 'string') {
    try { return new WorkerLayout(n, links, cached, mode); } catch (err) { console.warn('H!V3MYND: layout worker unavailable, running inline', err); }
  }
  return new InlineLayout(n, links, cached, mode);
}

class WorkerLayout implements LayoutRunner {
  done = false;
  fresh = true;
  private worker: Worker;
  private url: string;
  private latest: Float32Array;

  constructor(n: number, links: [number, number][], cached: (number[] | null)[], mode: LayoutMode) {
    this.url = URL.createObjectURL(new Blob([__LAYOUT_WORKER__], { type: 'text/javascript' }));
    this.worker = new Worker(this.url);
    // Seed positions come back immediately so the first frame isn't empty.
    const { write } = createSim(n, links, cached, mode);
    this.latest = new Float32Array(n * 3);
    write(this.latest);
    this.worker.onmessage = (e: MessageEvent<{ positions: Float32Array; done: boolean }>) => {
      this.latest = e.data.positions;
      this.fresh = true;
      if (e.data.done) { this.done = true; this.dispose(); }
    };
    this.worker.postMessage({ n, links, cached, mode });
  }

  step() {}

  writeTo(out: Float32Array) {
    out.set(this.latest);
    this.fresh = false;
  }

  dispose() {
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}

class InlineLayout implements LayoutRunner {
  done = false;
  fresh = true;
  private s: ReturnType<typeof createSim>;

  constructor(n: number, links: [number, number][], cached: (number[] | null)[], mode: LayoutMode) {
    this.s = createSim(n, links, cached, mode);
  }

  step(budgetMs: number) {
    if (this.done) return;
    const sim = this.s.sim;
    const t0 = performance.now();
    do sim.tick();
    while (performance.now() - t0 < budgetMs && sim.alpha() > sim.alphaMin());
    this.fresh = true;
    if (sim.alpha() <= sim.alphaMin()) this.done = true;
  }

  writeTo(out: Float32Array) {
    this.s.write(out);
    this.fresh = false;
  }

  dispose() {}
}

class FrozenLayout implements LayoutRunner {
  done = true;
  fresh = true;
  private s: ReturnType<typeof createSim>;
  constructor(n: number, links: [number, number][], cached: (number[] | null)[]) { this.s = createSim(n, links, cached); }
  step() {}
  writeTo(out: Float32Array) { this.s.write(out); this.fresh = false; }
  dispose() {}
}

function jitter(r: number) { return (Math.random() * 2 - 1) * r; }
