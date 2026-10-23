// Paths that arrive in agent events (hook payloads, pulses) are reports, not trusted
// input. Before H!V3MYND reads or snapshots a note named in one, the path must be a
// plain vault-relative Markdown path, and the file it names must really live inside
// the vault: not through "..", not an absolute path elsewhere, not the configuration
// folder, and not a link or junction that leads out.

export interface PathRules {
  /** The vault folder on disk ('' when unknown, e.g. on mobile). */
  base: string;
  /** Obsidian's configuration folder name, normally ".obsidian". */
  configDir: string;
  /** Only accept paths ending in .md (default true). */
  markdownOnly?: boolean;
}

/**
 * The vault-relative form of a path from an event, or null if it isn't one H!V3MYND
 * may touch. Normalises first and checks after, so "a/../.obsidian/x.md" is caught.
 * Absolute paths are accepted only when they lie under the vault folder.
 */
export function vaultRelative(input: string, rules: PathRules): string | null {
  let t = input.trim();
  if (!t || t.length > 1024 || [...t].some((ch) => ch.charCodeAt(0) < 0x20)) return null; // control characters
  t = t.replace(/\\/g, '/');
  // UNC (//server/share) and device paths (//?/, //./) never name a vault note.
  if (t.startsWith('//')) return null;
  const base = rules.base.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[a-z]:\//i.test(t) || t.startsWith('/')) {
    if (!base || !(t.toLowerCase().startsWith(base.toLowerCase() + '/'))) return null;
    t = t.slice(base.length + 1);
  }
  // Drive-relative (C:notes.md) resolves against another folder entirely.
  if (/^[a-z]:/i.test(t)) return null;
  const segs: string[] = [];
  for (const seg of t.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    // ":" means an NTFS stream or a drive; trailing dots and spaces are stripped by
    // Windows, so "notes.md." would name "notes.md" while looking like something else.
    if (seg.includes(':') || /[. ]$/.test(seg)) return null;
    segs.push(seg);
  }
  if (!segs.length) return null;
  if (segs[0].toLowerCase() === rules.configDir.toLowerCase()) return null;
  const rel = segs.join('/');
  if ((rules.markdownOnly ?? true) && !/\.md$/i.test(rel)) return null;
  return rel;
}

export interface FsLike {
  realpathSync: { native(p: string): string };
}

/**
 * Where `rel` really points, as a vault-relative path, once every link, junction and
 * Windows short name (OBSIDI~1) is resolved; null if that is outside the vault. For a
 * path that doesn't exist yet, its deepest existing folder is resolved and the rest
 * appended. Case is folded on Windows and macOS.
 */
export function realRelative(fs: FsLike, base: string, rel: string, platform: string): string | null {
  const norm = (p: string) => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return platform === 'win32' || platform === 'darwin' ? s.toLowerCase() : s;
  };
  let realBase: string;
  try { realBase = norm(fs.realpathSync.native(base)); } catch { return null; }
  const root = base.replace(/[\\/]+$/, '');
  const segs = rel.split('/').filter(Boolean);
  for (let i = segs.length; i >= 0; i--) {
    let real: string;
    try { real = norm(fs.realpathSync.native(i ? `${root}/${segs.slice(0, i).join('/')}` : root)); } catch { continue; }
    const rest = segs.slice(i).map((s) => norm(s));
    if (rest.includes('..')) return null;
    const full = [real, ...rest].join('/');
    return full.startsWith(realBase + '/') ? full.slice(realBase.length + 1) : null;
  }
  return null;
}

/** Whether `rel` really points at the configuration folder or anything in it. */
export function inConfigDir(realRel: string, configDir: string) {
  return realRel.split('/')[0].toLowerCase() === configDir.toLowerCase();
}

/**
 * Whether the existing file `rel` is inside the vault and outside its configuration
 * folder once every link, junction and short name is resolved. A path that doesn't
 * exist (or can't be resolved) is not: callers treat it as a new note and read nothing.
 */
export function resolvesInside(fs: FsLike, base: string, rel: string, platform: string, configDir = '.obsidian'): boolean {
  try { fs.realpathSync.native(`${base.replace(/[\\/]+$/, '')}/${rel}`); } catch { return false; }
  const real = realRelative(fs, base, rel, platform);
  return real !== null && !inConfigDir(real, configDir);
}
