import { App, FileSystemAdapter, FuzzySuggestModal, ItemView, Menu, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, TFolder, ViewStateResult, WorkspaceLeaf, debounce, normalizePath, requestUrl, setIcon } from 'obsidian';
import { PlexusRenderer, PlexusOptions, DEFAULT_OPTIONS, AudioControls, AudioSource, GraphInput, LayoutCache, TouchMode, SpanSlice } from './renderer';
import { PathResolver } from './resolver';
import { hookToEvents, promptFromHook, PulseEvent, searchMiss } from './hookparse';
import { AccessAction, AccessEntry, AccessLog, dayKey, noteTitle } from './accesslog';
import { buildReport } from './report';
import { buildPack, Pack } from './contextpack';
import { Collision, detectCollision, isSynthetic, foldHistory, heatAndDecay, linkSuggestions, parseWatchlist, rereads, taskGroups, tokensForBytes, watchMatch } from './insights';
import { ChangeRecord, ChangeStore, HistoryMode } from './changes';
import { BrainSearch } from './brainsearch';
import { HoverCard } from './hovercard';
import { GrowthBar } from './growth';
import { WelcomeModal, claudeCodeHooks, connectSection, copyButton, curlExample } from './onboarding';
import { MANUAL_VIEW_TYPE, ManualView } from './manual';
import { PhoneAlerts, PhoneFormat, randomTopic } from './phone';
import { WebViewer } from './webviewer';
import { meaningLinks } from './semantic';
import { ReplayBar } from './replay';
import { Claim, ClaimBoard, Gap, Handoff, Trust, buildBrief, buildHandoffPack, detectHandoff, gapRadar, gapStub, trustScore } from './team';
import { AgentTask, Authorship, TaskBoard, authorship, findSecrets, keptPurpose, maskSecrets, newSecrets } from './extras';
import { THEMES, chromeAccent, themeById } from './themes';
import { addGroup, showMenu } from './menus';
import { SHAPES, shapeById } from './shapes';
import { AudioReactor, SYSTEM_AUDIO } from './audio';
import { Credential, CredentialMeta, Scope, canAssertAgent, denyListFor, gate, hasScope, isDenied, newCredential, newKey, ownEvent } from './server/auth';
import { HttpError, LIMITS, readBody, readJsonBody, sendError, sendJson, sendStatus } from './server/http';
import { nodeDeps, removeSecretFile, vaultKeyDir, writeSecretFile } from './server/keyfile';
import { PathRules, inConfigDir, realRelative, resolvesInside, vaultRelative } from './server/pathguard';
import { Concurrency, RATE, RateLimiter } from './server/limits';
import { BridgeMessage, BridgeStore, cleanMessage } from './bridgestore';
import { readTail } from './filetail';
import { NoteIO, RestoreConflict, restoreNote } from './restore';
import { PrewriteOnError, prewriteReply } from './server/prewrite';
import { Hidden, SHOW_ALL, visibleClaims, visibleEntries, visibleHandoffs, visiblePaths, visibleTasks } from './server/visibility';


