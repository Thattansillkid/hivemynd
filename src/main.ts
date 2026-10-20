import { App, FileSystemAdapter, ItemView, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, debounce, normalizePath, setIcon } from 'obsidian';
import { PlexusRenderer, PlexusOptions, DEFAULT_OPTIONS, AudioControls, AudioSource, GraphInput, LayoutCache, TouchMode } from './renderer';
import { PathResolver } from './resolver';
import { hookToEvents, promptFromHook, PulseEvent, searchMiss } from './hookparse';
import { AccessAction, AccessEntry, AccessLog, dayKey, noteTitle } from './accesslog';
import { buildReport } from './report';
import { buildPack, Pack } from './contextpack';
import { Collision, detectCollision, isSynthetic, foldHistory, heatAndDecay, linkSuggestions, parseWatchlist, rereads, taskGroups, tokensForBytes, watchMatch } from './insights';
import { ChangeRecord, ChangeStore } from './changes';
import { BrainSearch } from './brainsearch';
import { HoverCard } from './hovercard';
import { GrowthBar } from './growth';
import { WelcomeModal, connectSection } from './onboarding';
import { PhoneAlerts, PhoneFormat, randomTopic } from './phone';
import { WebViewer } from './webviewer';
import { meaningLinks } from './semantic';
import { ReplayBar } from './replay';
import { AudioReactor, SYSTEM_AUDIO } from './audio';


export interface BridgeMessage {
  id: string;
  sender: string;
  recipient: string;
  body: string;
  reply_to: string | null;
  t: number;
  important: boolean;
}
import { AccessLogView, BudgetRange, GraphInfo, LOG_VIEW_TYPE } from './logview';
import { LAYOUT_VERSION, PanelPos } from './dashboard';
import { Monitor } from './monitor';
import { hubThreshold } from './layout';

const VIEW_TYPE = 'plexus-graph-view';
const LAYOUT_FILE = 'layout.json';

interface PlexusSettings extends PlexusOptions {
  bridge: boolean;
  port: number;
  exclude: string;
  showOrphans: boolean;
  digest: boolean;
  digestFolder: string;
  /** Write a summary note for each day with agent activity (into <digestFolder>/Reports). */
  dailyReport: boolean;
  /** Lay the brain out by what notes are about instead of by links. */
  meaningMap: boolean;
  /** Brain Monitor panel positions (null = default) and context-budget range. */
  monitorLayout: PanelPos[] | null;
  monitorLayoutVersion: number;
  budgetRange: BudgetRange;
  /** Light theme for the brain view and for the Brain Monitor (each has its own toggle). */
  brainLight: boolean;
  monitorLight: boolean;
  /** Phone alerts (off by default): see phone.ts. */
  phoneAlerts: boolean;
  phoneUrl: string;
  phoneFormat: PhoneFormat;
  phoneClashes: boolean;
  phoneBlocked: boolean;
  phoneWatch: boolean;
  phoneHideNames: boolean;
  /** Read-only web viewer (off by default): see webviewer.ts. */
  webViewer: boolean;
  webViewerLan: boolean;
  webViewerPort: number;
  viewerKey: string;
  logSearches: boolean;
  agentAliases: string;
  listenerKey: string;
  /** Per-agent permissions, enforced by the bridge (written to policyFile). */
  policies: Record<string, AgentPolicy>;
  /** Master switch: off = the bridge applies no per-agent rules (protected paths still apply). */
  enforcePermissions: boolean;
  /** PC control for agents without their own rule. */
  defaultPcControl: PcMode;
  /** Keep what each agent was asked to do (its prompt) in the access log. */
  storePurposes: boolean;
  /** Extra listener endpoints for tooling and debugging (view remote control, audio probes, reload). */
  developerMode: boolean;
  /** The first-run welcome has been shown. */
  welcomed: boolean;
  /** Where the bridge reads policies from; empty = permissions not in use. */
  policyFile: string;
  watchlist: string;
  watchNotify: boolean;
  audioDevice: string;
  musicStrength: number;
  musicDelay: number;
  musicMidHigh: number;
  /** Music panel sliders: how much each band drives the brain (1 = 100%). */
  musicBassGain: number;
  musicMidGain: number;
  musicHighGain: number;
  musicPalette: string;
  musicBassCutoff: number;
  musicBassSensitivity: number;
}

// Light-show palettes: first four colours for mids, last four for highs.
export const MUSIC_PALETTES: Record<string, string[]> = {
  Neon: ['#1f8bff', '#8a5bff', '#00e5ff', '#ff2bd6', '#fff3c4', '#ffd000', '#ff5e9c', '#4dffb8'],
  Aurora: ['#00ffa3', '#00c2ff', '#7a5cff', '#2bffea', '#e8fff8', '#b8ff3d', '#ff8af0', '#8cf7ff'],
  Fire: ['#ff3b1f', '#ff7a00', '#ff2e63', '#ffb000', '#fff1c1', '#ffe14d', '#ff9ec7', '#ffd6a8'],
  Ice: ['#2f8bff', '#5ac8ff', '#a6b8ff', '#00e0ff', '#ffffff', '#d6f3ff', '#b3a6ff', '#9ff9ff'],
};

export interface SearchMiss { t: number; agent: string; query: string }

/** PC control through the bridge: allowed, asked each time (a person approves), or blocked. */
export type PcMode = 'allow' | 'ask' | 'block';
export interface AgentPolicy { deny: string; readOnly: boolean; pcControl: PcMode | boolean }
/** Older settings stored PC control as true/false. */
export function pcModeOf(p: AgentPolicy | undefined, fallback: PcMode): PcMode {
  const v = p?.pcControl;
  if (v === true || v === 'allow') return 'allow';
  if (v === false || v === 'block') return 'block';
  if (v === 'ask') return 'ask';
  return fallback;
}

const DEFAULT_SETTINGS: PlexusSettings = {
  ...DEFAULT_OPTIONS,
  bridge: true,
  port: 27183,
  exclude: '',
  showOrphans: true,
  digest: true,
  digestFolder: 'Access Log',
  dailyReport: true,
  meaningMap: false,
  monitorLayout: null,
  monitorLayoutVersion: 0,
  budgetRange: 'day',
  brainLight: false,
  monitorLight: false,
  phoneAlerts: false,
  phoneUrl: '',
  phoneFormat: 'ntfy',
  phoneClashes: true,
  phoneBlocked: true,
  phoneWatch: false,
  phoneHideNames: false,
  webViewer: false,
  webViewerLan: false,
  webViewerPort: 27184,
  viewerKey: '',
  logSearches: true,
  agentAliases: '',
  listenerKey: '',
  policies: {},
  enforcePermissions: true,
  defaultPcControl: 'ask',
  storePurposes: true,
  developerMode: false,
  welcomed: false,
  policyFile: '',
  watchlist: [
    '# One folder or note path per line. Add ": read, write, search" to choose what alerts (default: read, write).',
  ].join('\n'),
  watchNotify: true,
  audioDevice: '',
  musicStrength: 1,
  musicDelay: 0,
  musicMidHigh: 0.5, // mids & highs respond at half the sensitivity of bass
  musicBassGain: 1,
  musicMidGain: 1,
  musicHighGain: 1,
  musicPalette: 'Neon',
  musicBassCutoff: 80, // the brain pulses on every low hit at or below this frequency
  musicBassSensitivity: 1,
};

const PURPOSE_TTL = 6 * 3600_000; // a prompt explains an agent's note access for up to 6 h

interface BuiltGraph extends GraphInput { resolver: PathResolver }


export default class PlexusPlugin extends Plugin {
  settings: PlexusSettings = DEFAULT_SETTINGS;
  private graph: BuiltGraph | null = null;
  private signature = '';
  private server: any = null;
  // Grok also runs Claude's hooks, so one Grok tool call can arrive twice under two names.
  private recent = new Map<string, { agent: string; at: number }>();
  // Exposed on GET /health so agent wiring can be checked against what actually lit.
  private stats = { pulses: 0, lit: 0, last: null as null | { at: string; agent: string; kind: string; notes: string[] } };
  log!: AccessLog;
  monitor!: Monitor;
  // Latest user prompt per agent session (and per agent as a fallback), so each
  // access can say what it was for.
  private purposes = new Map<string, { text: string; at: number }>();
  /** Two agents editing (or editing what another just read) the same note. Newest last. */
  alerts: Collision[] = [];
  private alertListeners = new Set<(c: Collision) => void>();
  heatOn = false;
  private heatTimer: number | null = null;
  changes!: ChangeStore;
  // Note text captured just before an agent's write (from PreToolUse hooks), by path.
  private pendingBefore = new Map<string, { text: string | null; t: number }>();
  bridgeMessages: BridgeMessage[] = [];
  private bridgeListeners = new Set<(m: BridgeMessage) => void>();
  replaying = false;
  misses: SearchMiss[] = [];
  readonly audio = new AudioReactor();
  private watchSeen = new Map<string, number>();
  phone!: PhoneAlerts;
  viewer!: WebViewer;

