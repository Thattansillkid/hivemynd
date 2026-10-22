// Key files for local tools (the bridge) that can't read Obsidian's SecretStorage.
//
// Each vault gets its own folder, ~/.hivemynd/vaults/<vault>-<hash>/, so two vaults
// on one computer never overwrite or find each other's keys. Files are owner-only:
// mode 0600 on macOS/Linux; on Windows inherited permissions are removed and only the
// current user is granted access (icacls), since a POSIX mode means nothing there.

export interface NodeDeps {
  fs: typeof import('fs');
  path: typeof import('path');
  os: typeof import('os');
  execFile: typeof import('child_process').execFile;
  platform: string;
  env: Record<string, string | undefined>;
}

/** Node modules through Obsidian's window.require (desktop only); null on mobile. */
export function nodeDeps(): NodeDeps | null {
  const req = typeof window === 'undefined' ? undefined : (window as unknown as { require?: (m: string) => unknown }).require;
  if (!req) return null;
  try {
    const proc = req('process') as { platform: string; env: Record<string, string | undefined> };
    return {
      fs: req('fs') as NodeDeps['fs'],
      path: req('path') as NodeDeps['path'],
      os: req('os') as NodeDeps['os'],
      execFile: (req('child_process') as typeof import('child_process')).execFile,
      platform: proc.platform,
      env: proc.env,
    };
  } catch { return null; }
}

/** 32-bit FNV-1a, hex: enough to tell vault folders apart, not a security measure. */
export function shortHash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vault';
}

/** This vault's key folder: ~/.hivemynd/vaults/<name>-<hash of its location>. */
export function vaultKeyDir(d: Pick<NodeDeps, 'path' | 'os'>, vaultName: string, vaultPath: string) {
  return d.path.join(d.os.homedir(), '.hivemynd', 'vaults', `${slug(vaultName)}-${shortHash(vaultPath.toLowerCase())}`);
}

/** Writes a secret readable only by the current user. Resolves once permissions are set. */
export async function writeSecretFile(d: NodeDeps, file: string, content: string) {
  d.fs.mkdirSync(d.path.dirname(file), { recursive: true, mode: 0o700 });
  d.fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
  // The mode only applies when the file is created; an existing file keeps its own.
  d.fs.chmodSync(file, 0o600);
  if (d.platform === 'win32') await restrictWindows(d, file);
}

export function removeSecretFile(d: Pick<NodeDeps, 'fs'>, file: string) {
  try { d.fs.rmSync(file, { force: true }); } catch { /* already gone */ }
}

/** Windows: drop inherited ACEs and grant only the current user. */
function restrictWindows(d: NodeDeps, file: string): Promise<void> {
  const user = d.env.USERNAME;
  if (!user) return Promise.reject(new Error('USERNAME is not set'));
  const who = d.env.USERDOMAIN ? `${d.env.USERDOMAIN}\\${user}` : user;
  // A full path, so a stray icacls.exe earlier on PATH is never run.
  const icacls = d.path.join(d.env.SystemRoot || d.env.windir || 'C:\\Windows', 'System32', 'icacls.exe');
  return new Promise((resolve, reject) => {
    d.execFile(icacls, [file, '/inheritance:r', '/grant:r', `${who}:F`], { windowsHide: true }, (err) => (err ? reject(new Error(`icacls failed: ${err.message}`)) : resolve()));
  });
}
