import { Menu, setIcon } from 'obsidian';

// Modular Brain Monitor: every overview card is a panel on a snap grid. Drag a panel
// by its header to move it (the others flow out of the way and float back up), drag
// its corner to resize, hide it with ×, bring it back from the Panels menu. The
// layout is saved. Narrow windows fall back to one column, where dragging is off.

export interface PanelPos { id: string; x: number; y: number; w: number; h: number; hidden?: boolean }
export interface PanelDef { id: string; title: string; el: HTMLElement; minW?: number; minH?: number }

export const COLS = 24;
const GAP_PX = 12;
const NARROW_PX = 900;
// Rows stretch to fill the window (fit to height) within these limits; beyond them
// the grid scrolls instead of squashing or ballooning.
const MIN_ROW_PX = 24;
const MAX_ROW_PX = 72;
/** Bump when the default changes enough that old saved layouts should be dropped. */
export const LAYOUT_VERSION = 2;

// Default: the access log takes the wide centre column; agent cards on the left,
// numbers on the right. 20 rows tall, so it fits a laptop screen and a 4K monitor.
export const DEFAULT_LAYOUT: PanelPos[] = [
  { id: 'status', x: 0, y: 0, w: 6, h: 6 },
  { id: 'alerts', x: 0, y: 6, w: 6, h: 5 },
  { id: 'agents', x: 0, y: 11, w: 6, h: 4 },
  { id: 'hot', x: 0, y: 15, w: 6, h: 5 },
  { id: 'log', x: 6, y: 0, w: 12, h: 20 },
  { id: 'sys', x: 18, y: 0, w: 6, h: 6 },
  { id: 'brain', x: 18, y: 6, w: 6, h: 6 },
  { id: 'budget', x: 18, y: 12, w: 6, h: 8 },
];

export class Dashboard {
  private pos = new Map<string, PanelPos>();
  private defs = new Map<string, PanelDef>();
  private ghost: HTMLElement;
  private rowPx = 36;
  private resizeObs: ResizeObserver;
  locked = false;

  constructor(private grid: HTMLElement, panels: PanelDef[], saved: PanelPos[] | null, private onChange: (layout: PanelPos[]) => void) {
    grid.addClass('pm-dash');
    this.ghost = grid.createDiv({ cls: 'pm-dash-ghost' });
    this.ghost.style.display = 'none';
    for (const d of panels) this.defs.set(d.id, d);
    // Saved positions win; panels added in later versions get their default slot.
    for (const p of [...(saved ?? []), ...DEFAULT_LAYOUT]) {
      if (this.defs.has(p.id) && !this.pos.has(p.id)) this.pos.set(p.id, { ...p });
    }
    for (const d of panels) {
      if (!this.pos.has(d.id)) this.pos.set(d.id, { id: d.id, x: 0, y: 999, w: 6, h: 8 });
      this.decorate(d);
    }
    this.settle(null);
    this.apply();
    // Popped out, resized or full screen: rows re-fit the new height.
    const win = grid.ownerDocument.defaultView ?? window;
    this.resizeObs = new win.ResizeObserver(() => this.fit());
    this.resizeObs.observe(grid);
  }

  destroy() { this.resizeObs.disconnect(); }

  /** Row height so the whole layout fills the window's height. */
  private fit() {
    if (this.narrow()) { this.grid.style.gridAutoRows = ''; return; }
    const rows = Math.max(1, ...[...this.pos.values()].filter((p) => !p.hidden).map((p) => p.y + p.h));
    const cs = getComputedStyle(this.grid);
    const inner = this.grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const px = Math.floor((inner - GAP_PX * (rows - 1)) / rows);
    this.rowPx = Math.max(MIN_ROW_PX, Math.min(MAX_ROW_PX, px));
    this.grid.style.gridAutoRows = `${this.rowPx}px`;
  }

  layout(): PanelPos[] { return [...this.pos.values()].map((p) => ({ ...p })); }

  reset() {
    this.pos.clear();
    for (const p of DEFAULT_LAYOUT) if (this.defs.has(p.id)) this.pos.set(p.id, { ...p });
    this.settle(null);
    this.apply();
    this.onChange(this.layout());
  }

  setHidden(id: string, hidden: boolean) {
    const p = this.pos.get(id);
    if (!p) return;
    p.hidden = hidden;
    if (!hidden) p.y = 999; // reappears at the bottom; gravity pulls it up
    this.settle(null);
    this.apply();
    this.onChange(this.layout());
  }

