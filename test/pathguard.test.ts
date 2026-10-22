import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvesInside, vaultRelative } from '../src/server/pathguard';

const WIN = { base: 'C:\\Users\\me\\Vault', configDir: '.obsidian' };
const POSIX = { base: '/home/me/Vault', configDir: '.obsidian' };

describe('vaultRelative', () => {
  it('accepts plain vault paths and normalises them', () => {
    expect(vaultRelative('Projects/Plan.md', WIN)).toBe('Projects/Plan.md');
    expect(vaultRelative('  Projects\\Sub\\Plan.md ', WIN)).toBe('Projects/Sub/Plan.md');
    expect(vaultRelative('./Projects//Plan.md', WIN)).toBe('Projects/Plan.md');
    expect(vaultRelative('C:/Users/me/Vault/Projects/Plan.md', WIN)).toBe('Projects/Plan.md');
    expect(vaultRelative('c:\\users\\ME\\vault\\a.md', WIN)).toBe('a.md');
    expect(vaultRelative('/home/me/Vault/a.md', POSIX)).toBe('a.md');
  });

  // Audit 5 fixtures.
  it('rejects parent-directory traversal however it is spelled', () => {
    for (const p of ['../outside.md', 'Projects/../../outside.md', '..\\outside.md', 'a/./../../x.md', 'C:/Users/me/Vault/../secrets.md', '/home/me/Vault/../x.md']) {
      expect(vaultRelative(p, p.startsWith('/') ? POSIX : WIN), p).toBeNull();
    }
  });

  it('rejects paths that normalise into the configuration folder', () => {
    for (const p of ['.obsidian/plugins/x.md', './.obsidian/a.md', '.OBSIDIAN/a.md', 'C:/Users/me/Vault/.obsidian/a.md', '.obsidian\\a.md']) {
      expect(vaultRelative(p, WIN), p).toBeNull();
    }
    // A note inside a folder merely named like it is fine.
    expect(vaultRelative('notes/.obsidian/a.md', WIN)).toBe('notes/.obsidian/a.md');
  });

  it('rejects absolute paths outside the vault, drive-relative, UNC and device paths', () => {
    for (const p of ['C:/Windows/win.ini.md', 'D:\\Vault\\a.md', 'C:a.md', 'c:notes\\a.md', '\\\\server\\share\\a.md', '//server/share/a.md', '\\\\?\\C:\\Users\\me\\Vault\\a.md', '\\\\.\\pipe\\x.md', '/etc/passwd.md', 'C:/Users/me/VaultX/a.md']) {
      expect(vaultRelative(p, WIN), p).toBeNull();
    }
    expect(vaultRelative('/etc/a.md', { base: '', configDir: '.obsidian' })).toBeNull();
  });

  it('rejects streams, Windows-trimmed names, control characters and non-Markdown', () => {
    for (const p of ['a.md:secret', 'a.md::$DATA', 'notes.md.', 'folder./a.md', 'folder /a.md', 'a\0.md', 'a\n.md', 'a.txt', 'a.md.bak', '', '   ', '.', '/', 'x'.repeat(1100) + '.md']) {
      expect(vaultRelative(p, WIN), JSON.stringify(p.slice(0, 40))).toBeNull();
    }
    expect(vaultRelative('Canvas.canvas', { ...WIN, markdownOnly: false })).toBe('Canvas.canvas');
  });
});

// Audit 5: links and junctions pointing outside the vault.
describe('resolvesInside (real files)', () => {
  let root: string, vault: string, outside: string;
  const linked: string[] = [];

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hivemynd-paths-'));
    vault = path.join(root, 'Vault');
    outside = path.join(root, 'Outside');
    fs.mkdirSync(path.join(vault, 'Notes'), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(vault, 'Notes', 'inside.md'), 'inside');
    fs.writeFileSync(path.join(outside, 'secret.md'), 'outside secret');
    // A junction (Windows, no admin needed) or symlink (elsewhere) to a folder outside.
    try { fs.symlinkSync(outside, path.join(vault, 'Linked'), process.platform === 'win32' ? 'junction' : 'dir'); linked.push('Linked'); } catch { /* unsupported */ }
    // A file symlink (needs Developer Mode or admin on Windows; skipped if refused).
    try { fs.symlinkSync(path.join(outside, 'secret.md'), path.join(vault, 'Notes', 'link.md'), 'file'); linked.push('Notes/link.md'); } catch { /* not permitted */ }
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const inside = (rel: string) => resolvesInside(fs, vault, rel, process.platform);

  it('accepts a real note inside the vault', () => {
    expect(inside('Notes/inside.md')).toBe(true);
  });

  it('refuses a folder junction or symlink that leads outside', () => {
    expect(linked).toContain('Linked');
    expect(vaultRelative('Linked/secret.md', { base: vault, configDir: '.obsidian' })).toBe('Linked/secret.md'); // looks fine…
    expect(inside('Linked/secret.md')).toBe(false); // …but isn't inside
  });

  it('refuses a file symlink that leads outside (when the OS allows creating one)', () => {
    if (!linked.includes('Notes/link.md')) return;
    expect(inside('Notes/link.md')).toBe(false);
  });

  it('treats missing files and traversal as not inside', () => {
    expect(inside('Notes/missing.md')).toBe(false);
    expect(inside('../Outside/secret.md')).toBe(false);
  });

  it('does not confuse a sibling folder that shares a prefix', () => {
    const sib = path.join(root, 'Vault2');
    fs.mkdirSync(sib);
    fs.writeFileSync(path.join(sib, 'x.md'), 'x');
    expect(resolvesInside(fs, vault, '../Vault2/x.md', process.platform)).toBe(false);
  });
});
