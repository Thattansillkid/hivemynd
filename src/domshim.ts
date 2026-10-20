// Obsidian adds small DOM helpers (createDiv, addClass, setCssStyles, ...) to every
// element. The brain renderer uses them, and it also runs in the read-only web viewer,
// a plain browser page without Obsidian. This file adds just the helpers the renderer
// needs, only when they're missing. Imported first by viewer.client.ts; never by the
// plugin itself.

interface ElInfo { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean | null> }

function build<K extends keyof HTMLElementTagNameMap>(tag: K, o?: ElInfo | string, parent?: Node) {
  // eslint-disable-next-line obsidianmd/prefer-create-el -- this shim provides createEl for pages without Obsidian
  const el = document.createElement(tag);
  const info: ElInfo = typeof o === 'string' ? { cls: o } : o ?? {};
  if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
  if (info.text !== undefined) el.textContent = info.text;
  for (const [k, v] of Object.entries(info.attr ?? {})) if (v !== null && v !== false) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

const P = HTMLElement.prototype as unknown as Record<string, unknown>;
const define = (name: string, fn: unknown) => { if (!(name in P)) Object.defineProperty(P, name, { value: fn, configurable: true, writable: true }); };

define('createEl', function (this: HTMLElement, tag: keyof HTMLElementTagNameMap, o?: ElInfo | string) { return build(tag, o, this); });
define('createDiv', function (this: HTMLElement, o?: ElInfo | string) { return build('div', o, this); });
define('createSpan', function (this: HTMLElement, o?: ElInfo | string) { return build('span', o, this); });
define('addClass', function (this: HTMLElement, ...c: string[]) { this.classList.add(...c); });
define('removeClass', function (this: HTMLElement, ...c: string[]) { this.classList.remove(...c); });
define('toggleClass', function (this: HTMLElement, c: string, on: boolean) { this.classList.toggle(c, on); });
define('hasClass', function (this: HTMLElement, c: string) { return this.classList.contains(c); });
define('setText', function (this: HTMLElement, t: string) { this.textContent = t; });
define('empty', function (this: HTMLElement) { this.replaceChildren(); });
define('setCssStyles', function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) { Object.assign(this.style, styles); });
define('setCssProps', function (this: HTMLElement, props: Record<string, string>) { for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v); });

// eslint-disable-next-line obsidianmd/no-global-this -- this shim runs in a plain web page, where the globals are what it provides
const G = globalThis as unknown as Record<string, unknown>;
if (!G.createDiv) G.createDiv = (o?: ElInfo | string) => build('div', o);
if (!G.createEl) G.createEl = (tag: keyof HTMLElementTagNameMap, o?: ElInfo | string) => build(tag, o);

export {};
