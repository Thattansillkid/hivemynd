import { ItemView, MarkdownRenderer } from 'obsidian';
import MANUAL from '../MANUAL.md';

// The user manual (MANUAL.md in the repository), compiled into main.js so every
// install has it, offline and matching the installed version.

export const MANUAL_VIEW_TYPE = 'hivemynd-manual';

/** GitHub-style heading anchor: "3. The brain" -> "3-the-brain". */
function slug(text: string) {
  return text.trim().toLowerCase().replace(/[^\w\- ]+/g, '').replace(/ /g, '-');
}

export class ManualView extends ItemView {
  getViewType() { return MANUAL_VIEW_TYPE; }
  getDisplayText() { return 'Hivemynd user manual'; }
  getIcon() { return 'book-open'; }

  async onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass('hivemynd-manual');
    const page = el.createDiv({ cls: 'hivemynd-manual-page markdown-rendered' });
    await MarkdownRenderer.render(this.app, MANUAL, page, '', this);
    // Links in the contents point at the manual's own headings: scroll to them here
    // instead of letting Obsidian look for a note of that name.
    this.registerDomEvent(page, 'click', (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      const href = a?.getAttribute('data-href') ?? a?.getAttribute('href') ?? '';
      if (!href.startsWith('#')) return;
      e.preventDefault();
      e.stopPropagation();
      const want = href.slice(1).toLowerCase();
      const heading = Array.from(page.querySelectorAll('h1, h2, h3')).find((h) => slug(h.textContent ?? '') === want);
      heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, true);
  }

  async onClose() {
    this.contentEl.empty();
  }
}
