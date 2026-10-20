// Spiking-network simulation that drives the visuals. Nodes fire spontaneously,
// each spike travels down links and may excite neighbours (a near-critical
// branching process, so you get both lone sparks and rolling avalanches).
// Agent activity (Claude, Codex, ...) rides the same machinery: a read sends a
// pulse along the shortest link path from the last note that agent touched.

// Pulse kind: 0 = spontaneous firing, slot + 1 = an agent's colour slot.
export const FIRE = 0;
export const enum Mode { Read = 0, Scan = 1, Write = 2 }
export const MAX_AGENTS = 8;

export interface NeuralSink {
  pulse(edge: number, fromA: boolean, start: number, dur: number, kind: number): void;
  beam(a: number, b: number, start: number, dur: number, kind: number): void;
  flash(node: number): void;
  aiMark(node: number, slot: number, mode: Mode): void;
}

const enum Ev { Fire, AIStep, AIArrive, Scan }
interface Event { t: number; type: Ev; node: number; slot: number; mode: Mode }

const REFRACTORY = 0.9;
const MAX_PENDING = 600;
// Ceiling on how many notes may light at once (decays at ~8/s). Without it a large
// avalanche fires hundreds of nodes in one frame and bloom flashes the whole screen.
const MAX_BURST = 14;
const AI_STEP = 0.2;

export class Neural {
  activity = 1;
  branch = 0.92;
  /** Total neuron firings so far; the monitor turns this into a rate. */
  spikes = 0;
  // Each agent leaves its own trail: where it last was, and when its current path ends.
  lastAI = new Int32Array(MAX_AGENTS).fill(-1);

  private start: Int32Array;
  private nbr: Int32Array;
  private edgeOf: Int32Array;
  private real: Uint8Array;
  private len: Float32Array;
  private lastFire: Float32Array;
  private active: number[] = [];
  private heap = new Heap();
  private acc = 0;
  private lastT = 0;
  private burst = 0;