export type { BridgeMessage } from './bridgestore';
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
  /** Cinematic camera: fly through the brain when it opens, and again after idle time. */
  cinemaOnOpen: boolean;
  /** Seconds without input before the flythrough resumes (0 = never). */
  cinemaIdle: number;
  cinemaSpeed: number;
  /** Claims: what an agent's pre-write hook hears when another agent holds the note. */
  claimMode: 'warn' | 'block' | 'off';
  /** How long an agent's edit keeps the note claimed (minutes). */
  claimMinutes: number;
  /** Agents whose pre-write hook understands H!V3MYND's reply (Claude Code's format). */
  hookReplies: string;
  /** When a pre-write check fails: block (hold the write back), allow, or auto (block if claims or secret scanning block). */
  prewriteOnError: PrewriteOnError;
  handoffs: boolean;
  trustWarnings: boolean;
  /** Daily brief: a note about yesterday's agent work, written each morning. */
  briefEnabled: boolean;
  briefHour: number;
  briefFolder: string;
  briefTimelapse: boolean;
  timelapseKeepDays: number;
  /** YYYY-MM-DD of the last day a brief was written for. */
  lastBrief: string;
  /** Where gap-radar starter notes go. */
  gapFolder: string;
  /** F6: lighter rendering for slower machines (no bloom, blur, nebula, marbles, time-lapse). */
  lowLatency: boolean;
  /** F3: ring the note each active agent is on right now (not only claimed notes). */
  presenceRings: boolean;
  /** F4: what an agent's pre-write hook hears when its edit contains a key or token. */
  secretScan: 'warn' | 'block' | 'off';
  /** F4: mask keys and tokens an agent wrote into a note (recorded as a change you can undo). */
  autoMaskSecrets: boolean;
  /** F13: push short lines (briefs, approvals) to Even G2 glasses through the Agent Bridge. */
  glassesFeed: boolean;
  bridgeUrl: string;
  bridgeTokenFile: string;
  glassesSender: string;
  glassesRecipient: string;
  /** Span across monitors: the monitors taking part (Electron display ids; empty = all). */
  spanMonitors: string[];
  /** The centre monitor: it leads the camera and carries the toolbar ('' = primary). */
  spanCenter: string;
  /** Light theme for the brain view and for the Brain Monitor (each has its own toggle). */
  brainLight: boolean;
  monitorLight: boolean;
  /** Brain theme (multiverse, inkblot, violet-dusk, ...). brainLight follows it. */
  brainTheme: string;
  /** Brain Monitor theme. monitorLight follows it. */
  monitorTheme: string;
  /** Brain shape (default, sphere, diamond, ...): a look only. */
  brainShape: string;
  /** Clustering, -1 (spread) .. 0 (as laid out) .. 1 (tight): a look only. */
  brainCluster: number;
  /** Shape cycle: morph to the next shape every N seconds (0 = off). */
  shapeCycle: number;
  /** How agent satellites orbit the brain (default, solar, atom, close, far, still). */
  agentOrbit: string;
  /** Orbit path colour: 'default' (agent colours), 'rainbow', or a hex colour. */
  orbitColor: string;
  /** Randomize: a new colour theme, shape, orbit, orbit colour and clustering every interval. */
  randomizeOn: boolean;
  /** Seconds between randomized looks. */
  randomizeInterval: number;
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
  /** Accept the 1.1 shared listener key (bridge scope) until the user retires it. */
  acceptLegacyKey: boolean;
  /** Listener credentials (keys themselves live in SecretStorage). */
  credentials: CredentialMeta[];
  /** Per-agent permissions, enforced by the bridge (written to policyFile). */
  policies: Record<string, AgentPolicy>;
  /** Master switch: off = the bridge applies no per-agent rules (protected paths still apply). */
  enforcePermissions: boolean;
  /** PC control for agents without their own rule. */
  defaultPcControl: PcMode;
  /** Keep what each agent was asked to do (its prompt) in the access log. */
  storePurposes: boolean;
  /** What change history keeps of each agent write (see HistoryMode). */
  historyMode: HistoryMode;
  /** Days of change history and bridge messages to keep (0 = forever). */
  historyDays: number;
  /** Bridge messages on disk: full text (secrets masked) or sender/recipient/time only. */
  bridgeMessageStore: 'full' | 'metadata';
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
  /** Light-show colour: 'default' (the palette's multicolour), 'rainbow' or a hex colour. */
  musicColor: string;
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
  brainTheme: '',
  monitorTheme: '',
  brainShape: 'default',
  brainCluster: 0,
  shapeCycle: 0,
  agentOrbit: 'default',
  orbitColor: 'default',
  randomizeOn: false,
  randomizeInterval: 60,
  cinemaOnOpen: true,
  cinemaIdle: 60,
  cinemaSpeed: 1,
  spanMonitors: [],
  spanCenter: '',
  claimMode: 'warn',
  claimMinutes: 20,
  hookReplies: 'claude',
  prewriteOnError: 'auto',
  handoffs: true,
  trustWarnings: true,
  briefEnabled: false, // opt-in: it writes a note (and a video) every day
  briefHour: 6,
  briefFolder: 'H!V3MYND/Briefs',
  briefTimelapse: true,
  timelapseKeepDays: 14,
  lastBrief: '',
  gapFolder: 'H!V3MYND/Gaps',
  lowLatency: false,
  presenceRings: true,
  secretScan: 'warn',
  autoMaskSecrets: true,
  glassesFeed: false,
  bridgeUrl: 'http://127.0.0.1:8787',
  bridgeTokenFile: '',
  glassesSender: 'claude',
  glassesRecipient: 'glasses',
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
  acceptLegacyKey: true,
  credentials: [],
  policies: {},
  enforcePermissions: true,
  defaultPcControl: 'ask',
  storePurposes: true,
  historyMode: 'redacted',
  historyDays: 30,
  bridgeMessageStore: 'full',
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
  musicColor: 'default',
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
  /** Listener credentials with their keys (loaded from SecretStorage). */
  credentials: Credential[] = [];
  /** When each credential last made a request (this session). */
  keyUsed = new Map<string, number>();
  // Grok also runs Claude's hooks, so one Grok tool call can arrive twice under two names.
  private recent = new Map<string, { agent: string; at: number }>();
  // Exposed on GET /health so agent wiring can be checked against what actually lit.
  private stats = { pulses: 0, lit: 0, persistFailures: 0, last: null as null | { at: string; agent: string; kind: string; notes: string[] } };
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
  bridge!: BridgeStore;
  private rate = new RateLimiter(RATE.burst, RATE.perSecond);
  private inflight = new Concurrency(RATE.concurrent);
  private approvals = new Concurrency(RATE.approvals);
  private bridgeListeners = new Set<(m: BridgeMessage) => void>();
  replaying = false;
  misses: SearchMiss[] = [];
  readonly audio = new AudioReactor();
  private watchSeen = new Map<string, number>();
  phone!: PhoneAlerts;
  viewer!: WebViewer;

  /** Developer mode: a synchronous start-up trace (survives a crash), in the plugin folder. */
  trace(stage: string) {
    if (!this.settings.developerMode) return;
    try {
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) return;
      const fs = (window as unknown as { require: (m: string) => { appendFileSync(p: string, s: string): void } }).require('fs');
      fs.appendFileSync(`${adapter.getBasePath()}/${this.manifest.dir}/load-trace.txt`, `${new Date().toISOString()} ${stage}
`);
    } catch { /* tracing must never break loading */ }
  }

  async onload() {
    this.trace('onload start');
    const onErr = (e: ErrorEvent | PromiseRejectionEvent) => this.trace(`window error: ${'reason' in e ? String((e.reason as Error)?.stack ?? e.reason) : (e.error?.stack ?? e.message)}`.slice(0, 2000));
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onErr);
    window.setTimeout(() => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr); this.trace('trace window closed'); }, 30_000);
    try {
      await this.onloadInner();
      this.trace('onload done');
    } catch (err) {
      this.trace(`onload FAILED: ${err instanceof Error ? err.stack : String(err)}`.slice(0, 3000));
      throw err;
    }
  }

  private async onloadInner() {
    await this.loadSettings();
    // Keep the bridge's policy file in step with these settings from the start.
    this.writePolicies();
    this.log = new AccessLog(this.app.vault.adapter, `${this.manifest.dir}/access-log`, () => ({ enabled: this.settings.digest, folder: this.settings.digestFolder }));
    await this.log.load();
    this.changes = new ChangeStore(this.app.vault.adapter, `${this.manifest.dir}/changes`);
    this.changes.mode = this.settings.historyMode;
    await this.changes.prune(this.settings.historyDays);
    await this.changes.load();
    this.bridge = new BridgeStore(this.app.vault.adapter, `${this.manifest.dir}/bridge`, `${this.manifest.dir}/bridge-messages.jsonl`);
    await this.bridge.prune(this.settings.historyDays);
    await this.bridge.load();
    await this.loadMisses();
    await this.loadPurposes();
    await this.loadTeam();
    this.applyShapeCycle();
    this.applyRandomize();
    this.phone = new PhoneAlerts(() => this.settings);
    this.alertListeners.add((c) => this.phone.notify(c));
    this.viewer = new WebViewer({ graph: () => this.viewerGraph(), keyOk: (k) => safeEqual(this.settings.viewerKey, k) });
    this.startViewer();
    // Right-click a note or folder to add it to (or remove it from) the watchlist.
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile)) menu.addItem((item) => item.setTitle('Focus the brain on this folder').setIcon('scan-eye').onClick(() => this.focusProject(file.path)));
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
    this.registerView(MANUAL_VIEW_TYPE, (leaf) => new ManualView(leaf));
    this.addCommand({ id: 'open-manual', name: 'Open the user manual', callback: () => void this.openManual() });
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
      team: () => ({ claims: this.claims.list(), handoffs: [...this.handoffs].reverse(), lastBrief: this.settings.lastBrief, briefFolder: this.settings.briefFolder, briefHour: this.settings.briefHour, claimMode: this.settings.claimMode }),
      onTeam: (fn) => { this.teamListeners.add(fn); return () => this.teamListeners.delete(fn); },
      releaseClaim: (path) => this.claims.releasePath(path),
      handoffPack: (h) => this.handoffPackFor(h.from, h.to, h.task),
      showTrail: (h) => this.showTrail(h),
      writeBriefNow: () => this.writeBrief(new Date(), true),
      radar: () => this.radarData(),
      draftStub: (g) => this.draftStub(g),
      agentTasks: () => this.tasks.list(),
      makeTask: (g) => { void this.makeTask(g); },
      approveTask: (id) => { this.tasks.update(id, { status: 'open' }); },
      removeTask: (id) => this.tasks.remove(id),
      restore: (c) => this.confirmRestore(c),
      bridge: () => this.bridge.messages,
      onBridge: (fn) => { this.bridgeListeners.add(fn); return () => this.bridgeListeners.delete(fn); },
      alias: (n) => this.alias(n),
      // Layouts saved before the current default (LAYOUT_VERSION) start fresh.
      monitorUi: () => ({ layout: this.settings.monitorLayoutVersion === LAYOUT_VERSION ? this.settings.monitorLayout : null, budgetRange: this.settings.budgetRange, light: this.settings.monitorLight, theme: this.settings.monitorTheme }),
      saveMonitorUi: (p) => {
        if (p.layout) { this.settings.monitorLayout = p.layout; this.settings.monitorLayoutVersion = LAYOUT_VERSION; }
        if (p.budgetRange) this.settings.budgetRange = p.budgetRange;
        if (p.light !== undefined) this.settings.monitorLight = p.light;
        if (p.theme !== undefined) { this.settings.monitorTheme = p.theme; this.settings.monitorLight = themeById(p.theme).light; }
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
    this.addCommand({ id: 'low-latency', name: 'Toggle low-latency mode', callback: () => void this.toggleLowLatency() });
    this.addCommand({ id: 'focus-project', name: 'Focus the brain on a project (folder)', callback: () => this.pickProject() });
    this.addCommand({ id: 'cinematic-camera', name: 'Toggle cinematic camera', callback: () => this.views()[0]?.toggleCinema() });
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
        }, () => void this.openManual()).open();
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
    // An agent without its own rule gets the most restrictive one, never none.
    const deny = denyListFor(this.settings.policies, agent);
    const denied = (p: string) => isDenied(p, deny);
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

  // ---------------------------------------------------------------- teamwork
  // Claims, handoffs, trust warnings, gap radar and the daily brief (logic in team.ts).

  claims!: ClaimBoard;
  handoffs: Handoff[] = [];
  private teamListeners = new Set<() => void>();
  private bumps = new Map<string, number>();
  private week: { at: number; entries: AccessEntry[] } | null = null;
  private radarCache: { at: number; gaps: Gap[] } | null = null;

  private teamDir() { return `${this.manifest.dir}/team`; }

  private async loadTeam() {
    const a = this.app.vault.adapter;
    const dir = this.teamDir();
    try { if (!(await a.exists(dir))) await a.mkdir(dir); } catch { /* ignore */ }
    const saveClaims = debounce((list: Claim[]) => void a.write(`${dir}/claims.json`, JSON.stringify(list)).catch(() => null), 1000, true);
    this.claims = new ClaimBoard(saveClaims);
    try { if (await a.exists(`${dir}/claims.json`)) this.claims.load(JSON.parse(await a.read(`${dir}/claims.json`))); } catch { /* fresh */ }
    try {
      if (await a.exists(`${dir}/handoffs.jsonl`)) {
        for (const line of (await a.read(`${dir}/handoffs.jsonl`)).split('\n')) {
          if (!line.trim()) continue;
          try { this.handoffs.push(JSON.parse(line)); } catch { /* torn line */ }
        }
        this.handoffs = this.handoffs.slice(-200);
      }
    } catch { /* fresh */ }
    this.claims.onChange(() => { this.refreshMarkers(); this.teamChanged(); });
    const saveTasks = debounce((list: AgentTask[]) => void a.write(`${dir}/tasks.json`, JSON.stringify(list)).catch(() => null), 800, true);
    this.tasks = new TaskBoard(saveTasks);
    try { if (await a.exists(`${dir}/tasks.json`)) this.tasks.load(JSON.parse(await a.read(`${dir}/tasks.json`))); } catch { /* fresh */ }
    this.tasks.onChange(() => this.teamChanged());
    // F3: presence rings follow active agents around the brain.
    this.registerInterval(window.setInterval(() => { if (this.settings.presenceRings) this.refreshMarkers(); }, 15_000));
    // F12: authorship badge for the open note in the status bar.
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('plexus-author-badge');
    this.registerDomEvent(this.statusEl, 'click', () => void this.explainAuthorship());
    this.registerEvent(this.app.workspace.on('file-open', () => void this.updateStatusBadge()));
    this.changes.onChange((c) => { this.authorCache.delete(c.path); void this.updateStatusBadge(); });
    // Daily brief: check every 10 minutes (and shortly after start) whether one is due.
    this.registerInterval(window.setInterval(() => void this.maybeBrief(), 10 * 60_000));
    this.app.workspace.onLayoutReady(() => window.setTimeout(() => void this.maybeBrief(), 90_000));
  }

  private teamChanged() {
    for (const fn of this.teamListeners) fn();
  }

  agentColor(name: string) {
    const a = this.settings.agents;
    return (a.find((x) => x.name === name) ?? a.find((x) => x.name === 'other'))?.color ?? '#2fd3c9';
  }

  private hookReplyAgents() {
    return new Set(this.settings.hookReplies.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  }

  /** The last 7 days of the access log, cached for half an hour. */
  private weekEntries(): AccessEntry[] {
    if (!this.week || Date.now() - this.week.at > 30 * 60_000) {
      const stale = this.week;
      this.week = { at: Date.now(), entries: stale?.entries ?? this.log.entries };
      void this.log.history(7).then((entries) => { this.week = { at: Date.now(), entries }; });
    }
    return this.week.entries;
  }

  private noteFacts(path: string) {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? { mtime: f.stat.mtime, size: f.stat.size } : null;
  }

  trustOf(path: string): Trust {
    return trustScore(path, this.noteFacts(path), this.weekEntries(), this.changes.records);
  }

  /**
   * What the agent's pre-write hook should hear, if anything: the note is claimed by
   * another agent, or the agent is about to rely on a note with low trust. In "warn"
   * mode each warning is given once; retrying the same edit goes through.
   */
  private preWriteReply(agent: string, paths: string[], data?: unknown): string | null {
    const now = Date.now();
    const parts: string[] = [];
    // F4: keys and tokens in what the agent is about to write.
    if (this.settings.secretScan !== 'off' && data && typeof data === 'object') {
      const text = hookStrings((data as { tool_input?: unknown }).tool_input).join('\n');
      const hits = findSecrets(text);
      const key = `secret|${agent}|${paths.join(',')}`;
      if (hits.length && (this.settings.secretScan === 'block' || now - (this.bumps.get(key) ?? 0) > 10 * 60_000)) {
        this.bumps.set(key, now);
        const kinds = [...new Set(hits.map((h) => h.kind))].join(', ');
        parts.push(`This edit contains what looks like a ${kinds}. Don't save keys or tokens in notes: write [REDACTED] or point to where the secret is stored instead.` +
          (this.settings.secretScan === 'block' ? '' : ' Retry the same edit only if the user asked for the value to be saved.'));
      }
    }
    const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    for (const [k, t] of this.bumps) if (now - t > 3 * 3600_000) this.bumps.delete(k);
    if (this.settings.claimMode !== 'off') {
      for (const p of paths) {
        const c = this.claims.holder(p, now);
        if (!c || c.agent === agent) continue;
        const key = `claim|${agent}|${p}`;
        if (this.settings.claimMode === 'warn' && now - (this.bumps.get(key) ?? 0) < 10 * 60_000) continue;
        this.bumps.set(key, now);
        parts.push(`"${noteTitle(p)}" is claimed by ${c.agent}${c.purpose ? ` (working on: ${c.purpose})` : ''} until ${time(c.until)}. ` +
          `What ${c.agent} did is in its handoff pack: GET http://127.0.0.1:${this.settings.port}/handoff?from=${encodeURIComponent(c.agent)} (header X-Hivemynd-Key). ` +
          (this.settings.claimMode === 'block' ? 'Ask the user before editing it, or wait for the claim to end.' : 'Read that and check with the user; retry the same edit to go ahead anyway.'));
        this.claimConflict(agent, c);
      }
    }
    if (this.settings.trustWarnings) {
      const sources = new Set(paths);
      const since = now - 30 * 60_000;
      for (let i = this.log.entries.length - 1; i >= 0; i--) {
        const e = this.log.entries[i];
        if (e.t < since) break;
        if (e.agent === agent && e.action === 'read') sources.add(e.notes[0]);
      }
      for (const p of sources) {
        const t = this.trustOf(p);
        if (t.band !== 'low') continue;
        const key = `trust|${agent}|${p}`;
        if (now - (this.bumps.get(key) ?? 0) < 2 * 3600_000) continue;
        this.bumps.set(key, now);
        parts.push(`Heads-up: "${noteTitle(p)}" has a trust score of ${t.score}/100 (${t.reasons.join('; ') || 'low'}). ` +
          `${paths.includes(p) ? 'You are about to edit it' : 'You read it earlier in this task'}; make sure it is still right before relying on it. Retry the same edit to go ahead.`);
        break;
      }
    }
    return parts.length ? `H!V3MYND: ${parts.join(' ')}` : null;
  }

  private claimConflict(agent: string, c: Claim) {
    const col: Collision = { t: Date.now(), kind: 'blocked', note: c.path, writer: agent, other: c.agent, otherAt: c.since };
    this.alerts.push(col);
    if (this.alerts.length > 200) this.alerts.shift();
    new Notice(`H!V3MYND: ${agent} tried to edit “${noteTitle(c.path)}”, which ${c.agent} has claimed. It was sent ${c.agent}'s handoff instead.`, 8000);
    for (const fn of this.alertListeners) fn(col);
  }

  private checkHandoff(entry: AccessEntry) {
    const h = detectHandoff(entry, this.log.entries, () => taskGroups(this.log.entries));
    if (!h) return;
    const dup = this.handoffs.some((x) => x.from === h.from && x.to === h.to && x.task === h.task && entry.t - x.t < 6 * 3600_000);
    if (dup) return;
    const rec: Handoff = { id: `${entry.t.toString(36)}-${h.from}-${h.to}`, ...h };
    this.handoffs.push(rec);
    if (this.handoffs.length > 200) this.handoffs.shift();
    void this.app.vault.adapter.append(`${this.teamDir()}/handoffs.jsonl`, JSON.stringify(rec) + '\n').catch(() => null);
    new Notice(`H!V3MYND handoff: ${h.to} picked up ${h.from}'s work at “${noteTitle(h.note)}”. The pack is in Brain Monitor → Team.`, 8000);
    this.showTrail(rec);
    this.teamChanged();
  }

  handoffPackFor(from: string, to?: string, task?: string, hidden: Hidden = SHOW_ALL) {
    return buildHandoffPack({
      from, to, task: task || undefined,
      entries: visibleEntries(this.log.entries, hidden), changes: visiblePaths(this.changes.records, hidden),
      claims: visibleClaims(this.claims.list(), hidden), misses: this.misses,
    });
  }

  showTrail(h: Handoff) {
    const paths = this.getGraph().paths;
    const idx = [...h.trail, h.note].map((p) => paths.indexOf(p)).filter((i) => i >= 0);
    for (const v of this.views()) v.renderer?.trail(idx, this.agentColor(h.from));
  }

  /** Gap radar (ranked) and the least trusted notes agents used this week. */
  async radarData(): Promise<{ gaps: Gap[]; trust: { path: string; trust: Trust }[] }> {
    const entries = await this.log.history(7);
    this.week = { at: Date.now(), entries };
    const gaps = gapRadar(this.misses, entries, (p) => this.noteFacts(p)?.size ?? null);
    this.radarCache = { at: Date.now(), gaps };
    const used = new Set<string>();
    for (const e of entries) if (e.action !== 'search') used.add(e.notes[0]);
    const trust = [...used].slice(0, 600).map((p) => ({ path: p, trust: this.trustOf(p) })).filter((x) => x.trust.band !== 'ok')
      .sort((a, b) => a.trust.score - b.trust.score).slice(0, 25);
    this.refreshMarkers();
    return { gaps, trust };
  }

  /** Claimed notes (agent-coloured rings) and thin notes from the radar (dashed outlines). */
  refreshMarkers() {
    const paths = this.getGraph().paths;
    const list: { index: number; color: string; style: 'claim' | 'gap' }[] = [];
    const ringed = new Set<string>();
    for (const c of this.claims?.list() ?? []) { list.push({ index: paths.indexOf(c.path), color: this.agentColor(c.agent), style: 'claim' }); ringed.add(c.path); }
    // F3 live presence: the note each agent touched in the last 3 minutes.
    if (this.settings.presenceRings && this.log) {
      const since = Date.now() - 3 * 60_000;
      const seen = new Set<string>();
      for (let i = this.log.entries.length - 1; i >= 0; i--) {
        const e = this.log.entries[i];
        if (e.t < since) break;
        if (e.action === 'search' || seen.has(e.agent) || ringed.has(e.notes[0])) continue;
        seen.add(e.agent);
        ringed.add(e.notes[0]);
        list.push({ index: paths.indexOf(e.notes[0]), color: this.agentColor(e.agent), style: 'claim' });
      }
    }
    for (const g of (this.radarCache?.gaps ?? []).filter((x) => x.path).slice(0, 8)) list.push({ index: paths.indexOf(g.path!), color: '', style: 'gap' });
    for (const v of this.views()) v.renderer?.setMarkers(list);
  }

  /** Create a starter note for a gap, then open it. */
  async draftStub(g: Gap, open = true) {
    if (g.path) { if (open) void this.app.workspace.openLinkText(g.path, '', 'tab'); return; }
    const folder = normalizePath(this.settings.gapFolder || 'Gaps');
    await this.ensureFolder(folder);
    const name = stubName(g.title) || g.title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Gap';
    const path = normalizePath(`${folder}/${name}.md`);
    const related = [...new Set(this.misses.filter((m) => m.query.trim().toLowerCase() === g.title.trim().toLowerCase())
      .flatMap((m) => this.log.entries.filter((e) => e.agent === m.agent && Math.abs(e.t - m.t) < 15 * 60_000 && e.action === 'read').map((e) => e.notes[0])))];
    if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.create(path, gapStub(g, related));
    if (open) void this.app.workspace.openLinkText(path, '', 'tab');
  }

  private async ensureFolder(folder: string) {
    const parts = folder.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (!this.app.vault.getAbstractFileByPath(p)) { try { await this.app.vault.createFolder(p); } catch { /* exists */ } }
    }
  }

  // ---- 1.1.0 extras

  tasks!: TaskBoard;
  private statusEl: HTMLElement | null = null;
  private authorCache = new Map<string, Authorship>();
  private changeIndex: Map<string, ChangeRecord[]> | null = null;
  projectFocus: string | null = null;

  async setOrbitColor(id: string) {
    this.settings.orbitColor = id;
    await this.saveData(this.settings);
    for (const v of this.views()) { const r = v.renderer; r?.crossfade(() => r.setOrbitColor(id)); }
  }

  async setAgentOrbit(id: string) {
    this.settings.agentOrbit = id;
    await this.saveData(this.settings);
    for (const v of this.views()) { const r = v.renderer; r?.crossfade(() => r.setOrbit(id)); }
  }

  // Randomize: on a timer, a new colour theme, shape, agent orbit, orbit line colour and
  // clustering, each different from what's showing.
  private randomTimer: number | null = null;

  async setRandomize(on: boolean) {
    this.settings.randomizeOn = on;
    if (on && this.settings.shapeCycle) { this.settings.shapeCycle = 0; this.applyShapeCycle(); } // the two would fight
    await this.saveData(this.settings);
    this.applyRandomize();
    if (on) await this.shuffleLook();
    const every = CYCLES.find(([sec]) => sec === this.settings.randomizeInterval)?.[1] ?? `${this.settings.randomizeInterval} s`;
    new Notice(on ? `H!V3MYND: randomize on, a new look every ${every}.` : 'H!V3MYND: randomize off.', 4000);
  }

  async setRandomizeInterval(sec: number) {
    this.settings.randomizeInterval = sec;
    await this.saveData(this.settings);
    this.applyRandomize();
  }

  applyRandomize() {
    if (this.randomTimer !== null) { window.clearInterval(this.randomTimer); this.randomTimer = null; }
    if (this.settings.randomizeOn) this.randomTimer = window.setInterval(() => void this.shuffleLook(), Math.max(10, this.settings.randomizeInterval) * 1000);
  }

  /** Pick something new for every look option at once. */
  async shuffleLook() {
    const s = this.settings;
    const pick = <T,>(list: T[], current: T) => { const rest = list.filter((x) => x !== current); return rest[Math.floor(Math.random() * rest.length)] ?? current; };
    const theme = pick(THEMES.map((t) => t.id), s.brainTheme);
    const shape = pick(SHAPES.map((x) => x.id), s.brainShape);
    const orbit = pick(ORBITS.map(([id]) => id), s.agentOrbit);
    const orbitColor = pick(ORBIT_COLORS.map(([id]) => id), s.orbitColor);
    const cluster = pick([-0.5, -0.25, 0, 0.35, 0.7], s.brainCluster);
    s.brainTheme = theme; s.brainLight = themeById(theme).light;
    s.brainShape = shape; s.agentOrbit = orbit; s.orbitColor = orbitColor; s.brainCluster = cluster;
    await this.saveData(s);
    for (const v of this.views()) {
      const r = v.renderer;
      if (!r) continue;
      // Shape and clustering morph together (one glide); colours, theme effects and
      // orbits cross-dissolve.
      r.setShape(shape, true);
      r.setCluster(cluster, true);
      r.crossfade(() => { v.applyTheme(); r.setOrbitColor(orbitColor); r.setOrbit(orbit); });
    }
  }

  // Shape cycle: every N seconds the brain morphs to the next shape in the list.
  private cycleTimer: number | null = null;

  async setShapeCycle(sec: number) {
    this.settings.shapeCycle = sec;
    if (sec && this.settings.randomizeOn) { this.settings.randomizeOn = false; this.applyRandomize(); } // the two would fight
    await this.saveData(this.settings);
    this.applyShapeCycle();
    new Notice(sec ? `H!V3MYND: shape cycle on, a new shape every ${CYCLES.find(([s]) => s === sec)?.[1] ?? `${sec} s`}.` : 'H!V3MYND: shape cycle off.', 4000);
  }

  applyShapeCycle() {
    if (this.cycleTimer !== null) { window.clearInterval(this.cycleTimer); this.cycleTimer = null; }
    const sec = this.settings.shapeCycle;
    if (!sec) return;
    this.cycleTimer = window.setInterval(() => {
      const i = SHAPES.findIndex((x) => x.id === this.settings.brainShape);
      void this.setBrainShape(SHAPES[(i + 1) % SHAPES.length].id);
    }, sec * 1000);
  }

  /** Switch the brain's shape everywhere; it morphs from the current shape. */
  async setBrainShape(id: string) {
    this.settings.brainShape = shapeById(id).id;
    await this.saveData(this.settings);
    for (const v of this.views()) v.renderer?.setShape(this.settings.brainShape, true);
  }

  /** Switch the brain's theme everywhere (every brain view and span monitor). */
  async setBrainTheme(id: string) {
    const t = themeById(id);
    this.settings.brainTheme = t.id;
    this.settings.brainLight = t.light;
    await this.saveData(this.settings);
    for (const v of this.views()) { if (v.renderer) v.renderer.crossfade(() => v.applyTheme()); else v.applyTheme(); }
  }

  /** F6: apply low-latency mode to every brain view. */
  applyLowLatency() {
    for (const v of this.views()) v.renderer?.setLowLatency(this.settings.lowLatency);
  }

  async toggleLowLatency() {
    this.settings.lowLatency = !this.settings.lowLatency;
    await this.saveData(this.settings);
    this.applyLowLatency();
    new Notice(`H!V3MYND: low-latency mode ${this.settings.lowLatency ? 'on (lighter effects)' : 'off (full effects)'}.`);
  }

  /** F15: dim everything except one folder (a project) and the notes it links to. */
  focusProject(folder: string | null) {
    this.projectFocus = folder;
    const g = this.getGraph();
    if (!folder) { for (const v of this.views()) v.renderer?.setFocus(null); return; }
    const prefix = folder.replace(/\/+$/, '') + '/';
    const inside = new Set<number>();
    g.paths.forEach((p, i) => { if (p.startsWith(prefix)) inside.add(i); });
    const all = new Set(inside);
    for (const [a, b] of g.links) { if (inside.has(a)) all.add(b); if (inside.has(b)) all.add(a); }
    for (const v of this.views()) v.renderer?.setFocus([...all], '#5fe8ff');
    new Notice(`H!V3MYND focus: ${folder} (${inside.size} notes and ${all.size - inside.size} linked). Press Esc or the focus button to leave.`, 6000);
  }

  pickProject() {
    if (this.projectFocus) { this.focusProject(null); return; }
    new FolderPick(this.app, (f) => this.focusProject(f)).open();
  }

  /** F12: who wrote the note: its lines credited to agents vs the human. */
  async authorshipOf(path: string): Promise<Authorship | null> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile) || f.extension !== 'md') return null;
    const hit = this.authorCache.get(path);
    if (hit) return hit;
    if (!this.changeIndex) this.changeIndex = await this.changes.indexByPath();
    const a = authorship(await this.app.vault.cachedRead(f), this.changeIndex.get(path) ?? []);
    this.authorCache.set(path, a);
    return a;
  }

  /** One line for hover cards and the status bar: agent share and trust. */
  async noteBadge(path: string) {
    const a = await this.authorshipOf(path);
    if (!a || !a.total) return null;
    const pct = Math.round((a.agent / a.total) * 100);
    const t = this.trustOf(path);
    return `${pct ? `${pct}% agent-written` : 'All human-written'} · trust ${t.score}`;
  }

  private async updateStatusBadge() {
    if (!this.statusEl) return;
    const f = this.app.workspace.getActiveFile();
    const text = f ? await this.noteBadge(f.path) : null;
    this.statusEl.setText(text ? `🤖 ${text}` : '');
    this.statusEl.toggle(!!text);
  }

  private async explainAuthorship() {
    const f = this.app.workspace.getActiveFile();
    if (!f) return;
    const a = await this.authorshipOf(f.path);
    if (!a) return;
    const parts = Object.entries(a.byAgent).sort((x, y) => y[1] - x[1]).map(([g, n]) => `${g} ${n}`);
    const t = this.trustOf(f.path);
    new Notice(`“${f.basename}”: ${a.total} lines, ${a.human} by you${parts.length ? `, ${parts.join(', ')} by agents` : ''}. Trust ${t.score}/100${t.reasons.length ? ` (${t.reasons.join('; ')})` : ''}.`, 10_000);
  }

  /** F5: turn a gap from the radar into an approved task agents can claim. */
  async makeTask(g: Gap) {
    let path = g.path;
    if (!path) {
      await this.draftStub(g, false);
      path = normalizePath(`${this.settings.gapFolder || 'Gaps'}/${stubName(g.title)}.md`);
    }
    const t = this.tasks.add({ title: g.kind === 'missing' ? `Write a note on “${g.title}”` : `Fill out “${g.title}”`, detail: `From the gap radar: ${g.detail}. Agents who hit this: ${g.agents.join(', ')}.`, path, by: 'you', status: 'open' });
    new Notice(`H!V3MYND: task ready for agents: “${t.title}”. They can claim it with POST /tasks/claim.`, 7000);
    return t;
  }

  /** F13: short lines for a heads-up display (agent status, approvals, last answer, brief). */
  hudLines(hidden: Hidden = SHOW_ALL): string[] {
    const out: string[] = [];
    const since = Date.now() - 10 * 60_000;
    const last = new Map<string, AccessEntry>();
    for (const e of visibleEntries(this.log.entries, hidden)) if (e.t >= since && e.action !== 'search') last.set(e.agent, e);
    for (const [agent, e] of last) out.push(`${agent} ▸ ${noteTitle(e.notes[0])}`.slice(0, 60));
    const claims = visibleClaims(this.claims.list(), hidden).length;
    if (claims) out.push(`${claims} note${claims === 1 ? '' : 's'} claimed`);
    const open = this.tasks.list().filter((t) => t.status === 'proposed').length;
    if (open) out.push(`${open} task${open === 1 ? '' : 's'} to approve`);
    if (!out.length) out.push('All quiet');
    return out;
  }

  /** F13: send one short line to the glasses through the Agent Bridge (when switched on). */
  async toGlasses(text: string) {
    const s = this.settings;
    if (!s.glassesFeed || !s.bridgeUrl || !s.bridgeTokenFile) return;
    try {
      const fs = (window as unknown as { require: (m: string) => { readFileSync(p: string, e: string): string } }).require('fs');
      const token = JSON.parse(fs.readFileSync(s.bridgeTokenFile, 'utf8'))?.agents?.[s.glassesSender];
      if (!token) return;
      await requestUrl({
        url: `${s.bridgeUrl.replace(/\/+$/, '')}/message`, method: 'POST', contentType: 'application/json', throw: false,
        headers: { 'X-Bridge-Token': String(token) },
        body: JSON.stringify({ sender: s.glassesSender, recipient: s.glassesRecipient, body: `H!V3MYND: ${maskSecrets(text).slice(0, 240)}` }),
      });
    } catch (err) {
      console.warn('H!V3MYND: glasses feed failed', err);
    }
  }

  // ---- daily brief

  private async maybeBrief() {
    if (!this.settings.briefEnabled) return;
    const now = new Date();
    if (now.getHours() < this.settings.briefHour) return;
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const key = ymd(y);
    if (this.settings.lastBrief >= key) return;
    this.settings.lastBrief = key;
    await this.saveData(this.settings);
    await this.writeBrief(y, this.settings.briefTimelapse);
  }

  /** Write the brief for `day` (today = so far). Returns the note path. */
  async writeBrief(day: Date, timelapse: boolean): Promise<string | null> {
    try {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
      const end = start + 86_400_000;
      const back = Math.max(1, Math.ceil((Date.now() - start) / 86_400_000) + 1);
      const all = await this.log.history(Math.min(8, back));
      const entries = all.filter((e) => e.t >= start && e.t < end).sort((a, b) => a.t - b.t);
      const folder = normalizePath(this.settings.briefFolder || 'H!V3MYND/Briefs');
      await this.ensureFolder(folder);
      const key = ymd(day);
      let tlPath: string | null = null;
      let tlNote = '';
      if (timelapse && entries.length && this.settings.lowLatency) tlNote = 'Time-lapse skipped: low-latency mode is on.';
      else if (timelapse && entries.length) {
        const view = this.views().find((v) => !v.spanRole && v.renderer && !v.renderer.paused && v.containerEl.ownerDocument.visibilityState === 'visible');
        if (!view) tlNote = 'Time-lapse skipped: the brain view was not open.';
        else {
          new Notice('H!V3MYND: recording a 30-second time-lapse of the day for the brief…', 5000);
          const buf = await view.recordTimelapse(entries, 30);
          if (buf) {
            tlPath = normalizePath(`${folder}/${key} time-lapse.webm`);
            const old = this.app.vault.getAbstractFileByPath(tlPath);
            if (old instanceof TFile) await this.app.vault.modifyBinary(old, buf);
            else await this.app.vault.createBinary(tlPath, buf);
          } else tlNote = 'Time-lapse skipped: this system could not record the brain.';
        }
      }
      const radar = await this.radarData();
      const notesThatDay = [...new Set(entries.filter((e) => e.action !== 'search').map((e) => e.notes[0]))];
      const lowTrust = notesThatDay.slice(0, 400).map((p) => ({ path: p, trust: this.trustOf(p) })).filter((x) => x.trust.band === 'low').sort((a, b) => a.trust.score - b.trust.score);
      const md = buildBrief({ day, entries, changes: this.changes.records, handoffs: this.handoffs, collisions: this.alerts, gaps: radar.gaps, lowTrust, timelapse: tlPath, timelapseNote: tlNote });
      const path = normalizePath(`${folder}/${key} Brain brief.md`);
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await this.app.vault.modify(f, md);
      else await this.app.vault.create(path, md);
      await this.pruneTimelapses(folder);
      new Notice(`H!V3MYND: brain brief for ${key} is ready (${path}).`, 8000);
      const short = /## In short\n([^\n]+)/.exec(md)?.[1];
      if (short) void this.toGlasses(`Brief ${key}: ${short.replace(/\*\*/g, '')}`);
      this.teamChanged();
      return path;
    } catch (err) {
      console.error('H!V3MYND: brief failed', err);
      new Notice(`H!V3MYND: couldn't write the brain brief (${err instanceof Error ? err.message : err}).`);
      return null;
    }
  }

  /** Time-lapse videos are big: keep only the last few days (old ones go to the trash). */
  private async pruneTimelapses(folder: string) {
    const keep = Math.max(1, this.settings.timelapseKeepDays);
    const cutoff = ymd(new Date(Date.now() - keep * 86_400_000));
    const dir = this.app.vault.getAbstractFileByPath(folder);
    if (!dir || !('children' in dir)) return;
    for (const f of [...(dir as { children: unknown[] }).children]) {
      if (!(f instanceof TFile) || !/^\d{4}-\d{2}-\d{2} time-lapse\.webm$/.test(f.name)) continue;
      if (f.name.slice(0, 10) < cutoff) await this.app.fileManager.trashFile(f);
    }
  }

  // ---------------------------------------------------------------- span across monitors
  // One full-screen pop-out per chosen monitor, each showing its slice of one picture.
  // The centre monitor's view leads (camera, flythrough, layout); the others follow it.

  spanning = false;
  private spanLeaves: WorkspaceLeaf[] = [];
  private endingSpan = false;

  /** Monitors as Electron reports them, or [] when that isn't available (mobile, web). */
  displays(): SpanDisplay[] {
    const remote = electronRemote();
    if (!remote) return [];
    const primary = remote.screen.getPrimaryDisplay().id;
    return remote.screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      name: d.label || `Display ${i + 1}`,
      x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height,
      primary: d.id === primary,
    }));
  }

  /** The monitors to span and the centre one, falling back to all / primary. */
  spanSelection(all = this.displays()) {
    const s = this.settings;
    let chosen = all.filter((d) => s.spanMonitors.includes(d.id));
    if (!chosen.length) chosen = all;
    const center = chosen.find((d) => d.id === s.spanCenter) ?? chosen.find((d) => d.primary) ?? chosen[0];
    return { chosen, center };
  }

  async startSpan(source: PlexusView | null) {
    const remote = electronRemote();
    if (!remote) { new Notice('H!V3MYND: spanning monitors needs the desktop app.'); return; }
    if (this.spanning) this.endSpan();
    const { chosen, center } = this.spanSelection();
    if (!center) return;
    // A virtual screen centred on the centre monitor, wide and tall enough for all of them.
    const cx = center.x + center.w / 2, cy = center.y + center.h / 2;
    let hw = center.w / 2, hh = center.h / 2;
    for (const d of chosen) {
      hw = Math.max(hw, Math.abs(d.x - cx), Math.abs(d.x + d.w - cx));
      hh = Math.max(hh, Math.abs(d.y - cy), Math.abs(d.y + d.h - cy));
    }
    const slice = (d: SpanDisplay): SpanSlice => ({ fullW: hw * 2, fullH: hh * 2, x: d.x - (cx - hw), y: d.y - (cy - hh), w: d.w, h: d.h, mainH: center.h });

    this.spanning = true;
    const normal = this.views().filter((v) => !v.spanRole);
    const src = source?.renderer ?? normal[0]?.renderer ?? null;
    const flying = src ? src.cinemaOn : true;
    for (const v of normal) v.closeMenus();
    // Centre first: the others follow its renderer.
    const order = [center, ...chosen.filter((d) => d !== center)];
    let lead: PlexusRenderer | null = null;
    let leadWin: ElectronWindow | null = null;
    for (const d of order) {
      if (!this.spanning) return; // cancelled while opening
      const leaf = this.app.workspace.openPopoutLeaf({ x: d.x + 40, y: d.y + 40, size: { width: Math.max(320, Math.min(900, d.w - 80)), height: Math.max(240, Math.min(700, d.h - 80)) } });
      this.spanLeaves.push(leaf);
      await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { span: true } });
      const view = leaf.view;
      if (!(view instanceof PlexusView) || !view.renderer) continue;
      const isLead = d === center;
      view.enterSpan(isLead ? 'lead' : 'follow', slice(d), isLead ? null : lead);
      if (isLead) {
        lead = view.renderer;
        lead.setCinema(false);
        if (src) lead.copyCameraFrom(src);
        if (flying) lead.setCinema(true);
      }
      const bw = await findWindow(remote, view.containerEl.ownerDocument, d);
      if (bw) {
        bw.setBounds({ x: d.x, y: d.y, width: d.w, height: d.h });
        bw.setFullScreen(true);
        if (isLead) leadWin = bw;
      }
    }
    // Pause the normal views (they're behind the span anyway) and give the centre focus.
    for (const v of normal) if (v.renderer) v.renderer.paused = true;
    leadWin?.focus();
  }

  endSpan() {
    if (!this.spanning && !this.spanLeaves.length) return;
    this.spanning = false;
    this.endingSpan = true;
    const leaves = this.spanLeaves;
    this.spanLeaves = [];
    for (const leaf of leaves) leaf.detach();
    this.endingSpan = false;
    for (const v of this.views()) {
      if (v.renderer) v.renderer.paused = false;
      v.paintSpanMenu();
    }
  }

  /** A span window closed some other way (Alt+F4, Obsidian): end the whole span. */
  spanViewClosed() {
    if (this.spanning && !this.endingSpan) this.endSpan();
  }

  onunload() {
    if (this.cycleTimer !== null) window.clearInterval(this.cycleTimer);
    if (this.randomTimer !== null) window.clearInterval(this.randomTimer);
    this.endSpan();
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

  /** The built-in user manual, in a tab (reused if already open). */
  async openManual() {
    const existing = this.app.workspace.getLeavesOfType(MANUAL_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({ type: MANUAL_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async activate() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE).find((l) => !(l.view instanceof PlexusView && l.view.spanRole));
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
      // Nothing a request sends may take the listener down: anything thrown is a status.
      try { this.handleRequest(req, res); } catch (err) { sendError(res, err); }
    });
    server.on('error', (err: any) => {
      new Notice(`H!V3MYND: agent listener couldn't start on port ${this.settings.port} (${err.code ?? err.message}).`);
      this.server = null;
    });
    server.listen(this.settings.port, '127.0.0.1');
    this.server = server;
  }

  /** Every key the listener accepts: the user's credentials, plus the 1.1 shared key while it's still allowed. */
  listenerCredentials(): Credential[] {
    const out = this.credentials.filter((c) => c.key);
    if (this.settings.acceptLegacyKey && this.settings.listenerKey) {
      out.push({ id: 'legacy', label: 'Shared key (1.1)', agent: '', scope: 'bridge', key: this.settings.listenerKey, created: 0, legacy: true });
    }
    return out;
  }

  private handleRequest(req: any, res: any) {
    // Origin, key, route, scope and agent identity are all checked in gate() (server/auth.ts).
    const g = gate(req, { credentials: this.listenerCredentials(), developerMode: this.settings.developerMode, alias: (n) => this.alias(n) });
    if (!g.ok) { if (g.body) sendJson(res, g.body, g.status); else sendStatus(res, g.status, g.text); return; }
    const { url, cred } = g;
    // Budgets per key and overall, so a flood can't exhaust memory or the window.
    if (!this.rate.take(cred.id)) { sendStatus(res, 429, 'slow down'); return; }
    const release = (g.route.key === 'POST /approve' ? this.approvals : this.inflight).enter();
    if (!release) { sendStatus(res, 503, 'busy'); return; }
    res.on('close', release);
    // The agent this request acts as: an agent key always acts as its own agent.
    const who = g.who;
    // Notes in folders hidden from an agent key's own agent stay out of every team
    // answer too (server/visibility.ts). Bridge and admin keys see everything.
    const viewDeny = canAssertAgent(cred) ? [] : denyListFor(this.settings.policies, who(null));
    const hidden: Hidden = viewDeny.length ? (p) => !!p && isDenied(p, viewDeny) : SHOW_ALL;
    this.keyUsed.set(cred.id, Date.now());
    if (req.method === 'GET' && url.pathname === '/health' && !(this.settings.developerMode && hasScope(cred, 'admin'))) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, notes: this.graph?.paths.length ?? 0, version: this.manifest.version }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const sizes = this.views().map((v) => v.debugSizes());
      const monitors = this.app.workspace.getLeavesOfType(LOG_VIEW_TYPE).map((l) => ({
        popout: l.view.containerEl.ownerDocument !== document,
        attached: l.view.containerEl.isConnected,
        w: l.view.containerEl.ownerDocument.defaultView?.innerWidth,
        theme: (() => { const r = l.view.containerEl.querySelector('.plexus-log'); if (!r) return null; const cs = getComputedStyle(r); return { cls: r.className, bg: cs.backgroundColor, img: cs.backgroundImage.slice(0, 80), pl: cs.getPropertyValue('--pl-bg') }; })(),
      }));
      const render = this.views().map((v) => ({ stats: v.renderer?.stats() ?? null, audio: !!v.renderer?.audio, error: v.renderer?.lastError ?? null }));
      res.end(JSON.stringify({ ok: true, notes: this.graph?.paths.length ?? 0, views: this.views().length, spanning: this.spanning, displays: this.displays().map((d) => `${d.name} ${d.w}x${d.h}@${d.x},${d.y}${d.primary ? ' main' : ''}`), monitors, sizes, render, audioFrames: this.audio.stats.frames, audioRunning: this.audio.running, ...this.stats }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/replay') {
      // Toggle the replay scrubber in the brain view (view only).
      res.writeHead(202); res.end();
      for (const v of this.views()) void v.toggleReplay();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/focus') {
      // Light a set of notes in the brain: {notes: [paths], agent}; an empty body clears.
      void readJsonBody(req, LIMITS.small).then((d) => {
        const notes = Array.isArray(d?.notes) ? (d.notes as unknown[]).filter((n): n is string => typeof n === 'string').slice(0, 200) : [];
        this.focusTask(notes.length ? notes : null, who(d?.agent));
        sendStatus(res, 204);
      }).catch((err) => sendError(res, err));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/music') {
      // Toggle music reactivity (view only).
      res.writeHead(202); res.end();
      void this.toggleMusic();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/system-audio-probe') {
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
    if (req.method === 'GET' && url.pathname === '/audio-probe') {
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
    if (req.method === 'GET' && url.pathname === '/audio-devices') {
      void AudioReactor.inputs().then((list) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ onsets: this.audio.onsets, selected: this.settings.audioDevice, running: this.audio.running, device: this.audio.deviceLabel, error: this.audio.error, inputs: list.map((d) => ({ id: d.deviceId, label: d.label })) }));
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/approve') {
      // The bridge holds an agent's PC action until a person decides here.
      void readJsonBody(req, LIMITS.small).then(async (raw) => {
        const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
        const d = { agent: str(raw?.agent, 60), action: str(raw?.action, 200), detail: str(raw?.detail, 1000) };
        void this.toGlasses(`Approval needed: ${d.agent ?? 'an agent'} wants to ${d.action ?? 'act'}${d.detail ? ` (${d.detail.slice(0, 80)})` : ''}`);
        sendJson(res, { approved: await this.askApproval(d) });
      }).catch((err) => sendError(res, err));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/policy-block') {
      // The bridge refused an agent something its permissions don't allow.
      void readJsonBody(req, LIMITS.small).then((d) => {
        const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
        this.policyBlocked({ agent: str(d?.agent, 60), action: str(d?.action, 200), detail: str(d?.detail, 500) });
        sendStatus(res, 204);
      }).catch((err) => sendError(res, err));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/context-pack') {
      // The notes most relevant to a task (?q=), cut to ?budget= tokens, as JSON. The
      // agent's permissions apply, and the notes light up and log as reads by ?agent=.
      const q = (url.searchParams.get('q') ?? '').slice(0, 300);
      const agent = who(url.searchParams.get('agent'));
      const budget = Math.min(50_000, Math.max(500, Number(url.searchParams.get('budget')) || 6000));
      void this.contextPack(q, budget, agent).then((pack) => sendJson(res, pack)).catch((err) => sendError(res, err));
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
    if (req.method === 'POST' && url.pathname === '/meaning') {
      // Toggle the meaning map (view only).
      res.writeHead(202); res.end();
      void this.toggleMeaning();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/heat') {
      // Toggle the heat & decay overlay (view only).
      res.writeHead(202); res.end();
      void this.toggleHeat();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/open-monitor') {
      // Lets an agent pop the Brain Monitor window open (optionally on a tab); it can only open this one view.
      res.writeHead(202); res.end();
      const tab = /^[a-z]+$/.exec(url.searchParams.get('tab') ?? '')?.[0];
      void this.activateLog(true, tab);
      return;
    }
    // ---- 1.1.0 extras: tasks (F5), authorship (F12), HUD (F13)
    if (url.pathname === '/tasks' && req.method === 'GET') { json(res, visibleTasks(this.tasks.list().filter((t) => t.status !== 'done' || Date.now() - (t.done ?? 0) < 86_400_000), hidden)); return; }
    if (url.pathname === '/authorship' && req.method === 'GET') {
      const path = url.searchParams.get('path') ?? '';
      // A hidden note answers exactly like one that doesn't exist.
      void (hidden(path) ? Promise.resolve(null) : this.authorshipOf(path)).then((a) => json(res, { path, ...(a ?? { total: 0, agent: 0, human: 0, byAgent: {} }) })).catch((err) => sendError(res, err));
      return;
    }
    if (url.pathname === '/hud' && req.method === 'GET') { json(res, { lines: this.hudLines(hidden) }); return; }
    if (req.method === 'POST' && (url.pathname === '/tasks' || url.pathname === '/tasks/claim' || url.pathname === '/tasks/done' || url.pathname === '/tasks/withdraw')) {
      void readJsonBody(req, LIMITS.json).then((body) => {
        const agent = body?.agent || !canAssertAgent(cred) ? who(body?.agent) : '';
        if (!agent) { res.writeHead(400); res.end('agent is required'); return; }
        if (url.pathname === '/tasks') {
          // An agent proposes a task; it waits for the user's approval in the Team tab.
          const t = this.tasks.add({ title: String(body?.title ?? '').slice(0, 160) || 'Untitled task', detail: maskSecrets(String(body?.detail ?? '').slice(0, 2000)), path: body?.path ? normalizePath(String(body.path)) : undefined, by: agent, status: 'proposed' });
          new Notice(`H!V3MYND: ${agent} proposed a task: “${t.title}”. Approve it in Brain Monitor → Team.`, 8000);
          json(res, t);
          return;
        }
        const t = this.tasks.get(String(body?.id ?? ''));
        if (!t) { res.writeHead(404); res.end('no such task'); return; }
        if (url.pathname === '/tasks/withdraw') {
          // An agent takes back a task it proposed (only while it waits for approval).
          if (t.by !== agent || t.status !== 'proposed') { json(res, { ok: false }); return; }
          this.tasks.remove(t.id);
          json(res, { ok: true });
          return;
        }
        if (url.pathname === '/tasks/claim') {
          if (t.status !== 'open') { json(res, { ok: false, status: t.status, agent: t.agent ?? null }); return; }
          this.tasks.update(t.id, { status: 'claimed', agent, claimed: Date.now() });
          if (t.path) this.claims.claim(agent, t.path, t.title, 60, true);
          json(res, { ok: true, task: this.tasks.get(t.id) });
          return;
        }
        if (t.agent && t.agent !== agent) { json(res, { ok: false, reason: `claimed by ${t.agent}` }); return; }
        this.tasks.update(t.id, { status: 'done', done: Date.now(), agent, result: maskSecrets(String(body?.result ?? '').slice(0, 2000)) });
        if (t.path) this.claims.release(agent, [t.path]);
        new Notice(`H!V3MYND: ${agent} finished “${t.title}”.`, 6000);
        json(res, { ok: true });
      }).catch((err) => sendError(res, err));
      return;
    }
    // ---- teamwork: claims, handoffs, trust, gaps, daily brief
    if (url.pathname === '/claims' && req.method === 'GET') { json(res, visibleClaims(this.claims.list(), hidden)); return; }
    if (url.pathname === '/handoffs' && req.method === 'GET') { json(res, visibleHandoffs(this.handoffs.slice(-50).reverse(), hidden)); return; }
    if (url.pathname === '/handoff' && req.method === 'GET') {
      const from = this.alias(url.searchParams.get('from') ?? '');
      if (!from) { res.writeHead(400); res.end('from= is required'); return; }
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(this.handoffPackFor(from, url.searchParams.get('to') ?? undefined, url.searchParams.get('task') ?? undefined, hidden));
      return;
    }
    if ((url.pathname === '/check' || url.pathname === '/trust') && req.method === 'GET') {
      const path = url.searchParams.get('path') ?? '';
      const agent = who(url.searchParams.get('agent'));
      if (hidden(path)) { json(res, { path, claim: null, yours: false, trust: trustScore(path, null, [], []) }); return; }
      const claim = this.claims.holder(path);
      json(res, { path, claim: claim && claim.agent !== agent ? claim : null, yours: claim?.agent === agent, trust: this.trustOf(path) });
      return;
    }
    if (url.pathname === '/gaps' && req.method === 'GET') { void this.radarData().then((r) => json(res, { gaps: visiblePaths(r.gaps, hidden), trust: visiblePaths(r.trust, hidden) })).catch((err) => sendError(res, err)); return; }
    if (req.method === 'POST' && (url.pathname === '/claim' || url.pathname === '/release' || url.pathname === '/brief/now')) {
      void readJsonBody(req, LIMITS.json).then(async (body) => {
        if (url.pathname === '/brief/now') {
          // Optional "day": YYYY-MM-DD (default today, so far).
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body?.day ?? ''));
          const day = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
          json(res, { path: await this.writeBrief(day, body?.timelapse !== false) });
          return;
        }
        const agent = body?.agent || !canAssertAgent(cred) ? who(body?.agent) : '';
        if (!agent) { res.writeHead(400); res.end('agent is required'); return; }
        const paths: string[] = Array.isArray(body?.paths) ? body.paths.map(String) : body?.path ? [String(body.path)] : [];
        if (url.pathname === '/release') { json(res, { released: this.claims.release(agent, paths.length ? paths : undefined) }); return; }
        const minutes = Math.max(1, Math.min(480, Number(body?.minutes) || this.settings.claimMinutes));
        const claimed: Claim[] = [], conflicts: (Claim & { handoff: string })[] = [];
        for (const p of paths.filter((x) => !hidden(x))) {
          const r = this.claims.claim(agent, normalizePath(p), keptPurpose(body?.purpose, this.settings.storePurposes), minutes, true);
          if ('claim' in r) claimed.push(r.claim);
          else conflicts.push({ ...r.conflict, handoff: `http://127.0.0.1:${this.settings.port}/handoff?from=${encodeURIComponent(r.conflict.agent)}&to=${encodeURIComponent(agent)}` });
        }
        json(res, { ok: !conflicts.length, claimed, conflicts });
      }).catch((err) => sendError(res, err));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/snapshot') {
      // Dev: one rendered frame of a brain view as PNG (view=, node=, dist=, light=0|1).
      const v = this.views()[Number(url.searchParams.get('view') ?? 0)]?.renderer;
      if (!v) { res.writeHead(404); res.end(); return; }
      const num = (k: string) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : undefined);
      const light = url.searchParams.has('light') ? url.searchParams.get('light') === '1' : undefined;
      const theme = url.searchParams.get('theme');
      if (theme) v.setBrainTheme(themeById(theme));
      const shape = url.searchParams.get('shape');
      if (shape) v.setShape(shape, false);
      const cl = url.searchParams.get('cluster');
      if (cl !== null) v.setCluster(Number(cl));
      const orb = url.searchParams.get('orbit');
      if (orb) v.setOrbit(orb);
      const oc = url.searchParams.get('orbitColor');
      if (oc) v.setOrbitColor(oc);
      void v.snapshot({ index: num('node'), dist: num('dist'), light, fit: url.searchParams.get('fit') === '1' }).then(async (b) => {
        if (theme) v.setBrainTheme(themeById(this.settings.brainTheme));
        if (shape) v.setShape(this.settings.brainShape, false);
        if (cl !== null) v.setCluster(this.settings.brainCluster);
        if (orb) v.setOrbit(this.settings.agentOrbit);
        if (oc) v.setOrbitColor(this.settings.orbitColor);
        if (!b) { res.writeHead(500); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(new Uint8Array(await b.arrayBuffer()));
      });
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/span/on' || url.pathname === '/span/off')) {
      // Start or stop spanning the brain across the chosen monitors.
      res.writeHead(202); res.end();
      if (url.pathname === '/span/on') void this.startSpan(null); else this.endSpan();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/reload') {
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
    const hook = /^\/hook\/([a-z0-9_-]{1,40})$/i.exec(url.pathname);
    const prompt = /^\/prompt\/([a-z0-9_-]{1,40})$/i.exec(url.pathname);
    // /prewrite/<agent>: PreToolUse payload; snapshot the note before the agent writes.
    // /bridge-message: a message (or array of them) relayed by the Agent Bridge.
    const prewrite = /^\/prewrite\/([a-z0-9_-]{1,40})$/i.exec(url.pathname);
    const bridgeMsg = url.pathname === '/bridge-message';
    if (req.method !== 'POST' || (url.pathname !== '/pulse' && !hook && !prompt && !prewrite && !bridgeMsg)) { res.writeHead(404); res.end(); return; }
    void readBody(req, LIMITS.event).then((body) => {
      let lit = 0;
      try {
        const data = JSON.parse(body);
        if (prewrite) {
          // Respond only after the snapshot is taken, so the write can't race it. If the
          // note is claimed by another agent, or the agent is relying on a note with low
          // trust, the reply tells it so (Claude Code's PreToolUse format: the reason is
          // shown to the agent and the edit is held back).
          // A failed check is its own outcome (see server/prewrite.ts): held back when
          // claims or secret scanning block, otherwise allowed and marked as unchecked.
          const raw = prewrite[1].toLowerCase();
          const answer = (reason: string | null, error?: unknown) => {
            if (error !== undefined) this.persistFailed('pre-write check', error);
            const r = prewriteReply({
              reason, error, replies: this.hookReplyAgents().has(raw), onError: this.settings.prewriteOnError,
              enforcing: this.settings.claimMode === 'block' || this.settings.secretScan === 'block',
            });
            res.writeHead(r.status, r.headers);
            res.end(r.body);
          };
          void this.snapshotBefore(data, raw)
            .then((paths) => this.preWriteReply(this.alias(raw), paths, data))
            .then((reason) => answer(reason), (err) => answer(null, err ?? new Error('unknown error')));
          return;
        }
        if (bridgeMsg) {
          // 204 only once every message is on disk; a retry with the same ids is safe.
          const list: unknown[] = Array.isArray(data) ? data : [data];
          if (list.length > RATE.messages) { sendStatus(res, 413, `at most ${RATE.messages} messages per request`); return; }
          void (async () => { for (const m of list) await this.addBridgeMessage(m); })()
            .then(() => sendStatus(res, 204))
            .catch((err) => { console.warn('H!V3MYND: could not save a bridge message', err); sendStatus(res, 500, 'message not saved'); });
          return;
        }
        if (prompt) {
          const p = promptFromHook(data);
          const agent = prompt[1].toLowerCase();
          if (p && this.settings.storePurposes) {
            const entry = { text: maskSecrets(p.purpose), at: Date.now() };
            this.purposes.set(`${agent}:${p.session}`, entry);
            this.purposes.set(`${agent}:*`, entry);
            this.savePurposes();
          }
          res.writeHead(204); res.end(); return;
        }
        const events: PulseEvent[] = hook ? hookToEvents(data, hook[1].toLowerCase()) : Array.isArray(data.events) ? data.events : [data];
        if (events.length > RATE.events) { sendStatus(res, 413, `at most ${RATE.events} events per request`); return; }
        if (hook) {
          const adapter = this.app.vault.adapter;
          const miss = searchMiss(data, adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '');
          if (miss) this.addMiss({ t: Date.now(), agent: this.alias(hook[1]), query: miss.query });
        }
        for (const ev of events) {
          if (!ev || typeof ev !== 'object') continue;
          // Events are reports from the key holder (see ownEvent in server/auth.ts).
          lit += this.pulse(ownEvent(ev, cred));
        }
      } catch {
        res.writeHead(400); res.end(); return;
      }
      // Hooks get an empty 204 so nothing lands in the agent's hook output.
      if (hook) { res.writeHead(204); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, lit }));
    }).catch((err) => sendError(res, err));
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
    let purpose = keptPurpose(ev.purpose, this.settings.storePurposes);
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
      if (action === 'write' && this.settings.claimMode !== 'off') this.claims.claim(agent, note, purpose, this.settings.claimMinutes, false);
      if (this.settings.handoffs) this.checkHandoff(entry);
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
    // Prompt storage off: anything remembered from before it was turned off goes too.
    if (!this.settings.storePurposes) { await this.forgetPurposes(); return; }
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

  /** Clears remembered prompts from memory and disk (when "Store agent prompts" is turned off). */
  async forgetPurposes() {
    this.purposes.clear();
    try { if (await this.app.vault.adapter.exists(this.purposeFile())) await this.app.vault.adapter.remove(this.purposeFile()); } catch { /* gone */ }
  }

  /** Deletes change history, bridge messages and remembered prompts. */
  async purgeHistory() {
    await this.changes.purge();
    await this.forgetPurposes();
    await this.bridge.purge();
  }

  private missFile() { return `${this.manifest.dir}/search-misses.jsonl`; }

  private async loadMisses() {
    try {
      if (!(await this.app.vault.adapter.exists(this.missFile()))) return;
      for (const line of (await readTail(this.app.vault.adapter, this.missFile(), 1_000_000)).split('\n')) {
        if (!line.trim()) continue;
        try { this.misses.push(JSON.parse(line)); } catch { /* torn line */ }
      }
      if (this.misses.length > 2000) this.misses.splice(0, this.misses.length - 2000);
    } catch { /* first run */ }
  }

  private addMiss(m: SearchMiss) {
    const miss = { ...m, query: maskSecrets(m.query.slice(0, 300)) };
    this.misses.push(miss);
    if (this.misses.length > 2000) this.misses.splice(0, this.misses.length - 2000);
    void this.app.vault.adapter.append(this.missFile(), JSON.stringify(miss) + '\n').catch((err) => this.persistFailed('search log', err));
  }

  private lastPersistNotice = 0;

  /** A log or history write failed: count it (shown in /health) and tell the user, at most every 10 minutes. */
  persistFailed(what: string, err: unknown) {
    this.stats.persistFailures++;
    console.warn(`H!V3MYND: could not save ${what}`, err);
    if (Date.now() - this.lastPersistNotice > 10 * 60_000) {
      this.lastPersistNotice = Date.now();
      new Notice(`H!V3MYND couldn't save its ${what} (${err instanceof Error ? err.message : String(err)}). Check free disk space and the plugin folder.`, 10_000);
    }
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

  /** Vault-relative .md paths named in write-tool texts; anything that is not one is dropped (see pathguard.ts). */
  private writePaths(texts: string[]): string[] {
    const rules = this.pathRules();
    const out = new Set<string>();
    for (const raw of texts) {
      const rel = vaultRelative(raw, rules);
      if (rel) out.add(normalizePath(rel));
    }
    return [...out];
  }

  private pathRules(): PathRules {
    const adapter = this.app.vault.adapter;
    return { base: adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '', configDir: this.app.vault.configDir };
  }

  /**
   * Whether H!V3MYND may read a note named by an agent event: a plain vault path to a
   * Markdown file that, with links and junctions followed, is inside the vault. On
   * mobile (no file system access) only notes in Obsidian's own index qualify.
   */
  private async readableNote(path: string): Promise<boolean> {
    const rules = this.pathRules();
    const rel = vaultRelative(path, rules);
    if (!rel || normalizePath(rel) !== normalizePath(path)) return false;
    const d = nodeDeps();
    if (d && rules.base) return resolvesInside(d.fs, rules.base, path, d.platform, rules.configDir);
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  private async snapshotBefore(data: any, agent: string): Promise<string[]> {
    const all = new Set<string>();
    for (const ev of hookToEvents(data, agent)) {
      if (ev.kind !== 'write') continue;
      const texts = (ev.texts as string[]) ?? [];
      const graph = this.getGraph();
      const paths = new Set([...graph.resolver.resolve(texts).map((i) => graph.paths[i]), ...this.writePaths(texts)]);
      for (const p of paths) {
        all.add(p);
        // A path that doesn't qualify is treated as a new note: nothing is read.
        const ok = await this.readableNote(p);
        this.pendingBefore.set(p, { text: ok ? await this.app.vault.adapter.read(p) : null, t: Date.now() });
      }
    }
    return [...all];
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
    const after = (await this.readableNote(path)) ? await this.app.vault.adapter.read(path) : null;
    if (before === after) return;
    const masked = after !== null && this.settings.autoMaskSecrets && this.settings.secretScan !== 'off' ? newSecrets(before, after) : [];
    const saved = await this.changes.add({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      t: Date.now(),
      agent,
      path,
      purpose: keptPurpose(ev.purpose, this.settings.storePurposes),
      source: typeof ev.source === 'string' ? ev.source.slice(0, 80) : '',
      before,
      after,
    });
    if (!saved) this.persistFailed('change history', new Error('write failed'));
    if (masked.length && after !== null) await this.maskNote(path, after, masked.map((h) => h.kind), agent);
  }

  /** F4: mask the keys and tokens an agent just wrote into a note (undoable in Changes). */
  private async maskNote(path: string, text: string, kinds: string[], agent: string) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    const clean = maskSecrets(text);
    if (clean === text) return;
    await this.app.vault.modify(f, clean);
    // Only raw history may keep the unmasked text as this change's undo; otherwise the
    // secret is gone once masked (the agent's own change record was redacted too).
    const undoable = this.settings.historyMode === 'raw';
    if (undoable) {
      await this.changes.add({
        id: `${Date.now().toString(36)}-mask`, t: Date.now(), agent: 'H!V3MYND', path,
        purpose: `Masked ${kinds.length} secret${kinds.length === 1 ? '' : 's'} ${agent} wrote (${[...new Set(kinds)].join(', ')})`,
        source: 'H!V3MYND secret scanner', before: text, after: clean,
      });
    }
    new Notice(`H!V3MYND masked ${kinds.length === 1 ? 'a' : kinds.length} ${[...new Set(kinds)].join(', ')} that ${agent} wrote into “${noteTitle(path)}”. ` +
      (undoable ? 'Undo it in Brain Monitor → Changes if it was meant to be there.' : 'The original value was not kept; if it was meant to be there, add it again yourself.'), 12_000);
    const col: Collision = { t: Date.now(), kind: 'watch', note: path, writer: agent, other: 'secret scanner', otherAt: Date.now(), action: 'write', rule: 'secret' };
    this.alerts.push(col);
    for (const fn of this.alertListeners) fn(col);
  }

  private confirmRestore(c: ChangeRecord) {
    const rules = this.pathRules();
    const rel = vaultRelative(c.path, rules);
    const d = nodeDeps();
    // Also by where it really points (links, junctions, short names like OBSIDI~1).
    const real = d && rules.base && rel ? realRelative(d.fs, rules.base, rel, d.platform) : rel;
    if (!rel || normalizePath(rel) !== normalizePath(c.path) || !real || inConfigDir(real, rules.configDir)) { new Notice('H!V3MYND: this change names a path outside the vault and can’t be restored.'); return; }
    if (c.stored === 'metadata') { new Notice('H!V3MYND: this change was recorded without its text (history: metadata only), so it can’t be undone.'); return; }
    void this.noteIO().read(c.path).then((current) => new RestoreModal(this.app, c, async () => {
      // Only if the note still reads as it did when this dialog opened (server/restore.ts).
      try {
        await restoreNote(this.noteIO(), c.path, c.before, current);
      } catch (err) {
        if (!(err instanceof RestoreConflict)) throw err;
        new Notice(`H!V3MYND: “${noteTitle(c.path)}” changed after you opened this restore, so nothing was replaced. Open the change again to review the latest version.`, 10_000);
        return;
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
    }).open());
  }

  /** Obsidian's vault API in the shape restoreNote() needs. */
  private noteIO(): NoteIO {
    const v = this.app.vault;
    return {
      read: async (path) => { const f = v.getAbstractFileByPath(path); return f instanceof TFile ? v.read(f) : null; },
      process: async (path, fn) => { const f = v.getAbstractFileByPath(path); if (!(f instanceof TFile)) throw new RestoreConflict(path); await v.process(f, fn); },
      create: async (path, text) => { await v.create(path, text); },
      trash: async (path) => { const f = v.getAbstractFileByPath(path); if (f) await this.app.fileManager.trashFile(f); },
    };
  }

  // ------------------------------------------------------------ bridge traffic

  /**
   * Stores one message from the bridge and waits until it is on disk. Resolves false
   * for something that isn't a message; rejects if it couldn't be saved.
   */
  private async addBridgeMessage(raw: unknown): Promise<boolean> {
    const m = cleanMessage(raw);
    if (!m) return false;
    this.bridge.metadataOnly = this.settings.bridgeMessageStore === 'metadata';
    if ((await this.bridge.add(m)) === 'duplicate') return true;
    // Only animate fresh traffic, not a history backfill.
    if (Date.now() - m.t < 60_000 && !this.replaying) {
      for (const v of this.views()) v.renderer?.message(this.alias(m.sender), m.recipient === 'all' ? 'all' : this.alias(m.recipient));
    }
    for (const fn of this.bridgeListeners) fn(m);
    return true;
  }

  // ------------------------------------------------------------ music reactivity

  /** Music button / M: with music on and its panel closed, bring the panel back; otherwise toggle. */
  async musicButton() {
    const hidden = this.views().filter((v) => v.renderer?.meterHidden);
    if (this.audio.running && hidden.length) { for (const v of hidden) v.renderer!.showMeter(); return; }
    await this.toggleMusic();
  }

  async toggleMusic() {
    for (const v of this.views()) v.renderer?.showMeter();
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
      v.renderer.audio = this.audio.running ? { reactor: this.audio, strength: s.musicStrength, delayMs: s.musicDelay, midHigh: s.musicMidHigh, palette: musicColors(s.musicColor, MUSIC_PALETTES[s.musicPalette] ?? MUSIC_PALETTES.Neon), gains: { bass: s.musicBassGain, mid: s.musicMidGain, high: s.musicHighGain } } : null;
      v.renderer.audioControls = this.audioControls;
    }
  }

  private saveGains = debounce(() => void this.saveData(this.settings), 500, true);

  /** Wiring for the music panel in the brain: band sliders and the source picker. */
  readonly audioControls: AudioControls = {
    colorOptions: () => ORBIT_COLORS.map(([id, label]) => [id, id === 'default' ? 'Default (multicolour)' : label] as [string, string]),
    color: () => this.settings.musicColor,
    setColor: (id) => { this.settings.musicColor = id; void this.saveData(this.settings); this.applyMusic(); },
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

  /** Path other local tools (bridge, hooks) read the key from. */
  keyFilePath() {
    const os = (window as any).require('os');
    const path = (window as any).require('path');
    return path.join(os.homedir(), '.hivemynd', 'listener.key');
  }

  /** This vault's own key folder, where bridge keys are saved. */
  vaultKeyDir(): string | null {
    const d = nodeDeps();
    const adapter = this.app.vault.adapter;
    if (!d || !(adapter instanceof FileSystemAdapter)) return null;
    return vaultKeyDir(d, this.app.vault.getName(), adapter.getBasePath());
  }

  /** Key file for a bridge credential; agent and admin keys go into hook configs instead. */
  credentialFile(c: CredentialMeta): string | null {
    const dir = this.vaultKeyDir();
    const d = nodeDeps();
    return dir && d && c.scope === 'bridge' ? d.path.join(dir, `${c.agent || 'bridge'}-${c.id}.key`) : null;
  }

  /**
   * Writes the key files local tools read: one per bridge credential in this vault's
   * folder, and the 1.1 shared file while the shared key is still accepted (removed
   * once it's retired, if it still holds this vault's key).
   */
  private async writeKeyFiles() {
    const d = nodeDeps();
    if (!d) return;
    const fail = (err: unknown) => console.warn('H!V3MYND: could not write a listener key file', err);
    const legacy = this.keyFilePath();
    if (this.settings.acceptLegacyKey && this.settings.listenerKey) await writeSecretFile(d, legacy, this.settings.listenerKey).catch(fail);
    else {
      try { if (d.fs.readFileSync(legacy, 'utf8').trim() === this.settings.listenerKey) removeSecretFile(d, legacy); } catch { /* not there */ }
    }
    for (const c of this.credentials) {
      const file = this.credentialFile(c);
      if (file) await writeSecretFile(d, file, c.key).catch(fail);
    }
  }

  private credentialSecretId(id: string) { return `hivemynd-cred-${id}`; }

  /** Loads credential keys from SecretStorage; a credential whose key is missing is dropped. */
  private loadCredentials() {
    const ss = this.app.secretStorage;
    this.credentials = (this.settings.credentials ?? []).map((m) => ({ ...m, key: ss.getSecret(this.credentialSecretId(m.id)) ?? '' })).filter((c) => c.key);
  }

  private async saveCredentials() {
    this.settings.credentials = this.credentials.map(({ key: _key, ...meta }) => meta);
    await this.saveData(this.settings);
    await this.writeKeyFiles();
  }

  async addCredential(label: string, agent: string, scope: Scope): Promise<Credential> {
    const c = newCredential(label, agent, scope);
    this.app.secretStorage.setSecret(this.credentialSecretId(c.id), c.key);
    this.credentials.push(c);
    await this.saveCredentials();
    return c;
  }

  async revokeCredential(id: string) {
    const c = this.credentials.find((x) => x.id === id);
    if (!c) return;
    this.app.secretStorage.setSecret(this.credentialSecretId(id), '');
    const d = nodeDeps();
    const file = this.credentialFile(c);
    if (d && file) removeSecretFile(d, file);
    this.credentials = this.credentials.filter((x) => x.id !== id);
    await this.saveCredentials();
  }

  async regenerateCredential(id: string) {
    const c = this.credentials.find((x) => x.id === id);
    if (!c) return;
    c.key = newKey();
    this.app.secretStorage.setSecret(this.credentialSecretId(id), c.key);
    await this.saveCredentials();
  }

  /**
   * Soft migration from the 1.1 shared key: one agent key per configured agent and
   * one bridge key, skipping any that already exist. The shared key keeps working
   * until the user retires it.
   */
  async migrateCredentials(): Promise<Credential[]> {
    const made: Credential[] = [];
    const have = (agent: string, scope: Scope) => this.credentials.some((c) => c.agent === agent && c.scope === scope);
    for (const a of this.settings.agents.filter((x) => x.name !== 'other')) {
      if (!have(a.name, 'agent')) made.push(await this.addCredential(`${a.name} hooks`, a.name, 'agent'));
    }
    if (!this.credentials.some((c) => c.scope === 'bridge')) made.push(await this.addCredential('Agent Bridge', 'bridge', 'bridge'));
    return made;
  }

  async setAcceptLegacyKey(on: boolean) {
    this.settings.acceptLegacyKey = on;
    await this.saveData(this.settings);
    await this.writeKeyFiles();
  }

  async regenerateViewerKey() {
    this.settings.viewerKey = randomHex(24);
    await this.saveData(this.settings);
    this.startViewer(); // restarting drops open viewers that used the old key
  }

  async regenerateKey() {
    this.settings.listenerKey = newKey();
    await this.saveData(this.settings);
    await this.writeKeyFiles();
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
    // Themes replaced the light/dark switches: light = Inkblot, dark = Multiverse.
    if (!this.settings.brainTheme) this.settings.brainTheme = this.settings.brainLight ? 'inkblot' : 'multiverse';
    if (!this.settings.monitorTheme) this.settings.monitorTheme = this.settings.monitorLight ? 'inkblot' : 'multiverse';
    if (!this.settings.viewerKey) { this.settings.viewerKey = randomHex(24); await this.saveData(this.settings); }
    // Keep agents added in later versions even if the saved list predates them.
    const names = new Set(this.settings.agents.map((a) => a.name));
    this.settings.agents = [...this.settings.agents, ...DEFAULT_OPTIONS.agents.filter((a) => !names.has(a.name))];
    this.loadCredentials();
    // A fresh install starts with the shared key retired and one key per agent; an
    // upgrade keeps the 1.1 shared key working until the user migrates.
    if (!this.settings.listenerKey && !saved.credentials) {
      this.settings.acceptLegacyKey = false;
      this.settings.listenerKey = newKey();
      await this.migrateCredentials();
    } else if (!this.settings.listenerKey) await this.regenerateKey();
    else await this.writeKeyFiles();
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

/** A yes/no question for actions that can't be undone. */
class ConfirmModal extends Modal {
  constructor(app: App, private heading: string, private text: string, private yes: string, private onConfirm: () => Promise<void>) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.heading });
    contentEl.createEl('p', { text: this.text });
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const ok = row.createEl('button', { cls: 'mod-warning', text: this.yes });
    ok.addEventListener('click', async () => { ok.disabled = true; await this.onConfirm(); this.close(); });
  }

  onClose() {
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
        : `This puts “${noteTitle(this.c.path)}” back to how it was just before ${this.c.agent}'s change at ${new Date(this.c.t).toLocaleTimeString([], { hour12: false })}. Anything written since that change is replaced; the current version is kept as a new entry in Changes, so this can be undone too. If the note changes while this dialog is open, nothing is replaced.`,
    });
    if (this.c.stored === 'redacted') contentEl.createEl('p', { text: 'Keys and tokens were masked when this change was saved, so any in the restored text come back masked.' });
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
    this.button(bar, 'music', 'Music reactivity (M)', () => void this.plugin.musicButton());
    this.button(bar, 'search', 'Search the brain (/ or Ctrl+F)', () => this.search?.show());
    this.cinemaBtn = this.button(bar, 'clapperboard', 'Cinematic camera (C starts / stops)', () => this.toggleCinemaMenu());
    this.spanBtn = this.button(bar, 'monitor', 'Span across monitors', () => this.toggleSpanMenu());
    this.button(bar, 'scan-eye', 'Focus on a project folder (Esc leaves)', () => this.plugin.pickProject());
    // Theme drop-down. One theme for every brain view: the normal view and each span monitor.
    this.themeBtn = this.button(bar, 'palette', 'Theme', () => {
      const menu = new Menu();
      const s = this.plugin.settings;
      addGroup(menu, 'Randomize', 'shuffle', [
        { title: 'On', checked: s.randomizeOn, run: () => void this.plugin.setRandomize(true) },
        { title: 'Off', checked: !s.randomizeOn, run: () => void this.plugin.setRandomize(false) },
        ...CYCLES.filter(([sec]) => sec > 0).map(([sec, label]) => ({ title: `Every ${label}`, checked: sec === s.randomizeInterval, run: () => void this.plugin.setRandomizeInterval(sec) })),
        { title: 'Shuffle now', checked: false, run: () => void this.plugin.shuffleLook() },
      ]);
      addGroup(menu, 'Colors', 'palette', THEMES.map((t) => ({ title: t.name, checked: t.id === s.brainTheme, run: () => void this.plugin.setBrainTheme(t.id) })));
      addGroup(menu, 'Shapes', 'shapes', SHAPES.map((sh) => ({ title: sh.name, checked: sh.id === s.brainShape, run: () => void this.plugin.setBrainShape(sh.id) })));
      addGroup(menu, 'Agent orbit', 'orbit', ORBITS.map(([id, label]) => ({ title: label, checked: id === s.agentOrbit, run: () => void this.plugin.setAgentOrbit(id) })));
      addGroup(menu, 'Orbit line color', 'circle-dot', ORBIT_COLORS.map(([id, label]) => ({ title: label, checked: id === s.orbitColor, run: () => void this.plugin.setOrbitColor(id) })));
      addGroup(menu, 'Shape cycle', 'repeat', CYCLES.map(([sec, label]) => ({ title: label, checked: sec === s.shapeCycle, run: () => void this.plugin.setShapeCycle(sec) })));
      menu.addItem((item) => item.setTitle('Clustering…').setIcon('sliders-horizontal').onClick(() => this.toggleClusterPanel()));
      const r = this.themeBtn!.getBoundingClientRect();
      showMenu(menu, { x: r.left, y: r.bottom + 4 }, this.containerEl.ownerDocument);
    });
    this.button(bar, 'activity', 'Brain Monitor (own window)', () => void this.plugin.activateLog(true));

    try {
      this.plugin.trace('view: creating renderer');
      this.renderer = new PlexusRenderer(host, this.plugin.settings);
      this.plugin.trace('view: renderer created');
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
    this.plugin.trace('view: applying theme');
    this.applyTheme();
    this.plugin.trace('view: theme applied');
    this.renderer.onCinemaChange = (on) => { this.cinemaBtn?.toggleClass('is-on', on); this.cinemaMenuPaint?.(); };
    this.applyCinema();
    this.renderer.setLowLatency(this.plugin.settings.lowLatency);
    if (this.plugin.settings.cinemaOnOpen) this.renderer.setCinema(true);
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
    }, (a) => this.plugin.settings.agents.find((x) => x.name === a)?.color ?? '#ffffff', (path) => this.plugin.noteBadge(path));
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
      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.toggleCinema(); return; }
      if (e.key === 'Escape' && this.plugin.projectFocus && !this.search?.open) { e.preventDefault(); this.plugin.focusProject(null); return; }
      if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.toggleGrowth(); return; }
      if ((e.key === '/' || ((e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey))) && !e.altKey) { e.preventDefault(); this.search?.show(); return; }
      if (e.key === 'Escape' && this.search?.open) { e.preventDefault(); this.search.close(); return; }
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.toggleReplayBar(); }
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.toggleFullscreen(); }
      if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void this.plugin.toggleHeat(); }
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void this.plugin.musicButton(); }
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
    this.plugin.refreshMarkers();
    if (this.plugin.heatOn) await this.plugin.applyHeat();
    this.plugin.applyMusic();
  }

  toggleReplay() {
    return this.replay?.toggleOpen();
  }

  /**
   * Replay these entries squeezed into `seconds` and record the brain doing it
   * (WebM). The camera flies through while recording. Null if recording isn't possible.
   */
  async recordTimelapse(entries: AccessEntry[], seconds: number): Promise<ArrayBuffer | null> {
    const r = this.renderer;
    if (!r || !entries.length || typeof MediaRecorder === 'undefined') return null;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) return null;
    const stream = r.canvasEl.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
    const index = new Map<string, number>();
    this.plugin.getGraph().paths.forEach((p, i) => index.set(p, i));
    const start = entries[0].t, span = Math.max(1, entries[entries.length - 1].t - start);
    const flying = r.cinemaOn;
    if (!flying) r.setCinema(true);
    this.plugin.replaying = true;
    rec.start(1000);
    const t0 = performance.now();
    let k = 0;
    await new Promise<void>((resolve) => {
      const step = () => {
        const done = (performance.now() - t0) / (seconds * 1000);
        const upTo = start + done * span;
        while (k < entries.length && entries[k].t <= upTo) {
          const e = entries[k++];
          const idx = e.notes.map((p) => index.get(p) ?? -1).filter((i) => i >= 0);
          if (idx.length) r.touch(idx, e.agent, e.action === 'write' ? 'write' : e.action === 'search' ? 'scan' : 'read');
        }
        if (done >= 1) resolve();
        else window.setTimeout(step, 40);
      };
      step();
    });
    rec.stop();
    await stopped;
    this.plugin.replaying = false;
    if (!flying) r.setCinema(false);
    for (const t of stream.getTracks()) t.stop();
    if (!chunks.length) return null;
    return await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
  }

  private cinemaBtn: HTMLButtonElement | null = null;

  toggleCinema() {
    if (this.renderer) this.renderer.setCinema(!this.renderer.cinemaOn, true);
  }

  // ---------------------------------------------------------------- span across monitors

  /** Set while this view is one of the span windows: 'lead' is the centre monitor. */
  spanRole: 'lead' | 'follow' | null = null;
  private spanBtn: HTMLButtonElement | null = null;
  private spanMenu: HTMLElement | null = null;
  private spanMenuPaint: (() => void) | null = null;
  private spanMenuOff: (() => void) | null = null;

  getState() {
    return { ...super.getState(), span: this.spanRole !== null };
  }

  async setState(state: unknown, result: ViewStateResult) {
    // A span window restored by Obsidian after a restart: the span is over, close it.
    if (state && typeof state === 'object' && (state as { span?: boolean }).span && !this.plugin.spanning) {
      window.setTimeout(() => this.leaf.detach(), 0);
    }
    await super.setState(state, result);
  }

  /** Become one monitor's part of the span. Followers copy the leader every frame. */
  enterSpan(role: 'lead' | 'follow', slice: SpanSlice, leader: PlexusRenderer | null) {
    this.spanRole = role;
    const doc = this.containerEl.ownerDocument;
    doc.body.addClass('plexus-span-window');
    this.contentEl.addClass(role === 'lead' ? 'is-span-lead' : 'is-span-follow');
    this.renderer?.setSlice(slice);
    this.renderer?.setLeader(leader);
    this.applyTheme();
    // Clicking a note ends the span and opens it in the main window.
    if (this.renderer) {
      this.renderer.onOpen = (i) => {
        const path = this.plugin.getGraph().paths[i];
        this.plugin.endSpan();
        if (path) window.setTimeout(() => void this.plugin.app.workspace.openLinkText(path, '', 'tab'), 50);
      };
    }
    // Escape on any span monitor ends the span (unless it is closing a menu or search).
    this.registerDomEvent(doc, 'keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || this.cinemaMenu || this.spanMenu || this.search?.open) return;
      e.preventDefault();
      this.plugin.endSpan();
    });
  }

  private clusterPanel: HTMLElement | null = null;
  private clusterOff: (() => void) | null = null;

  /** A small slider panel under the palette button: spread .. as laid out .. tight. */
  toggleClusterPanel() {
    if (this.clusterPanel) { this.closeClusterPanel(); return; }
    this.closeMenus();
    const btn = this.themeBtn;
    const s = this.plugin.settings;
    const m = (this.clusterPanel = this.contentEl.createDiv({ cls: 'plexus-cine-menu plexus-cluster-menu' }));
    if (btn) m.setCssStyles({ right: `${Math.max(8, Math.round(this.contentEl.getBoundingClientRect().right - btn.getBoundingClientRect().right))}px` });
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'dblclick', 'click']) m.addEventListener(ev, (e) => e.stopPropagation());
    const head = m.createDiv({ cls: 'pcm-head' });
    head.createSpan({ cls: 'pcm-title', text: 'Clustering' });
    const x = head.createEl('button', { cls: 'pcm-x', attr: { 'aria-label': 'Close' } });
    setIcon(x, 'x');
    x.addEventListener('click', () => this.closeClusterPanel());
    const row = m.createDiv({ cls: 'pcm-row' });
    row.createSpan({ cls: 'pcm-name', text: 'Spread' });
    const slider = row.createEl('input', { cls: 'pcm-speed', attr: { type: 'range', min: '-100', max: '100', step: '5', 'aria-label': 'Clustering' } });
    slider.value = String(Math.round(s.brainCluster * 100));
    row.createSpan({ cls: 'pcm-val', text: 'Tight' });
    const hint = m.createDiv({ cls: 'pcm-hint' });
    const paint = () => hint.setText(s.brainCluster === 0 ? 'As laid out. Double-click the slider to reset.' : s.brainCluster > 0 ? `Tighter clusters (${Math.round(s.brainCluster * 100)}%)` : `More spread out (${Math.round(-s.brainCluster * 100)}%)`);
    paint();
    let saveTimer = 0;
    slider.addEventListener('input', () => {
      s.brainCluster = Number(slider.value) / 100;
      for (const v of this.plugin.views()) v.renderer?.setCluster(s.brainCluster);
      paint();
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void this.plugin.saveData(s), 400);
    });
    slider.addEventListener('dblclick', () => { slider.value = '0'; slider.dispatchEvent(new Event('input')); });
    const doc = m.ownerDocument;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); this.closeClusterPanel(); } };
    doc.addEventListener('keydown', onKey, true);
    this.clusterOff = () => doc.removeEventListener('keydown', onKey, true);
  }

  closeClusterPanel() {
    this.clusterOff?.();
    this.clusterOff = null;
    this.clusterPanel?.remove();
    this.clusterPanel = null;
  }

  closeMenus() {
    this.closeClusterPanel();
    this.closeCinemaMenu();
    this.closeSpanMenu();
  }

  paintSpanMenu() {
    this.spanMenuPaint?.();
  }

  /** Drop-down: which monitors take part, which is the centre, and start / stop. */
  toggleSpanMenu() {
    if (this.spanMenu) { this.closeSpanMenu(); return; }
    this.closeCinemaMenu();
    const btn = this.spanBtn;
    if (!btn) return;
    const plugin = this.plugin;
    const s = plugin.settings;
    const all = plugin.displays();
    const m = (this.spanMenu = this.contentEl.createDiv({ cls: 'plexus-cine-menu plexus-span-menu' }));
    const right = this.contentEl.getBoundingClientRect().right - btn.getBoundingClientRect().right;
    m.setCssStyles({ right: `${Math.max(8, Math.round(right))}px` });
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'dblclick', 'click']) m.addEventListener(ev, (e) => e.stopPropagation());

    const head = m.createDiv({ cls: 'pcm-head' });
    head.createSpan({ cls: 'pcm-title', text: 'Span monitors' });
    const x = head.createEl('button', { cls: 'pcm-x', attr: { 'aria-label': 'Close' } });
    setIcon(x, 'x');
    x.addEventListener('click', () => this.closeSpanMenu());

    if (!all.length) {
      m.createDiv({ cls: 'pcm-hint', text: 'Monitor info is only available in the desktop app.' });
    }

    // Mini map of the monitors as Windows arranges them. Click one to include / leave out.
    const map = m.createDiv({ cls: 'psm-map' });
    const minX = Math.min(...all.map((d) => d.x)), minY = Math.min(...all.map((d) => d.y));
    const maxX = Math.max(...all.map((d) => d.x + d.w)), maxY = Math.max(...all.map((d) => d.y + d.h));
    const scale = Math.min(212 / Math.max(1, maxX - minX), 104 / Math.max(1, maxY - minY));
    map.setCssStyles({ height: `${Math.round((maxY - minY) * scale) + 2}px` });
    const tiles = all.map((d, i) => {
      const t = map.createDiv({ cls: 'psm-mon', text: String(i + 1), attr: { title: `${d.name} · ${d.w}×${d.h}` } });
      t.setCssStyles({
        left: `${Math.round((d.x - minX) * scale)}px`, top: `${Math.round((d.y - minY) * scale)}px`,
        width: `${Math.max(8, Math.round(d.w * scale) - 3)}px`, height: `${Math.max(8, Math.round(d.h * scale) - 3)}px`,
      });
      t.addEventListener('click', () => toggle(d.id));
      return t;
    });

    // List: include checkbox, name, size, centre choice.
    const list = m.createDiv({ cls: 'psm-list' });
    const rows = all.map((d, i) => {
      const row = list.createDiv({ cls: 'psm-row' });
      const cb = row.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Include ${d.name}` } });
      cb.addEventListener('change', () => toggle(d.id));
      const name = row.createSpan({ cls: 'psm-name' });
      name.createSpan({ cls: 'psm-num', text: String(i + 1) });
      name.createSpan({ text: ` ${d.w}×${d.h}${d.primary ? ' · main' : ''}` });
      const c = row.createEl('button', { cls: 'pcm-chip psm-center', text: 'Center' });
      c.addEventListener('click', () => {
        s.spanCenter = d.id;
        if (!effective().includes(d.id)) s.spanMonitors = [...effective(), d.id];
        changed();
      });
      return { cb, c };
    });

    const go = m.createEl('button', { cls: 'pcm-go' });
    go.addEventListener('click', () => {
      if (plugin.spanning) plugin.endSpan();
      else { this.closeSpanMenu(); void plugin.startSpan(this); }
      paint();
    });
    const hint = m.createDiv({ cls: 'pcm-hint' });

    // Empty selection means "all monitors"; work on the explicit list from here on.
    const effective = () => (s.spanMonitors.filter((id) => all.some((d) => d.id === id)).length ? s.spanMonitors.filter((id) => all.some((d) => d.id === id)) : all.map((d) => d.id));
    const toggle = (id: string) => {
      const cur = effective();
      const next = cur.includes(id) ? cur.filter((v) => v !== id) : [...cur, id];
      if (!next.length) return; // keep at least one
      s.spanMonitors = next;
      changed();
    };
    const changed = () => {
      void plugin.saveData(s);
      paint();
      // Already spanning: apply the new selection straight away.
      if (plugin.spanning) void plugin.startSpan(this.spanRole ? null : this);
    };
    const paint = () => {
      const on = effective();
      const { center } = plugin.spanSelection(all);
      all.forEach((d, i) => {
        const inc = on.includes(d.id), isC = center?.id === d.id;
        tiles[i].toggleClass('is-on', inc);
        tiles[i].toggleClass('is-center', isC);
        rows[i].cb.checked = inc;
        rows[i].c.toggleClass('is-on', isC);
      });
      go.setText(plugin.spanning ? '■  Stop spanning' : `▶  Span across ${on.length} monitor${on.length === 1 ? '' : 's'}`);
      go.toggleClass('is-on', plugin.spanning);
      hint.setText(plugin.spanning
        ? 'Esc on any monitor stops. The toolbar sits at the bottom of the center monitor.'
        : 'Click a monitor to include or leave it out. The center monitor leads the camera.');
    };
    this.spanMenuPaint = paint;
    paint();

    const doc = m.ownerDocument;
    let swallowClick = false;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (m.contains(t) || btn.contains(t)) return;
      if (this.contentEl.contains(t)) { e.stopPropagation(); e.preventDefault(); swallowClick = true; }
      this.closeSpanMenu();
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.closeSpanMenu();
    };
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('click', onClick, true);
    this.spanMenuOff = () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('keydown', onKey, true);
      window.setTimeout(() => doc.removeEventListener('click', onClick, true), 0);
    };
    btn.addClass('is-open');
  }

  closeSpanMenu() {
    this.spanMenuOff?.();
    this.spanMenuOff = null;
    this.spanMenuPaint = null;
    this.spanMenu?.remove();
    this.spanMenu = null;
    this.spanBtn?.removeClass('is-open');
  }

  private cinemaMenu: HTMLElement | null = null;
  private cinemaMenuPaint: (() => void) | null = null;
  private cinemaMenuOff: (() => void) | null = null;

  /** Drop-down under the clapperboard: start/stop, auto-start delay (or off), start on open, speed. */
  toggleCinemaMenu() {
    if (this.cinemaMenu) { this.closeCinemaMenu(); return; }
    this.closeSpanMenu();
    const btn = this.cinemaBtn;
    if (!btn) return;
    const s = this.plugin.settings;
    const save = () => void this.plugin.saveData(s);
    const all = () => this.plugin.views();
    const m = (this.cinemaMenu = this.contentEl.createDiv({ cls: 'plexus-cine-menu' }));
    // Sit under the button, right-aligned to it.
    const right = this.contentEl.getBoundingClientRect().right - btn.getBoundingClientRect().right;
    m.setCssStyles({ right: `${Math.max(8, Math.round(right))}px` });
    // Keep clicks, drags, wheel and keys inside the menu (not orbiting the brain or
    // triggering the view's single-key shortcuts).
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'dblclick', 'click']) m.addEventListener(ev, (e) => e.stopPropagation());

    const head = m.createDiv({ cls: 'pcm-head' });
    head.createSpan({ cls: 'pcm-title', text: 'Cinematic camera' });
    const x = head.createEl('button', { cls: 'pcm-x', attr: { 'aria-label': 'Close' } });
    setIcon(x, 'x');
    x.addEventListener('click', () => this.closeCinemaMenu());
    const go = m.createEl('button', { cls: 'pcm-go' });

    m.createDiv({ cls: 'pcm-label', text: 'Start by itself after' });
    const chips = m.createDiv({ cls: 'pcm-chips' });
    const fmt = (sec: number) => (sec >= 60 && sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`);
    const options = [0, 30, 60, 120, 300, 600];
    for (const sec of options) {
      const c = chips.createEl('button', { cls: 'pcm-chip', text: sec ? fmt(sec) : 'Off', attr: { 'data-sec': String(sec) } });
      c.addEventListener('click', () => {
        s.cinemaIdle = sec;
        save();
        for (const v of all()) { v.applyCinema(); if (sec > 0) v.renderer?.releaseCinemaHold(); }
        paint();
      });
    }
    const hint = m.createDiv({ cls: 'pcm-hint' });

    const openRow = m.createEl('label', { cls: 'pcm-row pcm-check' });
    const cb = openRow.createEl('input', { attr: { type: 'checkbox' } });
    cb.checked = s.cinemaOnOpen;
    openRow.createSpan({ text: 'Start when the brain opens' });
    cb.addEventListener('change', () => { s.cinemaOnOpen = cb.checked; save(); });

    const speedRow = m.createDiv({ cls: 'pcm-row' });
    speedRow.createSpan({ cls: 'pcm-name', text: 'Speed' });
    const speed = speedRow.createEl('input', { cls: 'pcm-speed', attr: { type: 'range', min: '0.3', max: '2', step: '0.1', 'aria-label': 'Flight speed' } });
    speed.value = String(s.cinemaSpeed);
    const speedVal = speedRow.createSpan({ cls: 'pcm-val' });
    speed.addEventListener('input', () => {
      s.cinemaSpeed = Number(speed.value);
      speedVal.setText(`${s.cinemaSpeed.toFixed(1)}×`);
      for (const v of all()) v.applyCinema();
    });
    speed.addEventListener('change', save);

    const paint = () => {
      const on = !!this.renderer?.cinemaOn;
      go.setText(on ? '■  Stop flythrough' : '▶  Start flythrough');
      go.toggleClass('is-on', on);
      chips.querySelectorAll<HTMLElement>('.pcm-chip').forEach((c) => c.toggleClass('is-on', Number(c.dataset.sec) === s.cinemaIdle));
      hint.setText(s.cinemaIdle > 0
        ? `Starts after ${fmt(s.cinemaIdle)} without touching the brain. Stopping it with the button above keeps it off.`
        : 'Off: it only runs when you start it.');
      speedVal.setText(`${s.cinemaSpeed.toFixed(1)}×`);
    };
    go.addEventListener('click', () => { this.toggleCinema(); paint(); });
    this.cinemaMenuPaint = paint;
    paint();

    // Close on a click anywhere else, or Escape. A click on the brain only closes the
    // menu: it doesn't reach the canvas, so it doesn't count as touching the brain
    // (which would stop the flythrough).
    const doc = m.ownerDocument;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (m.contains(t) || btn.contains(t)) return;
      if (this.contentEl.contains(t)) {
        e.stopPropagation();
        e.preventDefault();
        swallowClick = true;
      }
      this.closeCinemaMenu();
    };
    // The click that follows a swallowed pointerdown is dropped too (no node pick).
    let swallowClick = false;
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.closeCinemaMenu();
    };
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    this.cinemaMenuOff = () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('keydown', onKey, true);
      // Keep the click-swallower one tick longer: the click lands after the menu closes.
      window.setTimeout(() => doc.removeEventListener('click', onClick, true), 0);
    };
    doc.addEventListener('click', onClick, true);
    btn.addClass('is-open');
  }

  closeCinemaMenu() {
    this.cinemaMenuOff?.();
    this.cinemaMenuOff = null;
    this.cinemaMenuPaint = null;
    this.cinemaMenu?.remove();
    this.cinemaMenu = null;
    this.cinemaBtn?.removeClass('is-open');
  }

  applyCinema() {
    if (!this.renderer) return;
    const s = this.plugin.settings;
    this.renderer.cinemaIdleSec = s.cinemaIdle;
    this.renderer.cinemaSpeed = s.cinemaSpeed;
  }

  private themeBtn: HTMLButtonElement | null = null;

  applyTheme() {
    const theme = themeById(this.plugin.settings.brainTheme);
    const light = theme.light;
    this.contentEl.toggleClass('is-light', light);
    this.contentEl.ownerDocument.body.toggleClass('plexus-span-light', light && this.spanRole !== null);
    // Buttons and menus pick up the theme's node colour.
    const accent = chromeAccent(theme);
    if (accent) this.contentEl.style.setProperty('--hv-accent', accent);
    else this.contentEl.style.removeProperty('--hv-accent');
    this.contentEl.dataset.theme = theme.id;
    this.renderer?.setBrainTheme(theme);
    this.renderer?.setShape(shapeById(this.plugin.settings.brainShape).id, false);
    this.renderer?.setCluster(this.plugin.settings.brainCluster);
    this.renderer?.setOrbitColor(this.plugin.settings.orbitColor);
    this.renderer?.setOrbit(this.plugin.settings.agentOrbit);
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
    this.closeMenus();
    if (this.spanRole) {
      this.spanRole = null;
      this.plugin.spanViewClosed();
    }
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

  /** Listener keys: one per agent, each limited to what that kind of client needs. */
  private keysSection(containerEl: HTMLElement) {
    const p = this.plugin;
    const s = p.settings;
    const ago = (id: string) => { const t = p.keyUsed.get(id); return t ? `last used ${new Date(t).toLocaleTimeString([], { hour12: false })}` : 'not used since Obsidian started'; };
    const scopeText: Record<Scope, string> = {
      observer: 'Observer: reports activity only',
      agent: 'Agent: activity, pre-write checks, context packs, tasks and claims',
      bridge: 'Bridge: may act for any agent (the bridge checks its own agents)',
      admin: 'Admin: everything, including Developer mode tools',
    };
    new Setting(containerEl).setName('Agent keys').setHeading();
    if (s.acceptLegacyKey) {
      new Setting(containerEl).setName('Shared key from version 1.1 still accepted')
        .setDesc(`Anyone with this one key can act as any agent. Create per-agent keys, paste each agent's new snippet, then retire the shared key. It's saved to ${p.keyFilePath()} for older bridges (${ago('legacy')}).`)
        .addButton((b) => b.setButtonText('Create agent keys').setCta().onClick(async () => {
          const made = await p.migrateCredentials();
          new Notice(made.length ? `H!V3MYND: created ${made.length} key${made.length === 1 ? '' : 's'}. Copy each agent's snippet below.` : 'H!V3MYND: every agent already has a key.');
          this.display();
        }))
        .addButton((b) => b.setButtonText('Copy shared key').onClick(() => { void navigator.clipboard.writeText(s.listenerKey); new Notice('H!V3MYND: copied'); }))
        .addButton((b) => b.setButtonText('Retire shared key').setWarning().onClick(async () => {
          await p.setAcceptLegacyKey(false);
          new Notice('H!V3MYND: the shared key no longer works.');
          this.display();
        }));
    }
    for (const c of p.credentials) {
      const file = p.credentialFile(c);
      const row = new Setting(containerEl).setName(c.label)
        .setDesc(`${scopeText[c.scope]}${c.agent && c.scope !== 'bridge' && c.scope !== 'admin' ? ` · acts as ${c.agent}` : ''}${file ? ` · saved to ${file}` : ''} · ${ago(c.id)}`);
      if (c.scope === 'observer' || c.scope === 'agent') {
        row.addButton(copyButton('Claude Code hooks', () => claudeCodeHooks(s.port, c.key, c.agent)));
        row.addButton(copyButton('curl example', () => curlExample(s.port, c.key, c.agent)));
      }
      row.addButton(copyButton('Copy key', () => c.key));
      row.addExtraButton((b) => b.setIcon('refresh-cw').setTooltip('Regenerate (the old key stops working)').onClick(async () => { await p.regenerateCredential(c.id); this.display(); }));
      row.addExtraButton((b) => b.setIcon('trash').setTooltip('Revoke').onClick(async () => { await p.revokeCredential(c.id); this.display(); }));
    }
    let agent = '', scope: Scope = 'agent';
    new Setting(containerEl).setName('Add a key').setDesc('Agent name as it appears in the brain (e.g. claude), and what the key may do.')
      .addText((t) => t.setPlaceholder('agent name').onChange((v) => { agent = v; }))
      .addDropdown((d) => d.addOptions({ observer: 'Observer', agent: 'Agent', bridge: 'Bridge', admin: 'Admin' }).setValue(scope).onChange((v) => { scope = v as Scope; }))
      .addButton((b) => b.setButtonText('Add').onClick(async () => {
        if (!agent.trim() && (scope === 'observer' || scope === 'agent')) { new Notice('H!V3MYND: name the agent this key is for.'); return; }
        await p.addCredential(`${agent.trim() || scope} ${scope === 'agent' ? 'hooks' : scope}`, agent, scope);
        this.display();
      }));
  }

  display() {
    let { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => void this.plugin.saveSettings();
    containerEl.empty();

    new Setting(containerEl).setName('User manual').setDesc('Everything H!V3MYND does, where to find it, and how to connect agents.')
      .addButton((b) => b.setButtonText('Open').setCta().onClick(() => void this.plugin.openManual()));

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
    toggle('Store agent prompts', 'Keep what each agent was asked to do (its prompt, first line) with every access and change, for the Tasks tab, reports and context budget. Off: nothing an agent was asked is kept anywhere, and remembered prompts are cleared.', 'storePurposes', () => { if (!s.storePurposes) void this.plugin.forgetPurposes(); });
    new Setting(containerEl).setName('Change history').setDesc('What H!V3MYND keeps of each agent write, for Brain Monitor → Changes and undo. Redacted: note text with keys and tokens masked before saving; undo restores the masked text. Raw: exact text including any secrets, so undo is exact. Metadata: who, when, which note and line counts only; no diff, no undo.')
      .addDropdown((d) => d.addOptions({ redacted: 'Redacted (recommended)', raw: 'Raw (keeps secrets)', metadata: 'Metadata only' }).setValue(s.historyMode).onChange((v) => {
        s.historyMode = v as HistoryMode;
        this.plugin.changes.mode = s.historyMode;
        save();
        if (v === 'raw') new Notice('H!V3MYND: raw history keeps note text exactly, including any keys or passwords an agent writes, in the plugin folder.', 10_000);
      }));
    new Setting(containerEl).setName('Bridge messages on disk').setDesc('Full: message text is saved (keys and tokens masked). Metadata: only sender, recipient and time are saved; text is shown while Obsidian is open.')
      .addDropdown((d) => d.addOptions({ full: 'Full text', metadata: 'Metadata only' }).setValue(s.bridgeMessageStore).onChange((v) => { s.bridgeMessageStore = v as 'full' | 'metadata'; save(); }));
    new Setting(containerEl).setName('Keep history for (days)').setDesc('Change history and bridge messages older than this are deleted when Obsidian starts. 0 keeps everything.').addText((t) =>
      t.setValue(String(s.historyDays)).onChange(debounce((v: string) => { const n = Number(v); if (Number.isInteger(n) && n >= 0) { s.historyDays = n; save(); } }, 800, true)));
    new Setting(containerEl).setName('Delete stored history').setDesc('Deletes change history (all diffs and undo points), bridge messages and remembered prompts from the plugin folder. The access log is kept.')
      .addButton((b) => b.setButtonText('Delete…').setWarning().onClick(() => {
        new ConfirmModal(this.app, 'Delete stored history?', 'All change history (diffs and undo points), bridge messages and remembered prompts will be deleted. This can’t be undone.', 'Delete', async () => {
          await this.plugin.purgeHistory();
          new Notice('H!V3MYND: stored history deleted.');
        }).open();
      }));
    toggle('Log searches', 'Record notes that surfaced in agent searches (one line per search), not just reads and writes.', 'logSearches');
    toggle('Daily digest notes', 'Also write a readable table per day into the vault. The folder is kept out of the brain.', 'digest', () => this.plugin.refreshGraph(true));
    toggle('Daily brain report', "Summarise each day's agent activity in one note (Reports subfolder of the digest folder): who did what, most-used notes, alerts, re-reads and searches that found nothing. Written the next day, or any time with the command.", 'dailyReport', () => this.plugin.refreshGraph(true));
    new Setting(containerEl).setName('Digest folder').addText((t) =>
      t.setValue(s.digestFolder).onChange(debounce((v: string) => { s.digestFolder = v.trim() || 'Access Log'; save(); this.plugin.refreshGraph(true); }, 800, true)));

    new Setting(containerEl).setName('Cinematic camera').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'The camera flies through the brain on an endless path that never repeats. Toggle with C or the clapperboard button; touching the brain hands control back to you.',
    });
    toggle('Start when the brain opens', 'Begin each session with the flythrough.', 'cinemaOnOpen');
    new Setting(containerEl).setName('Resume after idle').setDesc('Seconds without input before the flythrough starts again. 0 = never. Switching it off yourself (button, C) always keeps it off.').addSlider((sl) =>
      sl.setLimits(0, 600, 15).setValue(s.cinemaIdle).setDynamicTooltip().onChange((v) => { s.cinemaIdle = v; save(); for (const view of this.plugin.views()) view.applyCinema(); }));
    new Setting(containerEl).setName('Flight speed').addSlider((sl) =>
      sl.setLimits(0.3, 2, 0.1).setValue(s.cinemaSpeed).setDynamicTooltip().onChange((v) => { s.cinemaSpeed = v; save(); for (const view of this.plugin.views()) view.applyCinema(); }));

    new Setting(containerEl).setName('Agent teamwork').setHeading();
    new Setting(containerEl).setName('Claims').setDesc('When an agent edits a note, it holds it for a while. If another agent tries to edit it, its pre-write hook hears who holds it and gets the handoff. Warn: the first try is held back with that message, a retry goes through. Block: held back until the claim ends.')
      .addDropdown((d) => d.addOptions({ warn: 'Warn (retry goes through)', block: 'Block', off: 'Off' }).setValue(s.claimMode).onChange((v) => { s.claimMode = v as PlexusSettings['claimMode']; save(); }));
    slider('Claim length', 'Minutes an edit keeps a note claimed (renewed by each edit).', 'claimMinutes', 5, 120, 5);
    new Setting(containerEl).setName('Agents that can hear replies').setDesc('Comma-separated agent names whose pre-write hook reads H!V3MYND\'s reply (Claude Code\'s hook format).')
      .addText((t) => t.setValue(s.hookReplies).onChange((v) => { s.hookReplies = v; save(); }));
    toggle('Handoffs', 'When an agent picks up notes another agent worked on and stepped away from, build a handoff pack and light its trail in the brain.', 'handoffs');
    toggle('Trust warnings', 'Before an agent edits, warn it once if it is relying on a note with a low trust score (old, re-read a lot, or edits undone).', 'trustWarnings');
    new Setting(containerEl).setName('Gap notes folder').setDesc('Where the gap radar creates starter notes.')
      .addText((t) => t.setValue(s.gapFolder).onChange((v) => { s.gapFolder = v.trim(); save(); }));

    toggle('Live presence rings', 'Ring the note each active agent is working on right now, in its colour.', 'presenceRings', () => this.plugin.refreshMarkers());
    new Setting(containerEl).setName('Secret scanner').setDesc('Keys and tokens in an agent\'s edit: warn it once, block the edit, or off. Also keeps them out of the access log and bridge history.')
      .addDropdown((d) => d.addOptions({ warn: 'Warn (retry goes through)', block: 'Block', off: 'Off' }).setValue(s.secretScan).onChange((v) => { s.secretScan = v as PlexusSettings['secretScan']; save(); }));
    toggle('Mask secrets agents write', 'If a key or token still lands in a note, replace it with a masked stub. With raw change history this is recorded as a change you can undo; otherwise the original value is not kept.', 'autoMaskSecrets');
    new Setting(containerEl).setName('If a pre-write check fails').setDesc('When H!V3MYND can’t check an agent’s edit (claims, secrets, trust) because of an error. Hold back: the edit is refused with an explanation. Let through: the edit goes ahead, marked as unchecked. Automatic: hold back when claims or the secret scanner are set to Block. Agents only stop if their hook system honours the reply.')
      .addDropdown((d) => d.addOptions({ auto: 'Automatic', block: 'Hold back', allow: 'Let through' }).setValue(s.prewriteOnError).onChange((v) => { s.prewriteOnError = v as PrewriteOnError; save(); }));

    new Setting(containerEl).setName('Performance').setHeading();
    toggle('Low-latency mode', 'For slower machines: no bloom, depth of field, nebula, sparks, close-up marbles or brief time-lapses.', 'lowLatency', () => this.plugin.applyLowLatency());

    new Setting(containerEl).setName('Even G2 glasses').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'Short lines for the glasses: the daily brief and approval requests. Glasses apps can also read GET /hud. Sending goes through the Agent Bridge to the glasses agent.' });
    toggle('Send to glasses', 'Off until your glasses are connected to the bridge.', 'glassesFeed');
    new Setting(containerEl).setName('Bridge address').addText((t) => t.setValue(s.bridgeUrl).onChange((v) => { s.bridgeUrl = v.trim(); save(); }));
    new Setting(containerEl).setName('Bridge token file').setDesc('The bridge\'s tokens.json; the sender\'s token is read from it when sending, never stored here.')
      .addText((t) => t.setValue(s.bridgeTokenFile).onChange((v) => { s.bridgeTokenFile = v.trim(); save(); }));
    new Setting(containerEl).setName('Send as / to').setDesc('Bridge agent names: sender and the glasses recipient.')
      .addText((t) => t.setPlaceholder('claude').setValue(s.glassesSender).onChange((v) => { s.glassesSender = v.trim(); save(); }))
      .addText((t) => t.setPlaceholder('glasses').setValue(s.glassesRecipient).onChange((v) => { s.glassesRecipient = v.trim(); save(); }))
      .addButton((b) => b.setButtonText('Test').onClick(async () => { const on = s.glassesFeed; s.glassesFeed = true; await this.plugin.toGlasses('Test from H!V3MYND: the glasses feed works.'); s.glassesFeed = on; new Notice('Sent a test line to the glasses inbox.'); }));

    new Setting(containerEl).setName('Daily brief').setHeading();
    toggle('Write a daily brief', 'Each morning, write a note summarising the previous day of agent work.', 'briefEnabled');
    slider('Brief time', 'Hour of the day (24 h) after which yesterday\'s brief is written.', 'briefHour', 0, 23, 1);
    new Setting(containerEl).setName('Brief folder').addText((t) => t.setValue(s.briefFolder).onChange((v) => { s.briefFolder = v.trim(); save(); }));
    toggle('Record a time-lapse', 'Record a 30-second video of the day\'s activity in the brain for each brief (needs the brain view open).', 'briefTimelapse');
    slider('Keep time-lapses (days)', 'Older videos move to the trash.', 'timelapseKeepDays', 1, 60, 1);
    new Setting(containerEl).addButton((b) => b.setButtonText('Write today\'s brief now').onClick(() => void this.plugin.writeBrief(new Date(), s.briefTimelapse)));

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
    connectSection(containerEl);
    this.keysSection(containerEl);
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


