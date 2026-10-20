import { App, TFile, prepareFuzzySearch, setIcon } from 'obsidian';

// Search box overlaid on the brain: matches light up (task-focus style), the camera
// flies to the best match, arrows move through results, Enter opens the note.

export interface SearchHost {
  paths(): string[];
  focus(indices: number[] | null): void;
  fly(index: number): void;
  open(path: string): void;
}

interface Doc { i: number; title: string; path: string; extra: string }

export class BrainSearch {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private docs: Doc[] = [];
  private results: Doc[] = [];
  private sel = 0;
  private timer: number | null = null;

  constructor(parent: HTMLElement, private app: App, private host: SearchHost) {
    this.el = parent.createDiv({ cls: 'plexus-search' });
    this.el.setCssStyles({ display: 'none' });
    const row = this.el.createDiv({ cls: 'plexus-search-row' });
    setIcon(row.createSpan({ cls: 'plexus-search-icon' }), 'search');
    this.input = row.createEl('input', { cls: 'plexus-search-input', attr: { type: 'text', placeholder: 'Search notes, #tags, aliases…', spellcheck: 'false' } });
    this.list = this.el.createDiv({ cls: 'plexus-search-list' });
    this.input.addEventListener('input', () => {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.run(), 70);
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep F / H / R shortcuts out of the text box
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = this.results[this.sel]; if (r) this.host.open(r.path); }
    });
  }

  get open() { return this.el.style.display !== 'none'; }

  show() {
    this.index();
    this.el.setCssStyles({ display: 'block' });
    this.input.focus();
    this.input.select();
    if (this.input.value) this.run();
  }

  close() {
    this.el.setCssStyles({ display: 'none' });
    this.host.focus(null);
  }

  /** Titles, folders, aliases and tags; rebuilt on open so new notes are included. */
  private index() {
    const byPath = new Map(this.host.paths().map((p, i) => [p, i]));
    this.docs = [];
    for (const [path, i] of byPath) {
      const f = this.app.vault.getAbstractFileByPath(path);
      const cache = f instanceof TFile ? this.app.metadataCache.getFileCache(f) : null;
      const aliases = cache?.frontmatter?.aliases;
      const tags = [...(cache?.tags ?? []).map((t) => t.tag), ...([] as string[]).concat(cache?.frontmatter?.tags ?? []).map((t) => `#${String(t).replace(/^#/, '')}`)];
      this.docs.push({
        i,
        path,
        title: path.split('/').pop()!.replace(/\.md$/i, ''),
        extra: `${path} ${Array.isArray(aliases) ? aliases.join(' ') : aliases ?? ''} ${tags.join(' ')}`,
      });
    }
  }

  private run() {
    const q = this.input.value.trim();
    this.list.empty();
    if (!q) { this.results = []; this.host.focus(null); return; }
    const fuzzy = prepareFuzzySearch(q);
    const scored: { d: Doc; s: number }[] = [];
    for (const d of this.docs) {
      const t = fuzzy(d.title);
      const x = t ? null : fuzzy(d.extra);
      const s = t ? t.score + 2 : x ? x.score : null;
      if (s !== null) scored.push({ d, s });
    }
    scored.sort((a, b) => b.s - a.s);
    this.results = scored.slice(0, 60).map((x) => x.d);
    this.sel = 0;
    this.host.focus(this.results.length ? this.results.map((r) => r.i) : null);
    if (this.results[0]) this.host.fly(this.results[0].i);
    if (!this.results.length) { this.list.createDiv({ cls: 'plexus-search-empty', text: 'No matching notes' }); return; }
    this.results.slice(0, 8).forEach((r, k) => {
      const item = this.list.createDiv({ cls: `plexus-search-item${k === 0 ? ' is-sel' : ''}` });
      item.createDiv({ cls: 'plexus-search-title', text: r.title });
      const folder = r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '';
      if (folder) item.createDiv({ cls: 'plexus-search-folder', text: folder });
      item.addEventListener('mouseenter', () => { this.sel = k; this.paintSel(); this.host.fly(r.i); });
      item.addEventListener('click', () => this.host.open(r.path));
    });
    if (this.results.length > 8) this.list.createDiv({ cls: 'plexus-search-more', text: `+${this.results.length - 8} more lit in the brain` });
  }

  private move(d: number) {
    const n = Math.min(8, this.results.length);
    if (!n) return;
    this.sel = (this.sel + d + n) % n;
    this.paintSel();
    this.host.fly(this.results[this.sel].i);
  }

  private paintSel() {
    this.list.querySelectorAll('.plexus-search-item').forEach((el, k) => el.toggleClass('is-sel', k === this.sel));
  }
}
