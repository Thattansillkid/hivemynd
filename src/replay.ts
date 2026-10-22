import { setIcon } from 'obsidian';
import { AccessEntry, noteTitle } from './accesslog';
import type { PlexusRenderer, TouchMode } from './renderer';

// Time scrubber for the brain: replays logged agent access in the 3D view.
// Dragging jumps to a moment (rebuilding the last two minutes of glow there);
// playing advances at 1×–600× real time, firing each entry as the playhead passes.

const RANGES: Record<string, number> = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 };
const SPEEDS = [1, 10, 60, 300, 1200];
const CONTEXT_MS = 120_000;

export interface ReplayHost {
  renderer(): PlexusRenderer | null;
  history(days: number): Promise<AccessEntry[]>;
  indexOf(path: string): number;
  setReplaying(on: boolean): void;
}

export class ReplayBar {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private clockEl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private entries: AccessEntry[] = [];
  private range = '24h';
  private speed = 60;
  private start = 0;
  private end = 0;
  private head = 0;
  private playing = false;
  private timer: number | null = null;
  private lastTick = 0;
  private dragging = false;
  private rangeSelect!: HTMLSelectElement;
  /** One agent only ('' = all), and a chosen calendar day for the "Pick a day" range. */
  private agent = '';
  private agentSelect!: HTMLSelectElement;
  private dayInput!: HTMLInputElement;

