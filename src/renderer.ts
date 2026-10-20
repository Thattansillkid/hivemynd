import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { startLayout, LayoutRunner, hubThreshold } from './layout';
import { Neural, NeuralSink, Mode, MAX_AGENTS } from './neural';
import type { BrainStats } from './monitor';
import type { AudioReactor } from './audio';
import * as GL from './shaders';

export interface GraphInput {
  paths: string[];
  links: [number, number][];
  /** Ties that drive the layout instead of links (the meaning map); links still draw. */
  layoutLinks?: [number, number][];
  /** Which layout this is ('links', 'meaning'); switching starts the physics fresh. */
  layoutKey?: string;
}
export type LayoutCache = Record<string, [number, number, number]>;
export type TouchMode = 'read' | 'scan' | 'write';
export interface AgentStyle { name: string; color: string }
/** How strongly each band drives the brain, 0..2 (1 = 100%). Only bass pulses it. */
export interface AudioGains { bass: number; mid: number; high: number }
export interface AudioSource { id: string; label: string; kind: 'system' | 'input' | 'output' }
export interface AudioControls {
  setGain(band: keyof AudioGains, v: number): void;
  /** Kick detection sensitivity, 0.5-2 (higher catches softer kicks). */
  sensitivity(): number;
  setSensitivity(v: number): void;
  sources(): Promise<AudioSource[]>;
  selected(): string;
  select(id: string): void;
  /** Listen to every source briefly and switch to the one carrying sound. */
  detect(): Promise<string>;
}

export interface PlexusOptions {
  nodeColor: string;
  linkColor: string;
  linkStrength: number;
  nodeSize: number;
  fireColor: string;
  nebulaColor: string;
  agents: AgentStyle[];
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  depthBlur: number;
  drift: number;
  activity: number;
  autoRotate: number;
  nebula: number;
  grain: number;
  followAI: boolean;
  plexusLines: boolean;
  triangles: boolean;
  maxPixelRatio: number;
  msaa: boolean;
}

// Starter colours for common agents. Any other agent name is accepted and can be
// given a colour in settings.
export const DEFAULT_AGENTS: AgentStyle[] = [
  { name: 'claude', color: '#ffb347' },
  { name: 'codex', color: '#6dff9e' },
  { name: 'gemini', color: '#4f9dff' },
  { name: 'grok', color: '#9b7bff' },
  { name: 'cursor', color: '#ff4fd8' },
  { name: 'other', color: '#ffffff' },
];

/** Light theme palette: nodes ink to deep navy, links to a pale sky blue. */
export const LIGHT_NODE_COLOR = '#ffffff';
export const LIGHT_LINK_COLOR = '#ffffff';
// Light mode keeps bloom subtle (a soft halo, not a fog) and drops the nebula haze.
const LIGHT_BLOOM = 0.05;
const LIGHT_NEBULA = 0;
// On paper the links (which skip the big-vault exposure cut) out-ink the nodes;
// light mode thins the links and lifts the nodes so dots read over threads.
const LIGHT_LINK_ALPHA = 0.16;
const LIGHT_NODE_GAIN = 2.6;
const LIGHT_NODE_SIZE = 1.3;

export const DEFAULT_OPTIONS: PlexusOptions = {
  nodeColor: '#3ee8de',
  linkColor: '#2fd3c9',
  linkStrength: 1,
  nodeSize: 1.6,
  fireColor: '#c8fbff',
  nebulaColor: '#0b5a63',
  agents: DEFAULT_AGENTS,
  bloomStrength: 0.8,
  bloomRadius: 0.55,
  bloomThreshold: 0.22,
  depthBlur: 1,
  drift: 1,
  activity: 1,
  autoRotate: 0.3,
  nebula: 1,
  grain: 0.6,
  followAI: true,
  plexusLines: true,
  triangles: true,
  maxPixelRatio: 2,
  msaa: true,
};

const SPARKS = 4096;
/** Seconds of quiet after which an agent's next access counts as a new piece of work. */
const SESSION_GAP = 45;
const MAX_TRIS = 7000;
const MODE: Record<TouchMode, Mode> = { read: Mode.Read, scan: Mode.Scan, write: Mode.Write };
const MODE_LABEL = ['read', 'scan', 'write'];

const seedOf = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

export class PlexusRenderer {
  readonly canvas: HTMLCanvasElement;
  onOpen: ((index: number, newTab: boolean) => void) | null = null;
  /** Hovered note (or -1) and its screen position, every frame while hovering. */
  onHover: ((index: number, x: number, y: number) => void) | null = null;
  onSettled: ((cache: LayoutCache) => void) | null = null;

  private opts: PlexusOptions;
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private resizeObserver: ResizeObserver;

  // Uniform objects shared by every material, so one write updates them all.
  private u = {
    uTime: { value: 0 },
    uDrift: { value: 1 },
    uFocus: { value: 500 },
    uAperture: { value: 0.002 },
    uPixelScale: { value: 500 },
    uMaxBlurPx: { value: 18 },
    uFar: { value: 1000 },
    uBaseSize: { value: 2.4 },
    uNodeScale: { value: 1.6 },
    uFireColor: { value: new THREE.Color() },
    uAgentColors: { value: Array.from({ length: MAX_AGENTS }, () => new THREE.Color()) },
    uLinkColor: { value: new THREE.Color() },
    uLinkAlpha: { value: 0.24 },
    uProxAlpha: { value: 0.05 },
    uTriAlpha: { value: 0.012 },
    uHover: { value: -1 },
    uGain: { value: 1 },
    uLinkFade: { value: 0 },
    uHeatMode: { value: 0 },
    uHeatColor: { value: new THREE.Color('#ffd27a') },
    uFocusMode: { value: 0 },
    uGrowth: { value: 0 },
    uMeaning: { value: 0 },
    uReveal: { value: 1 },
    uAudioBeat: { value: 0 },
    uAudioExpand: { value: 0 },
    uMusicColors: { value: Array.from({ length: 8 }, () => new THREE.Color()) },
    uCenter: { value: new THREE.Vector3() },
    uFocusColor: { value: new THREE.Color('#2fd3c9') },
    uAlertColor: { value: new THREE.Color('#ff3b3b') },
  };

  private nebula: THREE.Mesh;
  private sparks: THREE.Points;
  private sparkCursor = 0;
  private nodes: THREE.Points | null = null;
  private edges: THREE.LineSegments | null = null;
  private tris: THREE.Mesh | null = null;

  private graph: GraphInput | null = null;
  private n = 0;
  private positions = new Float32Array(0);
  private seeds = new Float32Array(0);
  private degree = new Uint16Array(0);
  // Links that aren't to or from an index note. Zero = dust.
  private ownDegree = new Uint16Array(0);
  private realPairs = new Int32Array(0);
  private edgePairs = new Int32Array(0);
  private triNodes = new Int32Array(0);
  private layout: LayoutRunner | null = null;
  private neural: Neural | null = null;
  private settled = false;
  private layoutFrames = 0;
  private dirty = { nodes: false, edges: false, sparks: false };

  private time = 0;
  private last = performance.now();
  // Rolling one-second window for the Brain Monitor.
  private statWindow = { start: performance.now(), frames: 0, work: 0, spikes: 0, sparks: 0 };
  private sparkCount = 0;
  private liveStats: BrainStats | null = null;
  private centroid = new THREE.Vector3();
  private radius = 300;
  private fit = true;
  private resumeRotateAt = 0;
  private follow = new THREE.Vector3();
  private followUntil = -1;
  private tmpMat = new THREE.Matrix4();
  private tmpVec = new THREE.Vector3();

