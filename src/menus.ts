import type { Menu } from 'obsidian';

/**
 * Show an Obsidian menu so it also works in full screen. Obsidian puts menus on the
 * page body, which sits behind an element shown full screen (the brain, the Brain
 * Monitor), so the menu was invisible until you left full screen. While something is
 * full screen, the menu, and any submenu opened from it, is moved inside it.
 */
export function showMenu(menu: Menu, pos: { x: number; y: number }, doc: Document) {
  menu.showAtPosition(pos, doc);
  const fs = doc.fullscreenElement;
  if (!fs) return;
  const adopt = () => {
    for (const el of Array.from(doc.body.querySelectorAll(':scope > .menu'))) if (!fs.contains(el)) fs.appendChild(el);
  };
  adopt();
  const watch = new MutationObserver(adopt);
  watch.observe(doc.body, { childList: true });
  menu.onHide(() => watch.disconnect());
}

export interface MenuEntry { title: string; checked: boolean; run: () => void }

/**
 * A group inside a menu: a real submenu when Obsidian offers one, otherwise a labelled
 * section of the same menu.
 */
export function addGroup(menu: Menu, title: string, icon: string, entries: MenuEntry[]) {
  let sub: Menu | null = null;
  menu.addItem((item) => {
    item.setTitle(title).setIcon(icon);
    const make = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu;
    if (typeof make === 'function') sub = make.call(item);
    else item.setIsLabel(true);
  });
  const target = sub ?? menu;
  for (const e of entries) target.addItem((item) => item.setTitle(e.title).setChecked(e.checked).onClick(e.run));
  if (!sub) menu.addSeparator();
}
