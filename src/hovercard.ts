import { App, TFile } from 'obsidian';
import { AccessLog, noteTitle } from './accesslog';

// Preview card for the note under the pointer in the brain: title, folder, a short
// excerpt, link counts and the last agent that touched it.

export class HoverCard {
  readonly el: HTMLElement;
  private shown = -1;
  private token = 0;

  constructor(parent: HTMLElement, private app: App, private log: () => AccessLog, private linkCounts: (path: string) => { out: number; in: number }, private agentColor: (a: string) => string) {
    this.el = parent.createDiv({ cls: 'plexus-card' });
    this.el.setCssStyles({ display: 'none' });
  }

  /** Called every frame with the hovered note (or -1) and its screen position. */
  update(path: string | null, index: number, x: number, y: number) {
    if (!path || index < 0) { this.el.setCssStyles({ display: 'none' }); this.shown = -1; return; }
    if (index !== this.shown) { this.shown = index; void this.fill(path); }
    this.el.setCssStyles({ display: 'block' });
    // Keep the card on-screen: flip left/up near the edges.
    const pw = this.el.parentElement?.clientWidth ?? 0, ph = this.el.parentElement?.clientHeight ?? 0;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const left = x + 18 + w > pw ? x - 18 - w : x + 18;
    const top = Math.min(Math.max(8, y - h / 2), ph - h - 8);
    this.el.style.left = `${Math.max(8, left)}px`;
    this.el.style.top = `${top}px`;
  }

  private async fill(path: string) {
    const my = ++this.token;
    this.el.empty();
    this.el.createDiv({ cls: 'plexus-card-title', text: noteTitle(path) });
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) this.el.createDiv({ cls: 'plexus-card-folder', text: folder });
    const excerpt = this.el.createDiv({ cls: 'plexus-card-excerpt', text: '…' });
    const { out, in: inn } = this.linkCounts(path);
    const meta = this.el.createDiv({ cls: 'plexus-card-meta' });
    meta.createSpan({ text: `${out} links out · ${inn} in` });
    const last = [...this.log().entries].reverse().find((e) => e.notes.includes(path));
    if (last) {
      const who = meta.createSpan({ cls: 'plexus-card-agent' });
      who.style.color = this.agentColor(last.agent);
      who.setText(`${last.agent} ${last.action} ${ago(Date.now() - last.t)}`);
    }
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) { excerpt.setText(''); return; }
    const text = await this.app.vault.cachedRead(f);
    if (my !== this.token) return;
    // Skip frontmatter by Obsidian's own parse (handles CRLF); regex as a fallback.
    const fmEnd = this.app.metadataCache.getFileCache(f)?.frontmatterPosition?.end.offset;
    const body = (fmEnd ? text.slice(fmEnd) : text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''))
      .replace(/^---\s*/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/https?:\/\/\S+/g, '').replace(/[#>*_`[\]]+/g, '').replace(/\s+/g, ' ').trim();
    excerpt.setText(body ? body.slice(0, 220) + (body.length > 220 ? '…' : '') : '(empty note)');
  }
}

function ago(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