// ------------------------------------------------------------------ span helpers

/** A monitor, in screen coordinates (DIP). */
interface SpanDisplay { id: string; name: string; x: number; y: number; w: number; h: number; primary: boolean }

interface ElectronRect { x: number; y: number; width: number; height: number }
interface ElectronWindow {
  getTitle(): string;
  getBounds(): ElectronRect;
  setBounds(r: ElectronRect): void;
  setFullScreen(on: boolean): void;
  focus(): void;
  isDestroyed(): boolean;
}
interface ElectronRemote {
  screen: {
    getAllDisplays(): { id: number; label?: string; bounds: ElectronRect }[];
    getPrimaryDisplay(): { id: number };
  };
  BrowserWindow: { getAllWindows(): ElectronWindow[] };
}

/** Obsidian's desktop app exposes Electron's remote module to plugins. */
function electronRemote(): ElectronRemote | null {
  if (!Platform.isDesktopApp) return null;
  try {
    const req = (window as unknown as { require?: (m: string) => unknown }).require;
    const electron = req?.('electron') as { remote?: ElectronRemote } | undefined;
    return electron?.remote ?? null;
  } catch {
    return null;
  }
}

/** The Electron window behind a pop-out document: tagged by a unique title, else by position. */
async function findWindow(remote: ElectronRemote, doc: Document, d: SpanDisplay): Promise<ElectronWindow | null> {
  const tag = `hivemynd-span-${d.id}-${Date.now()}`;
  for (let i = 0; i < 25; i++) {
    doc.title = tag;
    const wins = remote.BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    const byTitle = wins.find((w) => w.getTitle() === tag);
    if (byTitle) return byTitle;
    await new Promise((r) => window.setTimeout(r, 80));
  }
  const inside = remote.BrowserWindow.getAllWindows().filter((w) => {
    if (w.isDestroyed()) return false;
    const b = w.getBounds();
    return Math.abs(b.x - (d.x + 40)) < 30 && Math.abs(b.y - (d.y + 40)) < 30;
  });
  return inside[inside.length - 1] ?? null;
}

