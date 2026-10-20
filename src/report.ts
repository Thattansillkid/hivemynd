import { AccessEntry, clock, noteTitle } from './accesslog';
import { Collision, rereads } from './insights';
import type { SearchMiss } from './main';

// Daily brain report: one readable note per day summarising what the agents did in
// the vault. Plain text, no [[links]], so the report never wires itself into the
// graph or the backlinks of the notes it mentions.

export interface ReportInput {
  day: string; // YYYY-MM-DD
  dayStart: number;
  entries: AccessEntry[]; // that day only
  alerts: Collision[];
  misses: SearchMiss[];
  created: string[]; // notes created that day
  edited: string[]; // notes modified that day (any editor, not just agents)
  graph: { notes: number; links: number };
}

export function buildReport(r: ReportInput): string {
  const out: string[] = [];
  const reads = r.entries.filter((e) => e.action === 'read');
  const writes = r.entries.filter((e) => e.action === 'write');
  const searches = r.entries.filter((e) => e.action === 'search');
  const agents = [...new Set(r.entries.map((e) => e.agent))];
  const touched = new Set<string>();
  for (const e of r.entries) if (e.action !== 'search') e.notes.forEach((p) => touched.add(p));
  const tokens = r.entries.reduce((n, e) => n + (e.tokens ?? 0), 0);
  const kind = (k: Collision['kind']) => r.alerts.filter((a) => a.kind === k).length;

  out.push(`# Brain report ${r.day}`, '');
  out.push(`_Written by H!V3MYND at ${clock(Date.now())}. Plain text on purpose, so this note stays out of the brain._`, '');

  out.push('## At a glance', '');
  if (!r.entries.length) out.push('- No agent activity was logged.');
  else {
    out.push(`- ${r.entries.length} accesses by ${agents.length} agent${agents.length === 1 ? '' : 's'}: ${reads.length} reads, ${writes.length} writes, ${searches.length} searches`);
    out.push(`- ${touched.size} notes touched by agents${tokens ? `, about ${fmtTokens(tokens)} tokens pulled into context` : ''}`);
  }
  out.push(`- ${r.created.length} notes created and ${r.edited.length} edited in the vault (by anyone)`);
  out.push(`- Alerts: ${kind('write-write')} write clashes, ${kind('write-during-read')} stale reads, ${kind('blocked')} blocked by permissions, ${kind('watch')} watchlist hits`);
  out.push(`- Brain size: ${r.graph.notes} notes, ${r.graph.links} links`, '');

  if (agents.length) {
    out.push('## By agent', '', '| Agent | Reads | Writes | Searches | Tokens | First | Last |', '|---|---:|---:|---:|---:|---|---|');
    for (const a of agents.sort()) {
      const mine = r.entries.filter((e) => e.agent === a);
      const n = (act: string) => mine.filter((e) => e.action === act).length;
      const tk = mine.reduce((s, e) => s + (e.tokens ?? 0), 0);
      out.push(`| ${a} | ${n('read')} | ${n('write')} | ${n('search')} | ${tk ? fmtTokens(tk) : ''} | ${clock(mine[0].t)} | ${clock(mine[mine.length - 1].t)} |`);
    }
    out.push('');
  }

  const use = new Map<string, { reads: number; writes: number; agents: Set<string> }>();
  for (const e of r.entries) {
    if (e.action === 'search') continue;
    for (const p of e.notes) {
      const u = use.get(p) ?? { reads: 0, writes: 0, agents: new Set<string>() };
      if (e.action === 'read') u.reads++; else u.writes++;
      u.agents.add(e.agent);
      use.set(p, u);
    }
  }
  const top = [...use].sort((a, b) => (b[1].reads + b[1].writes * 2) - (a[1].reads + a[1].writes * 2)).slice(0, 15);
  if (top.length) {
    out.push('## Most-used notes', '', '| Note | Folder | Reads | Writes | Agents |', '|---|---|---:|---:|---|');
    for (const [p, u] of top) out.push(`| ${cell(noteTitle(p))} | ${cell(folder(p))} | ${u.reads} | ${u.writes} | ${[...u.agents].join(', ')} |`);
    out.push('');
  }

  const written = [...use].filter(([, u]) => u.writes).sort((a, b) => b[1].writes - a[1].writes);
  if (written.length) {
    out.push('## Written by agents', '');
    for (const [p, u] of written.slice(0, 30)) out.push(`- ${noteTitle(p)} (${folder(p) || 'vault root'}): ${u.writes}× by ${[...u.agents].join(', ')}`);
    if (written.length > 30) out.push(`- …and ${written.length - 30} more`);
    out.push('');
  }

  if (r.created.length) {
    out.push('## New notes', '');
    for (const p of r.created.slice(0, 30)) out.push(`- ${noteTitle(p)} (${folder(p) || 'vault root'})`);
    if (r.created.length > 30) out.push(`- …and ${r.created.length - 30} more`);
    out.push('');
  }

  if (r.alerts.length) {
    out.push('## Alerts', '');
    for (const a of r.alerts.slice(-25)) out.push(`- ${clock(a.t)} ${alertText(a)}`);
    out.push('');
  }

  const again = rereads(r.entries, r.dayStart);
  if (again.length) {
    out.push('## Read over and over', '', 'Notes an agent read three or more times. A summary or memory entry could save that context.', '');
    for (const x of again.slice(0, 12)) out.push(`- ${noteTitle(x.path)}: ${x.count}× by ${x.agent}`);
    out.push('');
  }

  if (r.misses.length) {
    const byQ = new Map<string, { q: string; n: number; agents: Set<string> }>();
    for (const m of r.misses) {
      const k = m.query.toLowerCase();
      const c = byQ.get(k) ?? { q: m.query, n: 0, agents: new Set<string>() };
      c.n++; c.agents.add(m.agent); byQ.set(k, c);
    }
    out.push('## Searches that found nothing', '', 'Possible gaps in the vault: agents looked for these and came back empty.', '');
    for (const c of [...byQ.values()].sort((a, b) => b.n - a.n).slice(0, 15)) out.push(`- "${c.q}"${c.n > 1 ? ` ${c.n}×` : ''} (${[...c.agents].join(', ')})`);
    out.push('');
  }

  return out.join('\n');
}

function alertText(a: Collision) {
  const n = a.note ? noteTitle(a.note) : '';
  switch (a.kind) {
    case 'write-write': return `${a.writer} and ${a.other} both edited ${n}`;
    case 'write-during-read': return `${a.writer} edited ${n} while ${a.other} was working from it`;
    case 'blocked': return `${a.writer} was blocked from ${a.action ?? 'an action'}${n ? ` (${n})` : ''}`;
    default: return `${a.writer} ${a.action ?? 'touched'} watched note ${n}`;
  }
}

function folder(p: string) { return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; }
function cell(s: string) { return s.replace(/\|/g, '\\|'); }
function fmtTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n); }