  constructor(
    private n: number,
    private pairs: Int32Array,
    real: Uint8Array,
    positions: Float32Array,
    private speed: number,
    private sink: NeuralSink,
  ) {
    const e = pairs.length / 2;
    this.real = real;
    this.len = new Float32Array(e);
    const deg = new Int32Array(n + 1);
    for (let k = 0; k < e; k++) {
      const a = pairs[2 * k], b = pairs[2 * k + 1];
      deg[a]++; deg[b]++;
      const dx = positions[a * 3] - positions[b * 3];
      const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
      const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
      this.len[k] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    this.start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.start[i + 1] = this.start[i] + deg[i];
    const fill = this.start.slice(0, n);
    this.nbr = new Int32Array(e * 2);
    this.edgeOf = new Int32Array(e * 2);
    for (let k = 0; k < e; k++) {
      const a = pairs[2 * k], b = pairs[2 * k + 1];
      this.nbr[fill[a]] = b; this.edgeOf[fill[a]++] = k;
      this.nbr[fill[b]] = a; this.edgeOf[fill[b]++] = k;
    }
    this.lastFire = new Float32Array(n).fill(-1e4);
    for (let i = 0; i < n; i++) if (this.start[i + 1] > this.start[i]) this.active.push(i);
  }

  update(t: number) {
    const dt = Math.max(0, Math.min(t - this.lastT, 0.25));
    this.lastT = t;
    this.burst *= Math.exp(-dt * 8);
    if (this.active.length) {
      this.acc += dt * this.activity * (1.5 + this.n / 2000);
      while (this.acc >= 1) {
        this.acc -= 1;
        this.fire(this.active[(Math.random() * this.active.length) | 0], t);
      }
    }
    while (this.heap.size && this.heap.peek().t <= t) {
      const ev = this.heap.pop();
      switch (ev.type) {
        case Ev.Fire: this.fire(ev.node, ev.t); break;
        case Ev.AIStep: this.sink.flash(ev.node); break;
        case Ev.Scan: this.sink.aiMark(ev.node, ev.slot, Mode.Scan); break;
        case Ev.AIArrive:
          this.sink.aiMark(ev.node, ev.slot, ev.mode);
          this.lastFire[ev.node] = -1e4;
          this.fire(ev.node, ev.t);
          break;
      }
    }
  }

  ai(indices: number[], slot: number, mode: Mode, t: number) {
    const kind = slot + 1;
    if (mode === Mode.Scan) {
      // Everything that surfaced lights now; a 15 ms stagger only so a batch reads as a sweep.
      indices.slice(0, 40).forEach((node, k) => this.heap.push({ t: t + k * 0.015, type: Ev.Scan, node, slot, mode }));
      return;
    }
    // Real time: the note flares the moment the event arrives. The trail from the
    // agent's previous note is drawn alongside it, never in front of it.
    for (const node of indices.slice(0, 40)) {
      const from = this.lastAI[slot];
      this.lastAI[slot] = node;
      this.sink.aiMark(node, slot, mode);
      this.lastFire[node] = -1e4;
      this.fire(node, t);
      if (from < 0 || from === node) continue;
      const path = this.bfs(from, node, 9);
      if (!path) {
        this.sink.beam(from, node, t, 0.35, kind);
        continue;
      }
      const step = Math.min(AI_STEP, 0.9 / path.edges.length);
      let at = from;
      path.edges.forEach((e, s) => {
        this.sink.pulse(e, this.pairs[2 * e] === at, t + s * step, step, kind);
        at = path.nodes[s + 1];
        if (s < path.edges.length - 1) this.heap.push({ t: t + (s + 1) * step, type: Ev.AIStep, node: at, slot, mode });
      });
    }
  }

  private fire(i: number, t: number) {
    if (t - this.lastFire[i] < REFRACTORY || this.burst > MAX_BURST) return;
    this.lastFire[i] = t;
    this.burst += 1;
    this.spikes++;
    this.sink.flash(i);
    if (this.heap.size > MAX_PENDING) return;
    const s = this.start[i], deg = this.start[i + 1] - s;
    if (!deg) return;
    for (let k = s; k < s + deg; k++) {
      const e = this.edgeOf[k];
      const p = Math.min(0.95, this.branch / deg) * (this.real[e] ? 1 : 0.55);
      if (Math.random() >= p) continue;
      const dur = Math.min(1.4, Math.max(0.22, this.len[e] / this.speed));
      this.sink.pulse(e, this.pairs[2 * e] === i, t, dur, FIRE);
      this.heap.push({ t: t + dur, type: Ev.Fire, node: this.nbr[k], slot: 0, mode: Mode.Read });
    }
  }

  // Shortest path over real links only; ambient proximity lines are not knowledge.
  private bfs(src: number, dst: number, maxDepth: number) {
    const prev = new Int32Array(this.n).fill(-1);
    const prevEdge = new Int32Array(this.n);
    const depth = new Uint8Array(this.n);
    prev[src] = src;
    const queue = [src];
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q];
      if (u === dst) break;
      if (depth[u] >= maxDepth) continue;
      for (let k = this.start[u]; k < this.start[u + 1]; k++) {
        const e = this.edgeOf[k];
        const v = this.nbr[k];
        if (!this.real[e] || prev[v] !== -1) continue;
        prev[v] = u; prevEdge[v] = e; depth[v] = depth[u] + 1;
        queue.push(v);
      }
    }
    if (prev[dst] === -1) return null;
    const nodes = [dst], edges: number[] = [];
    for (let v = dst; v !== src; v = prev[v]) { edges.push(prevEdge[v]); nodes.push(prev[v]); }
    return { nodes: nodes.reverse(), edges: edges.reverse() };
  }
}

class Heap {
  private a: Event[] = [];
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  push(e: Event) {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].t <= a[i].t) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Event {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].t < a[m].t) m = l;
        if (r < a.length && a[r].t < a[m].t) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