  async onload() {
    await this.loadSettings();
    // Keep the bridge's policy file in step with these settings from the start.
    this.writePolicies();
    this.log = new AccessLog(this.app.vault.adapter, `${this.manifest.dir}/access-log`, () => ({ enabled: this.settings.digest, folder: this.settings.digestFolder }));
    await this.log.load();
    this.changes = new ChangeStore(this.app.vault.adapter, `${this.manifest.dir}/changes`);
    await this.changes.load();
    await this.loadBridgeMessages();
    await this.loadMisses();
    await this.loadPurposes();
    this.phone = new PhoneAlerts(() => this.settings);
    this.alertListeners.add((c) => this.phone.notify(c));
    this.viewer = new WebViewer({ graph: () => this.viewerGraph(), keyOk: (k) => safeEqual(this.settings.viewerKey, k) });
    this.startViewer();
    // Right-click a note or folder to add it to (or remove it from) the watchlist.
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      const prefix = file instanceof TFile ? file.path : `${file.path.replace(/\/+$/, '')}/`;
      const watched = parseWatchlist(this.settings.watchlist).some((r) => r.prefix === prefix);
      menu.addItem((item) => item.setTitle(watched ? 'Stop watching in H!V3MYND' : 'Watch in H!V3MYND').setIcon(watched ? 'eye-off' : 'eye').onClick(async () => {
        const lines = this.settings.watchlist.split('\n');
        this.settings.watchlist = watched
          ? lines.filter((l) => l.split(':')[0].trim() !== prefix).join('\n')
          : [...lines, prefix].join('\n');
        await this.saveSettings();
        new Notice(watched ? `H!V3MYND: stopped watching ${prefix}` : `H!V3MYND: watching ${prefix} (read, write)`);
      }));
    }));
    // Rebuild today's collision alerts from the loaded log.
    this.log.entries.forEach((e, i) => {
      const c = detectCollision(e, this.log.entries.slice(Math.max(0, i - 400), i));
      if (c) this.alerts.push(c);
    });
    this.monitor = new Monitor(() => this.views()[0]?.renderer?.stats() ?? null);
    this.registerView(VIEW_TYPE, (leaf) => new PlexusView(leaf, this));
    this.registerView(LOG_VIEW_TYPE, (leaf) => new AccessLogView(leaf, {
      log: this.log,
      monitor: this.monitor,
      agents: () => this.settings.agents,
      graphInfo: () => this.graphInfo(),
      openNote: (path, agent) => this.openFromLog(path, agent),
      popOut: () => void this.activateLog(true),
      alerts: () => this.alerts,
      onAlert: (fn) => { this.alertListeners.add(fn); return () => this.alertListeners.delete(fn); },
      changes: this.changes,
      tasks: () => taskGroups(this.log.entries),
      focusTask: (notes, agent) => this.focusTask(notes, agent),
      exportTask: (t) => this.exportTask(t),
      gaps: () => this.gapData(),
      restore: (c) => this.confirmRestore(c),
      bridge: () => this.bridgeMessages,
      onBridge: (fn) => { this.bridgeListeners.add(fn); return () => this.bridgeListeners.delete(fn); },
      alias: (n) => this.alias(n),
      // Layouts saved before the current default (LAYOUT_VERSION) start fresh.
      monitorUi: () => ({ layout: this.settings.monitorLayoutVersion === LAYOUT_VERSION ? this.settings.monitorLayout : null, budgetRange: this.settings.budgetRange, light: this.settings.monitorLight }),
      saveMonitorUi: (p) => {
        if (p.layout) { this.settings.monitorLayout = p.layout; this.settings.monitorLayoutVersion = LAYOUT_VERSION; }
        if (p.budgetRange) this.settings.budgetRange = p.budgetRange;
        if (p.light !== undefined) this.settings.monitorLight = p.light;
        void this.saveData(this.settings);
      },
    }));
    this.addCommand({ id: 'toggle-heat', name: 'Toggle heat & decay view', callback: () => void this.toggleHeat() });
    this.addCommand({ id: 'toggle-music', name: 'Toggle music reactivity', callback: () => void this.toggleMusic() });
    // The Agent Chat window was removed (2026-10-19); close any pane left from it.
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.iterateAllLeaves((l) => { if (l.getViewState().type === 'plexus-agent-chat') l.detach(); });
    });
    this.addRibbonIcon('activity', 'Open Brain Monitor (own window)', () => void this.activateLog(true));
    this.addCommand({ id: 'open-monitor-window', name: 'Open Brain Monitor in its own window', callback: () => void this.activateLog(true) });
    this.addCommand({ id: 'open-access-log', name: 'Open Brain Monitor in the sidebar', callback: () => void this.activateLog(false) });
    this.addRibbonIcon('brain-circuit', 'Open H!V3MYND', () => this.activate());
    this.addCommand({ id: 'open', name: 'Open the brain', callback: () => this.activate() });
    this.addCommand({
      id: 'toggle-fullscreen',
      name: 'Toggle full screen',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(PlexusView);
        if (!view) return false;
        if (!checking) view.toggleFullscreen();
        return true;
      },
    });
    this.addCommand({ id: 'demo', name: 'Demo agent activity', callback: () => this.demo() });
    this.addCommand({ id: 'toggle-permissions', name: 'Turn agent permissions on or off', callback: async () => {
      this.settings.enforcePermissions = !this.settings.enforcePermissions;
      await this.saveSettings();
      this.writePolicies();
      new Notice(this.settings.enforcePermissions ? 'H!V3MYND: agent permissions ON (approvals and rules enforced)' : 'H!V3MYND: agent permissions OFF (agents unrestricted; protected paths still apply)', 6000);
    } });
    this.addCommand({ id: 'meaning-map', name: 'Toggle meaning map (arrange by topic)', callback: () => void this.toggleMeaning() });
    this.addCommand({ id: 'growth', name: 'Play vault growth time-lapse', callback: async () => { await this.activate(); this.views()[0]?.toggleGrowth(); } });
    this.addCommand({ id: 'brain-report', name: "Write today's brain report (so far)", callback: async () => {
      const path = await this.writeReport(dayKey(new Date()));
      if (path) void this.app.workspace.openLinkText(path, '', 'tab');
    } });
    this.addSettingTab(new PlexusSettingTab(this.app, this));
    // First run: a short welcome with the two next steps.
    if (!this.settings.welcomed) {
      this.app.workspace.onLayoutReady(() => {
        new WelcomeModal(this.app, () => void this.activate(), () => {
          const setting = (this.app as any).setting;
          setting?.open?.();
          setting?.openTabById?.(this.manifest.id);
        }).open();
        this.settings.welcomed = true;
        void this.saveData(this.settings);
      });
    }

    // Links resolve asynchronously after startup and after edits; rebuild only when
    // the shape of the graph actually changed.
    this.registerEvent(this.app.metadataCache.on('resolved', debounce(() => this.refreshGraph(), 4000, true)));
    this.startServer();
    // Yesterday's report is written the first time Obsidian runs on a new day.
    this.app.workspace.onLayoutReady(() => window.setTimeout(() => void this.catchUpReport(), 15_000));
    this.registerInterval(window.setInterval(() => void this.catchUpReport(), 30 * 60_000));
  }

  // ------------------------------------------------------------ web viewer

  startViewer() {
    this.viewer.stop();
    if (!this.settings.webViewer || !Platform.isDesktopApp) return;
    this.viewer.start(this.settings.webViewerPort, this.settings.webViewerLan, (msg) => new Notice(`H!V3MYND web viewer: ${msg}`));
  }

  /** Link to open the viewer: this computer, or its LAN address when sharing is on. */
  viewerUrl() {
    let host = '127.0.0.1';
    if (this.settings.webViewerLan) {
      const nets = (window as any).require?.('os')?.networkInterfaces?.() ?? {};
      for (const list of Object.values(nets) as { family: string | number; internal: boolean; address: string }[][]) {
        const v4 = list?.find((x) => (x.family === 'IPv4' || x.family === 4) && !x.internal);
        if (v4) { host = v4.address; break; }
      }
    }
    return `http://${host}:${this.settings.webViewerPort}/?key=${this.settings.viewerKey}`;
  }

  private async viewerGraph() {
    const g = this.getGraph();
    const mode = this.settings.meaningMap ? 'meaning' : 'links';
    const options: Partial<PlexusOptions> = {};
    for (const k of Object.keys(DEFAULT_OPTIONS) as (keyof PlexusOptions)[]) (options as any)[k] = (this.settings as any)[k];
    return { paths: g.paths, links: g.links, layoutKey: mode, positions: await this.loadLayout(mode), options };
  }

  // ------------------------------------------------------------ meaning map

  private meaning: { key: string; links: Promise<[number, number][]> } | null = null;

  /** Similar-note ties for the current graph; recomputed only when notes come or go. */
  meaningLinks(g: GraphInput): Promise<[number, number][]> {
    const key = `${g.paths.length}:${hashPaths(g.paths)}`;
    if (this.meaning?.key === key) return this.meaning.links;
    const notice = new Notice('H!V3MYND: building the meaning map…', 0);
    const links = meaningLinks(this.app, g.paths, 6, (d, t) => notice.setMessage(`H!V3MYND: building the meaning map… ${Math.round((d / t) * 100)}%`))
      .finally(() => notice.hide());
    this.meaning = { key, links };
    links.catch(() => { this.meaning = null; });
    return links;
  }

  async toggleMeaning() {
    this.settings.meaningMap = !this.settings.meaningMap;
    await this.saveSettings();
    new Notice(this.settings.meaningMap ? 'H!V3MYND: meaning map — notes gather by topic' : 'H!V3MYND: link map — notes gather by links', 4000);
    for (const v of this.views()) await v.reloadGraph();
  }

  // ------------------------------------------------------------ context packs

  async contextPack(q: string, budget: number, agent: string): Promise<Pack> {
    const g = this.getGraph();
    const deny = (this.settings.policies[agent]?.deny ?? '').split(',').map((d) => d.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()).filter(Boolean);
    const denied = (p: string) => { const l = p.toLowerCase(); return deny.some((d) => l === d || l.startsWith(d + '/')); };
    const pack = await buildPack(this.app, g.paths, g.links, await this.log.history(30), q, budget, denied);
    if (pack.notes.length) this.pulse({ agent, kind: 'read', texts: pack.notes.map((n) => n.path), purpose: q, source: 'context pack', tokens: Object.fromEntries(pack.notes.map((n) => [n.path, n.tokens])) });
    return pack;
  }

  // ------------------------------------------------------------ daily brain report

  private reportPath(day: string) { return normalizePath(`${this.settings.digestFolder || 'Access Log'}/Reports/${day} Brain report.md`); }

  private async catchUpReport() {
    if (!this.settings.dailyReport) return;
    const day = dayKey(new Date(Date.now() - 86_400_000));
    if (await this.app.vault.adapter.exists(this.reportPath(day))) return;
    const path = await this.writeReport(day, true);
    if (path) new Notice(`H!V3MYND: yesterday's brain report is in ${path}`, 8000);
  }

  /** Builds and writes the report for one day; returns its path, or null if skipped. */
  async writeReport(day: string, skipEmpty = false): Promise<string | null> {
    const start = new Date(`${day}T00:00:00`).getTime(), end = start + 86_400_000;
    const inDay = (t: number) => t >= start && t < end;
    const daysBack = Math.ceil((Date.now() - start) / 86_400_000) + 1;
    const entries = (await this.log.history(daysBack)).filter((e) => inDay(e.t) && !isSynthetic(e)).sort((a, b) => a.t - b.t)
      .map((e) => ({ ...e, agent: this.alias(e.agent) }));
    if (skipEmpty && !entries.length) return null;
    const skip = this.settings.digestFolder ? this.settings.digestFolder.replace(/\/+$/, '') + '/' : null;
    const files = this.app.vault.getMarkdownFiles().filter((f) => !skip || !f.path.startsWith(skip));
    const created = files.filter((f) => inDay(f.stat.ctime)).map((f) => f.path);
    const edited = files.filter((f) => inDay(f.stat.mtime) && !inDay(f.stat.ctime)).map((f) => f.path);
    const g = this.getGraph();
    const md = buildReport({
      day, dayStart: start, entries,
      alerts: this.alerts.filter((a) => inDay(a.t)),
      misses: this.misses.filter((m) => inDay(m.t)),
      created, edited,
      graph: { notes: g.paths.length, links: g.links.length },
    });
    const path = this.reportPath(day);
    try {
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.createFolder(dir).catch(() => undefined);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await this.app.vault.process(existing, () => md);
      else await this.app.vault.create(path, md);
      return path;
    } catch (err) {
      new Notice(`H!V3MYND: couldn't write the brain report (${err instanceof Error ? err.message : err})`);
      return null;
    }
  }

  onunload() {
    this.audio.stop();
    if (this.heatTimer !== null) window.clearInterval(this.heatTimer);
    this.stopServer();
    this.viewer?.stop();
    void this.log?.flushAll();
  }

  /** The monitor normally lives in its own window so it can go full screen beside the brain. */
  async activateLog(popout = true, tab?: string) {
    const leaves = this.app.workspace.getLeavesOfType(LOG_VIEW_TYPE);
    if (popout) {
      // A pop-out restored after a reload can be minimised or off-screen, and focus()
      // can't bring it back; replace it with a fresh window instead.
      for (const l of leaves) if (l.view.containerEl.ownerDocument !== document) l.detach();
    } else if (leaves[0]) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = popout
      ? this.app.workspace.openPopoutLeaf({ size: { width: 1500, height: 950 } })
      : this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('split');
    await leaf.setViewState({ type: LOG_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    if (tab && leaf.view instanceof AccessLogView) leaf.view.showPage(tab);
  }

  private graphInfo(): GraphInfo {
    const g = this.getGraph();
    const deg = new Uint32Array(g.paths.length);
    for (const [a, b] of g.links) { deg[a]++; deg[b]++; }
    const hub = hubThreshold(g.paths.length);
    let hubs = 0, unlinked = 0;
    for (const d of deg) { if (d > hub) hubs++; if (!d) unlinked++; }
    return { notes: g.paths.length, links: g.links.length, hubs, unlinked };
  }

  private openFromLog(path: string, _agent: string) {
    void this.app.workspace.openLinkText(path, '', 'tab');
    const i = this.getGraph().paths.indexOf(path);
    if (i >= 0) for (const v of this.views()) v.renderer?.highlight(i);
  }

  async activate() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  views(): PlexusView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).filter((v): v is PlexusView => v instanceof PlexusView);
  }

  getGraph(): BuiltGraph {
    if (!this.graph) {
      this.graph = this.buildGraph();
      this.signature = signatureOf(this.graph);
    }
    return this.graph;
  }

  refreshGraph(force = false) {
    const next = this.buildGraph();
    const sig = signatureOf(next);
    if (!force && sig === this.signature) return;
    this.graph = next;
    this.signature = sig;
    for (const v of this.views()) void v.reloadGraph();
  }

  private buildGraph(): BuiltGraph {
    const prefixes = this.settings.exclude.split(',').map((s) => s.trim()).filter(Boolean);
    // The access digest lives in the vault but never joins the brain.
    if ((this.settings.digest || this.settings.dailyReport) && this.settings.digestFolder) prefixes.push(this.settings.digestFolder.replace(/\/+$/, '') + '/');
    let files = this.app.vault.getMarkdownFiles().map((f) => f.path).filter((p) => !prefixes.some((x) => p.startsWith(x)));
    let index = new Map(files.map((p, i) => [p, i]));
    let links: [number, number][] = [];
    const seen = new Set<number>();
    const n = files.length;
    for (const [src, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      const a = index.get(src);
      if (a === undefined) continue;
      for (const dst of Object.keys(targets)) {
        const b = index.get(dst);
        if (b === undefined || a === b) continue;
        const key = Math.min(a, b) * n + Math.max(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        links.push([a, b]);
      }
    }
    if (!this.settings.showOrphans) {
      const keep = new Set<number>();
      for (const [a, b] of links) { keep.add(a); keep.add(b); }
      const kept = files.filter((_, i) => keep.has(i));
      const remap = new Map(kept.map((p, i) => [index.get(p)!, i]));
      links = links.map(([a, b]) => [remap.get(a)!, remap.get(b)!]);
      files = kept;
      index = new Map(files.map((p, i) => [p, i]));
    }
    const adapter = this.app.vault.adapter;
    const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
    return { paths: files, links, resolver: new PathResolver(files, base) };
  }

  // ------------------------------------------------------------ layout cache

  private layoutPath(mode = 'links') { return `${this.manifest.dir}/${mode === 'meaning' ? 'layout-meaning.json' : LAYOUT_FILE}`; }

  async loadLayout(mode = 'links'): Promise<LayoutCache | null> {
    try {
      const path = this.layoutPath(mode);
      if (!(await this.app.vault.adapter.exists(path))) return null;
      return JSON.parse(await this.app.vault.adapter.read(path));
    } catch {
      return null;
    }
  }

  async saveLayout(cache: LayoutCache, mode = 'links') {
    try { await this.app.vault.adapter.write(this.layoutPath(mode), JSON.stringify(cache)); } catch (err) { console.warn('H!V3MYND: could not save layout', err); }
  }

  // ------------------------------------------------------------ agent listener

  /**
   * Local-only HTTP listener. Agents (Claude Code hook, the bridge, any local tool)
   * POST /pulse {agent, kind: read|scan|write, texts: [...]}; any vault note path in
   * the texts lights up. It only drives visuals, binds 127.0.0.1, and refuses
   * browser-originated requests.
   */
  startServer() {
    if (!this.settings.bridge || this.server || !Platform.isDesktopApp) return;
    const http = (window as any).require?.('http');
    if (!http) return;
    const server = http.createServer((req: any, res: any) => {
      if (req.headers.origin) { res.writeHead(403); res.end(); return; }
      // Every endpoint needs the shared key (header X-Hivemynd-Key, or ?key= for tools that
      // can't set headers). Without it only a bare liveness answer is given.
      const url = new URL(req.url ?? '/', 'http://local');
      const authed = this.keyOk(String(req.headers['x-hivemynd-key'] ?? url.searchParams.get('key') ?? ''));
      url.searchParams.delete('key');
      req.url = url.pathname + url.search;
      if (!authed) {
        if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
        res.writeHead(401); res.end(); return;
      }
      // Tooling endpoints (view remote control, audio probes, reload) only answer in
      // Developer mode. Agents need just pulses, hooks, prompts, approvals and packs.
      if (!this.settings.developerMode && DEV_ROUTES.has(url.pathname)) { res.writeHead(404); res.end(); return; }
      if (req.method === 'GET' && req.url === '/health' && !this.settings.developerMode) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, notes: this.graph?.paths.length ?? 0, version: this.manifest.version }));
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const sizes = this.views().map((v) => v.debugSizes());
        const monitors = this.app.workspace.getLeavesOfType(LOG_VIEW_TYPE).map((l) => ({
          popout: l.view.containerEl.ownerDocument !== document,
          attached: l.view.containerEl.isConnected,
          w: l.view.containerEl.ownerDocument.defaultView?.innerWidth,
          theme: (() => { const r = l.view.containerEl.querySelector('.plexus-log'); if (!r) return null; const cs = getComputedStyle(r); return { cls: r.className, bg: cs.backgroundColor, img: cs.backgroundImage.slice(0, 80), pl: cs.getPropertyValue('--pl-bg') }; })(),
        }));
        const render = this.views().map((v) => ({ stats: v.renderer?.stats() ?? null, audio: !!v.renderer?.audio, error: v.renderer?.lastError ?? null }));
        res.end(JSON.stringify({ ok: true, notes: this.graph?.paths.length ?? 0, views: this.views().length, monitors, sizes, render, audioFrames: this.audio.stats.frames, audioRunning: this.audio.running, ...this.stats }));
        return;
      }
      if (req.method === 'POST' && req.url === '/replay') {
        // Toggle the replay scrubber in the brain view (view only).
        res.writeHead(202); res.end();
        for (const v of this.views()) void v.toggleReplay();
        return;
      }
      if (req.method === 'POST' && req.url === '/focus') {
        // Light a set of notes in the brain: {notes: [paths], agent}; an empty body clears.
        let body = '';
        req.on('data', (c: string) => { body += c; });
        req.on('end', () => {
          try {
            const d = body.trim() ? JSON.parse(body) : {};
            this.focusTask(Array.isArray(d.notes) && d.notes.length ? d.notes : null, this.alias(String(d.agent ?? 'claude')));
            res.writeHead(204);
          } catch { res.writeHead(400); }
          res.end();
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/music') {
        // Toggle music reactivity (view only).
        res.writeHead(202); res.end();
        void this.toggleMusic();
        return;
      }
      if (req.method === 'GET' && req.url === '/system-audio-probe') {
        void (async () => {
          let result: any;
          try {
            const stream = await AudioReactor.systemAudio();
            const ctx = new AudioContext();
            const an = ctx.createAnalyser();
            ctx.createMediaStreamSource(stream).connect(an);
            const buf = new Float32Array(an.fftSize);
            let peak = 0;
            const end = performance.now() + 800;
            while (performance.now() < end) { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); await new Promise((r) => window.setTimeout(r, 30)); }
            stream.getTracks().forEach((t) => t.stop());
            void ctx.close();
            result = { ok: true, peak: Math.round(peak * 1000) / 1000 };
          } catch (err) {
            result = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        })();
        return;
      }
      if (req.method === 'GET' && req.url === '/audio-probe') {
        void AudioReactor.inputs().then(async (list) => {
          const ids = list.map((d) => d.deviceId).filter((id) => id !== 'default' && id !== 'communications');
          const levels = await AudioReactor.probe(ids);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(list.filter((d) => ids.includes(d.deviceId)).map((d) => ({ label: d.label, peak: Math.round((levels[d.deviceId] ?? -1) * 1000) / 1000 })).sort((a, b) => b.peak - a.peak)));
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/audio-levels') {
        // Detector inputs over ?s= seconds of whatever is playing (tuning aid).
        const secs = Math.min(30, Math.max(2, Number(url.searchParams.get('s')) || 8));
        const st = this.audio.stats;
        st.frames = 0; st.rms = []; st.share = []; st.full = [];
        const o0 = this.audio.onsets;
        const t0 = performance.now();
        window.setTimeout(() => {
          const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b.length ? Math.round(b[Math.floor((b.length - 1) * p)] * 10000) / 10000 : null; };
          const pct = (a: number[]) => ({ p10: q(a, 0.1), p50: q(a, 0.5), p90: q(a, 0.9), max: q(a, 1) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const times = this.audio.onsetTimes.filter((t) => t >= t0);
          const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
          const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
          res.end(JSON.stringify({ seconds: secs, frames: st.frames, onsets: this.audio.onsets - o0, medianGapMs: Math.round(medGap), gaps: times.slice(1).map((t, i) => Math.round(t - times[i])), bpm: medGap ? Math.round(60000 / medGap) : null, device: this.audio.deviceLabel, rms: pct(st.rms), share: pct(st.share), full: pct(st.full) }));
        }, secs * 1000);
        return;
      }
      if (req.method === 'GET' && req.url === '/audio-devices') {
        void AudioReactor.inputs().then((list) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ onsets: this.audio.onsets, selected: this.settings.audioDevice, running: this.audio.running, device: this.audio.deviceLabel, error: this.audio.error, inputs: list.map((d) => ({ id: d.deviceId, label: d.label })) }));
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/approve') {
        // The bridge holds an agent's PC action until a person decides here.
        let body = '';
        req.on('data', (c: string) => { body += c; if (body.length > 20_000) req.destroy(); });
        req.on('end', () => {
          let d: { agent?: string; action?: string; detail?: string } = {};
          try { d = JSON.parse(body); } catch { /* empty */ }
          void this.askApproval(d).then((approved) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ approved }));
          });
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/policy-block') {
        // The bridge refused an agent something its permissions don't allow.
        let body = '';
        req.on('data', (c: string) => { body += c; });
        req.on('end', () => {
          try { this.policyBlocked(JSON.parse(body)); } catch { /* ignore */ }
          res.writeHead(204); res.end();
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/context-pack') {
        // The notes most relevant to a task (?q=), cut to ?budget= tokens, as JSON. The
        // agent's permissions apply, and the notes light up and log as reads by ?agent=.
        const q = (url.searchParams.get('q') ?? '').slice(0, 300);
        const agent = this.alias(url.searchParams.get('agent') || 'other');
        const budget = Math.min(50_000, Math.max(500, Number(url.searchParams.get('budget')) || 6000));
        void this.contextPack(q, budget, agent).then((pack) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(pack));
        }).catch((err) => { res.writeHead(500); res.end(String(err)); });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/report') {
        // Write the brain report for ?day=YYYY-MM-DD (default today) and return its path.
        const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') ?? '') ? url.searchParams.get('day')! : dayKey(new Date());
        void this.writeReport(day).then((path) => {
          res.writeHead(path ? 200 : 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: !!path, path }));
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/meaning') {
        // Toggle the meaning map (view only).
        res.writeHead(202); res.end();
        void this.toggleMeaning();
        return;
      }
      if (req.method === 'POST' && req.url === '/heat') {
        // Toggle the heat & decay overlay (view only).
        res.writeHead(202); res.end();
        void this.toggleHeat();
        return;
      }
      if (req.method === 'POST' && (req.url ?? '').startsWith('/open-monitor')) {
        // Lets an agent pop the Brain Monitor window open (optionally on a tab); it can only open this one view.
        res.writeHead(202); res.end();
        const tab = /[?&]tab=([a-z]+)/.exec(req.url ?? '')?.[1];
        void this.activateLog(true, tab);
        return;
      }
      if (req.method === 'POST' && req.url === '/reload') {
        // Dev convenience: pick up a fresh main.js build without restarting Obsidian.
        res.writeHead(202); res.end();
        const plugins = (this.app as any).plugins;
        const id = this.manifest.id;
        window.setTimeout(async () => { await plugins.disablePlugin(id); await plugins.loadManifests?.(); await plugins.enablePlugin(id); }, 50);
        return;
      }
      // /pulse: pre-parsed events (Agent Bridge). /hook/<agent>: a raw PostToolUse payload
      // piped straight from Claude Code or Grok Build by curl.
      // /prompt/<agent>: a UserPromptSubmit payload, remembered as the purpose of that
      // agent's next note accesses.
      const hook = /^\/hook\/([a-z0-9_-]{1,40})$/i.exec(req.url ?? '');
      const prompt = /^\/prompt\/([a-z0-9_-]{1,40})$/i.exec(req.url ?? '');
      // /prewrite/<agent>: PreToolUse payload; snapshot the note before the agent writes.
      // /bridge-message: a message (or array of them) relayed by the Agent Bridge.
      const prewrite = /^\/prewrite\/([a-z0-9_-]{1,40})$/i.exec(req.url ?? '');
      const bridgeMsg = req.url === '/bridge-message';
      if (req.method !== 'POST' || (req.url !== '/pulse' && !hook && !prompt && !prewrite && !bridgeMsg)) { res.writeHead(404); res.end(); return; }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 1_000_000) { res.writeHead(413); res.end(); req.destroy(); }
      });
      req.on('end', () => {
        let lit = 0;
        try {
          const data = JSON.parse(body);
          if (prewrite) {
            // Respond only after the snapshot is taken, so the write can't race it.
            void this.snapshotBefore(data, prewrite[1].toLowerCase()).finally(() => { res.writeHead(204); res.end(); });
            return;
          }
          if (bridgeMsg) {
            for (const m of Array.isArray(data) ? data : [data]) this.addBridgeMessage(m);
            res.writeHead(204); res.end(); return;
          }
          if (prompt) {
            const p = promptFromHook(data);
            const agent = prompt[1].toLowerCase();
            if (p && this.settings.storePurposes) {
              const entry = { text: p.purpose, at: Date.now() };
              this.purposes.set(`${agent}:${p.session}`, entry);
              this.purposes.set(`${agent}:*`, entry);
              this.savePurposes();
            }
            res.writeHead(204); res.end(); return;
          }
          const events: PulseEvent[] = hook ? hookToEvents(data, hook[1].toLowerCase()) : Array.isArray(data.events) ? data.events : [data];
          if (hook) {
            const adapter = this.app.vault.adapter;
            const miss = searchMiss(data, adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '');
            if (miss) this.addMiss({ t: Date.now(), agent: this.alias(hook[1]), query: miss.query });
          }
          for (const ev of events) lit += this.pulse(ev);
        } catch {
          res.writeHead(400); res.end(); return;
        }
        // Hooks get an empty 204 so nothing lands in the agent's hook output.
        if (hook) { res.writeHead(204); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, lit }));
      });
    });
    server.on('error', (err: any) => {
      new Notice(`H!V3MYND: agent listener couldn't start on port ${this.settings.port} (${err.code ?? err.message}).`);
      this.server = null;
    });
    server.listen(this.settings.port, '127.0.0.1');
    this.server = server;
  }

  stopServer() {
    this.server?.close();
    this.server = null;
  }

  restartServer() {
    this.stopServer();
    this.startServer();
  }

  /** Display name for an agent, applying the configured aliases (e.g. bot2=claude). */
  alias(name: string) {
    const key = name.toLowerCase();
    for (const pair of this.settings.agentAliases.split(',')) {
      const [from, to] = pair.split('=').map((s) => s.trim().toLowerCase());
      if (from && to && from === key) return to;
    }
    return key;
  }

  private pulse(ev: PulseEvent): number {
    const texts = Array.isArray(ev.texts) ? ev.texts.filter((t): t is string => typeof t === 'string') : [];
    if (!texts.length) return 0;
    const kind: TouchMode = ev.kind === 'write' ? 'write' : ev.kind === 'scan' ? 'scan' : 'read';
    const agent = this.alias(typeof ev.agent === 'string' && ev.agent ? ev.agent : 'other');
    const graph = this.getGraph();
    const indices = graph.resolver.resolve(texts, kind === 'scan' ? 80 : 40);
    const key = `${kind}:${indices.join(',')}`;
    const now = performance.now();
    if (indices.length && this.recent.get(key) !== undefined && this.recent.get(key)!.agent !== agent && now - this.recent.get(key)!.at < 400) return 0;
    this.recent.set(key, { agent, at: now });
    if (this.recent.size > 200) this.recent.delete(this.recent.keys().next().value!);
    // During replay the brain shows the past; live access is still logged.
    if (!this.replaying) for (const v of this.views()) v.renderer?.touch(indices, agent, kind);
    this.viewer?.touch(indices, agent, kind);
    let notes = indices.map((i) => graph.paths[i]);
    if (kind === 'write') {
      // New notes aren't in the graph yet; take their paths straight from the event.
      for (const p of this.writePaths(texts)) if (!notes.includes(p)) notes.push(p);
      notes = notes.filter((p) => this.app.vault.getAbstractFileByPath(p) || ev.before !== undefined);
    }
    // Resolve the purpose once so the log entry and the change record agree.
    if (!ev.purpose) {
      const p = (ev.session && this.purposes.get(`${agent}:${ev.session}`)) || this.purposes.get(`${agent}:*`);
      if (p && Date.now() - p.at < PURPOSE_TTL) ev.purpose = p.text;
    }
    // Demo pulses only animate the brain: no log entries, no change records.
    if (ev.source !== 'demo') {
      this.record(ev, agent, kind, notes);
      if (kind === 'write') for (const p of notes) void this.captureChange(ev, agent, p);
    }
    this.stats.pulses++;
    this.stats.lit += indices.length;
    if (indices.length) this.stats.last = { at: new Date().toISOString(), agent, kind, notes: indices.slice(0, 5).map((i) => graph.paths[i]) };
    return indices.length;
  }

  private record(ev: PulseEvent, agent: string, kind: TouchMode, notes: string[]) {
    if (!notes.length) return;
    if (kind === 'scan' && !this.settings.logSearches) return;
    const now = Date.now();
    let purpose = typeof ev.purpose === 'string' && this.settings.storePurposes ? ev.purpose.trim().slice(0, 200) : '';
    if (!purpose && this.settings.storePurposes) {
      const p = (ev.session && this.purposes.get(`${agent}:${ev.session}`)) || this.purposes.get(`${agent}:*`);
      if (p && now - p.at < PURPOSE_TTL) purpose = p.text;
    }
    const source = typeof ev.source === 'string' ? ev.source : '';
    if (kind === 'scan') {
      const tokens = tokensForBytes(Number(ev.responseChars) || 0);
      this.log.add({ t: now, agent, action: 'search', notes, purpose, source, tokens });
      return;
    }
    const action: AccessAction = kind === 'write' ? 'write' : 'read';
    for (const note of notes) {
      const entry: AccessEntry = { t: now, agent, action, notes: [note], purpose, source };
      if (action === 'read') entry.tokens = this.readTokens(ev, note, notes.length, entry);
      this.log.add(entry);
      if (action === 'write') this.checkCollision(entry);
      this.checkWatch(agent, action, note);
    }
  }

  /**
   * Estimated tokens a read pulled into the agent's context. In order of trust: an
   * exact count sent with the pulse (context packs), the size of what a command
   * printed, the requested line range, Claude's 2000-line Read cap, the whole file.
   */
  private readTokens(ev: PulseEvent, note: string, count: number, entry: AccessEntry) {
    const file = this.app.vault.getAbstractFileByPath(note);
    const whole = file instanceof TFile ? tokensForBytes(file.stat.size) : 0;
    const exact = ev.tokens && typeof ev.tokens === 'object' ? Number(ev.tokens[note]) : NaN;
    if (Number.isFinite(exact) && exact >= 0) {
      if (exact < whole) entry.partial = true;
      return Math.round(exact);
    }
    const chars = Number(ev.responseChars) || 0;
    if (chars > 0) {
      // A command that names notes: what it printed is what reached the agent.
      const t = Math.min(whole, Math.round(tokensForBytes(chars) / Math.max(1, count)));
      if (t < whole) entry.partial = true;
      return t;
    }
    const limit = Number(ev.readLimit) || 0;
    if (limit) { entry.partial = true; return Math.min(whole, limit * 15); }
    if (ev.source === 'Read tool' && file instanceof TFile) {
      // Claude Code's Read returns at most 2000 lines when no range is given.
      const sections = this.app.metadataCache.getFileCache(file)?.sections;
      const lines = sections?.length ? sections[sections.length - 1].position.end.line + 1 : 0;
      if (lines > 2000) { entry.partial = true; return Math.round(whole * (2000 / lines)); }
    }
    return whole;
  }

  // ------------------------------------------------------------ PC-action approvals

  private grants = new Map<string, number>(); // "agent|action" -> approved until (ms)

  /** Ask the person at the PC whether an agent may do something. No answer in 60 s = no. */
  askApproval(d: { agent?: string; action?: string; detail?: string }): Promise<boolean> {
    const agent = this.alias(String(d.agent ?? 'other'));
    const action = String(d.action ?? 'use the PC').slice(0, 120);
    const detail = String(d.detail ?? '').slice(0, 600);
    const key = `${agent}|${action}`;
    if ((this.grants.get(key) ?? 0) > Date.now()) return Promise.resolve(true);
    // Dialogs draw outside a full-screen element, so leave full screen to show it.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (this.settings.phoneAlerts) void this.phone.send('Approval needed', `${agent} wants to ${action}. Approve or deny in Obsidian within a minute.`, true).catch(() => undefined);
    // A desktop notification shows even when Obsidian is behind other windows;
    // clicking it brings the main window (where the dialog is) to the front.
    try {
      const n = new Notification(`H!V3MYND: approve ${agent}?`, { body: `${agent} wants to ${action}. Approve or deny in Obsidian within a minute.`, requireInteraction: true });
      n.onclick = () => { window.focus(); n.close(); };
      window.setTimeout(() => n.close(), 62_000);
    } catch { /* notifications blocked */ }
    return new Promise((resolve) => {
      const modal = new ApprovalModal(this.app, agent, action, detail, (choice) => {
        if (choice === 'ten') this.grants.set(key, Date.now() + 10 * 60_000);
        resolve(choice !== 'deny');
      });
      modal.open();
      // Obsidian opens dialogs in whichever window is focused (maybe the Brain
      // Monitor pop-out); keep approvals in the main window where they're expected.
      if (modal.containerEl.ownerDocument !== document) document.body.appendChild(modal.containerEl);
      window.focus();
    });
  }

  // ------------------------------------------------------------ agent permissions

  /** Writes the permissions the bridge enforces. Agents without restrictions are omitted (full access). */
  writePolicies() {
    if (!this.settings.policyFile) return;
    const agents: Record<string, unknown> = {};
    const fallback = this.settings.defaultPcControl;
    for (const [name, p] of Object.entries(this.settings.policies)) {
      const deny = p.deny.split(',').map((d) => d.trim()).filter(Boolean);
      agents[name] = { deny, readOnly: p.readOnly, pcControl: pcModeOf(p, fallback) };
    }
    try {
      const fs = (window as any).require('fs');
      fs.writeFileSync(this.settings.policyFile, JSON.stringify({ enforce: this.settings.enforcePermissions, default: { pcControl: fallback }, agents }, null, 2), 'utf8');
    } catch (err) {
      new Notice(`H!V3MYND: couldn't write the bridge policy file (${err instanceof Error ? err.message : err})`);
    }
  }

  private policyBlocked(d: { agent?: string; action?: string; detail?: string }) {
    const agent = this.alias(String(d.agent ?? 'other'));
    const detail = String(d.detail ?? '');
    const note = detail.toLowerCase().endsWith('.md') ? detail : '';
    const c: Collision = { t: Date.now(), kind: 'blocked', note: note || detail, writer: agent, other: '', otherAt: Date.now(), action: String(d.action ?? ''), rule: '' };
    this.alerts.push(c);
    if (this.alerts.length > 200) this.alerts.shift();
    new Notice(`⛔ H!V3MYND: blocked ${agent} (${c.action}${detail ? `: ${detail}` : ''})`, 8000);
    const i = note ? this.getGraph().paths.indexOf(note) : -1;
    if (i >= 0) for (const v of this.views()) v.renderer?.alertFlash(i);
    for (const fn of this.alertListeners) fn(c);
  }

  // ------------------------------------------------------------ watchlist

  private checkWatch(agent: string, action: string, note: string) {
    const rule = watchMatch(parseWatchlist(this.settings.watchlist), note, action);
    if (!rule) return;
    const key = `${agent}|${action}|${note}`;
    const now = Date.now();
    if (now - (this.watchSeen.get(key) ?? 0) < 120_000) return; // one alert per 2 min per agent+note+action
    this.watchSeen.set(key, now);
    const c: Collision = { t: now, kind: 'watch', note, writer: agent, other: '', otherAt: now, action, rule: rule.prefix };
    this.alerts.push(c);
    if (this.alerts.length > 200) this.alerts.shift();
    const msg = `${agent} ${action === 'write' ? 'wrote' : action === 'read' ? 'read' : 'searched'} watched note “${noteTitle(note)}”`;
    new Notice(`👁 H!V3MYND: ${msg}`, 8000);
    if (this.settings.watchNotify && typeof Notification !== 'undefined') {
      try { new Notification('H!V3MYND watchlist', { body: `${msg}\n${note}`, silent: false }); } catch { /* notifications blocked */ }
    }
    const i = this.getGraph().paths.indexOf(note);
    if (i >= 0) for (const v of this.views()) v.renderer?.alertFlash(i);
    for (const fn of this.alertListeners) fn(c);
  }

  // ------------------------------------------------------------ tasks & gaps

  private focusTask(notes: string[] | null, agent: string) {
    const g = this.getGraph();
    const idx = notes ? notes.map((p) => g.paths.indexOf(p)).filter((i) => i >= 0) : null;
    const color = this.settings.agents.find((a) => a.name === agent)?.color ?? '#2fd3c9';
    for (const v of this.views()) v.renderer?.setFocus(idx, color);
  }

  private async exportTask(t: import('./insights').TaskGroup) {
    const folder = normalizePath(`${this.settings.digestFolder}/Task maps`);
    const day = new Date(t.start).toISOString().slice(0, 10);
    const name = (t.purpose || 'unnamed task').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const path = normalizePath(`${folder}/${day} ${t.agent} - ${name}.md`);
    const lines = [
      '---', 'hivemynd: task-map', `agent: ${t.agent}`, `date: ${day}`, '---',
      `# Context map: ${t.purpose || 'unnamed task'}`, '',
      `${t.agent} touched ${t.notes.length} notes between ${new Date(t.start).toLocaleTimeString([], { hour12: false })} and ${new Date(t.end).toLocaleTimeString([], { hour12: false })} (~${Math.round(t.tokens / 100) / 10}k tokens of context).`, '',
      '| # | Note | Reads | Writes | Searches |', '| --- | --- | --- | --- | --- |',
      ...[...t.notes].sort((a, b) => a.first - b.first).map((n, i) => `| ${i + 1} | [[${n.path.replace(/\.md$/i, '')}]] | ${n.reads} | ${n.writes} | ${n.searches} |`),
      '',
    ];
    if (!(await this.app.vault.adapter.exists(folder))) await this.app.vault.createFolder(folder);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.process(existing, () => lines.join('\n'));
    else await this.app.vault.create(path, lines.join('\n'));
    await this.app.workspace.openLinkText(path, '', 'tab');
  }

  // Remembered prompts survive plugin reloads, so purposes don't vanish mid-task.
  private purposeFile() { return `${this.manifest.dir}/purposes.json`; }

  private async loadPurposes() {
    try {
      if (!(await this.app.vault.adapter.exists(this.purposeFile()))) return;
      const saved = JSON.parse(await this.app.vault.adapter.read(this.purposeFile())) as [string, { text: string; at: number }][];
      for (const [k, v] of saved) if (Date.now() - v.at < PURPOSE_TTL) this.purposes.set(k, v);
    } catch { /* first run */ }
  }

  private savePurposes = debounce(() => {
    const keep = [...this.purposes].filter(([, v]) => Date.now() - v.at < PURPOSE_TTL).slice(-200);
    void this.app.vault.adapter.write(this.purposeFile(), JSON.stringify(keep));
  }, 2000, false);

  private missFile() { return `${this.manifest.dir}/search-misses.jsonl`; }

  private async loadMisses() {
    try {
      if (!(await this.app.vault.adapter.exists(this.missFile()))) return;
      for (const line of (await this.app.vault.adapter.read(this.missFile())).split('\n')) {
        if (!line.trim()) continue;
        try { this.misses.push(JSON.parse(line)); } catch { /* torn line */ }
      }
      if (this.misses.length > 2000) this.misses.splice(0, this.misses.length - 2000);
    } catch { /* first run */ }
  }

  private addMiss(m: SearchMiss) {
    this.misses.push(m);
    void this.app.vault.adapter.append(this.missFile(), JSON.stringify(m) + '\n');
  }

  private gapData() {
    const g = this.getGraph();
    const dayStart = new Date(new Date().toDateString()).getTime();
    const adj = new Set<string>();
    const deg = new Map<string, number>();
    for (const [a, b] of g.links) {
      const pa = g.paths[a], pb = g.paths[b];
      adj.add(pa < pb ? `${pa}\u0000${pb}` : `${pb}\u0000${pa}`);
      deg.set(pa, (deg.get(pa) ?? 0) + 1);
      deg.set(pb, (deg.get(pb) ?? 0) + 1);
    }
    const tasks = taskGroups(this.log.entries);
    const used = new Map<string, number>();
    for (const e of this.log.entries) if (e.action !== 'search') for (const p of e.notes) used.set(p, (used.get(p) ?? 0) + 1);
    const usedOrphans = [...used].filter(([p]) => !deg.get(p) && g.paths.includes(p)).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const broken: { source: string; targets: string[] }[] = [];
    for (const [src, targets] of Object.entries(this.app.metadataCache.unresolvedLinks)) {
      const names = Object.keys(targets);
      if (names.length && !src.startsWith(this.settings.digestFolder + '/')) broken.push({ source: src, targets: names });
    }
    broken.sort((a, b) => b.targets.length - a.targets.length);
    const missCounts = new Map<string, { query: string; n: number; agents: Set<string>; last: number }>();
    for (const m of this.misses) {
      const k = m.query.toLowerCase();
      const c = missCounts.get(k) ?? { query: m.query, n: 0, agents: new Set<string>(), last: 0 };
      c.n++;
      c.agents.add(m.agent);
      c.last = Math.max(c.last, m.t);
      missCounts.set(k, c);
    }
    return {
      misses: [...missCounts.values()].sort((a, b) => b.last - a.last).slice(0, 40),
      rereads: rereads(this.log.entries, dayStart),
      suggestions: linkSuggestions(tasks, (a, b) => adj.has(a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)),
      usedOrphans,
      broken: broken.slice(0, 40),
      brokenTotal: broken.reduce((n, b) => n + b.targets.length, 0),
    };
  }

  private checkCollision(entry: AccessEntry) {
    const c = detectCollision(entry, this.log.entries);
    if (!c) return;
    this.alerts.push(c);
    if (this.alerts.length > 200) this.alerts.shift();
    const what = c.kind === 'write-write' ? `also wrote it ${ago(c.t - c.otherAt)} earlier` : `was reading it ${ago(c.t - c.otherAt)} earlier`;
    new Notice(`⚠ H!V3MYND collision: ${c.writer} wrote “${noteTitle(c.note)}” — ${c.other} ${what}.`, 10_000);
    const i = this.getGraph().paths.indexOf(c.note);
    if (i >= 0) for (const v of this.views()) v.renderer?.highlight(i);
    for (const fn of this.alertListeners) fn(c);
  }

  // ------------------------------------------------------------ write diff & undo

  /** Vault-relative .md paths named in write-tool texts (absolute paths outside the vault are ignored). */
  private writePaths(texts: string[]): string[] {
    const adapter = this.app.vault.adapter;
    const base = (adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '').replace(/\\/g, '/').replace(/\/+$/, '');
    const out = new Set<string>();
    for (const raw of texts) {
      const t = raw.trim().replace(/\\/g, '/');
      if (!/\.md$/i.test(t)) continue;
      let rel: string | null = null;
      if (base && t.toLowerCase().startsWith(base.toLowerCase() + '/')) rel = t.slice(base.length + 1);
      else if (!/^[a-z]:\//i.test(t) && !t.startsWith('/')) rel = t;
      if (rel && !rel.startsWith(`${this.app.vault.configDir}/`)) out.add(normalizePath(rel));
    }
    return [...out];
  }

  private async snapshotBefore(data: any, agent: string) {
    for (const ev of hookToEvents(data, agent)) {
      if (ev.kind !== 'write') continue;
      const texts = (ev.texts as string[]) ?? [];
      const graph = this.getGraph();
      const paths = new Set([...graph.resolver.resolve(texts).map((i) => graph.paths[i]), ...this.writePaths(texts)]);
      for (const p of paths) {
        const exists = await this.app.vault.adapter.exists(p);
        this.pendingBefore.set(p, { text: exists ? await this.app.vault.adapter.read(p) : null, t: Date.now() });
      }
    }
  }

  private async captureChange(ev: PulseEvent, agent: string, path: string) {
    let before: string | null | undefined;
    if (ev.before !== undefined) before = ev.before as string | null; // bridge sends it inline
    else {
      const p = this.pendingBefore.get(path);
      if (p && Date.now() - p.t < 120_000) before = p.text;
      this.pendingBefore.delete(path);
    }
    if (before === undefined) return; // no pre-image: can't offer a diff or undo
    const exists = await this.app.vault.adapter.exists(path);
    const after = exists ? await this.app.vault.adapter.read(path) : null;
    if (before === after) return;
    await this.changes.add({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      t: Date.now(),
      agent,
      path,
      purpose: typeof ev.purpose === 'string' ? ev.purpose : '',
      source: typeof ev.source === 'string' ? ev.source : '',
      before,
      after,
    });
  }

  private confirmRestore(c: ChangeRecord) {
    new RestoreModal(this.app, c, async () => {
      const adapter = this.app.vault.adapter;
      const current = (await adapter.exists(c.path)) ? await adapter.read(c.path) : null;
      if (c.before === null) {
        // The write created the note: undo moves it to Obsidian's trash (recoverable).
        const f = this.app.vault.getAbstractFileByPath(c.path);
        if (f) await this.app.fileManager.trashFile(f);
      } else {
        const f = this.app.vault.getAbstractFileByPath(c.path);
        if (f instanceof TFile) await this.app.vault.process(f, () => c.before as string);
        else await this.app.vault.create(c.path, c.before);
      }
      // The undo is itself a change, so it can be undone too.
      await this.changes.add({
        id: `${Date.now().toString(36)}-undo`,
        t: Date.now(),
        agent: 'you',
        path: c.path,
        purpose: `Undo of ${c.agent}'s change at ${new Date(c.t).toLocaleTimeString([], { hour12: false })}`,
        source: 'H!V3MYND restore',
        before: current,
        after: c.before,
        restoreOf: c.id,
      });
      new Notice(`Restored “${noteTitle(c.path)}” to before ${c.agent}'s change.`);
    }).open();
  }

  // ------------------------------------------------------------ bridge traffic

  private bridgeFile() { return `${this.manifest.dir}/bridge-messages.jsonl`; }

  private async loadBridgeMessages() {
    try {
      if (!(await this.app.vault.adapter.exists(this.bridgeFile()))) return;
      const seen = new Set<string>();
      for (const line of (await this.app.vault.adapter.read(this.bridgeFile())).split('\n')) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line) as BridgeMessage;
          if (!seen.has(m.id)) { seen.add(m.id); this.bridgeMessages.push(m); }
        } catch { /* torn line */ }
      }
      this.bridgeMessages.sort((a, b) => a.t - b.t);
    } catch (err) {
      console.warn('H!V3MYND: could not load bridge messages', err);
    }
  }

  private addBridgeMessage(raw: any) {
    if (!raw || typeof raw.id !== 'string' || this.bridgeMessages.some((m) => m.id === raw.id)) return;
    const t = typeof raw.ts === 'number' ? raw.ts * 1000 : Date.parse(raw.timestamp ?? '') || Date.now();
    const m: BridgeMessage = {
      id: raw.id,
      sender: String(raw.sender ?? 'other'),
      recipient: String(raw.recipient ?? 'all'),
      body: String(raw.body ?? raw.text ?? ''),
      reply_to: raw.reply_to ?? null,
      t,
      important: !!raw.important,
    };
    this.bridgeMessages.push(m);
    this.bridgeMessages.sort((a, b) => a.t - b.t);
    void this.app.vault.adapter.append(this.bridgeFile(), JSON.stringify(m) + '\n');
    // Only animate fresh traffic, not a history backfill.
    if (Date.now() - t < 60_000 && !this.replaying) {
      for (const v of this.views()) v.renderer?.message(this.alias(m.sender), m.recipient === 'all' ? 'all' : this.alias(m.recipient));
    }
    for (const fn of this.bridgeListeners) fn(m);
  }

  // ------------------------------------------------------------ music reactivity

  async toggleMusic() {
    if (this.audio.running) {
      this.audio.stop();
      for (const v of this.views()) if (v.renderer) v.renderer.audio = null;
      new Notice('H!V3MYND: music reactivity off');
      return;
    }
    // Default: system audio loopback (whatever the PC is playing), no cable needed.
    await this.audio.start(this.settings.audioDevice || SYSTEM_AUDIO);
    this.audio.setBass(this.settings.musicBassCutoff, this.settings.musicBassSensitivity);
    if (!this.audio.running) { new Notice(`H!V3MYND: couldn't open audio input (${this.audio.error})`); return; }
    this.applyMusic();
    new Notice(`H!V3MYND: music reactivity on, listening to ${this.audio.deviceLabel}`);
  }

  applyMusic() {
    for (const v of this.views()) {
      if (!v.renderer) continue;
      const s = this.settings;
      v.renderer.audio = this.audio.running ? { reactor: this.audio, strength: s.musicStrength, delayMs: s.musicDelay, midHigh: s.musicMidHigh, palette: MUSIC_PALETTES[s.musicPalette] ?? MUSIC_PALETTES.Neon, gains: { bass: s.musicBassGain, mid: s.musicMidGain, high: s.musicHighGain } } : null;
      v.renderer.audioControls = this.audioControls;
    }
  }

  private saveGains = debounce(() => void this.saveData(this.settings), 500, true);

  /** Wiring for the music panel in the brain: band sliders and the source picker. */
  readonly audioControls: AudioControls = {
    setGain: (band, v) => {
      const key = band === 'bass' ? 'musicBassGain' : band === 'mid' ? 'musicMidGain' : 'musicHighGain';
      this.settings[key] = Math.max(0, Math.min(2, v));
      for (const view of this.views()) if (view.renderer?.audio) view.renderer.audio.gains[band] = this.settings[key];
      this.saveGains();
    },
    sources: async () => {
      const out: AudioSource[] = [{ id: '', label: 'System audio (default output)', kind: 'system' }];
      try {
        for (const d of await AudioReactor.inputs()) out.push({ id: d.deviceId, label: d.label || 'Unnamed input', kind: 'input' });
        for (const d of await navigator.mediaDevices.enumerateDevices()) {
          if (d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications') out.push({ id: `out:${d.deviceId}`, label: d.label || 'Unnamed output', kind: 'output' });
        }
      } catch { /* listing failed: system audio still works */ }
      return out;
    },
    sensitivity: () => this.settings.musicBassSensitivity,
    setSensitivity: (v) => {
      this.settings.musicBassSensitivity = Math.max(0.5, Math.min(2, v));
      this.audio.setBass(this.settings.musicBassCutoff, this.settings.musicBassSensitivity);
      this.saveGains();
    },
    selected: () => this.settings.audioDevice,
    select: (id) => void this.selectAudio(id),
    detect: async () => {
      const inputs = (await AudioReactor.inputs()).filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications');
      const [system, levels] = await Promise.all([AudioReactor.probeSystem(), AudioReactor.probe(inputs.map((d) => d.deviceId), 700)]);
      const all = [{ id: '', label: 'System audio', peak: system }, ...inputs.map((d) => ({ id: d.deviceId, label: d.label || 'input', peak: levels[d.deviceId] ?? -1 }))];
      all.sort((a, b) => b.peak - a.peak);
      // System audio is the music itself. Room mics (webcams, headsets) also pick up
      // the speakers and can read louder, so system wins whenever it carries sound.
      const best = system >= 0.02 ? all.find((x) => x.id === '')! : all[0];
      if (!best || best.peak < 0.01) return 'No sound on any source. Start the music, then try again.';
      if (best.id !== this.settings.audioDevice || !this.audio.running) {
        if (!this.audio.running) { this.settings.audioDevice = best.id; await this.saveData(this.settings); await this.toggleMusic(); }
        else await this.selectAudio(best.id);
      }
      return `Listening to ${best.label} (loudest source).`;
    },
  };

  /** Switch what the brain listens to; '' = system audio loopback. */
  async selectAudio(id: string) {
    this.settings.audioDevice = id;
    await this.saveData(this.settings);
    if (!this.audio.running) return;
    await this.audio.start(id || SYSTEM_AUDIO);
    this.audio.setBass(this.settings.musicBassCutoff, this.settings.musicBassSensitivity);
    if (!this.audio.running) new Notice(`H!V3MYND: couldn't open that audio source (${this.audio.error})`);
    else new Notice(`H!V3MYND: listening to ${this.audio.deviceLabel}`);
    this.applyMusic();
  }

  // ------------------------------------------------------------ heat & decay

  async toggleHeat() {
    this.heatOn = !this.heatOn;
    if (this.heatTimer !== null) window.clearInterval(this.heatTimer);
    this.heatTimer = null;
    if (this.heatOn) this.heatTimer = window.setInterval(() => void this.applyHeat(), 30_000);
    await this.applyHeat();
  }

  /** Recomputes heat/decay from 90 days of log plus file edit times and pushes it to the brain. */
  async applyHeat() {
    if (!this.heatOn) { for (const v of this.views()) v.renderer?.setHeat(null, null, false); return; }
    const g = this.getGraph();
    const now = Date.now();
    const history = foldHistory(await this.log.history(90), now);
    const mtimes = new Map<string, number>();
    for (const f of this.app.vault.getMarkdownFiles()) mtimes.set(f.path, f.stat.mtime);
    const { heat, decay } = heatAndDecay(g.paths, history, mtimes, now);
    for (const v of this.views()) v.renderer?.setHeat(heat, decay, true);
  }

  demo() {
    const g = this.getGraph();
    const linked = [...new Set(g.links.flat())];
    if (!linked.length) return;
    const pick = () => g.paths[linked[(Math.random() * linked.length) | 0]];
    const steps: PulseEvent[] = [
      { agent: 'claude', kind: 'scan', texts: Array.from({ length: 30 }, pick) },
      { agent: 'claude', kind: 'read', texts: [pick()] },
      { agent: 'claude', kind: 'read', texts: [pick()] },
      { agent: 'codex', kind: 'read', texts: [pick()] },
      { agent: 'claude', kind: 'read', texts: [pick()] },
      { agent: 'codex', kind: 'write', texts: [pick()] },
    ];
    steps.forEach((ev, i) => window.setTimeout(() => this.pulse({ ...ev, source: 'demo' }), 400 + i * 1600));
  }

  // ------------------------------------------------------------ settings

  /** Constant-time comparison against the listener key. */
  private keyOk(given: string) { return safeEqual(this.settings.listenerKey, given); }

  /** Path other local tools (bridge, hooks) read the key from. */
  keyFilePath() {
    const os = (window as any).require('os');
    const path = (window as any).require('path');
    return path.join(os.homedir(), '.hivemynd', 'listener.key');
  }

  private writeKeyFile() {
    try {
      const fs = (window as any).require('fs');
      const path = (window as any).require('path');
      const file = this.keyFilePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, this.settings.listenerKey, { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      console.warn('H!V3MYND: could not write listener key file', err);
    }
  }

  async regenerateViewerKey() {
    this.settings.viewerKey = randomHex(24);
    await this.saveData(this.settings);
    this.startViewer(); // restarting drops open viewers that used the old key
  }

  async regenerateKey() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    this.settings.listenerKey = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await this.saveData(this.settings);
    this.writeKeyFile();
  }

  /**
   * Secrets (listener and viewer keys, the alert webhook URL) live in Obsidian's
   * SecretStorage, never in data.json, which plugins and sync tools can read.
   */
  async saveData(data: any) {
    const ss = this.app.secretStorage;
    const copy = { ...data };
    for (const [k, id] of SECRET_FIELDS) {
      const v = copy[k];
      if (typeof v === 'string' && v !== (ss.getSecret(id) ?? '')) ss.setSecret(id, v);
      delete copy[k];
    }
    await super.saveData(copy);
  }

  async loadSettings() {
    const saved = (await this.loadData()) ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    const ss = this.app.secretStorage;
    let legacy = false;
    for (const [k, id] of SECRET_FIELDS) {
      if (typeof saved[k] === 'string' && saved[k]) legacy = true; // older data.json held it in plain text
      const v = ss.getSecret(id);
      if (v) (this.settings as any)[k] = v;
    }
    if (legacy) await this.saveData(this.settings); // moves them into SecretStorage
    if (!this.settings.listenerKey) await this.regenerateKey();
    else this.writeKeyFile();
    if (!this.settings.viewerKey) { this.settings.viewerKey = randomHex(24); await this.saveData(this.settings); }
    // Keep agents added in later versions even if the saved list predates them.
    const names = new Set(this.settings.agents.map((a) => a.name));
    this.settings.agents = [...this.settings.agents, ...DEFAULT_OPTIONS.agents.filter((a) => !names.has(a.name))];
  }

  async saveSettings() {
    await this.saveData(this.settings);
    for (const v of this.views()) { v.renderer?.setOptions(this.settings); v.renderer?.setAgents(this.settings.agents); }
  }
}

