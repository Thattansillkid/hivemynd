import { App, TFile, setIcon } from 'obsidian';
import type { PlexusRenderer } from './renderer';

// Vault growth time-lapse: the brain rebuilds itself note by note in the order the
// notes appeared, links joining as both ends exist. The playhead runs over notes
// (not calendar time) so quiet months don't stall it; the clock shows the date.

const DURATIONS: Record<string, number> = { Slow: 60_000, Normal: 25_000, Fast: 10_000 };

export interface GrowthHost {
  renderer(): PlexusRenderer | null;
  paths(): string[];
}

export class GrowthBar {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private clockEl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private order: number[] = []; // note indices, oldest first
  private times: number[] = []; // birth time of order[k]
  private head = 0; // 0..1 along the order
  private playing = false;
  private raf: number | null = null;
  private last = 0;
  private duration = DURATIONS.Normal;
  private dragging = false;

  constructor(parent: HTMLElement, private app: App, private host: GrowthHost) {
    this.el = parent.createDiv({ cls: 'plexus-replay plexus-growth' });
    this.el.style.display = 'none';
    const controls = this.el.createDiv({ cls: 'plexus-replay-controls' });
    const title = controls.createDiv({ cls: 'plexus-replay-title' });
    setIcon(title.createSpan(), 'sprout');
    title.createSpan({ text: 'Growth' });
    this.playBtn = this.btn(controls, 'pause', 'Play / pause (space)', () => this.toggle());
    this.btn(controls, 'skip-back', 'Start over', () => { this.seek(0); if (!this.playing) this.toggle(); });
    const speed = controls.createEl('select', { cls: 'plexus-replay-select', attr: { 'aria-label': 'Speed' } });
    for (const k of Object.keys(DURATIONS)) speed.createEl('option', { text: k, value: k });
    speed.value = 'Normal';
    speed.addEventListener('change', () => { this.duration = DURATIONS[speed.value]; });
    this.clockEl = controls.createDiv({ cls: 'plexus-replay-clock' });
    const live = controls.createEl('button', { cls: 'plexus-replay-live', text: '● Back to now' });
    live.addEventListener('click', () => this.close());

    this.canvas = this.el.createEl('canvas', { cls: 'plexus-replay-track' });
    this.canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.canvas.setPointerCapture(e.pointerId); this.scrub(e.offsetX); });
    this.canvas.addEventListener('pointermove', (e) => { if (this.dragging) this.scrub(e.offsetX); });
    this.canvas.addEventListener('pointerup', () => { this.dragging = false; });
  }

  get open() { return this.el.style.display !== 'none'; }

  toggleOpen() { if (this.open) this.close(); else this.openBar(); }

  /** Space plays/pauses, Esc closes, arrows step. True when the key was used. */
  handleKey(e: KeyboardEvent) {
    if (!this.open) return false;
    if (e.key === ' ') { e.preventDefault(); this.toggle(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.seek(this.head + (e.key === 'ArrowRight' ? 0.02 : -0.02)); return true; }
    return false;
  }

  private openBar() {
    const r = this.host.renderer();
    if (!r) return;
    const paths = this.host.paths();
    const born = paths.map((p, i) => ({ i, t: this.birth(p) }));
    born.sort((a, b) => a.t - b.t || a.i - b.i);
    this.order = born.map((b) => b.i);
    this.times = born.map((b) => b.t);
    const rank = new Float32Array(paths.length);
    const n = Math.max(1, born.length - 1);
    born.forEach((b, k) => { rank[b.i] = k / n; });
    r.setGrowth(rank);
    this.el.style.display = 'block';
    r.setFeedOffset(this.el.offsetHeight + 24);
    this.seek(0);
    this.playing = false;
    this.toggle();
  }

  close() {
    this.stop();
    this.el.style.display = 'none';
    const r = this.host.renderer();
    r?.setGrowth(null);
    r?.setFeedOffset(0);
  }

  /** When a note entered the vault: a created/date property if it has one, else the
   *  earlier of the file's created and modified times (copies reset "created"). */
  private birth(path: string) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return Date.now();
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    for (const k of ['created', 'date', 'created_at', 'createdAt']) {
      const v = fm?.[k];
      const t = typeof v === 'string' || typeof v === 'number' ? new Date(v).getTime() : NaN;
      if (t > 0 && t <= Date.now()) return t;
    }
    return Math.min(f.stat.ctime || Infinity, f.stat.mtime || Infinity, Date.now());
  }

  private toggle() {
    this.playing = !this.playing;
    setIcon(this.playBtn, this.playing ? 'pause' : 'play');
    if (!this.playing) { this.stop(); return; }
    if (this.head >= 1) this.seek(0);
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing) return;
      this.seek(this.head + (now - this.last) / this.duration);
      this.last = now;
      if (this.head >= 1) { this.playing = false; setIcon(this.playBtn, 'play'); return; }
      this.raf = window.requestAnimationFrame(tick);
    };
    this.raf = window.requestAnimationFrame(tick);
  }

  private stop() {
    this.playing = false;
    if (this.raf !== null) window.cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private scrub(x: number) {
    if (this.playing) this.toggle();
    this.seek(x / Math.max(1, this.canvas.clientWidth));
  }

  private seek(h: number) {
    this.head = Math.min(1, Math.max(0, h));
    this.host.renderer()?.setReveal(this.head);
    const k = Math.min(this.order.length - 1, Math.floor(this.head * (this.order.length - 1)));
    const t = this.times[k];
    this.clockEl.setText(t ? `${new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · ${k + 1} of ${this.order.length} notes` : '');
    this.draw();
  }

  /** Notes per month along the playhead axis, plus year marks and the playhead. */
  private draw() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const n = this.times.length;
    if (!n) return;
    // Cumulative curve: notes (x) against time (y), so bursts show as flat steps.
    const t0 = this.times[0], t1 = this.times[n - 1] || t0 + 1;
    g.strokeStyle = 'rgba(47, 211, 201, 0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const t = this.times[Math.min(n - 1, Math.floor((x / w) * (n - 1)))];
      const y = h - 8 - ((t - t0) / Math.max(1, t1 - t0)) * (h - 16);
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(143, 179, 176, 0.8)';
    g.font = '10px var(--font-interface, sans-serif)';
    let year = -1;
    for (let x = 0; x <= w; x += 4) {
      const y = new Date(this.times[Math.min(n - 1, Math.floor((x / w) * (n - 1)))]).getFullYear();
      if (y !== year) { if (year !== -1) { g.fillRect(x, h - 6, 1, 6); g.fillText(String(y), x + 3, h - 1); } year = y; }
    }
    const px = this.head * w;
    g.fillStyle = '#5fe8ff';
    g.fillRect(px - 1, 0, 2, h);
  }

  private btn(parent: HTMLElement, icon: string, label: string, onClick: () => void) {
    const b = parent.createEl('button', { cls: 'plexus-replay-btn', attr: { 'aria-label': label } });
    setIcon(b, icon);
    b.addEventListener('click', onClick);
    return b;
  }
}
