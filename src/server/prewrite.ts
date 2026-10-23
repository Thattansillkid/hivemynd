// The answer to an agent's pre-write hook. Three outcomes are kept apart, so a check
// that failed never looks like a write that was allowed:
//
//   allow   204, no body
//   deny    the reason, in Claude Code's PreToolUse format for agents that read hook
//           replies, otherwise as {"decision":"deny","reason"}
//   error   the check itself failed. In enforcing mode it is answered like a deny
//           ("couldn't check"), so the write is held back; in advisory mode the write
//           may go ahead, marked with the X-Hivemynd-Check: failed header.
//
// Whatever the answer, blocking only happens if the agent's hook system honours it.

export type PrewriteOnError = 'auto' | 'block' | 'allow';

export interface PrewriteInput {
  /** The reason to hold the write back, or null to allow it. */
  reason: string | null;
  /** Set when the snapshot or the checks threw. */
  error?: unknown;
  /** Whether this agent reads hook replies (Claude Code's format). */
  replies: boolean;
  onError: PrewriteOnError;
  /** Claims or secret scanning are set to block (what "auto" follows). */
  enforcing: boolean;
}

export interface PrewriteReply { status: number; headers: Record<string, string>; body: string }

const JSON_TYPE = { 'Content-Type': 'application/json; charset=utf-8' };

function deny(reason: string, replies: boolean, extra: Record<string, string> = {}): PrewriteReply {
  const body = replies
    ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
    : { decision: 'deny', reason };
  return { status: 200, headers: { ...JSON_TYPE, ...extra }, body: JSON.stringify(body) };
}

export function prewriteReply(p: PrewriteInput): PrewriteReply {
  if (p.error !== undefined) {
    const block = p.onError === 'block' || (p.onError === 'auto' && p.enforcing);
    const why = p.error instanceof Error ? p.error.message : typeof p.error === 'string' ? p.error : 'unknown error';
    if (block) return deny(`H!V3MYND couldn't check this write (${why.slice(0, 200)}), so it is held back. Try again, or ask the user.`, p.replies, { 'X-Hivemynd-Check': 'failed' });
    return { status: 204, headers: { 'X-Hivemynd-Check': 'failed' }, body: '' };
  }
  if (p.reason) return deny(p.reason, p.replies);
  return { status: 204, headers: {}, body: '' };
}
