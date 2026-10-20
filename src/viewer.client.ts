import { PlexusRenderer, DEFAULT_OPTIONS, PlexusOptions, TouchMode } from './renderer';

// Read-only brain in a browser (phone, tablet, second screen). Served by the plugin
// when "Web viewer" is on; bundled separately and inlined into main.js as a string.
// It can only look: no note contents, no controls that reach the vault or agents.

interface GraphPayload {
  paths: string[];
  links: [number, number][];
  layoutKey: string;
  positions: Record<string, [number, number, number]> | null;
  options: Partial<PlexusOptions>;
}

const key = new URLSearchParams(location.search).get('key') ?? '';
// Drop the key from the address bar (and from anything copied out of it).
history.replaceState(null, '', location.pathname);
const status = document.getElementById('status')!;
const say = (t: string) => { status.textContent = t; };

async function main() {
  const res = await fetch('graph', { headers: { 'X-Hivemynd-View': key }, cache: 'no-store' });
  if (!res.ok) { say(res.status === 401 ? 'This link has expired or the key is wrong.' : `Couldn't load the brain (${res.status}).`); return; }
  const g: GraphPayload = await res.json();
  const r = new PlexusRenderer(document.getElementById('host')!, { ...DEFAULT_OPTIONS, ...g.options });
  r.setGraph({ paths: g.paths, links: g.links, layoutKey: g.layoutKey }, g.positions);
  say(`${g.paths.length} notes · read-only · live`);
  listen(r);
}

// Live agent activity. Server-sent events carry a header-less request, so the key
// rides in a short-lived ticket instead of the URL.
async function listen(r: PlexusRenderer) {
  const t = await fetch('ticket', { method: 'POST', headers: { 'X-Hivemynd-View': key } }).then((x) => (x.ok ? x.text() : ''), () => '');
  if (!t) { say('Live updates unavailable; retrying…'); setTimeout(() => listen(r), 5000); return; }
  const es = new EventSource(`events?ticket=${encodeURIComponent(t)}`);
  es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data) as { i: number[]; a: string; k: TouchMode };
      r.touch(d.i, d.a, d.k);
    } catch { /* ignore */ }
  };
  es.onerror = () => { es.close(); say('Reconnecting…'); setTimeout(() => listen(r), 3000); };
  es.onopen = () => say(`${status.textContent?.split(' · ')[0]} · read-only · live`);
}

main().catch((err) => say(`Viewer error: ${err}`));