  /** The Panels menu: show/hide each panel, lock, reset. */
  menu(e: MouseEvent) {
    const m = new Menu();
    for (const d of this.defs.values()) {
      const p = this.pos.get(d.id)!;
      m.addItem((i) => i.setTitle(d.title).setChecked(!p.hidden).onClick(() => this.setHidden(d.id, !p.hidden)));
    }
    m.addSeparator();
    m.addItem((i) => i.setTitle(this.locked ? 'Unlock layout' : 'Lock layout').setIcon(this.locked ? 'unlock' : 'lock').onClick(() => {
      this.locked = !this.locked;
      this.grid.toggleClass('is-locked', this.locked);
    }));
    m.addItem((i) => i.setTitle('Reset layout').setIcon('rotate-ccw').onClick(() => this.reset()));
    m.showAtMouseEvent(e);
  }

  private narrow() { return this.grid.clientWidth < NARROW_PX; }

  private decorate(d: PanelDef) {
    d.el.addClass('pm-panel');
    const head = d.el.querySelector<HTMLElement>('.pm-card-head');
    if (head) {
      head.addClass('pm-drag');
      const close = head.createEl('button', { cls: 'pm-panel-x', attr: { 'aria-label': `Hide ${d.title}` } });
      setIcon(close, 'x');
      close.addEventListener('click', (e) => { e.stopPropagation(); this.setHidden(d.id, true); });
      head.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select')) return;
        this.drag(d.id, e, 'move');
      });
    }
    const grip = d.el.createDiv({ cls: 'pm-resize', attr: { 'aria-label': 'Resize' } });
    grip.addEventListener('pointerdown', (e) => { if (e.button === 0) this.drag(d.id, e, 'resize'); });
  }

  /** Grid cell size in px (column width includes its gap). */
  private cell() {
    const cs = getComputedStyle(this.grid);
    const inner = this.grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { cw: (inner + GAP_PX) / COLS, rh: this.rowPx + GAP_PX, left: parseFloat(cs.paddingLeft), top: parseFloat(cs.paddingTop) };
  }

  private drag(id: string, e: PointerEvent, mode: 'move' | 'resize') {
    if (this.locked || this.narrow()) return;
    const p = this.pos.get(id)!;
    const def = this.defs.get(id)!;
    const el = def.el;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const { cw, rh } = this.cell();
    const start = { x: e.clientX, y: e.clientY, px: p.x, py: p.y, pw: p.w, ph: p.h };
    el.addClass('is-dragging');
    this.grid.addClass('is-dragging-any'); // hold row height steady mid-drag
    this.ghost.style.display = '';
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - start.x) / cw);
      const dy = Math.round((ev.clientY - start.y) / rh);
      if (mode === 'move') {
        p.x = clamp(start.px + dx, 0, COLS - p.w);
        p.y = Math.max(0, start.py + dy);
        el.style.transform = `translate(${ev.clientX - start.x - (p.x - start.px) * cw}px, ${ev.clientY - start.y - (p.y - start.py) * rh}px)`;
      } else {
        p.w = clamp(start.pw + dx, def.minW ?? 3, COLS - p.x);
        p.h = Math.max(def.minH ?? 4, start.ph + dy);
      }
      this.settle(p);
      this.apply();
    };
    const up = () => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeClass('is-dragging');
      this.grid.removeClass('is-dragging-any');
      el.style.transform = '';
      this.ghost.style.display = 'none';
      this.settle(null);
      this.apply();
      this.fit();
      this.onChange(this.layout());
      // Charts and lists size themselves from their box.
      this.grid.ownerDocument.defaultView?.dispatchEvent(new Event('resize'));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /**
   * Gravity layout: the pinned panel (being dragged) stays put; every other panel,
   * top to bottom, takes the highest free spot in its columns.
   */
  private settle(pinned: PanelPos | null) {
    const placed: PanelPos[] = pinned ? [pinned] : [];
    const rest = [...this.pos.values()].filter((p) => !p.hidden && p !== pinned).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const p of rest) {
      p.x = clamp(p.x, 0, COLS - Math.min(p.w, COLS));
      p.w = Math.min(p.w, COLS);
      let y = 0;
      while (placed.some((q) => overlap(p, q, y))) y++;
      p.y = y;
      placed.push(p);
    }
  }

  private apply() {
    if (!this.grid.hasClass('is-dragging-any')) this.fit();
    for (const [id, p] of this.pos) {
      const el = this.defs.get(id)!.el;
      el.style.display = p.hidden ? 'none' : '';
      el.style.gridColumn = `${p.x + 1} / span ${p.w}`;
      el.style.gridRow = `${p.y + 1} / span ${p.h}`;
    }
    const dragging = [...this.defs.values()].find((d) => d.el.hasClass('is-dragging'));
    if (dragging) {
      const p = this.pos.get(dragging.id)!;
      this.ghost.style.gridColumn = `${p.x + 1} / span ${p.w}`;
      this.ghost.style.gridRow = `${p.y + 1} / span ${p.h}`;
    }
  }
}

function overlap(a: PanelPos, b: PanelPos, ay: number) {
  return a.x < b.x + b.w && b.x < a.x + a.w && ay < b.y + b.h && b.y < ay + a.h;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
