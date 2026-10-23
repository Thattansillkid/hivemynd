// Regression tests for the gstack-cso re-audit of 1.2.0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanMessage } from '../src/bridgestore';
import { Credential, ownEvent } from '../src/server/auth';
import { inConfigDir, realRelative, resolvesInside, vaultRelative } from '../src/server/pathguard';
import { visibleClaims, visibleEntries, visibleHandoffs, visiblePaths, visibleTasks } from '../src/server/visibility';
import { denyListFor, isDenied } from '../src/server/auth';

const cred = (scope: Credential['scope'], agent: string): Credential => ({ id: agent, label: agent, agent, scope, key: 'k', created: 0 });

// CSO 1: only the bridge may send a note's previous text.
describe('ownEvent', () => {
  const ev = { agent: 'grok', kind: 'write', texts: ['a.md'], before: 'planted text' };

  it('strips before and the agent name for agent and observer keys', () => {
    for (const scope of ['agent', 'observer'] as const) {
      const out = ownEvent(ev, cred(scope, 'claude'));
      expect(out.before).toBeUndefined();
      expect('before' in out).toBe(false);
      expect(out.agent).toBe('claude');
    }
    expect(ev.before).toBe('planted text'); // the request's own object is left alone
  });

  it('keeps them for bridge and admin keys', () => {
    for (const scope of ['bridge', 'admin'] as const) expect(ownEvent(ev, cred(scope, 'x'))).toEqual(ev);
  });

  it('strips before: null too (which would mark the note as created)', () => {
    expect('before' in ownEvent({ agent: 'a', before: null }, cred('agent', 'a'))).toBe(false);
  });
});

// CSO 2: Windows short names and links must not reach the configuration folder.
describe('real path checks', () => {
  let root: string, vault: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hivemynd-cso-'));
    vault = path.join(root, 'Vault');
    fs.mkdirSync(path.join(vault, '.obsidian', 'plugins', 'x'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'Notes'));
    fs.writeFileSync(path.join(vault, '.obsidian', 'plugins', 'x', 'README.md'), 'config');
    fs.writeFileSync(path.join(vault, 'Notes', 'a.md'), 'note');
    try { fs.symlinkSync(path.join(vault, '.obsidian'), path.join(vault, 'cfg'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { /* unsupported */ }
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const rules = () => ({ base: vault, configDir: '.obsidian' });

  it('refuses a short-name path into .obsidian when Windows has short names', () => {
    const short = 'OBSIDI~1/plugins/x/README.md';
    expect(vaultRelative(short, rules())).toBe(short); // looks like an ordinary folder…
    let shortExists = false;
    try { fs.realpathSync.native(path.join(vault, short)); shortExists = true; } catch { /* no 8.3 names on this volume */ }
    if (shortExists) expect(realRelative(fs, vault, short, process.platform)).toBe('.obsidian/plugins/x/readme.md');
    expect(resolvesInside(fs, vault, short, process.platform, '.obsidian')).toBe(false); // …but never qualifies
  });

  it('refuses a link inside the vault that points at .obsidian', () => {
    if (!fs.existsSync(path.join(vault, 'cfg'))) return;
    expect(resolvesInside(fs, vault, 'cfg/plugins/x/README.md', process.platform, '.obsidian')).toBe(false);
  });

  it('resolves a note that does not exist yet through its real folder', () => {
    const real = realRelative(fs, vault, 'Notes/new.md', process.platform);
    expect(real?.toLowerCase()).toBe('notes/new.md');
    expect(inConfigDir(real!, '.obsidian')).toBe(false);
    if (fs.existsSync(path.join(vault, 'cfg'))) expect(inConfigDir(realRelative(fs, vault, 'cfg/new.md', process.platform)!, '.obsidian')).toBe(true);
  });

  it('still accepts an ordinary note', () => {
    expect(resolvesInside(fs, vault, 'Notes/a.md', process.platform, '.obsidian')).toBe(true);
  });
});

// CSO 3: hidden folders stay out of team answers.
describe('team visibility', () => {
  const deny = denyListFor({ claude: { deny: 'Finance' } }, 'claude');
  const hidden = (p: string | undefined | null) => !!p && isDenied(p, deny);

  it('filters claims, handoffs, tasks, gaps and trust', () => {
    expect(visibleClaims([{ path: 'Finance/q3.md' }, { path: 'Notes/a.md' }], hidden)).toEqual([{ path: 'Notes/a.md' }]);
    expect(visibleHandoffs([
      { note: 'Finance/q3.md', trail: [] },
      { note: 'Notes/a.md', trail: ['Finance/budget.md', 'Notes/b.md'] },
    ], hidden)).toEqual([{ note: 'Notes/a.md', trail: ['Notes/b.md'] }]);
    expect(visibleTasks([{ path: 'Finance/x.md' }, {}, { path: 'Notes/a.md' }], hidden)).toEqual([{}, { path: 'Notes/a.md' }]);
    expect(visiblePaths([{ path: 'Finance/x.md' }, { path: undefined }], hidden)).toEqual([{ path: undefined }]);
  });

  it('removes hidden notes from log entries used by handoff packs and the HUD', () => {
    const entries = [
      { agent: 'grok', notes: ['Finance/q3.md'] },
      { agent: 'grok', notes: ['Finance/a.md', 'Notes/b.md'] },
      { agent: 'grok', notes: ['Notes/c.md'] },
    ];
    const out = visibleEntries(entries, hidden);
    expect(out).toEqual([{ agent: 'grok', notes: ['Notes/b.md'] }, entries[2]]);
    expect(JSON.stringify(out)).not.toContain('Finance');
  });
});

// CSO 4: no message escapes retention by its timestamp.
describe('bridge message dates', () => {
  it('clamps timestamps before 2000 so they land in a day file retention sees', () => {
    for (const ts of [-8.64e12, -1, 0, 1]) {
      const m = cleanMessage({ id: 'a', ts }, Date.UTC(2026, 9, 22))!;
      expect(m.t).toBe(Date.UTC(2000, 0, 1));
    }
    expect(cleanMessage({ id: 'a', t: -5 })!.t).toBe(Date.UTC(2000, 0, 1));
  });
});