// ------------------------------------------------------------------ small helpers

function json(res: any, body: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** File-name-safe title for a gap starter note. */
function stubName(title: string) {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Every string value inside a hook's tool_input (content, new_string, edits, ...). */
function hookStrings(v: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 5 || out.length > 200) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) hookStrings(x, out, depth + 1);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) hookStrings(x, out, depth + 1);
  return out;
}

/** F15: pick a folder to focus the brain on. */
class FolderPick extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private pick: (path: string) => void) {
    super(app);
    this.setPlaceholder('Focus the brain on a project folder…');
  }
  getItems() { return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && !f.isRoot()); }
  getItemText(f: TFolder) { return f.path; }
  onChooseItem(f: TFolder) { this.pick(f.path); }
}

/** Shape cycle intervals offered in the theme menu (seconds, label). */
const CYCLES: [number, string][] = [[0, 'Off'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes'], [600, '10 minutes']];

/** Agent orbit modes offered in the theme menu (id, label). */
const ORBITS: [string, string][] = [['default', 'Default'], ['solar', 'Solar system'], ['atom', 'Atom'], ['close', 'Close orbit'], ['far', 'Wide orbit'], ['still', 'Parked']];

/** Orbit path colours offered in the theme menu (id or hex, label). */
const ORBIT_COLORS: [string, string][] = [
  ['default', 'Default (agent colours)'], ['#ffffff', 'White'], ['#ff3b30', 'Red'], ['#ff9500', 'Orange'], ['#ffd60a', 'Yellow'],
  ['#34c759', 'Green'], ['#2fd3c9', 'Teal'], ['#0a84ff', 'Blue'], ['#bf5af2', 'Purple'], ['#ff375f', 'Pink'], ['#e8b04b', 'Gold'], ['rainbow', 'Rainbow'],
];

/** The light show's eight colours for a chosen colour: shades of one colour, a rainbow, or the palette. */
function musicColors(choice: string, palette: string[]): string[] {
  if (!choice || choice === 'default') return palette;
  const hsl = (h: number, sat: number, l: number) => {
    const f = (n: number) => { const k = (n + h * 12) % 12; const a = sat * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  if (choice === 'rainbow') return Array.from({ length: 8 }, (_, i) => hsl(i / 8, 0.95, 0.55));
  // One colour: the colour itself plus lighter shades for the highs.
  const mix = (hex: string, t: number) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return `#${c.map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('')}`; };
  return [0, 0.08, 0.15, 0.05, 0.35, 0.25, 0.12, 0.45].map((t) => mix(choice, t));
}

