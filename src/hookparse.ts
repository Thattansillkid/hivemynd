// Turns a raw PostToolUse hook payload (Claude Code or Grok Build) into pulse events,
// so the hook itself can be a bare `curl` with no interpreter start-up.

export interface PulseEvent {
  agent?: string;
  kind?: string;
  texts?: unknown;
  purpose?: string; // what the agent was doing, when it says so
  session?: string; // hook session id, used to look up the prompt that started the work
  source?: string; // tool name or bridge route
  readLimit?: number; // lines requested by a ranged read (Claude's Read limit)
  responseChars?: number; // size of a search's output, for the context budget
  before?: string | null; // note text before a write (sent inline by the bridge); null = created
  tokens?: Record<string, number>; // exact tokens delivered per note (context packs)
}

// Claude Code names, Grok Build names, and Obsidian MCP tools under either prefix.
const READ = /^(Read|read_file|view_file|open_file)$|(read_note|read_multiple_notes|get_frontmatter|get_notes_info)$/;
const WRITE = /^(Write|Edit|MultiEdit|NotebookEdit|write_file|create_file|edit_file|search_replace|str_replace\w*)$|(write_note|patch_note|update_frontmatter|manage_tags|move_note|move_file)$/;
const MAX_LINES = 400;

// Every string in the value that mentions a .md file, split into lines and capped.
function collect(value: unknown, out: string[] = []): string[] {
  if (out.length >= MAX_LINES || value == null) return out;
  if (typeof value === 'string') {
    if (!/\.md/i.test(value)) return out;
    for (const line of value.split(/\r?\n/)) {
      if (out.length >= MAX_LINES) break;
      if (/\.md/i.test(line)) out.push(line.length > 600 ? line.slice(0, 600) : line);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collect(v, out);
  } else if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collect(v, out);
  }
  return out;
}

export function hookToEvents(ev: any, agent: string): PulseEvent[] {
  const tool: string = ev.tool_name || ev.toolName || ev.tool || '';
  const session = String(ev.session_id ?? ev.sessionId ?? '');
  const base = { agent, session, source: tool ? `${tool} tool` : 'hook' };
  const input = ev.tool_input ?? ev.toolInput ?? ev.input ?? ev.arguments;
  const inputs = collect(input);
  if (READ.test(tool)) {
    // What was read is the input path; the file's own contents aren't "accessed notes".
    const limit = Number(input?.limit ?? input?.end_line ?? 0) || undefined;
    return inputs.length ? [{ ...base, kind: 'read', texts: inputs, readLimit: limit }] : [];
  }
  if (WRITE.test(tool)) {
    return inputs.length ? [{ ...base, kind: 'write', texts: inputs.slice(0, 20) }] : [];
  }
  // Searches, globs, listings and shell output: every note that surfaced was scanned.
  const response = ev.tool_response ?? ev.toolResponse ?? ev.tool_output ?? ev.output ?? ev.result;
  const texts = [...inputs, ...collect(response)];
  const responseChars = typeof response === 'string' ? response.length : response ? JSON.stringify(response).length : 0;
  return texts.length ? [{ ...base, kind: 'scan', texts, responseChars }] : [];
}

/** The user's request from a UserPromptSubmit hook, cut to one readable line. */
export function promptFromHook(ev: any): { session: string; purpose: string } | null {
  const raw = ev.prompt ?? ev.user_prompt ?? ev.userPrompt ?? ev.message ?? ev.input ?? '';
  // Drop harness-injected blocks (system reminders, hook context) so the purpose is
  // the person's actual words.
  const text = (typeof raw === 'string' ? raw : JSON.stringify(raw))
    .replace(/<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|user-prompt-submit-hook)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/^\s*<[^>]+>\s*$/gm, '');
  const line = text.split(/\r?\n/).map((l: string) => l.trim()).find((l: string) => l.length > 0) ?? '';
  const purpose = line.replace(/\s+/g, ' ').slice(0, 160) + (line.length > 160 ? '…' : '');
  if (!purpose) return null;
  return { session: String(ev.session_id ?? ev.sessionId ?? ''), purpose };
}

const SEARCH = /^(Grep|Glob|grep_search|file_search|find_files|codebase_search)$|(search_notes|search_vault|search)$/i;

/**
 * A vault search that came back empty: the clearest sign of a knowledge gap.
 * Returns the query, or null if this wasn't a vault search or it found something.
 */
export function searchMiss(ev: any, vaultBase: string): { query: string } | null {
  const tool: string = ev.tool_name || ev.toolName || ev.tool || '';
  if (!SEARCH.test(tool)) return null;
  const input = ev.tool_input ?? ev.toolInput ?? ev.input ?? ev.arguments ?? {};
  const isVaultTool = /obsidian|note|vault/i.test(tool);
  const scope = String(input.path ?? input.directory ?? input.target_directory ?? ev.cwd ?? '').replace(/\\/g, '/').toLowerCase();
  const base = vaultBase.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  if (!isVaultTool && !(base && scope.startsWith(base))) return null;
  const r = ev.tool_response ?? ev.toolResponse ?? ev.tool_output ?? ev.output ?? ev.result;
  let empty = false;
  if (r == null) empty = true;
  else if (typeof r === 'string') empty = !r.trim() || /^(\[\]|no (matches|results|files)( found)?\.?)$/i.test(r.trim());
  else if (typeof r === 'object') {
    if (typeof r.numFiles === 'number') empty = r.numFiles === 0 && !String(r.content ?? '').trim();
    else if (Array.isArray(r.filenames)) empty = r.filenames.length === 0;
    else if (Array.isArray(r.content)) empty = r.content.every((c: any) => !String(c?.text ?? '').trim() || /^(\[\]|no results)/i.test(String(c?.text ?? '').trim()));
  }
  if (!empty) return null;
  const query = String(input.pattern ?? input.query ?? input.glob ?? input.q ?? '').slice(0, 200);
  return query ? { query } : null;
}