/** An agent wants to use the PC through the bridge: approve once, for 10 minutes, or deny. */
class ApprovalModal extends Modal {
  private done = false;
  private timer: number | null = null;

  constructor(app: App, private agent: string, private action: string, private detail: string, private decide: (c: 'once' | 'ten' | 'deny') => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('plexus-approval');
    contentEl.createEl('h3', { text: `${this.agent} wants to ${this.action}` });
    if (this.detail) contentEl.createEl('pre', { cls: 'plexus-approval-detail', text: this.detail });
    const left = contentEl.createDiv({ cls: 'plexus-approval-timer' });
    let s = 60;
    const tick = () => { left.setText(`Denied automatically in ${s} s if you don't choose.`); if (s-- <= 0) this.finish('deny'); };
    tick();
    this.timer = window.setInterval(tick, 1000);
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { text: 'Deny' }).addEventListener('click', () => this.finish('deny'));
    row.createEl('button', { text: 'Allow for 10 min' }).addEventListener('click', () => this.finish('ten'));
    row.createEl('button', { cls: 'mod-cta', text: 'Allow once' }).addEventListener('click', () => this.finish('once'));
  }

  private finish(c: 'once' | 'ten' | 'deny') {
    if (this.done) return;
    this.done = true;
    this.decide(c);
    this.close();
  }

  onClose() {
    if (this.timer !== null) window.clearInterval(this.timer);
    if (!this.done) { this.done = true; this.decide('deny'); }
    this.contentEl.empty();
  }
}