  private mouse = new THREE.Vector2(-1e4, -1e4);
  private mouseDirty = false;
  private lastMove = 0;
  private linkFade = 0;
  private downAt = new THREE.Vector2();
  private hover = -1;
  private label: HTMLDivElement;
  private feed: HTMLDivElement;
  private legend: HTMLDivElement;
  private heatTarget = 0;
  private focusTarget = 0;
  /** Music reactivity source; null = off. strength 0..3, delay in ms. */
  audio: { reactor: AudioReactor; strength: number; delayMs: number; midHigh: number; palette: string[]; gains: AudioGains } | null = null;
  /** Hooks for the music panel's sliders and source picker (set by the view). */
  audioControls: AudioControls | null = null;
  private expand = 0;
  private expandVel = 0;
  private lastBeat = 0;
  private midAcc = 0;
  private highAcc = 0;
  private musicReturns: { t: number; edge: number; fromA: boolean; dur: number; kind: number }[] = [];
  private meter: HTMLDivElement | null = null;
  private focusSet: Set<number> | null = null;
  private focusCenter = new THREE.Vector3();
  // Agent "satellites" orbiting outside the brain, plus live bridge-message arcs.
  private satellites = new Map<string, { mesh: THREE.Mesh; label: HTMLDivElement; base: number; flash: number }>();
  private arcs: { line: THREE.Line; born: number }[] = [];
  private bolts: { lines: THREE.Line[]; born: number; base: number; node: number; agent: string; lastActive: number }[] = [];
  private lastTouch = new Map<string, number>();

