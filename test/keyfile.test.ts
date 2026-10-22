import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeDeps, removeSecretFile, shortHash, slug, vaultKeyDir, writeSecretFile } from '../src/server/keyfile';
import { nvidiaSmiPath } from '../src/trustedexec';

let tmp: string;
let deps: NodeDeps;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hivemynd-keys-'));
  deps = { fs, path, os: { ...os, homedir: () => tmp } as typeof os, execFile, platform: process.platform, env: process.env };
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('vaultKeyDir', () => {
  // Audit 10: separate vaults must not share one key file.
  it('gives two vaults with the same name different folders', () => {
    const a = vaultKeyDir(deps, 'Notes', 'C:\\Users\\a\\Notes');
    const b = vaultKeyDir(deps, 'Notes', 'D:\\Backup\\Notes');
    expect(a).not.toBe(b);
    expect(a.startsWith(path.join(tmp, '.hivemynd', 'vaults'))).toBe(true);
  });
  it('is stable and path-safe', () => {
    expect(vaultKeyDir(deps, 'My Vault!', '/x')).toBe(vaultKeyDir(deps, 'My Vault!', '/X'));
    expect(slug('../../etc')).toBe('etc');
    expect(shortHash('a')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('writeSecretFile', () => {
  it('writes the key and makes it owner-only', async () => {
    const file = path.join(vaultKeyDir(deps, 'v', '/v'), 'bridge-1.key');
    await writeSecretFile(deps, file, 'secret');
    expect(fs.readFileSync(file, 'utf8')).toBe('secret');
    if (process.platform === 'win32') {
      // Audit 10: on Windows a POSIX mode means nothing; the ACL must name only this user.
      const acl = await new Promise<string>((r, j) => execFile('icacls', [file], (e, out) => (e ? j(e) : r(out))));
      expect(acl).toContain(process.env.USERNAME!);
      expect(acl).not.toMatch(/\(I\)/); // no inherited entries
      expect(acl).not.toMatch(/BUILTIN\\Users|Everyone/i);
    } else {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('tightens a file that already existed with loose permissions', async () => {
    const file = path.join(tmp, 'k.key');
    fs.writeFileSync(file, 'old', { mode: 0o644 });
    await writeSecretFile(deps, file, 'new');
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
  });

  it('removes files quietly', () => {
    const file = path.join(tmp, 'gone.key');
    fs.writeFileSync(file, 'x');
    removeSecretFile(deps, file);
    removeSecretFile(deps, file);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('nvidiaSmiPath', () => {
  // Audit 10: the GPU tool is run by full path, never looked up on PATH.
  it('only returns a known install location', () => {
    const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' };
    expect(nvidiaSmiPath('win32', env, (p) => p === 'C:\\Windows\\System32\\nvidia-smi.exe')).toBe('C:\\Windows\\System32\\nvidia-smi.exe');
    expect(nvidiaSmiPath('win32', env, () => false)).toBeNull();
    expect(nvidiaSmiPath('linux', {}, (p) => p === '/usr/bin/nvidia-smi')).toBe('/usr/bin/nvidia-smi');
    expect(nvidiaSmiPath('linux', {}, (p) => p === 'nvidia-smi')).toBeNull();
  });
});
