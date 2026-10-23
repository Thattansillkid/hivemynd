import { describe, expect, it } from 'vitest';
import { NoteIO, RestoreConflict, restoreNote } from '../src/restore';
import { prewriteReply } from '../src/server/prewrite';

// Audit 7: a failed check is never an allow in enforcement mode.
describe('prewriteReply', () => {
  const base = { reason: null, replies: true, onError: 'auto' as const, enforcing: false };

  it('allows with an empty 204', () => {
    expect(prewriteReply(base)).toEqual({ status: 204, headers: {}, body: '' });
  });

  it('denies in Claude Code format for agents that read replies, generically otherwise', () => {
    const cc = JSON.parse(prewriteReply({ ...base, reason: 'claimed' }).body);
    expect(cc.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'claimed' });
    expect(JSON.parse(prewriteReply({ ...base, reason: 'claimed', replies: false }).body)).toEqual({ decision: 'deny', reason: 'claimed' });
  });

  it('holds the write back when the check fails while enforcing (auto)', () => {
    const r = prewriteReply({ ...base, error: new Error('EBUSY: snapshot failed'), enforcing: true });
    expect(r.status).toBe(200);
    expect(r.headers['X-Hivemynd-Check']).toBe('failed');
    expect(JSON.parse(r.body).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(r.body).toContain('EBUSY');
  });

  it('holds it back when set to block even if nothing else enforces', () => {
    const r = prewriteReply({ ...base, error: 'boom', onError: 'block', replies: false });
    expect(JSON.parse(r.body)).toMatchObject({ decision: 'deny' });
  });

  it('lets it through in advisory mode, but marked as unchecked', () => {
    for (const r of [prewriteReply({ ...base, error: new Error('x') }), prewriteReply({ ...base, error: new Error('x'), onError: 'allow', enforcing: true })]) {
      expect(r.status).toBe(204);
      expect(r.headers['X-Hivemynd-Check']).toBe('failed');
    }
  });

  it('a failed check never looks exactly like an allowed write', () => {
    const allowed = prewriteReply(base);
    for (const onError of ['auto', 'block', 'allow'] as const) {
      for (const enforcing of [true, false]) {
        expect(prewriteReply({ ...base, error: new Error('x'), onError, enforcing })).not.toEqual(allowed);
      }
    }
  });
});

/** An in-memory vault; `onRead` lets a test edit the note between steps. */
class MemNotes implements NoteIO {
  notes = new Map<string, string>();
  trashed: string[] = [];
  onProcess?: () => void;
  async read(p: string) { return this.notes.get(p) ?? null; }
  async process(p: string, fn: (c: string) => string) {
    this.onProcess?.();
    const cur = this.notes.get(p);
    if (cur === undefined) throw new Error('gone');
    this.notes.set(p, fn(cur));
  }
  async create(p: string, t: string) { this.notes.set(p, t); }
  async trash(p: string) { this.notes.delete(p); this.trashed.push(p); }
}

// Audit 8: an edit made after the restore was opened is preserved.
describe('restoreNote', () => {
  it('restores when the note is as the dialog showed it', async () => {
    const io = new MemNotes();
    io.notes.set('a.md', 'agent text');
    await restoreNote(io, 'a.md', 'original', 'agent text');
    expect(io.notes.get('a.md')).toBe('original');
  });

  it('refuses and keeps the edit when the note changed after the dialog opened', async () => {
    const io = new MemNotes();
    io.notes.set('a.md', 'agent text + my edit');
    await expect(restoreNote(io, 'a.md', 'original', 'agent text')).rejects.toBeInstanceOf(RestoreConflict);
    expect(io.notes.get('a.md')).toBe('agent text + my edit');
  });

  it('refuses when the edit lands between the check and the write', async () => {
    const io = new MemNotes();
    io.notes.set('a.md', 'agent text');
    io.onProcess = () => io.notes.set('a.md', 'agent text + late edit');
    await expect(restoreNote(io, 'a.md', 'original', 'agent text')).rejects.toBeInstanceOf(RestoreConflict);
    expect(io.notes.get('a.md')).toBe('agent text + late edit');
  });

  it('trashes a created note only if it is unchanged', async () => {
    const io = new MemNotes();
    io.notes.set('new.md', 'agent made this');
    await expect(restoreNote(io, 'new.md', null, 'agent made this, then I added')).rejects.toBeInstanceOf(RestoreConflict);
    expect(io.trashed).toEqual([]);
    await restoreNote(io, 'new.md', null, 'agent made this');
    expect(io.trashed).toEqual(['new.md']);
  });

  it('recreates a deleted note, but not over one created since', async () => {
    const io = new MemNotes();
    await restoreNote(io, 'gone.md', 'old text', null);
    expect(io.notes.get('gone.md')).toBe('old text');
    io.notes.set('other.md', 'someone made a new one');
    await expect(restoreNote(io, 'other.md', 'old text', null)).rejects.toBeInstanceOf(RestoreConflict);
    expect(io.notes.get('other.md')).toBe('someone made a new one');
  });
});