class RestoreModal extends Modal {
  constructor(app: App, private c: ChangeRecord, private onConfirm: () => Promise<void>) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    const created = this.c.before === null;
    contentEl.createEl('h3', { text: created ? 'Remove this note?' : 'Restore this note?' });
    contentEl.createEl('p', {
      text: created
        ? `${this.c.agent} created “${noteTitle(this.c.path)}”. Undoing moves it to Obsidian's trash (.trash), where you can still recover it.`
        : `This puts “${noteTitle(this.c.path)}” back to how it was just before ${this.c.agent}'s change at ${new Date(this.c.t).toLocaleTimeString([], { hour12: false })}. Anything written since then is replaced; the current version is kept as a new entry in Changes, so this can be undone too.`,
    });
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const ok = row.createEl('button', { cls: 'mod-warning', text: created ? 'Move to trash' : 'Restore' });
    ok.addEventListener('click', async () => { ok.disabled = true; await this.onConfirm(); this.close(); });
  }

  onClose() {
    this.contentEl.empty();
  }
}

function ago(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)} min`;
}

function signatureOf(g: GraphInput) {
  let h = g.paths.length * 31 + g.links.length;
  for (const p of g.paths) for (let i = 0; i < p.length; i++) h = (Math.imul(h, 31) + p.charCodeAt(i)) | 0;
  return `${g.paths.length}:${g.links.length}:${h}`;
}

class PlexusView extends ItemView {
  renderer: PlexusRenderer | null = null;
  private fsButton: HTMLButtonElement | null = null;
  private replay: ReplayBar | null = null;
  private search: BrainSearch | null = null;
  private growth: GrowthBar | null = null;
  private card: HoverCard | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: PlexusPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'H!V3MYND'; }
  getIcon() { return 'brain-circuit'; }

  async onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass('plexus-view');
    el.tabIndex = 0;
    const host = el.createDiv({ cls: 'plexus-host' });

    const bar = el.createDiv({ cls: 'plexus-toolbar' });
    this.fsButton = this.button(bar, 'maximize', 'Full screen (F)', () => this.toggleFullscreen());
    this.button(bar, 'locate-fixed', 'Recenter (double-click)', () => this.renderer?.recenter());
    this.button(bar, 'zap', 'Demo agent activity', () => this.plugin.demo());
    this.button(bar, 'flame', 'Heat & decay view (H)', () => void this.plugin.toggleHeat());
    this.button(bar, 'history', 'Replay agent activity (R)', () => this.toggleReplayBar());
    this.button(bar, 'sprout', 'Vault growth time-lapse (G)', () => this.toggleGrowth());
    this.button(bar, 'shapes', 'Meaning map: arrange by topic instead of links (S)', () => void this.plugin.toggleMeaning());
    this.button(bar, 'music', 'Music reactivity (M)', () => void this.plugin.toggleMusic());
    this.button(bar, 'search', 'Search the brain (/ or Ctrl+F)', () => this.search?.show());
    const theme = this.button(bar, this.plugin.settings.brainLight ? 'moon' : 'sun', 'Light / dark theme', () => {
      this.plugin.settings.brainLight = !this.plugin.settings.brainLight;
      void this.plugin.saveData(this.plugin.settings);
      setIcon(theme, this.plugin.settings.brainLight ? 'moon' : 'sun');
      this.applyTheme();
    });
    this.button(bar, 'activity', 'Brain Monitor (own window)', () => void this.plugin.activateLog(true));

    try {
      this.renderer = new PlexusRenderer(host, this.plugin.settings);
    } catch (err) {
      el.createDiv({ cls: 'plexus-error', text: `H!V3MYND needs WebGL 2: ${err}` });
      return;
    }
    this.renderer.onOpen = (i, split) => {
      const path = this.plugin.getGraph().paths[i];
      if (!path) return;
      if (document.fullscreenElement) void document.exitFullscreen();
      void this.app.workspace.openLinkText(path, '', split ? 'split' : 'tab');
    };
    this.applyTheme();
    this.renderer.onSettled = (cache) => void this.plugin.saveLayout(cache, this.layoutMode);
    this.search = new BrainSearch(el, this.app, {
      paths: () => this.plugin.getGraph().paths,
      focus: (ix) => this.renderer?.setFocus(ix, '#5fe8ff'),
      fly: (i) => this.renderer?.highlight(i),
      open: (path) => {
        this.search?.close();
        if (document.fullscreenElement) void document.exitFullscreen();
        void this.app.workspace.openLinkText(path, '', 'tab');
      },
    });
    this.card = new HoverCard(el, this.app, () => this.plugin.log, (path) => {
      const links = this.app.metadataCache.resolvedLinks;
      let inn = 0;
      for (const targets of Object.values(links)) if (targets[path]) inn++;
      return { out: Object.keys(links[path] ?? {}).length, in: inn };
    }, (a) => this.plugin.settings.agents.find((x) => x.name === a)?.color ?? '#ffffff');
    this.renderer.onHover = (i, x, y) => this.card?.update(i >= 0 ? this.plugin.getGraph().paths[i] ?? null : null, i, x, y);
    this.renderer.setAgents(this.plugin.settings.agents);
    this.replay = new ReplayBar(el, {
      renderer: () => this.renderer,
      history: (days) => this.plugin.log.history(days),
      indexOf: (p) => this.plugin.getGraph().paths.indexOf(p),
      setReplaying: (on) => { this.plugin.replaying = on; },
    });
    this.growth = new GrowthBar(el, this.app, { renderer: () => this.renderer, paths: () => this.plugin.getGraph().paths });
    await this.reloadGraph();

    this.registerDomEvent(el, 'pointerdown', () => el.focus({ preventScroll: true }));
    this.registerDomEvent(el, 'keydown', (e: KeyboardEvent) => {
      if (this.replay?.handleKey(e)) return;
      if (this.growth?.handleKey(e)) return;
      if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void this.plugin.toggleMeaning(); return; }
      if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.toggleGrowth(); return; }
      if ((e.key === '/' || ((e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey))) && !e.altKey) { e.preventDefault(); this.search?.show(); return; }
      if (e.key === 'Escape' && this.search?.open) { e.preventDefault(); this.search.close(); return; }
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.toggleReplayBar(); }
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.toggleFullscreen(); }
      if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void this.plugin.toggleHeat(); }
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void this.plugin.toggleMusic(); }
    });
    this.registerDomEvent(document, 'fullscreenchange', () => {
      if (this.fsButton) setIcon(this.fsButton, document.fullscreenElement === el ? 'minimize' : 'maximize');
    });
  }

  debugSizes() {
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { cls: (el as HTMLElement).className, w: Math.round(r.width), h: Math.round(r.height), pos: cs.position, display: cs.display, hCss: cs.height };
    };
    const host = this.contentEl.querySelector('.plexus-host');
    return {
      leaf: box(this.containerEl),
      content: box(this.contentEl),
      host: box(host),
      canvas: box(host?.querySelector('canvas')),
      canvasPx: [host?.querySelector('canvas')?.width, host?.querySelector('canvas')?.height],
      fullscreen: document.fullscreenElement ? (document.fullscreenElement as HTMLElement).className : null,
      screen: [screen.width, screen.height, window.innerWidth, window.innerHeight, devicePixelRatio],
    };
  }

  private layoutMode = 'links';

  async reloadGraph() {
    if (!this.renderer) return;
    if (this.growth?.open) this.growth.close(); // birth order is per graph
    const g = this.plugin.getGraph();
    const mode = this.plugin.settings.meaningMap ? 'meaning' : 'links';
    let input: GraphInput = g;
    if (mode === 'meaning') {
      try { input = { ...g, layoutLinks: await this.plugin.meaningLinks(g), layoutKey: 'meaning' }; }
      catch (err) { new Notice(`H!V3MYND: meaning map failed (${err instanceof Error ? err.message : err})`); }
    }
    if (!this.renderer || this.plugin.getGraph() !== g) return; // closed or superseded meanwhile
    this.layoutMode = input.layoutKey ?? 'links';
    this.renderer.setGraph(input, await this.plugin.loadLayout(this.layoutMode));
    if (this.plugin.heatOn) await this.plugin.applyHeat();
    this.plugin.applyMusic();
  }

  toggleReplay() {
    return this.replay?.toggleOpen();
  }

  applyTheme() {
    const light = this.plugin.settings.brainLight;
    this.contentEl.toggleClass('is-light', light);
    this.renderer?.setTheme(light);
  }

  // Replay and the growth time-lapse share the bottom bar; one at a time.
  private toggleReplayBar() {
    if (this.growth?.open) this.growth.close();
    void this.replay?.toggleOpen();
  }

  toggleGrowth() {
    if (this.replay?.open) this.replay.close();
    this.growth?.toggleOpen();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.contentEl.requestFullscreen().catch((err) => new Notice(`H!V3MYND: full screen refused (${err.message})`));
  }

  async onClose() {
    if (this.replay?.open) this.replay.close();
    if (this.growth?.open) this.growth.close();
    if (document.fullscreenElement === this.contentEl) await document.exitFullscreen();
    this.renderer?.dispose();
    this.renderer = null;
  }

  private button(parent: HTMLElement, icon: string, label: string, onClick: () => void) {
    const b = parent.createEl('button', { cls: 'plexus-btn', attr: { 'aria-label': label } });
    setIcon(b, icon);
    b.addEventListener('click', onClick);
    return b;
  }
}

class PlexusSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PlexusPlugin) {
    super(app, plugin);
  }

  display() {
    let { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => void this.plugin.saveSettings();
    containerEl.empty();

    const slider = (name: string, desc: string, key: keyof PlexusSettings, min: number, max: number, step: number) =>
      new Setting(containerEl).setName(name).setDesc(desc).addSlider((sl) =>
        sl.setLimits(min, max, step).setValue(s[key] as number).setDynamicTooltip().onChange((v) => { (s as any)[key] = v; save(); }));
    const toggle = (name: string, desc: string, key: keyof PlexusSettings, after?: () => void) =>
      new Setting(containerEl).setName(name).setDesc(desc).addToggle((t) =>
        t.setValue(s[key] as boolean).onChange((v) => { (s as any)[key] = v; save(); after?.(); }));
    const color = (name: string, key: keyof PlexusSettings) =>
      new Setting(containerEl).setName(name).addColorPicker((c) => c.setValue(s[key] as string).onChange((v) => { (s as any)[key] = v; save(); }));

    new Setting(containerEl).setName('Look').setHeading();
    color('Orb colour', 'nodeColor');
    color('Link colour', 'linkColor');
    slider('Link strength', 'How solid the connection lines are.', 'linkStrength', 0, 3, 0.05);
    slider('Orb size', 'Size of each note.', 'nodeSize', 0.5, 4, 0.05);
    color('Firing colour', 'fireColor');
    color('Nebula colour', 'nebulaColor');
    slider('Glow strength', 'Bloom around bright nodes and pulses.', 'bloomStrength', 0, 3, 0.05);
    slider('Glow radius', '', 'bloomRadius', 0, 1, 0.05);
    slider('Glow threshold', 'Lower makes more of the network glow.', 'bloomThreshold', 0, 1, 0.01);
    slider('Depth of field', 'How strongly notes away from the focus blur into bokeh.', 'depthBlur', 0, 3, 0.05);
    slider('Nebula', 'Background cloud brightness.', 'nebula', 0, 3, 0.05);
    slider('Film grain', '', 'grain', 0, 2, 0.05);
    toggle('Ambient plexus lines', 'Faint lines between nearby notes, in addition to real links.', 'plexusLines');
    toggle('Triangle facets', 'Translucent faces where three notes connect.', 'triangles');

    new Setting(containerEl).setName('Motion').setHeading();
    slider('Neuron activity', 'Spontaneous firing rate. 0 stills the network.', 'activity', 0, 4, 0.05);
    slider('Drift', 'How much notes float.', 'drift', 0, 3, 0.05);
    slider('Auto-rotate speed', '0 turns it off.', 'autoRotate', 0, 3, 0.05);
    toggle('Follow agents', 'Camera glides to the note an agent just read or wrote.', 'followAI');

    new Setting(containerEl).setName('Performance').setHeading();
    slider('Max pixel ratio', 'Render resolution cap. 2 is crisp on 4K/HiDPI; 1 is lighter.', 'maxPixelRatio', 0.5, 3, 0.25);
    toggle('Multisample anti-aliasing', 'Takes effect next time the view opens.', 'msaa');

    new Setting(containerEl).setName('Notes').setHeading();
    toggle('Show unlinked notes', 'Notes with no links appear as faint dust.', 'showOrphans', () => this.plugin.refreshGraph(true));
    new Setting(containerEl).setName('Exclude folders').setDesc('Comma-separated path prefixes, e.g. "Archive/, Templates/".').addText((t) =>
      t.setValue(s.exclude).onChange(debounce((v: string) => { s.exclude = v; save(); this.plugin.refreshGraph(true); }, 800, true)));

    new Setting(containerEl).setName('Access log').setHeading();
    toggle('Store agent prompts', 'Keep what each agent was asked to do (its prompt, first line) with every access, for the Tasks tab, reports and context budget. Off: accesses are logged without it.', 'storePurposes');
    toggle('Log searches', 'Record notes that surfaced in agent searches (one line per search), not just reads and writes.', 'logSearches');
    toggle('Daily digest notes', 'Also write a readable table per day into the vault. The folder is kept out of the brain.', 'digest', () => this.plugin.refreshGraph(true));
    toggle('Daily brain report', "Summarise each day's agent activity in one note (Reports subfolder of the digest folder): who did what, most-used notes, alerts, re-reads and searches that found nothing. Written the next day, or any time with the command.", 'dailyReport', () => this.plugin.refreshGraph(true));
    new Setting(containerEl).setName('Digest folder').addText((t) =>
      t.setValue(s.digestFolder).onChange(debounce((v: string) => { s.digestFolder = v.trim() || 'Access Log'; save(); this.plugin.refreshGraph(true); }, 800, true)));

    new Setting(containerEl).setName('Music reactivity').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'The brain pulses to music. By default it listens to everything this PC plays (system audio loopback), so nothing needs routing. You can pick a specific input instead, like a mic or an interface channel. Toggle with M in the brain or the ♫ button.',
    });
    const deviceSetting = new Setting(containerEl).setName('Audio input').setDesc('Loading inputs…');
    void AudioReactor.inputs().then((inputs) => {
      deviceSetting.setDesc('What the brain listens to.');
      deviceSetting.addDropdown((d) => {
        d.addOption('', 'System audio: whatever this PC is playing (recommended)');
        for (const i of inputs) d.addOption(i.deviceId, i.label || 'Unnamed input');
        d.setValue(s.audioDevice).onChange(async (v) => {
          await this.plugin.selectAudio(v);
        });
      });
    });
    new Setting(containerEl).setName('Bass cutoff (Hz)').setDesc('The brain swells on every low hit at or below this frequency. 80 Hz = kick drums and sub-bass only.').addSlider((sl) =>
      sl.setLimits(40, 160, 5).setValue(s.musicBassCutoff).setDynamicTooltip().onChange((v) => { s.musicBassCutoff = v; save(); this.plugin.audio.setBass(v, s.musicBassSensitivity); }));
    new Setting(containerEl).setName('Bass sensitivity').setDesc('Higher catches softer low hits; lower reacts only to strong kicks.').addSlider((sl) =>
      sl.setLimits(0.5, 2, 0.05).setValue(s.musicBassSensitivity).setDynamicTooltip().onChange((v) => { s.musicBassSensitivity = v; save(); this.plugin.audio.setBass(s.musicBassCutoff, v); }));
    new Setting(containerEl).setName('Mids & highs sensitivity').setDesc('Relative to bass. 0.5 = the light show reacts at half the sensitivity of the bass swell.').addSlider((sl) =>
      sl.setLimits(0, 1.5, 0.05).setValue(s.musicMidHigh).setDynamicTooltip().onChange((v) => { s.musicMidHigh = v; save(); this.plugin.applyMusic(); }));
    new Setting(containerEl).setName('Light show palette').setDesc('Colours the mids and highs fire in.').addDropdown((d) => {
      for (const name of Object.keys(MUSIC_PALETTES)) d.addOption(name, name);
      d.setValue(s.musicPalette).onChange((v) => { s.musicPalette = v; save(); this.plugin.applyMusic(); });
    });
    new Setting(containerEl).setName('Strength').setDesc('Overall: how far the brain swells on bass and how busy the light show gets.').addSlider((sl) =>
      sl.setLimits(0, 3, 0.05).setValue(s.musicStrength).setDynamicTooltip().onChange((v) => { s.musicStrength = v; save(); this.plugin.applyMusic(); }));
    new Setting(containerEl).setName('Sync delay (ms)').setDesc('Hold the visuals back if sound reaches you late (Bluetooth headphones ≈ 150–250 ms). 0 for wired speakers.').addSlider((sl) =>
      sl.setLimits(0, 400, 5).setValue(s.musicDelay).setDynamicTooltip().onChange((v) => { s.musicDelay = v; save(); this.plugin.applyMusic(); }));

    new Setting(containerEl).setName('Agent permissions').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Limit what each agent may do through the bridge. The bridge enforces these; a blocked attempt shows as a red alert. PC control covers commands, apps, web pages, screenshots and files outside the vault: Allow, Ask (you approve each action here; unanswered = denied) or Block. Some paths are always off limits whatever you choose: the bridge folder, agent configs (.claude, .grok, .hivemynd), credentials, browser profiles, startup folders and the vault\u2019s configuration folder. Needs the bridge policy file path below.',
    });
    new Setting(containerEl).setName('Bridge policy file').setDesc('Full path of agent_policies.json next to your bridge, e.g. C:\\hivemynd\\bridge\\agent_policies.json. Leave empty if you don’t run a bridge.').addText((t) =>
      t.setValue(s.policyFile).onChange(debounce((v: string) => { s.policyFile = v.trim(); save(); this.plugin.writePolicies(); }, 800, true)));
    new Setting(containerEl).setName('Enforce agent permissions').setDesc('Off: agents work without the rules below (no approvals, hidden folders or read-only). Your rules stay saved for when you turn this back on. Protected paths are always enforced.').addToggle((t) =>
      t.setValue(s.enforcePermissions).onChange((v) => { s.enforcePermissions = v; save(); this.plugin.writePolicies(); this.display(); }));
    const modes: Record<PcMode, string> = { allow: 'PC: allow', ask: 'PC: ask me', block: 'PC: block' };
    const rulesEl = containerEl.createDiv({ cls: s.enforcePermissions ? '' : 'plexus-rules-off' });
    const ruleHost = containerEl;
    containerEl = rulesEl;
    new Setting(containerEl).setName('Default PC control').setDesc('For agents that don\u2019t have their own rule below.').addDropdown((d) =>
      d.addOptions(modes).setValue(s.defaultPcControl).onChange((v) => { s.defaultPcControl = v as PcMode; save(); this.plugin.writePolicies(); }));
    for (const a of s.agents.filter((x) => x.name !== 'other')) {
      const p = (s.policies[a.name] ??= { deny: '', readOnly: false, pcControl: s.defaultPcControl });
      const commit = () => { save(); this.plugin.writePolicies(); };
      const row = new Setting(containerEl).setName(a.name).setDesc('Hidden folders (comma-separated)');
      row.addText((t) => t.setPlaceholder('e.g. Personal/, Finance/').setValue(p.deny).onChange(debounce((v: string) => { p.deny = v; commit(); }, 600, true)));
      row.addToggle((t) => t.setTooltip('Read-only').setValue(p.readOnly).onChange((v) => { p.readOnly = v; commit(); }));
      row.addDropdown((d) => d.addOptions(modes).setValue(pcModeOf(p, s.defaultPcControl)).onChange((v) => { p.pcControl = v as PcMode; commit(); }));
    }
    containerEl = ruleHost;

    new Setting(containerEl).setName('Watchlist').setHeading();
    new Setting(containerEl).setName('Watched folders and notes').setDesc('One path prefix per line; add ": read, write, search" to choose what alerts. Any agent touching these flashes red in the brain and raises an alert. You can also right-click a note or folder → Watch in H!V3MYND.').addTextArea((t) => {
      t.setValue(s.watchlist).onChange(debounce((v: string) => { s.watchlist = v; save(); }, 600, true));
      t.inputEl.rows = 7;
      t.inputEl.setCssStyles({ width: '100%' });
    });
    toggle('Desktop notifications', 'Also show a Windows notification for watchlist alerts.', 'watchNotify');

    new Setting(containerEl).setName('Agents').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: `Each agent that reads or writes notes leaves its own coloured trail. Agents report to http://127.0.0.1:${s.port}/pulse.`,
    });
    toggle('Agent listener', 'Accept pulses from local agents (Claude Code hook, Agent Bridge).', 'bridge', () => this.plugin.restartServer());
    toggle('Developer mode', 'Extra listener endpoints for tooling: remote-control the brain view (heat, replay, focus, music), audio probes, plugin reload and detailed health. Leave off unless you build on H!V3MYND.', 'developerMode');
    new Setting(containerEl).setName('Listener port').addText((t) =>
      t.setValue(String(s.port)).onChange(debounce((v: string) => {
        const port = Number(v);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
        s.port = port;
        save();
        this.plugin.restartServer();
      }, 800, true)));
    new Setting(containerEl).setName('Listener key').setDesc(`Every request to the local listener must carry this key (header X-Hivemynd-Key). It's also saved to ${this.plugin.keyFilePath()} so local tools can read it. If you regenerate it, update your hook configs.`)
      .addButton((b) => b.setButtonText('Copy key').onClick(() => { void navigator.clipboard.writeText(s.listenerKey); new Notice('H!V3MYND key copied'); }))
      .addButton((b) => b.setButtonText('Regenerate').setWarning().onClick(async () => { await this.plugin.regenerateKey(); new Notice('H!V3MYND: new key saved. Update hook configs that send the old one.'); }));
    connectSection(containerEl, s.port, s.listenerKey);
    new Setting(containerEl).setName('Agent aliases').setDesc('Show one token name as another, e.g. "bot2=claude" when an agent reports under a different name. Comma-separated.').addText((t) =>
      t.setValue(s.agentAliases).onChange(debounce((v: string) => { s.agentAliases = v; save(); }, 600, true)));
    s.agents.forEach((agent) => {
      new Setting(containerEl).setName(agent.name).addColorPicker((c) => c.setValue(agent.color).onChange((v) => { agent.color = v; save(); }));
    });

    new Setting(containerEl).setName('Phone alerts').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Off by default. Pushes Brain Monitor alerts to your phone: agents clashing on a note, actions blocked by permissions, watched notes touched. Only the alert line is sent, never note contents. Easiest: install the free ntfy app, subscribe to a private topic, and paste its URL below (ntfy.sh or your own ntfy server). A Discord webhook or any JSON endpoint also works.',
    });
    toggle('Send phone alerts', 'Push alerts to the URL below.', 'phoneAlerts');
    new Setting(containerEl).setName('Alert URL').setDesc('ntfy topic URL, Discord webhook URL, or any endpoint that accepts a JSON POST. Anyone who knows an ntfy topic can read it, so use a generated one.')
      .addText((t) => t.setPlaceholder('https://ntfy.sh/hivemynd-...').setValue(s.phoneUrl).onChange(debounce((v: string) => { s.phoneUrl = v.trim(); save(); }, 600, true)))
      .addButton((b) => b.setButtonText('New private ntfy topic').onClick(() => { s.phoneUrl = `https://ntfy.sh/${randomTopic()}`; s.phoneFormat = 'ntfy'; save(); this.display(); }));
    new Setting(containerEl).setName('Alert format').addDropdown((d) => d.addOptions({ ntfy: 'ntfy', discord: 'Discord webhook', json: 'Plain JSON' }).setValue(s.phoneFormat).onChange((v) => { s.phoneFormat = v as PhoneFormat; save(); }));
    toggle('Clashes', 'Two agents editing one note, or editing a note another agent is working from.', 'phoneClashes');
    toggle('Blocked actions', "An agent tried something its permissions don't allow.", 'phoneBlocked');
    toggle('Watchlist', 'An agent touched a watched note or folder.', 'phoneWatch');
    toggle('Hide note names', 'Say "a note" instead of the note title.', 'phoneHideNames');
    new Setting(containerEl).setName('Test').addButton((b) => b.setButtonText('Send test alert').onClick(async () => {
      try { await this.plugin.phone.send('H!V3MYND test', 'Phone alerts are working.'); new Notice('H!V3MYND: test alert sent'); }
      catch (err) { new Notice(`H!V3MYND: test alert failed (${err instanceof Error ? err.message : err})`); }
    }));

    new Setting(containerEl).setName('Web viewer').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Off by default. A read-only copy of the live brain in any browser: a phone, tablet or second screen. It shows note names, links and agent activity, never note contents, and nothing in it can change your vault. Anyone with the link can watch, so share it like a password; a new key cuts everyone off.',
    });
    toggle('Run the web viewer', 'Serve the brain at the link below.', 'webViewer', () => { this.plugin.startViewer(); this.display(); });
    toggle('Allow other devices on my network', 'Off: only this computer can open it. On: phones and tablets on the same Wi-Fi can too.', 'webViewerLan', () => { this.plugin.startViewer(); this.display(); });
    new Setting(containerEl).setName('Viewer port').addText((t) =>
      t.setValue(String(s.webViewerPort)).onChange(debounce((v: string) => {
        const port = Number(v);
        if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === s.port) return;
        s.webViewerPort = port;
        save();
        this.plugin.startViewer();
      }, 800, true)));
    if (s.webViewer) {
      new Setting(containerEl).setName('Viewer link').setDesc(this.plugin.viewerUrl().replace(/key=.*/, 'key=...'))
        .addButton((b) => b.setButtonText('Copy link').onClick(() => { void navigator.clipboard.writeText(this.plugin.viewerUrl()); new Notice('H!V3MYND: viewer link copied'); }))
        .addButton((b) => b.setButtonText('Open').onClick(() => window.open(this.plugin.viewerUrl())))
        .addButton((b) => b.setButtonText('New key').setWarning().onClick(async () => { await this.plugin.regenerateViewerKey(); new Notice('H!V3MYND: viewer key changed; old links stop working'); this.display(); }));
    }
  }
}

function hashPaths(paths: string[]) {
  let h = 2166136261;
  for (const p of paths) for (let i = 0; i < p.length; i++) { h ^= p.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Constant-time string comparison for keys. */
function safeEqual(key: string, given: string) {
  if (!key || given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

function randomHex(bytes: number) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Settings kept in Obsidian SecretStorage instead of data.json. */
const SECRET_FIELDS: [string, string][] = [
  ['listenerKey', 'hivemynd-listener-key'],
  ['viewerKey', 'hivemynd-viewer-key'],
  ['phoneUrl', 'hivemynd-alert-url'],
];

/** Listener routes that only answer in Developer mode. */
const DEV_ROUTES = new Set(['/replay', '/focus', '/music', '/system-audio-probe', '/audio-probe', '/audio-levels', '/audio-devices', '/report', '/meaning', '/heat', '/open-monitor', '/reload']);