  constructor(container: HTMLElement, options: PlexusOptions) {
    this.container = container;
    this.opts = { ...options };

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.addClass('plexus-canvas');
    if (getComputedStyle(container).position === 'static') container.setCssStyles({ position: 'relative' });
    container.appendChild(this.canvas);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 50000);
    this.camera.position.set(0, 80, 700);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener('start', () => { this.fit = false; this.resumeRotateAt = Infinity; });
    this.controls.addEventListener('end', () => { this.resumeRotateAt = this.time + 6; });

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.opts.msaa ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.7, 0.1);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.6 }, uRes: { value: new THREE.Vector2(1, 1) }, uLight: { value: 0 }, uPaper: { value: new THREE.Color('#f8f8f7') } },
      vertexShader: GL.FINISH_VERT,
      fragmentShader: GL.FINISH_FRAG,
    });
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());

    this.nebula = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.u.uTime,
          uRes: { value: new THREE.Vector2(1, 1) },
          uNebula: { value: new THREE.Color() },
          uCam: { value: new THREE.Vector2() },
          uAmount: { value: 1 },
        },
        vertexShader: GL.NEBULA_VERT,
        fragmentShader: GL.NEBULA_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.nebula.frustumCulled = false;
    this.nebula.renderOrder = -1;
    this.scene.add(this.nebula);

    this.sparks = this.buildSparks();
    this.scene.add(this.sparks);

    this.label = this.overlay('pxo-label');
    this.legend = this.buildLegend();
    this.feed = this.overlay('pxo-feed');

    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.set(e.clientX - r.left, e.clientY - r.top);
      this.mouseDirty = true;
      this.lastMove = performance.now();
    });
    this.canvas.addEventListener('pointerleave', () => { this.mouse.set(-1e4, -1e4); this.mouseDirty = true; });
    this.canvas.addEventListener('pointerdown', (e) => this.downAt.set(e.clientX, e.clientY));
    this.canvas.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      if (moved < 5 && this.hover >= 0 && e.button === 0) this.onOpen?.(this.hover, e.ctrlKey || e.metaKey);
    });
    this.canvas.addEventListener('dblclick', () => this.recenter());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.setOptions(this.opts);
    this.resize();
    this.renderer.setAnimationLoop(this.frame);
  }

  // ---------------------------------------------------------------- public API

  private layoutKey = 'links';
  private linkDim = 1;

  setGraph(graph: GraphInput, cached?: LayoutCache | null) {
    let live = this.exportPositions();
    const glow = this.exportGlow();
    this.disposeGraph();
    this.graph = graph;
    const n = (this.n = graph.paths.length);
    this.positions = new Float32Array(n * 3);
    this.seeds = Float32Array.from({ length: n }, (_, i) => seedOf(i + hashStr(graph.paths[i]) * 997));
    this.degree = new Uint16Array(n);
    this.realPairs = new Int32Array(graph.links.length * 2);
    graph.links.forEach(([a, b], k) => {
      this.realPairs[2 * k] = a;
      this.realPairs[2 * k + 1] = b;
      this.degree[a]++;
      this.degree[b]++;
    });
    const hub = hubThreshold(n);
    this.ownDegree = new Uint16Array(n);
    for (const [a, b] of graph.links) {
      if (this.degree[a] > hub || this.degree[b] > hub) continue;
      this.ownDegree[a]++;
      this.ownDegree[b]++;
    }

    const key = graph.layoutKey ?? 'links';
    if (key !== this.layoutKey) {
      live = {};
      this.layoutKey = key;
      // In the meaning map, wiki links cut across topics: keep them as faint threads.
      this.linkDim = key === 'meaning' ? 0.3 : 1;
      this.u.uLinkAlpha.value = 0.42 * this.opts.linkStrength * this.linkDim * (this.light ? LIGHT_LINK_ALPHA : 1);
      this.u.uMeaning.value = key === 'meaning' ? 1 : 0;
      this.recenter();
    }
    const start = graph.paths.map((p) => live[p] ?? cached?.[p] ?? null);
    this.layout = startLayout(n, graph.layoutLinks ?? graph.links, start, key === 'meaning' ? 'meaning' : 'links');
    this.layout.writeTo(this.positions);
    this.settled = false;
    this.layoutFrames = 0;
    this.updateBounds();
    if (!this.graph || !live || !Object.keys(live).length) this.frameCamera();
    // Additive glow saturates as notes pile up; scale exposure down for big vaults.
    let linked = 0;
    for (const d of this.ownDegree) if (d) linked++;
    this.baseGain = Math.min(1, Math.max(0.25, Math.sqrt(450 / Math.max(linked, 1))));
    this.u.uGain.value = this.baseGain * (this.light ? LIGHT_NODE_GAIN : 1);

    this.nodes = this.buildNodes();
    this.scene.add(this.nodes);
    this.restoreGlow(glow);
    this.rebuildLinks();
  }

  // Agent trails survive a graph rebuild, so editing a note doesn't wipe the glow.
  private exportGlow() {
    const out = new Map<string, [number, number]>();
    if (!this.nodes || !this.graph) return out;
    const ai = this.nodes.geometry.getAttribute('aAI') as THREE.BufferAttribute;
    const code = this.nodes.geometry.getAttribute('aAICode') as THREE.BufferAttribute;
    this.graph.paths.forEach((p, i) => { if (ai.getX(i) > this.time - 120) out.set(p, [ai.getX(i), code.getX(i)]); });
    return out;
  }

  private restoreGlow(glow: Map<string, [number, number]>) {
    if (!this.nodes || !this.graph || !glow.size) return;
    const ai = this.nodes.geometry.getAttribute('aAI') as THREE.BufferAttribute;
    const code = this.nodes.geometry.getAttribute('aAICode') as THREE.BufferAttribute;
    this.graph.paths.forEach((p, i) => {
      const g = glow.get(p);
      if (g) { ai.setX(i, g[0]); code.setX(i, g[1]); }
    });
    ai.needsUpdate = code.needsUpdate = true;
  }

  /** An agent touched these notes. `agent` picks the colour and trail; mode the gesture. */
  touch(indices: number[], agent: string, mode: TouchMode) {
    if (!this.neural || !indices.length) return;
    // An agent's first access after a pause strikes its first note with lightning; the
    // beam then holds on that note for as long as the agent keeps working.
    if (this.time - (this.lastTouch.get(agent) ?? -1e9) > SESSION_GAP) this.lightning(agent, indices[0]);
    else for (const b of this.bolts) if (b.agent === agent) b.lastActive = this.time;
    this.lastTouch.set(agent, this.time);
    this.neural.ai(indices, this.agentSlot(agent), MODE[mode], this.time);
  }

  // Start outside the cloud; inside it, near notes become screen-filling bokeh.
  private frameCamera() {
    const dir = this.tmpVec.copy(this.camera.position).sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.1, 1);
    dir.setLength(this.radius * 1.6);
    this.controls.target.copy(this.centroid);
    this.camera.position.copy(this.centroid).add(dir);
  }

  /**
   * Heat & decay overlay. heat/decay are 0..1 per note (graph order); pass on=false to
   * fade back to the normal view. Values can be refreshed while it is on.
   */
  setHeat(heat: Float32Array | null, decay: Float32Array | null, on: boolean) {
    this.heatTarget = on ? 1 : 0;
    this.legend.style.display = on ? 'block' : 'none';
    if (!this.nodes || !heat || !decay || heat.length !== this.n) return;
    const g = this.nodes.geometry;
    (g.getAttribute('aHeat') as THREE.BufferAttribute).copyArray(heat).needsUpdate = true;
    (g.getAttribute('aDecay') as THREE.BufferAttribute).copyArray(decay).needsUpdate = true;
  }

  private buildLegend() {
    const el = this.overlay('pxo-panel pxo-legend');
    el.createDiv({ cls: 'pxo-legend-title', text: 'Heat & decay' });
    el.createDiv({ cls: 'pxo-legend-bar' });
    const ends = el.createDiv({ cls: 'pxo-legend-ends' });
    ends.createSpan({ text: 'Untouched 90 d+' });
    ends.createSpan({ text: 'Used often, lately' });
    el.createDiv({ cls: 'pxo-legend-note', text: 'Gold & large = hot. Dim = no agent use or edits for 30–90 days.' });
    return el;
  }

  /**
   * Task focus: light only these notes (and the links between them) in the agent's
   * colour, dim the rest, and frame them. Pass null to return to the normal view.
   */
  setFocus(indices: number[] | null, color = '#2fd3c9') {
    this.focusSet = indices && indices.length ? new Set(indices) : null;
    this.focusTarget = this.focusSet ? 1 : 0;
    this.u.uFocusColor.value.set(color);
    if (this.nodes) {
      const a = this.nodes.geometry.getAttribute('aFocus') as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      arr.fill(0);
      if (this.focusSet) for (const i of this.focusSet) arr[i] = 1;
      a.needsUpdate = true;
    }
    if (this.edges) {
      const a = this.edges.geometry.getAttribute('aFocusEdge') as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      const pairs = this.edgePairs;
      for (let k = 0; k < pairs.length / 2; k++) {
        const on = this.focusSet && this.focusSet.has(pairs[2 * k]) && this.focusSet.has(pairs[2 * k + 1]) ? 1 : 0;
        arr[2 * k] = arr[2 * k + 1] = on;
      }
      a.needsUpdate = true;
    }
    if (this.focusSet) {
      this.focusCenter.set(0, 0, 0);
      for (const i of this.focusSet) this.focusCenter.add(this.tmpVec.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]));
      this.focusCenter.divideScalar(this.focusSet.size);
    } else {
      this.followUntil = -1;
    }
  }

  /**
   * Growth time-lapse: born[i] is 0..1, the order note i appeared in the vault. Pass
   * null to end it. setReveal() then moves the playhead; later notes stay hidden.
   */
  setGrowth(born: Float32Array | null) {
    this.born = born && born.length === this.n ? born : null;
    this.u.uGrowth.value = this.born ? 1 : 0;
    this.u.uReveal.value = 1;
    if (this.nodes) (this.nodes.geometry.getAttribute('aBorn') as THREE.BufferAttribute).copyArray(this.born ?? new Float32Array(this.n)).needsUpdate = true;
    if (this.edges) (this.edges.geometry.getAttribute('aBornEdge') as THREE.BufferAttribute).copyArray(this.bornEdges(this.edgePairs)).needsUpdate = true;
  }

  setReveal(r: number) { this.u.uReveal.value = r; }

  private born: Float32Array | null = null;
  private bornEdges(pairs: Int32Array) {
    const out = new Float32Array(pairs.length);
    if (!this.born) return out;
    for (let k = 0; k < pairs.length / 2; k++) out[2 * k] = out[2 * k + 1] = Math.max(this.born[pairs[2 * k]], this.born[pairs[2 * k + 1]]);
    return out;
  }

  /** A watched note was touched: a red flare that fades over a few seconds. */
  alertFlash(index: number) {
    if (!this.nodes || index < 0 || index >= this.n) return;
    (this.nodes.geometry.getAttribute('aAlert') as THREE.BufferAttribute).setX(index, this.time);
    this.dirty.nodes = true;
  }

  /** Flash one note and glide the camera to it (used when a note is picked from the log). */
  highlight(index: number) {
    if (!this.nodes || index < 0 || index >= this.n) return;
    (this.nodes.geometry.getAttribute('aFire') as THREE.BufferAttribute).setX(index, this.time);
    this.dirty.nodes = true;
    this.follow.set(this.positions[index * 3], this.positions[index * 3 + 1], this.positions[index * 3 + 2]);
    this.followUntil = this.time + 25;
  }

  private light = false;
  private baseGain = 1;

  /**
   * Light theme: white paper, deeper blue nodes, the same light-blue links. Drawn by
   * the finish pass (see FINISH_FRAG), so every effect keeps working unchanged.
   */
  setTheme(light: boolean) {
    if (light === this.light) return;
    this.light = light;
    this.finish.uniforms.uLight.value = light ? 1 : 0;
    // ACES would grey the white paper; light mode writes final colours directly.
    this.renderer.toneMapping = light ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.setOptions({});
    this.writeTints();
  }

  /** Node colour for the current theme: light mode swaps the cyan for a deep blue. */
  private nodeColor() { return this.light ? LIGHT_NODE_COLOR : this.opts.nodeColor; }

  recenter() { this.fit = true; this.followUntil = -1; this.resumeRotateAt = 0; }

  setOptions(next: Partial<PlexusOptions>) {
    const prev = this.opts;
    this.opts = { ...this.opts, ...next };
    const o = this.opts;
    this.u.uFireColor.value.set(o.fireColor);
    this.u.uLinkColor.value.set(this.light ? LIGHT_LINK_COLOR : o.linkColor).multiplyScalar(0.9);
    const lk = this.light ? LIGHT_LINK_ALPHA : 1;
    this.u.uNodeScale.value = o.nodeSize * (this.light ? LIGHT_NODE_SIZE : 1);
    this.u.uLinkAlpha.value = 0.42 * o.linkStrength * this.linkDim * lk;
    this.u.uProxAlpha.value = 0.08 * o.linkStrength * lk;
    this.u.uGain.value = this.baseGain * (this.light ? LIGHT_NODE_GAIN : 1);
    this.u.uTriAlpha.value = 0.016 * o.linkStrength * (this.light ? 0.12 : 1);
    o.agents.slice(0, MAX_AGENTS).forEach((a, i) => this.u.uAgentColors.value[i].set(a.color));
    (this.nebula.material as THREE.ShaderMaterial).uniforms.uNebula.value.set(o.nebulaColor);
    (this.nebula.material as THREE.ShaderMaterial).uniforms.uAmount.value = o.nebula * (this.light ? LIGHT_NEBULA : 1);
    this.finish.uniforms.uGrain.value = o.grain;
    this.bloom.strength = o.bloomStrength * (this.light ? LIGHT_BLOOM : 1);
    this.bloom.radius = o.bloomRadius;
    this.bloom.threshold = o.bloomThreshold;
    this.controls.autoRotateSpeed = o.autoRotate;
    if (this.neural) this.neural.activity = o.activity;
    if (this.nodes && prev.nodeColor !== o.nodeColor) this.writeTints();
    if (this.settled && (prev.plexusLines !== o.plexusLines || prev.triangles !== o.triangles)) this.rebuildLinks();
    if (prev.maxPixelRatio !== o.maxPixelRatio) this.resize();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.disposeGraph();
    for (const obj of [this.nebula, this.sparks]) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.label.remove();
    this.feed.remove();
    this.legend.remove();
    this.meter?.remove();
    for (const s of this.satellites.values()) s.label.remove();
  }

  // ---------------------------------------------------------------- frame loop

  /** Last error thrown inside a frame (shown on GET /health). */
  lastError: string | null = null;
  private errorCount = 0;

  // three.js stops its animation loop for good if the callback throws, which froze the
  // brain (black after a resize) and silenced the music analyser. Errors are caught,
  // recorded and the loop carries on.
  private frame = () => {
    try {
      this.frameBody();
    } catch (err) {
      this.errorCount++;
      if (this.errorCount < 5 || this.errorCount % 600 === 0) console.error('H!V3MYND: frame error', err);
      this.lastError = `${this.errorCount}× ${err instanceof Error ? err.stack ?? err.message : String(err)}`.slice(0, 1200);
    }
  };

  private frameBody() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.container.isConnected || this.container.clientWidth === 0 || this.container.clientHeight === 0) return;

    this.time += dt;
    this.u.uTime.value = this.time;
    this.finish.uniforms.uTime.value = this.time;

    if (this.layout && !this.settled) {
      this.layout.step(8);
      if (this.layout.fresh) {
        this.layout.writeTo(this.positions);
        this.syncPositions();
      }
      if (++this.layoutFrames % 15 === 0) this.updateBounds();
      if (this.layout.done) this.onLayoutDone();
    }
    this.neural?.update(this.time);
    this.applyAudio(dt);
    this.flush();
    this.updateCamera(dt);
    // Pick only once the pointer rests; re-picking on every move strobed the highlight
    // across dense clusters and read as the whole screen flashing.
    if (this.mouseDirty && now - this.lastMove > 120) { this.mouseDirty = false; this.pick(); }
    this.linkFade = this.settled ? Math.min(1, this.linkFade + dt / 1.5) : 0.15;
    const hm = this.u.uHeatMode;
    hm.value += (this.heatTarget - hm.value) * Math.min(1, dt * 3);
    const fm = this.u.uFocusMode;
    fm.value += (this.focusTarget - fm.value) * Math.min(1, dt * 3);
    if (this.focusSet) { this.follow.copy(this.focusCenter); this.followUntil = this.time + 1; }
    this.u.uLinkFade.value = this.linkFade;
    this.placeLabel();
    this.updateSatellites();
    this.updateArcs();
    this.updateBolts();
    this.composer.render(dt);
    this.countFrame(now);
  }

  // ------------------------------------------------------------------ satellites

  /** One small glowing orb per agent on a slow orbit outside the brain. */
  setAgents(agents: { name: string; color: string }[]) {
    for (const s of this.satellites.values()) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      s.label.remove();
    }
    this.satellites.clear();
    const list = agents.filter((a) => a.name !== 'other');
    list.forEach((a, i) => {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(a.color).multiplyScalar(1.6), transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
      mesh.renderOrder = 4;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      const label = this.overlay('pxo-sat');
      label.style.setProperty('--agent', a.color);
      label.textContent = a.name;
      this.satellites.set(a.name, { mesh, label, base: (i / list.length) * Math.PI * 2, flash: -1e4 });
    });
  }

  private satellitePos(base: number, out: THREE.Vector3) {
    const ang = base + this.time * 0.025;
    const r = this.radius * 1.3;
    return out.set(this.centroid.x + Math.cos(ang) * r, this.centroid.y + Math.sin(ang * 2 + base) * this.radius * 0.12, this.centroid.z + Math.sin(ang) * r);
  }

  private updateSatellites() {
    const v = new THREE.Vector3();
    const p = new THREE.Vector2();
    for (const s of this.satellites.values()) {
      this.satellitePos(s.base, s.mesh.position);
      const pulse = Math.exp(-(this.time - s.flash) * 2.5);
      s.mesh.scale.setScalar(this.radius * (0.011 + 0.012 * pulse));
      v.copy(s.mesh.position).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      s.label.style.display = visible ? 'block' : 'none';
      if (visible) {
        p.set((v.x * 0.5 + 0.5) * this.canvas.clientWidth, (0.5 - v.y * 0.5) * this.canvas.clientHeight);
        s.label.style.left = `${p.x}px`;
        s.label.style.top = `${p.y}px`;
      }
    }
  }

  /** A bridge message: an arc flies from the sender's satellite to the recipient's (or to all). */
  message(from: string, to: string) {
    const src = this.satellites.get(from);
    if (!src) return;
    src.flash = this.time;
    const targets = to === 'all' ? [...this.satellites.entries()].filter(([n]) => n !== from) : [[to, this.satellites.get(to)] as const];
    for (const [, dst] of targets) {
      if (!dst) continue;
      const a = this.satellitePos(src.base, new THREE.Vector3());
      const b = this.satellitePos(dst.base, new THREE.Vector3());
      // Bow the curve outward and up so arcs read as passing around the brain.
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const ctrl = mid.clone().sub(this.centroid).multiplyScalar(0.55).add(this.centroid).add(new THREE.Vector3(0, this.radius * 0.55, 0));
      const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
      const pts = curve.getPoints(64);
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      g.setAttribute('aT', new THREE.BufferAttribute(Float32Array.from(pts, (_, i) => i / (pts.length - 1)), 1));
      const color = (src.mesh.material as THREE.MeshBasicMaterial).color.clone().multiplyScalar(0.8);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: this.u.uTime, uStart: { value: this.time }, uColor: { value: color } },
        vertexShader: GL.ARC_VERT,
        fragmentShader: GL.ARC_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(g, mat);
      line.frustumCulled = false;
      line.renderOrder = 5;
      this.scene.add(line);
      this.arcs.push({ line, born: this.time });
      window.setTimeout(() => { if (dst) dst.flash = this.time; }, 1400);
    }
  }

  private updateArcs() {
    while (this.arcs.length && this.time - this.arcs[0].born > 6.5) {
      const { line } = this.arcs.shift()!;
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
  }

  /**
   * Music: bass hits swell the whole brain slightly; mids and highs (at a fraction of
   * bass sensitivity) fire coloured signals back and forth along the links.
   */
  private applyAudio(dt: number) {
    const u = this.u;
    u.uCenter.value.copy(this.centroid);
    const a = this.audio;
    const lv = a?.reactor.sample(a.delayMs) ?? null;
    const k = a?.strength ?? 0;
    // Only bass moves the brain (swell, glow, bloom); its slider scales all of that.
    const kb = k * (a?.gains.bass ?? 1);
    // Bass hits drive a lightly damped spring: each kick throws the brain outward, it
    // snaps back past its resting size (contracts), then settles. Breathes with the beat.
    const beat = lv?.beat ?? 0;
    if (lv && beat > 0.95 && this.lastBeat < 0.9) this.expandVel += (0.45 + lv.bass * 0.25) * kb;
    this.lastBeat = beat;
    const stiffness = 150, damping = 6;
    const h = Math.min(dt, 1 / 30);
    this.expandVel += (-stiffness * this.expand - damping * this.expandVel) * h;
    this.expand += this.expandVel * h;
    this.expand = Math.max(-0.05, Math.min(0.09, this.expand));
    u.uAudioExpand.value = this.expand;
    u.uAudioBeat.value = beat * kb;
    if (a) a.palette.forEach((c, i) => u.uMusicColors.value[i]?.set(c));
    this.bloom.strength = this.opts.bloomStrength * (this.light ? LIGHT_BLOOM : 1) * (1 + (lv ? lv.beat * 0.6 : 0) * kb);
    (this.nebula.material as THREE.ShaderMaterial).uniforms.uAmount.value = this.opts.nebula * (this.light ? LIGHT_NEBULA : 1) * (1 + (lv?.bass ?? 0) * 0.8 * kb);

    // Light show: spawn rate follows each band's level, scaled by the mid/high sensitivity.
    if (lv && a && this.edgePairs.length) {
      const s = k * a.midHigh;
      this.midAcc += dt * lv.mid * lv.mid * 70 * s * a.gains.mid;
      this.highAcc += dt * lv.high * lv.high * 110 * s * a.gains.high;
      let budget = 10;
      // Mids pick from the first four palette colours, highs from the last four.
      while (this.midAcc >= 1 && budget-- > 0) { this.midAcc -= 1; this.musicPulse(9 + ((Math.random() * 4) | 0), 0.28 + Math.random() * 0.3); }
      while (this.highAcc >= 1 && budget-- > 0) { this.highAcc -= 1; this.musicPulse(13 + ((Math.random() * 4) | 0), 0.14 + Math.random() * 0.16); }
      this.midAcc = Math.min(this.midAcc, 3);
      this.highAcc = Math.min(this.highAcc, 3);
    }
    // Back-and-forth: each signal bounces once back along its link.
    while (this.musicReturns.length && this.musicReturns[0].t <= this.time) {
      const r = this.musicReturns.shift()!;
      this.sink.pulse(r.edge, r.fromA, this.time, r.dur, r.kind);
    }
    this.drawMeter(lv);
  }

  private musicPulse(kind: number, dur: number) {
    const edges = this.edgePairs.length / 2;
    const e = (Math.random() * edges) | 0;
    const fromA = Math.random() < 0.5;
    this.sink.pulse(e, fromA, this.time, dur, kind);
    this.sink.flash(this.edgePairs[e * 2 + (fromA ? 1 : 0)]);
    if (this.musicReturns.length < 400) this.musicReturns.push({ t: this.time + dur, edge: e, fromA: !fromA, dur, kind });
  }

  private drawMeter(lv: { bass: number; mid: number; high: number; beat: number } | null) {
    if (!lv || !this.audio) { if (this.meter) this.meter.setCssStyles({ display: 'none' }); return; }
    if (!this.meter) this.buildMeter();
    this.meter!.setCssStyles({ display: 'block' });
    const bars = this.meter!.querySelectorAll<HTMLElement>('.pxm-bar');
    [lv.bass, lv.mid, lv.high].forEach((v, i) => { bars[i].style.width = `${Math.round(v * 100)}%`; });
    const title = this.meter!.querySelector<HTMLElement>('.pxm-title')!;
    title.style.textShadow = lv.beat > 0.5 ? '0 0 10px #2fd3c9' : 'none';
    const g = this.audio.gains;
    this.meter!.querySelectorAll<HTMLInputElement>('.pxm-gain').forEach((el) => {
      if (el.ownerDocument.activeElement === el) return; // don't fight a drag
      const v = Math.round(g[el.dataset.band as keyof AudioGains] * 100);
      if (el.value !== String(v)) {
        el.value = String(v);
        const pct = el.closest('.pxm-row')?.querySelector<HTMLElement>('.pxm-pct');
        if (pct) pct.textContent = `${v}%`;
      }
    });
  }

  /**
   * The music panel: a level bar per band with a 0-200% slider on it (how much that
   * band drives the brain; only bass pulses it), and the audio source picker.
   */
  private buildMeter() {
    const m = (this.meter = this.overlay('plexus-music'));
    // Keep clicks, drags, wheel and keys inside the panel (not orbiting the brain or
    // triggering the view's single-key shortcuts).
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'dblclick', 'click']) m.addEventListener(ev, (e) => e.stopPropagation());
    m.createDiv({ cls: 'pxm-title', text: '♫ Music' });
    const bands: [keyof AudioGains, string, string][] = [
      ['bass', 'Bass', 'Bass: how hard kicks swell and pulse the brain'],
      ['mid', 'Mids', 'Mids: how many coloured signals mids fire (no pulse)'],
      ['high', 'Highs', 'Highs: how many signals highs fire (no pulse)'],
    ];
    for (const [band, name, tip] of bands) {
      const row = m.createDiv({ cls: 'pxm-row', attr: { title: tip } });
      row.createSpan({ cls: 'pxm-name', text: name });
      const track = row.createSpan({ cls: 'pxm-track' });
      track.createSpan({ cls: 'pxm-bar' });
      const input = track.createEl('input', { cls: 'pxm-gain', attr: { type: 'range', min: '0', max: '200', step: '5', 'aria-label': `${name} effect on the brain` } });
      input.dataset.band = band;
      const pct = row.createSpan({ cls: 'pxm-pct', text: '100%' });
      input.addEventListener('input', () => {
        pct.textContent = `${input.value}%`;
        this.audioControls?.setGain(band, Number(input.value) / 100);
      });
      input.addEventListener('dblclick', () => { input.value = '100'; input.dispatchEvent(new Event('input')); });
    }
    // Kick sensitivity: which low hits count as a pulse (the sliders above set how big).
    const krow = m.createDiv({ cls: 'pxm-row', attr: { title: 'Kick sensitivity: higher catches softer kicks, lower only the hardest' } });
    krow.createSpan({ cls: 'pxm-name', text: 'Kick' });
    const ktrack = krow.createSpan({ cls: 'pxm-track' });
    const kin = ktrack.createEl('input', { cls: 'pxm-sens', attr: { type: 'range', min: '50', max: '200', step: '5', 'aria-label': 'Kick sensitivity' } });
    const kpct = krow.createSpan({ cls: 'pxm-pct' });
    const ks = Math.round((this.audioControls?.sensitivity() ?? 1) * 100);
    kin.value = String(ks);
    kpct.textContent = `${ks}%`;
    kin.addEventListener('input', () => { kpct.textContent = `${kin.value}%`; this.audioControls?.setSensitivity(Number(kin.value) / 100); });
    kin.addEventListener('dblclick', () => { kin.value = '100'; kin.dispatchEvent(new Event('input')); });
    const src = m.createEl('select', { cls: 'pxm-src', attr: { 'aria-label': 'Audio source' } });
    const fill = async () => {
      const list = (await this.audioControls?.sources()) ?? [];
      src.empty();
      // System audio first, then the groups (an option appended after them would sink to the bottom).
      for (const s of list.filter((x) => x.kind === 'system')) src.createEl('option', { text: s.label, value: s.id });
      const groups: Record<AudioSource['kind'], HTMLElement> = {
        system: src,
        input: src.createEl('optgroup', { attr: { label: 'Inputs (mics, Stereo Mix, virtual cables)' } }),
        output: src.createEl('optgroup', { attr: { label: 'Outputs: set as the Windows default to use' } }),
      };
      for (const s of list.filter((x) => x.kind !== 'system')) {
        const o = groups[s.kind].createEl('option', { text: s.label, value: s.id });
        if (s.kind === 'output') o.disabled = true;
      }
      src.value = this.audioControls?.selected() ?? '';
    };
    // Refresh the list when the pointer arrives, never while it's open: rebuilding an
    // open <select> drops the user's pick.
    let filling = false;
    const refresh = () => {
      if (filling || src.ownerDocument.activeElement === src) return;
      filling = true;
      void fill().finally(() => { filling = false; });
    };
    refresh();
    m.addEventListener('mouseenter', refresh);
    src.addEventListener('change', () => this.audioControls?.select(src.value));
    const find = m.createEl('button', { cls: 'pxm-find', text: 'Find sound', attr: { title: 'Play something, then click: listens to every source and switches to the one with sound' } });
    find.addEventListener('click', async () => {
      find.disabled = true;
      find.setText('Listening…');
      const msg = (await this.audioControls?.detect()) ?? '';
      find.disabled = false;
      find.setText('Find sound');
      src.blur();
      refresh();
      m.querySelector<HTMLElement>('.pxm-hint')!.setText(msg || 'Double-click a slider to reset it to 100%.');
    });
    m.createDiv({ cls: 'pxm-hint', text: 'Double-click a slider to reset it to 100%.' });
  }

  /** Lift the agent feed above an overlay docked at the bottom (e.g. the replay bar). */
  setFeedOffset(px: number) {
    this.feed.style.bottom = `${16 + px}px`;
  }

  /** Lightning from an agent's satellite into a note: a bright jagged bolt in the agent's colour. */
  private lightning(agent: string, node: number) {
    const sat = this.satellites.get(agent);
    if (!sat || node < 0 || node >= this.n) return;
    sat.flash = this.time;
    const color = (sat.mesh.material as THREE.MeshBasicMaterial).color.clone().multiplyScalar(2.2);
    // A main bolt plus two thinner forks, re-jagged every frame so it crackles.
    const lines = [1, 0.55, 0.4].map((o) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(33 * 3), 3));
      const m = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(o), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
      const l = new THREE.Line(g, m);
      l.frustumCulled = false;
      l.renderOrder = 6;
      this.scene.add(l);
      return l;
    });
    this.bolts.push({ lines, born: this.time, base: sat.base, node, agent, lastActive: this.time });
    (this.nodes!.geometry.getAttribute('aFire') as THREE.BufferAttribute).setX(node, this.time + 0.25);
    this.dirty.nodes = true;
  }

  private updateBolts() {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      const age = this.time - bolt.born;
      const idle = this.time - bolt.lastActive;
      if (idle > SESSION_GAP + 1.6) {
        for (const l of bolt.lines) { this.scene.remove(l); l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
        this.bolts.splice(i, 1);
        continue;
      }
      const satEntry = [...this.satellites.values()].find((s) => s.base === bolt.base);
      if (satEntry) a.copy(satEntry.mesh.position); else this.satellitePos(bolt.base, a);
      b.set(this.positions[bolt.node * 3], this.positions[bolt.node * 3 + 1], this.positions[bolt.node * 3 + 2]);
      // Grow from the satellite to the note over the first 0.12 s, then crackle and fade.
      const reach = Math.min(1, age / 0.12);
      // Held while the agent is active; fades once it has been quiet for SESSION_GAP.
      const fade = idle < SESSION_GAP ? 1 : Math.max(0, 1 - (idle - SESSION_GAP) / 1.6);
      // Full width for the first second, then slims to a fifth over 0.15 s: tighter
      // jag, forks gone, dimmer glow (so the bloom halo narrows too).
      const slim = age < 1 ? 1 : Math.max(0.2, 1 - ((age - 1) / 0.15) * 0.8);
      dir.subVectors(b, a);
      const len = dir.length();
      p1.set(dir.y, -dir.x, 0.3).normalize();
      p2.crossVectors(dir, p1).normalize();
      bolt.lines.forEach((line, k) => {
        const arr = (line.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
        const amp = len * (k === 0 ? 0.045 : 0.07) * slim;
        for (let s = 0; s <= 32; s++) {
          const t = (s / 32) * reach;
          const env = Math.sin(Math.PI * Math.min(1, t)) * (s === 0 || s === 32 ? 0 : 1);
          const j1 = (Math.random() * 2 - 1) * amp * env, j2 = (Math.random() * 2 - 1) * amp * env;
          arr[s * 3] = a.x + dir.x * t + p1.x * j1 + p2.x * j2;
          arr[s * 3 + 1] = a.y + dir.y * t + p1.y * j1 + p2.y * j2;
          arr[s * 3 + 2] = a.z + dir.z * t + p1.z * j1 + p2.z * j2;
        }
        line.geometry.getAttribute('position').needsUpdate = true;
        // Flicker like real lightning.
        const glow = k === 0 ? slim : slim > 0.99 ? 1 : 0;
        (line.material as THREE.LineBasicMaterial).opacity = fade * glow * (0.55 + Math.random() * 0.45);
      });
    }
  }

  /** Drop every agent glow and trail (used when entering or leaving replay). */
  clearAgentGlow() {
    if (this.nodes) {
      const ai = this.nodes.geometry.getAttribute('aAI') as THREE.BufferAttribute;
      (ai.array as Float32Array).fill(-1e4);
      ai.needsUpdate = true;
    }
    if (this.edges) {
      const tr = this.edges.geometry.getAttribute('aTrail') as THREE.BufferAttribute;
      (tr.array as Float32Array).fill(-1e4);
      tr.needsUpdate = true;
    }
    this.neural?.lastAI.fill(-1);
    this.feed.replaceChildren();
  }

  private countFrame(start: number) {
    const w = this.statWindow;
    const now = performance.now();
    w.frames++;
    w.work += now - start;
    const span = now - w.start;
    if (span < 1000) return;
    const spikes = this.neural?.spikes ?? 0;
    this.liveStats = {
      fps: (w.frames * 1000) / span,
      frameMs: w.work / w.frames,
      spikesPerSec: Math.max(0, ((spikes - w.spikes) * 1000) / span),
      sparksPerSec: ((this.sparkCount - w.sparks) * 1000) / span,
      nodes: this.n,
      links: this.realPairs.length / 2,
      ambient: (this.edgePairs.length - this.realPairs.length) / 2,
      facets: this.triNodes.length / 3,
    };
    this.statWindow = { start: now, frames: 0, work: 0, spikes, sparks: this.sparkCount };
  }

  /** Last full second of render and neuron activity, or null before the first second. */
  stats(): BrainStats | null {
    return this.liveStats;
  }

  private updateCamera(dt: number) {
    const target = this.controls.target;
    const k = 1 - Math.exp(-dt * 0.9);
    const following = this.opts.followAI && this.time < this.followUntil;
    const goal = following ? this.follow : this.centroid;
    this.tmpVec.copy(goal).sub(target).multiplyScalar(k);
    target.add(this.tmpVec);
    this.camera.position.add(this.tmpVec);

    if (this.fit) {
      const offset = this.tmpVec.copy(this.camera.position).sub(target);
      // Fit to the narrower field of view so tall, narrow panes (portrait monitors)
      // pull back enough to show the whole brain and its agent satellites.
      const halfV = THREE.MathUtils.degToRad(this.camera.fov / 2);
      const halfMin = Math.min(halfV, Math.atan(Math.tan(halfV) * this.camera.aspect));
      const fit = Math.max(1.6, (0.8 * 1.3) / Math.tan(halfMin));
      const want = this.radius * fit * (following ? 0.8 : 1);
      offset.setLength(offset.length() + (want - offset.length()) * Math.min(1, k * 2));
      this.camera.position.copy(target).add(offset);
    }
    this.controls.autoRotate = this.opts.autoRotate > 0 && this.time > this.resumeRotateAt;
    this.controls.update(dt);

    const focus = this.camera.position.distanceTo(target);
    this.u.uFocus.value = focus;
    // Light mode is ink on paper: crisp, so depth-of-field is nearly off.
    this.u.uAperture.value = (this.opts.depthBlur * (this.light ? 0.1 : 1)) / (this.radius * 0.85);
    this.u.uFar.value = focus + this.radius * 1.4;
    this.u.uDrift.value = this.opts.drift * this.radius * 0.01;
    this.u.uBaseSize.value = this.radius * 0.0045;

    // Nebula parallax follows the orbit so the clouds feel like they sit in depth.
    const sph = new THREE.Spherical().setFromVector3(this.tmpVec.copy(this.camera.position).sub(target));
    (this.nebula.material as THREE.ShaderMaterial).uniforms.uCam.value.set(sph.theta * 0.35, sph.phi * 0.25);
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.opts.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const hPx = h * pr;
    this.u.uPixelScale.value = hPx / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.u.uMaxBlurPx.value = 24 * (hPx / 1080);
    (this.nebula.material as THREE.ShaderMaterial).uniforms.uRes.value.set(w * pr, hPx);
    this.finish.uniforms.uRes.value.set(w * pr, hPx);
  }

  // ---------------------------------------------------------------- graph build

  private buildNodes() {
    const n = this.n;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    // Unlinked notes become small dim dust; hubs grow with the square root of their links.
    const hub = hubThreshold(n);
    g.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from(this.degree, (d, i) => (d > hub ? 2.6 : this.ownDegree[i] ? 0.7 + 0.45 * Math.min(Math.sqrt(d), 4) : 0.45)), 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    g.setAttribute('aFire', new THREE.BufferAttribute(new Float32Array(n).fill(-1e4), 1));
    g.setAttribute('aAI', new THREE.BufferAttribute(new Float32Array(n).fill(-1e4), 1));
    g.setAttribute('aAICode', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aIdx', new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aDecay', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aFocus', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aAlert', new THREE.BufferAttribute(new Float32Array(n).fill(-1e4), 1));
    g.setAttribute('aBorn', new THREE.BufferAttribute(this.born && this.born.length === n ? this.born.slice() : new Float32Array(n), 1));
    const pts = new THREE.Points(g, this.material(GL.COMMON + GL.COLORS + GL.NODE_VERT, GL.NODE_FRAG));
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    this.nodes = pts;
    this.writeTints();
    return pts;
  }

  // Monochrome like the reference, with a faint hue shift per top-level folder so
  // regions of the vault read as subtly different tissue.
  private writeTints() {
    if (!this.nodes || !this.graph) return;
    const attr = this.nodes.geometry.getAttribute('aTint') as THREE.BufferAttribute;
    const base = new THREE.Color(this.nodeColor());
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    const c = new THREE.Color();
    this.graph.paths.forEach((p, i) => {
      const slash = p.indexOf('/');
      const top = slash > 0 ? p.slice(0, slash) : '';
      c.setHSL(hsl.h + (hashStr(top) - 0.5) * 0.12, hsl.s, hsl.l * (0.75 + 0.5 * this.seeds[i]));
      if (!this.ownDegree[i] && this.degree[i] <= hubThreshold(this.n)) c.multiplyScalar(0.18);
      attr.setXYZ(i, c.r, c.g, c.b);
    });
    attr.needsUpdate = true;
  }

  private rebuildLinks() {
    for (const obj of [this.edges, this.tris]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
    const prox = this.settled && this.opts.plexusLines ? this.proximityPairs() : new Int32Array(0);
    const pairs = new Int32Array(this.realPairs.length + prox.length);
    pairs.set(this.realPairs);
    pairs.set(prox, this.realPairs.length);
    const real = new Uint8Array(pairs.length / 2);
    real.fill(1, 0, this.realPairs.length / 2);
    this.edgePairs = pairs;

    const e = pairs.length / 2;
    const g = new THREE.BufferGeometry();
    // aKind: link brightness weight for real links (index spokes are faint), -1 for ambient lines.
    const hub = hubThreshold(this.n);
    const seed = new Float32Array(e * 2), t = new Float32Array(e * 2), kind = new Float32Array(e * 2);
    const pulse = new Float32Array(e * 6);
    for (let k = 0; k < e; k++) {
      seed[2 * k] = this.seeds[pairs[2 * k]];
      seed[2 * k + 1] = this.seeds[pairs[2 * k + 1]];
      t[2 * k + 1] = 1;
      const m = Math.max(this.degree[pairs[2 * k]], this.degree[pairs[2 * k + 1]]);
      kind[2 * k] = kind[2 * k + 1] = real[k] ? (m > hub ? Math.max(0.006, 12 / m) : 1) : -1;
      pulse.set([-1e4, 1, 1, -1e4, 1, 1], k * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(e * 6), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    g.setAttribute('aPulse', new THREE.BufferAttribute(pulse, 3));
    g.setAttribute('aPulseKind', new THREE.BufferAttribute(new Float32Array(e * 2), 1));
    g.setAttribute('aTrail', new THREE.BufferAttribute(new Float32Array(e * 4).fill(-1e4), 2));
    const focusEdge = new Float32Array(e * 2);
    if (this.focusSet) {
      for (let k = 0; k < e; k++) if (this.focusSet.has(pairs[2 * k]) && this.focusSet.has(pairs[2 * k + 1])) focusEdge[2 * k] = focusEdge[2 * k + 1] = 1;
    }
    g.setAttribute('aFocusEdge', new THREE.BufferAttribute(focusEdge, 1));
    g.setAttribute('aBornEdge', new THREE.BufferAttribute(this.bornEdges(pairs), 1));
    const span = new Float32Array(e * 2), P = this.positions, R = Math.max(1, this.radius);
    for (let k = 0; k < e; k++) {
      const a = pairs[2 * k] * 3, b = pairs[2 * k + 1] * 3;
      span[2 * k] = span[2 * k + 1] = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]) / R;
    }
    g.setAttribute('aSpan', new THREE.BufferAttribute(span, 1));
    this.edges = new THREE.LineSegments(g, this.material(GL.COMMON + GL.COLORS + GL.EDGE_VERT, GL.COLORS + GL.EDGE_FRAG));
    this.edges.frustumCulled = false;
    this.edges.renderOrder = 1;
    this.scene.add(this.edges);

    this.triNodes = this.opts.triangles ? this.findTriangles(pairs) : new Int32Array(0);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.triNodes.length * 3), 3));
    tg.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from(this.triNodes, (i) => this.seeds[i]), 1));
    this.tris = new THREE.Mesh(tg, this.material(GL.COMMON + GL.TRI_VERT, GL.TRI_FRAG));
    (this.tris.material as THREE.Material).side = THREE.DoubleSide;
    this.tris.frustumCulled = false;
    this.scene.add(this.tris);

    this.syncPositions();
    const lastAI = this.neural?.lastAI;
    this.neural = new Neural(this.n, pairs, real, this.positions, this.radius * 0.45, this.sink);
    if (lastAI) this.neural.lastAI.set(lastAI);
    this.neural.activity = this.opts.activity;
  }

  // Ambient "plexus" wiring between spatially close notes. Faint, never used for AI
  // paths, but it gives sparse regions the triangulated look of the reference.
  private proximityPairs(): Int32Array {
    const n = this.n, P = this.positions;
    const spacing = Math.cbrt(((4 / 3) * Math.PI * this.radius ** 3) / Math.max(n, 1));
    const R = spacing * 1.8, R2 = R * R;
    const cells = new Map<number, number[]>();
    const key = (x: number, y: number, z: number) => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
    const cell = (v: number) => Math.floor(v / R);
    for (let i = 0; i < n; i++) {
      const k = key(cell(P[i * 3]), cell(P[i * 3 + 1]), cell(P[i * 3 + 2]));
      const list = cells.get(k);
      if (list) list.push(i); else cells.set(k, [i]);
    }
    const linked = new Set<number>();
    for (let k = 0; k < this.realPairs.length; k += 2) {
      const a = this.realPairs[k], b = this.realPairs[k + 1];
      linked.add(Math.min(a, b) * n + Math.max(a, b));
    }
    const out: number[] = [];
    const best: [number, number][] = [];
    for (let i = 0; i < n && out.length < n * 3; i++) {
      const cx = cell(P[i * 3]), cy = cell(P[i * 3 + 1]), cz = cell(P[i * 3 + 2]);
      best.length = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const list = cells.get(key(cx + dx, cy + dy, cz + dz));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const ddx = P[j * 3] - P[i * 3], ddy = P[j * 3 + 1] - P[i * 3 + 1], ddz = P[j * 3 + 2] - P[i * 3 + 2];
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 < R2) best.push([d2, j]);
        }
      }
      best.sort((a, b) => a[0] - b[0]);
      for (let m = 0; m < Math.min(2, best.length); m++) {
        const j = best[m][1];
        const id = i * n + j;
        if (linked.has(id)) continue;
        linked.add(id);
        out.push(i, j);
      }
    }
    return Int32Array.from(out);
  }

  private findTriangles(pairs: Int32Array): Int32Array {
    const adj: Set<number>[] = Array.from({ length: this.n }, () => new Set());
    for (let k = 0; k < pairs.length; k += 2) { adj[pairs[k]].add(pairs[k + 1]); adj[pairs[k + 1]].add(pairs[k]); }
    const out: number[] = [];
    for (let k = 0; k < pairs.length && out.length < MAX_TRIS * 3; k += 2) {
      const a = Math.min(pairs[k], pairs[k + 1]), b = Math.max(pairs[k], pairs[k + 1]);
      for (const c of adj[a]) if (c > b && adj[b].has(c)) out.push(a, b, c);
    }
    return Int32Array.from(out.slice(0, MAX_TRIS * 3));
  }

  private buildSparks() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    g.setAttribute('aB', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    g.setAttribute('aSeeds', new THREE.BufferAttribute(new Float32Array(SPARKS * 2), 2));
    g.setAttribute('aTiming', new THREE.BufferAttribute(new Float32Array(SPARKS * 2).fill(-1e4), 2));
    g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(SPARKS), 1));
    const pts = new THREE.Points(g, this.material(GL.COMMON + GL.COLORS + GL.SPARK_VERT, GL.SPRITE_FRAG, true));
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    return pts;
  }

  /** additive: pure light (sparks). Otherwise premultiplied "over": rgb adds, alpha occludes. */
  private material(vertexShader: string, fragmentShader: string, additive = false) {
    const m = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    if (additive) {
      m.blending = THREE.AdditiveBlending;
    } else {
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.OneFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    return m;
  }

  private syncPositions() {
    const P = this.positions;
    if (this.nodes) (this.nodes.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    if (this.edges) {
      const attr = this.edges.geometry.getAttribute('position') as THREE.BufferAttribute;
      const out = attr.array as Float32Array, pairs = this.edgePairs;
      for (let v = 0; v < pairs.length; v++) {
        const i = pairs[v] * 3;
        out[v * 3] = P[i]; out[v * 3 + 1] = P[i + 1]; out[v * 3 + 2] = P[i + 2];
      }
      attr.needsUpdate = true;
    }
    if (this.tris && this.triNodes.length) {
      const attr = this.tris.geometry.getAttribute('position') as THREE.BufferAttribute;
      const out = attr.array as Float32Array, ids = this.triNodes;
      for (let v = 0; v < ids.length; v++) {
        const i = ids[v] * 3;
        out[v * 3] = P[i]; out[v * 3 + 1] = P[i + 1]; out[v * 3 + 2] = P[i + 2];
      }
      attr.needsUpdate = true;
    }
  }

  private updateBounds() {
    const n = this.n, P = this.positions;
    if (!n) return;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < n; i++) { x += P[i * 3]; y += P[i * 3 + 1]; z += P[i * 3 + 2]; }
    this.centroid.set(x / n, y / n, z / n);
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dx = P[i * 3] - this.centroid.x, dy = P[i * 3 + 1] - this.centroid.y, dz = P[i * 3 + 2] - this.centroid.z;
      d[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    d.sort();
    this.radius = Math.max(50, d[Math.floor(n * 0.9)]);
  }

  private onLayoutDone() {
    this.settled = true;
    this.layout = null;
    this.updateBounds();
    this.rebuildLinks();
    this.onSettled?.(this.exportPositions());
  }

  private exportPositions(): LayoutCache {
    const out: LayoutCache = {};
    if (!this.graph) return out;
    const P = this.positions, r = (v: number) => Math.round(v * 10) / 10;
    this.graph.paths.forEach((p, i) => { out[p] = [r(P[i * 3]), r(P[i * 3 + 1]), r(P[i * 3 + 2])]; });
    return out;
  }

  private disposeGraph() {
    for (const obj of [this.nodes, this.edges, this.tris]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
    this.nodes = this.edges = this.tris = null;
    this.layout?.dispose();
    this.layout = null;
    this.neural = null;
    this.setHover(-1);
  }

  // ---------------------------------------------------------------- neural sink

  private sink: NeuralSink = {
    pulse: (edge, fromA, start, dur, kind) => {
      if (!this.edges) return;
      const pulse = this.edges.geometry.getAttribute('aPulse') as THREE.BufferAttribute;
      const pk = this.edges.geometry.getAttribute('aPulseKind') as THREE.BufferAttribute;
      const dir = fromA ? 1 : -1;
      pulse.setXYZ(edge * 2, start, dir, dur);
      pulse.setXYZ(edge * 2 + 1, start, dir, dur);
      pk.setX(edge * 2, kind);
      pk.setX(edge * 2 + 1, kind);
      if (kind > 0 && kind <= MAX_AGENTS) {
        const trail = this.edges.geometry.getAttribute('aTrail') as THREE.BufferAttribute;
        trail.setXY(edge * 2, start + dur, kind);
        trail.setXY(edge * 2 + 1, start + dur, kind);
      }
      this.dirty.edges = true;
      const a = this.edgePairs[edge * 2], b = this.edgePairs[edge * 2 + 1];
      this.spark(fromA ? a : b, fromA ? b : a, start, dur, kind);
    },
    beam: (a, b, start, dur, kind) => this.spark(a, b, start, dur, kind),
    flash: (node) => {
      if (!this.nodes) return;
      (this.nodes.geometry.getAttribute('aFire') as THREE.BufferAttribute).setX(node, this.time);
      this.dirty.nodes = true;
    },
    aiMark: (node, slot, mode) => {
      if (!this.nodes || !this.graph) return;
      const g = this.nodes.geometry;
      (g.getAttribute('aAI') as THREE.BufferAttribute).setX(node, this.time);
      (g.getAttribute('aAICode') as THREE.BufferAttribute).setX(node, slot * 4 + mode);
      this.dirty.nodes = true;
      if (mode !== Mode.Scan) {
        this.follow.set(this.positions[node * 3], this.positions[node * 3 + 1], this.positions[node * 3 + 2]);
        this.followUntil = this.time + 25;
        this.addFeed(slot, mode, this.graph.paths[node]);
      }
    },
  };

  private spark(a: number, b: number, start: number, dur: number, kind: number) {
    const g = this.sparks.geometry;
    const s = this.sparkCursor;
    this.sparkCursor = (s + 1) % SPARKS;
    this.sparkCount++;
    const P = this.positions;
    (g.getAttribute('aA') as THREE.BufferAttribute).setXYZ(s, P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
    (g.getAttribute('aB') as THREE.BufferAttribute).setXYZ(s, P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
    (g.getAttribute('aSeeds') as THREE.BufferAttribute).setXY(s, this.seeds[a], this.seeds[b]);
    (g.getAttribute('aTiming') as THREE.BufferAttribute).setXY(s, start, dur);
    (g.getAttribute('aKind') as THREE.BufferAttribute).setX(s, kind);
    this.dirty.sparks = true;
  }

  private flush() {
    if (this.dirty.nodes && this.nodes) {
      const g = this.nodes.geometry;
      for (const name of ['aFire', 'aAI', 'aAICode', 'aAlert']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.dirty.edges && this.edges) {
      const g = this.edges.geometry;
      (g.getAttribute('aPulse') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aPulseKind') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aTrail') as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.dirty.sparks) {
      const g = this.sparks.geometry;
      for (const name of ['aA', 'aB', 'aSeeds', 'aTiming', 'aKind']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    this.dirty.nodes = this.dirty.edges = this.dirty.sparks = false;
  }

  // ---------------------------------------------------------------- overlays

  private agentSlot(name: string) {
    const agents = this.opts.agents.slice(0, MAX_AGENTS);
    const key = name.toLowerCase();
    const i = agents.findIndex((a) => a.name.toLowerCase() === key);
    if (i >= 0) return i;
    const other = agents.findIndex((a) => a.name.toLowerCase() === 'other');
    return other >= 0 ? other : 0;
  }

  private addFeed(slot: number, mode: Mode, path: string) {
    const agent = this.opts.agents[slot];
    const color = agent?.color ?? '#ffffff';
    const name = path.split('/').pop()!.replace(/\.md$/i, '');
    const row = createDiv();
    row.textContent = `${(agent?.name ?? 'agent').toUpperCase()}  ${MODE_LABEL[mode]}  ›  ${name}`;
    row.className = 'pxo-feed-row';
    row.style.setProperty('--agent', color);
    this.feed.appendChild(row);
    while (this.feed.children.length > 7) this.feed.firstElementChild!.remove();
    row.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 0.95, transform: 'none', offset: 0.04 },
        { opacity: 0.7, offset: 0.75 },
        { opacity: 0 },
      ],
      { duration: 16000, easing: 'ease-out', fill: 'forwards' },
    ).onfinish = () => row.remove();
  }

  /** An HTML layer over the canvas; its look lives in styles.css under `cls`. */
  private overlay(cls: string) {
    const el = createDiv({ cls });
    this.container.appendChild(el);
    return el;
  }

  private project(i: number, out: THREE.Vector2): boolean {
    const m = this.tmpMat.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const P = this.positions, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return false;
    out.set(
      ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * this.canvas.clientWidth,
      (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * this.canvas.clientHeight,
    );
    return true;
  }

  // Screen-space pick: cheaper than a raycast for a few thousand points and immune
  // to stale bounding spheres while the layout is still moving.
  private pick() {
    if (!this.n) return;
    const m = this.tmpMat.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, P = this.positions;
    let best = -1, bestD = 14 * 14;
    const born = this.born, reveal = this.u.uReveal.value;
    for (let i = 0; i < this.n; i++) {
      if (born && born[i] > reveal) continue;
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0) continue;
      const dx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * w - this.mouse.x;
      const dy = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5) * h - this.mouse.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    this.setHover(best);
  }

  private setHover(i: number) {
    this.hover = i;
    this.u.uHover.value = i;
    this.canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
    if (i < 0 || !this.graph) { this.label.setCssStyles({ display: 'none' }); this.onHover?.(-1, 0, 0); return; }
    this.label.textContent = this.graph.paths[i].replace(/\.md$/i, '');
    this.label.style.display = this.onHover ? 'none' : 'block';
  }

  private labelPos = new THREE.Vector2();
  private placeLabel() {
    if (this.hover < 0) return;
    if (!this.project(this.hover, this.labelPos)) { this.label.setCssStyles({ display: 'none' }); this.onHover?.(-1, 0, 0); return; }
    // A hover card (if the view provides one) replaces the plain label.
    if (this.onHover) { this.onHover(this.hover, this.labelPos.x, this.labelPos.y); return; }
    this.label.setCssStyles({ display: 'block' });
    this.label.style.left = `${this.labelPos.x}px`;
    this.label.style.top = `${this.labelPos.y}px`;
  }
}