  constructor(parent: HTMLElement, private host: ReplayHost) {
    this.el = parent.createDiv({ cls: 'plexus-replay' });
    this.el.setCssStyles({ display: 'none' });
    const controls = this.el.createDiv({ cls: 'plexus-replay-controls' });
    const title = controls.createDiv({ cls: 'plexus-replay-title' });
    setIcon(title.createSpan(), 'history');
    title.createSpan({ text: 'Replay' });
    this.playBtn = this.btn(controls, 'pause', 'Play / pause (space)', () => this.toggle());
    this.btn(controls, 'skip-back', 'Jump to start of range', () => this.seek(this.start));
    const speed = controls.createEl('select', { cls: 'plexus-replay-select', attr: { 'aria-label': 'Speed' } });
    for (const s of SPEEDS) speed.createEl('option', { text: `${s}×`, value: String(s) });
    speed.value = String(this.speed);
    speed.addEventListener('change', () => { this.speed = Number(speed.value); });
    const range = (this.rangeSelect = controls.createEl('select', { cls: 'plexus-replay-select', attr: { 'aria-label': 'Range' } }));
    for (const r of Object.keys(RANGES)) range.createEl('option', { text: `Last ${r}`, value: r });
    range.createEl('option', { text: 'Pick a day', value: 'day' });
    range.value = this.range;
    range.addEventListener('change', () => { this.range = range.value; this.dayInput.toggle(this.range === 'day'); void this.load(); });
    // A single day: watch one agent's (or every agent's) actions from that day.
    this.dayInput = controls.createEl('input', { cls: 'plexus-replay-select', attr: { type: 'date', 'aria-label': 'Day to replay' } });
    this.dayInput.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    this.dayInput.toggle(false);
    this.dayInput.addEventListener('change', () => void this.load());
    this.agentSelect = controls.createEl('select', { cls: 'plexus-replay-select', attr: { 'aria-label': 'Agent' } });
    this.agentSelect.createEl('option', { text: 'All agents', value: '' });
    this.agentSelect.addEventListener('change', () => { this.agent = this.agentSelect.value; void this.load(); });
    this.clockEl = controls.createDiv({ cls: 'plexus-replay-clock' });
    const live = controls.createEl('button', { cls: 'plexus-replay-live', text: '● Back to live' });
    live.addEventListener('click', () => this.close());

    this.canvas = this.el.createEl('canvas', { cls: 'plexus-replay-track' });
    this.canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.canvas.setPointerCapture(e.pointerId); this.scrubTo(e.offsetX); });
    this.canvas.addEventListener('pointermove', (e) => { if (this.dragging) this.scrubTo(e.offsetX); });
    this.canvas.addEventListener('pointerup', () => { this.dragging = false; });
  }

  get open() { return this.el.style.display !== 'none'; }

  async toggleOpen() {
    if (this.open) this.close();
    else await this.openBar();
  }

  private async openBar() {
    this.el.setCssStyles({ display: 'block' });
    this.host.setReplaying(true);
    this.host.renderer()?.setFeedOffset(this.el.offsetHeight + 24);
    // Open on the smallest range that holds the last day's activity.
    const recent = (await this.host.history(8)).map((e) => e.t);
    const oldest = recent.length ? Math.min(...recent) : Date.now();
    this.range = Object.keys(RANGES).find((r) => Date.now() - RANGES[r] <= oldest) ?? '7d';
    this.rangeSelect.value = this.range;
    this.dayInput.toggle(false);
    await this.load();
    this.play();
  }

  close() {
    this.pause();
    this.el.setCssStyles({ display: 'none' });
    this.host.renderer()?.setFeedOffset(0);
    this.host.setReplaying(false);
    this.host.renderer()?.clearAgentGlow();
  }

  handleKey(e: KeyboardEvent) {
    if (!this.open) return false;
    if (e.key === ' ') { e.preventDefault(); this.toggle(); return true; }
    if (e.key === 'Escape') { this.close(); return true; }
    return false;
  }

  private async load() {
    let days: number;
    if (this.range === 'day') {
      const [y, m, d] = (this.dayInput.value || '').split('-').map(Number);
      const start = y ? new Date(y, m - 1, d).getTime() : new Date(new Date().toDateString()).getTime();
      this.start = start;
      this.end = Math.min(Date.now(), start + 86_400_000);
      days = Math.ceil((Date.now() - start) / 86_400_000) + 1;
    } else {
      this.end = Date.now();
      this.start = this.end - RANGES[this.range];
      days = Math.ceil(RANGES[this.range] / 86_400_000) + 1;
    }
    const all = (await this.host.history(days)).filter((e) => e.t >= this.start && e.t <= this.end);
    // Agent picker: everyone seen in this range (keep the current choice if still there).
    const seen = [...new Set(all.map((e) => e.agent))].sort();
    this.agentSelect.empty();
    this.agentSelect.createEl('option', { text: 'All agents', value: '' });
    for (const a of seen) this.agentSelect.createEl('option', { text: a, value: a });
    if (this.agent && !seen.includes(this.agent)) this.agent = '';
    this.agentSelect.value = this.agent;
    this.entries = all.filter((e) => !this.agent || e.agent === this.agent).sort((a, b) => a.t - b.t);
    // Start where the activity starts, not hours of silence before it.
    this.seek(this.entries.length ? Math.max(this.start, this.entries[0].t - 30_000) : this.start);
  }

  private toggle() { if (this.playing) this.pause(); else this.play(); }

  private play() {
    this.playing = true;
    setIcon(this.playBtn, 'pause');
    this.lastTick = performance.now();
    this.timer ??= window.setInterval(() => this.tick(), 50);
  }

  private pause() {
    this.playing = false;
    setIcon(this.playBtn, 'play');
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (!this.playing) return;
    const next = Math.min(this.end, this.head + dt * this.speed);
    this.fire(this.head, next);
    this.head = next;
    if (this.head >= this.end) this.pause();
    this.draw();
  }

  private scrubTo(x: number) {
    const w = this.canvas.clientWidth;
    this.seek(this.start + Math.min(1, Math.max(0, x / w)) * (this.end - this.start));
  }

  /** Jump: clear the brain, then rebuild the last couple of minutes of glow at once. */
  private seek(t: number) {
    this.head = t;
    this.host.renderer()?.clearAgentGlow();
    this.fire(t - CONTEXT_MS, t);
    this.draw();
  }

  private fire(from: number, to: number) {
    const r = this.host.renderer();
    if (!r) return;
    for (const e of this.entries) {
      if (e.t <= from) continue;
      if (e.t > to) break;
      const idx = e.notes.map((n) => this.host.indexOf(n)).filter((i) => i >= 0);
      if (!idx.length) continue;
      const mode: TouchMode = e.action === 'search' ? 'scan' : e.action;
      r.touch(idx, e.agent, mode);
    }
  }

  private draw() {
    const win = this.canvas.ownerDocument.defaultView ?? window;
    const dpr = win.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const span = this.end - this.start || 1;
    const x = (t: number) => ((t - this.start) / span) * w;

    // Activity density: one bar per bucket, single cyan hue (magnitude, not identity).
    const buckets = Math.max(20, Math.floor(w / 4));
    const counts = new Array(buckets).fill(0);
    for (const e of this.entries) counts[Math.min(buckets - 1, Math.floor(((e.t - this.start) / span) * buckets))]++;
    const max = Math.max(1, ...counts);
    const bw = w / buckets;
    const baseY = h - 14;
    counts.forEach((c, i) => {
      if (!c) return;
      const bh = Math.max(2, (c / max) * (baseY - 4));
      ctx.fillStyle = i * bw <= x(this.head) ? 'rgba(47, 211, 201, 0.85)' : 'rgba(47, 211, 201, 0.35)';
      ctx.fillRect(i * bw + 0.5, baseY - bh, Math.max(1, bw - 1), bh);
    });
    ctx.strokeStyle = 'rgba(47, 211, 201, 0.25)';
    ctx.beginPath(); ctx.moveTo(0, baseY + 0.5); ctx.lineTo(w, baseY + 0.5); ctx.stroke();

    // Axis labels at range start, middle, end.
    ctx.fillStyle = '#8fb3b0';
    ctx.font = '11px var(--font-interface, system-ui, sans-serif)';
    ctx.textBaseline = 'bottom';
    const fmt = (t: number) => new Date(t).toLocaleString([], this.range === '7d' ? { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false });
    ctx.textAlign = 'left'; ctx.fillText(fmt(this.start), 2, h);
    ctx.textAlign = 'center'; ctx.fillText(fmt(this.start + span / 2), w / 2, h);
    ctx.textAlign = 'right'; ctx.fillText(fmt(this.end), w - 2, h);

    // Playhead.
    const px = x(this.head);
    ctx.strokeStyle = '#e4f8f6';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, baseY); ctx.stroke();
    ctx.fillStyle = '#e4f8f6';
    ctx.beginPath(); ctx.arc(px, 4, 4, 0, Math.PI * 2); ctx.fill();

    const d = new Date(this.head);
    const next = this.entries.find((e) => e.t > this.head);
    this.clockEl.setText(`${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString([], { hour12: false })}${next ? `  ·  next: ${next.agent} ${next.action} ${noteTitle(next.notes[0])}` : ''}`);
  }

  private btn(parent: HTMLElement, icon: string, label: string, onClick: () => void) {
    const b = parent.createEl('button', { cls: 'plexus-replay-btn', attr: { 'aria-label': label, title: label } });
    setIcon(b, icon);
    b.addEventListener('click', onClick);
    return b;
  }
}
