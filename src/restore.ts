// Undoing an agent's change without losing anything written since.
//
// The restore dialog shows the note as it was when it opened. Restoring checks, inside
// the same atomic update that writes the old text back, that the note still matches
// what was shown; if anyone edited it in between, nothing is replaced and the user is
// asked to review again.

export class RestoreConflict extends Error {
  constructor(readonly path: string) {
    super(`“${path}” changed after the restore was opened`);
  }
}

/** The note operations a restore needs (the plugin passes Obsidian's vault API). */
export interface NoteIO {
  /** Current text, or null when there is no such note. */
  read(path: string): Promise<string | null>;
  /** Atomically replaces the text; `fn` gets the text as it is at that moment and may throw to abort. */
  process(path: string, fn: (current: string) => string): Promise<void>;
  create(path: string, text: string): Promise<void>;
  /** Moves the note to Obsidian's trash (recoverable). */
  trash(path: string): Promise<void>;
}

/**
 * Puts `path` back to `before` (null: the change created the note, so it goes to the
 * trash) if it still reads `expected` (what the user was shown; null: no note).
 * Throws RestoreConflict otherwise.
 */
export async function restoreNote(io: NoteIO, path: string, before: string | null, expected: string | null): Promise<void> {
  const now = await io.read(path);
  if (now !== expected) throw new RestoreConflict(path);
  if (before === null) {
    if (now !== null) await io.trash(path);
    return;
  }
  if (now === null) { await io.create(path, before); return; }
  await io.process(path, (current) => {
    if (current !== expected) throw new RestoreConflict(path);
    return before;
  });
}
