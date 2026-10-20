import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { AccessEntry, AccessLog, clock, dayKey, noteTitle } from './accesslog';
import type { AgentStyle } from './renderer';
import type { Monitor, Sample } from './monitor';
import { AgentState, Collision, HEAVY_READ_TOKENS, LinkSuggestion, Reread, TaskGroup, agentStatuses, budgetByTask, isSynthetic as isSyntheticEntry } from './insights';

export type BudgetRange = 'day' | 'week' | 'month' | 'year';
const RANGE_DAYS: Record<BudgetRange, number> = { day: 1, week: 7, month: 30, year: 365 };
const RANGE_LABEL: Record<BudgetRange, string> = { day: 'today', week: 'last 7 days', month: 'last 30 days', year: 'last 12 months' };
import { ChangeRecord, ChangeStore, diffLines, diffStats } from './changes';
import type { BridgeMessage } from './main';
import { Dashboard, PanelPos } from './dashboard';

export const LOG_VIEW_TYPE = 'plexus-access-log';

const ACTION_LABEL: Record<string, string> = { read: 'Read', write: 'Write', search: 'Search' };
const ACTION_ICON: Record<string, string> = { read: 'eye', write: 'pencil', search: 'search' };
const MAX_ROWS = 400;
const LANE_WINDOW = 30 * 60_000;
const CYAN = '#2fd3c9';

export interface GraphInfo { notes: number; links: number; hubs: number; unlinked: number }

export interface LogHost {
  log: AccessLog;
  monitor: Monitor;
  agents(): AgentStyle[];
  graphInfo(): GraphInfo;
  openNote(path: string, agent: string): void;
  popOut(): void;
  alerts(): Collision[];
  onAlert(fn: (c: Collision) => void): () => void;
  changes: ChangeStore;
  restore(c: ChangeRecord): void;
  bridge(): BridgeMessage[];
  onBridge(fn: (m: BridgeMessage) => void): () => void;
  alias(name: string): string;
  tasks(): TaskGroup[];
  focusTask(notes: string[] | null, agent: string): void;
  exportTask(t: TaskGroup): void;
  /** Saved Brain Monitor panel layout and budget range (plugin settings). */
  monitorUi(): { layout: PanelPos[] | null; budgetRange: BudgetRange; light: boolean };
  saveMonitorUi(patch: Partial<{ layout: PanelPos[]; budgetRange: BudgetRange; light: boolean }>): void;
  gaps(): {
    misses: { query: string; n: number; agents: Set<string>; last: number }[];
    rereads: Reread[];
    suggestions: LinkSuggestion[];
    usedOrphans: [string, number][];
    broken: { source: string; targets: string[] }[];
    brokenTotal: number;
  };
}

const STATE_LABEL: Record<AgentState, string> = { active: 'Active', idle: 'Idle', quiet: 'Quiet', unseen: 'Not seen' };
const STATE_ICON: Record<AgentState, string> = { active: 'radio', idle: 'pause-circle', quiet: 'moon', unseen: 'circle-dashed' };

/**
 * Brain Monitor: system load, brain vitals, agent activity, hot notes and the live
 * access log in one window. Meant to live in its own pop-out window, so it can go
 * full screen on another monitor without covering the brain.
 */
export class AccessLogView extends ItemView {
  private list!: HTMLElement;
  private statsEl!: HTMLElement;
  private agentFilter = new Set<string>();
  private actionFilter = 'all';
  private query = '';
  private cleanups: (() => void)[] = [];
  private charts: LineChart[] = [];
  private tiles = new Map<string, { value: HTMLElement; sub: HTMLElement }>();
  private lanes!: Lanes;
  private hotEl!: HTMLElement;
  private brainCounts!: HTMLElement;
  private statusEl!: HTMLElement;
  private alertsEl!: HTMLElement;
  private alertBadge!: HTMLElement;
  private budgetEl!: HTMLElement;
  private pages = new Map<string, HTMLElement>();
  private tabButtons = new Map<string, HTMLButtonElement>();
  private bridgeList!: HTMLElement;
  private bridgePairs!: HTMLElement;
  private bridgeFilter = '';
  private changeList!: HTMLElement;
  private diffEl!: HTMLElement;
  private selectedChange: string | null = null;
  private taskList!: HTMLElement;
  private taskDetail!: HTMLElement;
  private selectedTask: string | null = null;
  private focusedTask: string | null = null;
  private gapsEl!: HTMLElement;
  private clockEl!: HTMLElement;
  private dash: Dashboard | null = null;
  private budgetRange: BudgetRange = 'day';
  private budgetTitle!: HTMLElement;
  private budgetTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private host: LogHost) {
    super(leaf);
  }

  getViewType() { return LOG_VIEW_TYPE; }
  getDisplayText() { return 'Brain Monitor'; }
  getIcon() { return 'activity'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('plexus-log');
    root.toggleClass('is-light', !!this.host.monitorUi().light);
    this.lightChrome(!!this.host.monitorUi().light);
    root.tabIndex = 0;

    // ---- header
    const head = root.createDiv({ cls: 'pm-head' });
    const title = head.createDiv({ cls: 'plexus-log-title' });
    title.createSpan({ text: 'Brain Monitor' });
    const live = title.createSpan({ cls: 'plexus-log-live' });
    live.createSpan({ cls: 'plexus-log-live-dot' });
    live.createSpan({ text: 'Live' });
    const tabs = head.createDiv({ cls: 'pm-tabs' });
    for (const [key, label, icon] of [['overview', 'Overview', 'layout-dashboard'], ['bridge', 'Bridge traffic', 'messages-square'], ['changes', 'Changes', 'git-compare'], ['tasks', 'Tasks', 'route'], ['gaps', 'Gaps', 'puzzle']]) {
      const b = tabs.createEl('button', { cls: 'pm-tab' });
      setIcon(b.createSpan({ cls: 'pm-tab-icon' }), icon);
      b.createSpan({ text: label });
      b.addEventListener('click', () => this.showPage(key));
      this.tabButtons.set(key, b);
    }
    this.clockEl = head.createDiv({ cls: 'pm-clock' });
    const actions = head.createDiv({ cls: 'pm-actions' });
    const inMainWindow = this.containerEl.ownerDocument === document;
    const themeBtn = this.headButton(actions, root.hasClass('is-light') ? 'moon' : 'sun', 'Light / dark theme', () => {
      const light = !root.hasClass('is-light');
      root.toggleClass('is-light', light);
      this.lightChrome(light);
      setIcon(themeBtn, light ? 'moon' : 'sun');
      this.host.saveMonitorUi({ light });
      this.onSample(); // redraw charts in the new colours
    });
    this.headButton(actions, 'layout-grid', 'Panels: show, hide, lock or reset the layout', (e) => this.dash?.menu(e));
    if (inMainWindow) this.headButton(actions, 'external-link', 'Open in its own window', () => this.host.popOut());
    const fs = this.headButton(actions, 'maximize', 'Full screen (F)', () => this.toggleFullscreen());
    this.registerDomEvent(root.ownerDocument, 'fullscreenchange', () =>
      setIcon(fs, root.ownerDocument.fullscreenElement === root ? 'minimize' : 'maximize'));
    this.registerDomEvent(root, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.toggleFullscreen(); }
    });

    const grid = root.createDiv({ cls: 'pm-grid pm-page' });
    this.pages.set('overview', grid);
    this.buildBridgePage(root);
    this.buildChangesPage(root);
    this.buildTasksPage(root);
    this.buildGapsPage(root);
    this.showPage('overview');

    // ---- system
    const sys = this.card(grid, 'pm-sys', 'System', 'cpu');
    const sysTiles = sys.createDiv({ cls: 'pm-tiles' });
    this.charts.push(
      this.tile(sysTiles, 'cpu', 'CPU', (s) => s.cpu, { max: 100, unit: '%' }),
      this.tile(sysTiles, 'gpu', 'GPU load', (s) => s.gpu, { max: 100, unit: '%' }),
      this.tile(sysTiles, 'gpuMem', 'GPU memory', (s) => s.gpuMem, { max: null, unit: ' MiB', maxOf: (s) => s.gpuMemTotal }),
      this.tile(sysTiles, 'gpuTemp', 'GPU temp', (s) => s.gpuTemp, { max: null, unit: '°C' }),
      this.tile(sysTiles, 'ram', 'RAM', (s) => s.ram, { max: 100, unit: '%' }),
      this.tile(sysTiles, 'gpuPower', 'GPU power', (s) => s.gpuPower, { max: null, unit: ' W' }),
    );

    // ---- brain vitals
    const brain = this.card(grid, 'pm-brain', 'Brain vitals', 'brain-circuit');
    this.brainCounts = brain.createDiv({ cls: 'pm-counts' });
    const brainTiles = brain.createDiv({ cls: 'pm-tiles' });
    this.charts.push(
      this.tile(brainTiles, 'fps', 'Frame rate', (s) => s.fps, { max: null, unit: ' fps', digits: 0 }),
      this.tile(brainTiles, 'frameMs', 'Frame work', (s) => s.frameMs, { max: null, unit: ' ms', digits: 1 }),
      this.tile(brainTiles, 'spikes', 'Neurons firing', (s) => s.spikes, { max: null, unit: ' /s', digits: 1 }),
      this.tile(brainTiles, 'sparks', 'Signals in flight', (s) => s.sparks, { max: null, unit: ' /s', digits: 1 }),
    );

    // ---- agent status board
    const status = this.card(grid, 'pm-status', 'Agent status', 'radar');
    this.statusEl = status.createDiv({ cls: 'pm-status-list' });

    // ---- collisions
    const alerts = this.card(grid, 'pm-alerts', 'Alerts', 'triangle-alert');
    this.alertBadge = alerts.querySelector('.pm-card-head')!.createSpan({ cls: 'pm-badge' });
    this.alertsEl = alerts.createDiv({ cls: 'pm-alert-list' });

    // ---- context budget
    const budget = this.card(grid, 'pm-budget', 'Context budget', 'gauge');
    this.budgetTitle = budget.querySelector<HTMLElement>('.pm-card-head span:last-child')!;
    this.budgetRange = this.host.monitorUi().budgetRange ?? 'day';
    const seg = budget.querySelector('.pm-card-head')!.createDiv({ cls: 'pm-seg' });
    for (const r of Object.keys(RANGE_DAYS) as BudgetRange[]) {
      const b = seg.createEl('button', { cls: `pm-seg-btn${r === this.budgetRange ? ' is-on' : ''}`, text: r[0].toUpperCase() + r.slice(1), attr: { 'aria-label': `Context budget for ${RANGE_LABEL[r]}` } });
      b.addEventListener('click', () => {
        this.budgetRange = r;
        seg.querySelectorAll('.pm-seg-btn').forEach((x) => x.toggleClass('is-on', x === b));
        this.host.saveMonitorUi({ budgetRange: r });
        void this.renderBudget();
      });
    }
    this.budgetEl = budget.createDiv({ cls: 'pm-budget-body' });

    // ---- agent activity
    const agentsCard = this.card(grid, 'pm-agents', 'Agent activity · last 30 min', 'users');
    this.lanes = new Lanes(agentsCard.createDiv({ cls: 'pm-lanes' }), this.host);

    // ---- hot notes
    const hot = this.card(grid, 'pm-hot', 'Hot notes · today', 'flame');
    this.hotEl = hot.createDiv({ cls: 'pm-hot-list' });

    // ---- access log
    const logCard = this.card(grid, 'pm-log', 'Access log', 'scroll-text');
    this.statsEl = logCard.createDiv({ cls: 'plexus-log-stats' });
    this.buildFilters(logCard);
    this.list = logCard.createDiv({ cls: 'plexus-log-list' });

    const panel = (cls: string, id: string, title: string, minW = 4, minH = 4) => ({ id, title, el: grid.querySelector<HTMLElement>(`.${cls}`)!, minW, minH });
    this.dash = new Dashboard(grid, [
      panel('pm-sys', 'sys', 'System'),
      panel('pm-brain', 'brain', 'Brain vitals'),
      panel('pm-status', 'status', 'Agent status'),
      panel('pm-alerts', 'alerts', 'Alerts'),
      panel('pm-budget', 'budget', 'Context budget', 4, 6),
      panel('pm-agents', 'agents', 'Agent activity'),
      panel('pm-hot', 'hot', 'Hot notes'),
      panel('pm-log', 'log', 'Access log', 6, 8),
    ], this.host.monitorUi().layout, (layout) => this.host.saveMonitorUi({ layout }));
    this.cleanups.push(() => this.dash?.destroy());

    this.renderAll();
    this.renderBrainCounts();
    this.renderHot();
    this.renderStatus();
    this.renderAlerts();
    void this.renderBudget();
    this.cleanups.push(this.host.onAlert(() => this.renderAlerts(true)));
    this.cleanups.push(this.host.onBridge(() => this.renderBridge(true)));
    this.cleanups.push(this.host.changes.onChange(() => this.renderChanges()));
    this.cleanups.push(this.host.log.onEntry((e) => this.onEntry(e)));
    this.host.monitor.acquire();
    this.cleanups.push(() => this.host.monitor.release());
    this.cleanups.push(this.host.monitor.onSample(() => this.onSample()));
    this.onSample();
  }

  async onClose() {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    const doc = this.contentEl.ownerDocument;
    if (doc.fullscreenElement === this.contentEl) await doc.exitFullscreen();
  }

  /** In its own window the monitor owns the frame too (tab bar, title bar): match it. */
  private lightChrome(light: boolean) {
    const doc = this.contentEl.ownerDocument;
    if (doc !== document) doc.body.toggleClass('plexus-light-window', light);
  }

  private toggleFullscreen() {
    const doc = this.contentEl.ownerDocument;
    if (doc.fullscreenElement) void doc.exitFullscreen();
    else void this.contentEl.requestFullscreen();
  }

  private headButton(parent: HTMLElement, icon: string, label: string, onClick: (e: MouseEvent) => void) {
    const b = parent.createEl('button', { cls: 'pm-btn', attr: { 'aria-label': label, title: label } });
    setIcon(b, icon);
    b.addEventListener('click', onClick);
    return b;
  }

  private card(parent: HTMLElement, cls: string, label: string, icon: string) {
    const c = parent.createDiv({ cls: `pm-card ${cls}` });
    const h = c.createDiv({ cls: 'pm-card-head' });
    setIcon(h.createSpan({ cls: 'pm-card-icon' }), icon);
    h.createSpan({ text: label });
    return c;
  }

  private tile(parent: HTMLElement, key: string, label: string, pick: (s: Sample) => number | null, o: ChartOpts) {
    const t = parent.createDiv({ cls: 'pm-tile' });
    t.createDiv({ cls: 'pm-tile-label', text: label });
    const value = t.createDiv({ cls: 'pm-tile-value', text: '—' });
    const sub = t.createDiv({ cls: 'pm-tile-sub' });
    this.tiles.set(key, { value, sub });
    return new LineChart(t.createDiv({ cls: 'pm-spark' }), label, pick, o);
  }

  // ------------------------------------------------------------ live updates

  private onSample() {
    const m = this.host.monitor;
    const s = m.samples[m.samples.length - 1];
    this.clockEl.setText(new Date().toLocaleTimeString([], { hour12: false }));
    for (const c of this.charts) c.draw(m.samples);
    if (s) {
      const set = (key: string, v: number | null, unit: string, digits = 0, sub = '') => {
        const t = this.tiles.get(key);
        if (!t) return;
        t.value.setText(v === null ? '—' : `${v.toFixed(digits)}${unit}`);
        t.sub.setText(sub);
      };
      const gpuOff = m.gpuStatus === 'unavailable' ? 'nvidia-smi not found' : m.gpuStatus === 'starting' ? 'connecting…' : '';
      set('cpu', s.cpu, '%', 0, 'all cores');
      set('gpu', s.gpu, '%', 0, gpuOff || m.gpuName);
      set('gpuMem', s.gpuMem !== null ? s.gpuMem / 1024 : null, ' GB', 1, s.gpuMemTotal ? `of ${(s.gpuMemTotal / 1024).toFixed(0)} GB` : gpuOff);
      set('gpuTemp', s.gpuTemp, '°C', 0, gpuOff);
      set('ram', s.ram, '%', 0, m.ramTotalGb ? `of ${m.ramTotalGb.toFixed(0)} GB` : '');
      set('gpuPower', s.gpuPower, ' W', 0, gpuOff);
      set('fps', s.fps, '', 0, s.fps === null ? 'open the brain view' : 'frames / s');
      set('frameMs', s.frameMs, ' ms', 1, 'CPU time per frame');
      set('spikes', s.spikes, '', 1, 'firings / s');
      set('sparks', s.sparks, '', 1, 'pulses launched / s');
    }
    this.lanes.draw();
    this.renderBrainCounts();
    // Status ages ("2m ago", Active -> Idle) tick without new entries.
    if (s && Math.floor(s.t / 1000) % 5 === 0) this.renderStatus();
  }

  showPage(key: string) {
    if (!this.pages.has(key)) return;
    for (const [k, el] of this.pages) el.style.display = k === key ? '' : 'none';
    for (const [k, b] of this.tabButtons) b.toggleClass('is-on', k === key);
    if (key === 'bridge') this.renderBridge();
    if (key === 'changes') this.renderChanges();
    if (key === 'tasks') this.renderTasks();
    if (key === 'gaps') this.renderGaps();
  }

  // ------------------------------------------------------------ task context map

  private buildTasksPage(root: HTMLElement) {
    const page = root.createDiv({ cls: 'pm-page pm-split' });
    this.pages.set('tasks', page);
    const side = this.card(page, 'pm-side', 'Tasks', 'route');
    this.taskList = side.createDiv({ cls: 'pm-change-list' });
    const main = this.card(page, 'pm-main', 'Context map', 'share-2');
    this.taskDetail = main.createDiv({ cls: 'pm-task-detail' });
  }

  private renderTasks() {
    if (!this.taskList || this.pages.get('tasks')!.style.display === 'none') return;
    const tasks = this.host.tasks().filter((t) => t.notes.some((n) => n.reads + n.writes > 0)).slice(0, 150);
    this.taskList.empty();
    if (!tasks.length) {
      this.taskList.createDiv({ cls: 'pm-empty', text: 'No tasks yet. Each agent request that opens notes becomes a task here.' });
      this.taskDetail.empty();
      return;
    }
    if (!this.selectedTask || !tasks.some((t) => t.key === this.selectedTask)) this.selectedTask = tasks[0].key;
    for (const t of tasks) {
      const el = this.taskList.createDiv({ cls: `pm-change${t.key === this.selectedTask ? ' is-on' : ''}` });
      el.style.setProperty('--agent', colorOf(this.host.agents(), t.agent));
      const head = el.createDiv({ cls: 'pm-change-head' });
      this.agentChip(head, t.agent);
      if (this.focusedTask === t.key) head.createSpan({ cls: 'pm-tag', text: 'In brain' });
      head.createSpan({ cls: 'pm-msg-time', text: `${clock(t.start)}` });
      el.createDiv({ cls: 'pm-change-note', text: t.purpose || 'No purpose reported' });
      el.createDiv({ cls: 'pm-change-meta', text: `${t.notes.length} notes · ${Math.max(1, Math.round((t.end - t.start) / 60_000))} min · ~${fmtTokens(t.tokens)} tokens` });
      el.addEventListener('click', () => { this.selectedTask = t.key; this.renderTasks(); });
    }
    this.renderTaskDetail(tasks.find((t) => t.key === this.selectedTask)!);
  }

  private renderTaskDetail(t: TaskGroup) {
    this.taskDetail.empty();
    const head = this.taskDetail.createDiv({ cls: 'pm-diff-head' });
    const title = head.createDiv({ cls: 'pm-diff-title' });
    title.createDiv({ cls: 'pm-change-note', text: t.purpose || 'No purpose reported' });
    title.createDiv({ cls: 'plexus-log-note-folder', text: `${t.agent} · ${new Date(t.start).toLocaleString([], { hour12: false })} → ${clock(t.end)} · ${t.notes.length} notes · ~${fmtTokens(t.tokens)} tokens` });
    const actions = head.createDiv({ cls: 'pm-diff-actions' });
    const showing = this.focusedTask === t.key;
    const show = actions.createEl('button', { cls: showing ? 'plexus-log-chip is-on' : 'pm-undo pm-cyan', text: showing ? 'Clear from brain' : 'Show in brain' });
    show.addEventListener('click', () => {
      if (showing) { this.host.focusTask(null, t.agent); this.focusedTask = null; }
      else { this.host.focusTask(t.notes.map((n) => n.path), t.agent); this.focusedTask = t.key; }
      this.renderTasks();
    });
    const exp = actions.createEl('button', { cls: 'plexus-log-chip', text: 'Export as note' });
    exp.addEventListener('click', () => this.host.exportTask(t));

    const list = this.taskDetail.createDiv({ cls: 'pm-task-notes' });
    const ordered = [...t.notes].sort((a, b) => a.first - b.first);
    ordered.forEach((n, i) => {
      const row = list.createDiv({ cls: 'pm-tnote' });
      row.style.setProperty('--agent', colorOf(this.host.agents(), t.agent));
      row.createDiv({ cls: 'pm-tnote-step', text: String(i + 1) });
      const body = row.createDiv({ cls: 'pm-tnote-body' });
      const a = body.createEl('a', { cls: 'plexus-log-note-title', text: noteTitle(n.path), attr: { title: n.path } });
      a.addEventListener('click', (ev) => { ev.preventDefault(); this.host.openNote(n.path, t.agent); });
      const folder = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
      if (folder) body.createDiv({ cls: 'plexus-log-note-folder', text: folder });
      const what = [n.reads && `${n.reads} read${n.reads > 1 ? 's' : ''}`, n.writes && `${n.writes} write${n.writes > 1 ? 's' : ''}`, n.searches && `surfaced in ${n.searches} search${n.searches > 1 ? 'es' : ''}`].filter(Boolean).join(' · ');
      row.createDiv({ cls: 'pm-tnote-what', text: `${clock(n.first)} · ${what}` });
    });
  }

  // ------------------------------------------------------------ knowledge gaps

  private buildGapsPage(root: HTMLElement) {
    const page = root.createDiv({ cls: 'pm-page pm-gaps' });
    this.pages.set('gaps', page);
    this.gapsEl = page;
  }

  private renderGaps() {
    if (!this.gapsEl || this.pages.get('gaps')!.style.display === 'none') return;
    const g = this.host.gaps();
    this.gapsEl.empty();
    const openLink = (parent: HTMLElement, path: string) => {
      const a = parent.createEl('a', { cls: 'plexus-log-note-title', text: noteTitle(path), attr: { title: path } });
      a.addEventListener('click', (ev) => { ev.preventDefault(); this.host.openNote(path, 'other'); });
      return a;
    };

    const misses = this.card(this.gapsEl, 'pm-gap', 'Searches that found nothing', 'search-x');
    misses.createDiv({ cls: 'pm-gap-why', text: 'An agent looked for this in the vault and came back empty, so the knowledge may be missing or filed under different words.' });
    if (!g.misses.length) misses.createDiv({ cls: 'pm-empty', text: 'No empty vault searches recorded yet.' });
    for (const m of g.misses) {
      const r = misses.createDiv({ cls: 'pm-gap-row' });
      r.createDiv({ cls: 'pm-gap-q', text: m.query });
      r.createDiv({ cls: 'pm-gap-meta', text: `${m.n}× · ${[...m.agents].join(', ')} · ${agoText(Date.now() - m.last)}` });
    }

    const rr = this.card(this.gapsEl, 'pm-gap', 'Read again and again · today', 'repeat');
    rr.createDiv({ cls: 'pm-gap-why', text: 'Notes an agent opened 3+ times today. A short summary or memory entry would save the repeat reads.' });
    if (!g.rereads.length) rr.createDiv({ cls: 'pm-empty', text: 'Nothing re-read 3+ times today.' });
    for (const r of g.rereads.slice(0, 15)) {
      const row = rr.createDiv({ cls: 'pm-gap-row' });
      row.style.setProperty('--agent', colorOf(this.host.agents(), r.agent));
      openLink(row, r.path);
      row.createDiv({ cls: 'pm-gap-meta', text: `${r.agent} · ${r.count} reads · last ${clock(r.last)}` });
    }

    const sug = this.card(this.gapsEl, 'pm-gap', 'Suggested links', 'link');
    sug.createDiv({ cls: 'pm-gap-why', text: 'Pairs of notes agents keep using together that don’t link to each other. Copy the link and paste it into either note.' });
    if (!g.suggestions.length) sug.createDiv({ cls: 'pm-empty', text: 'No missing links spotted yet. This fills in as agents work across tasks.' });
    for (const s of g.suggestions) {
      const row = sug.createDiv({ cls: 'pm-gap-row pm-gap-pair' });
      const pair = row.createDiv({ cls: 'pm-gap-q' });
      openLink(pair, s.a);
      pair.createSpan({ cls: 'pm-arrow', text: ' ↔ ' });
      openLink(pair, s.b);
      row.createDiv({ cls: 'pm-gap-meta', text: `used together in ${s.together} tasks${s.tasks.length ? ` · e.g. ${s.tasks[0]}` : ''}` });
      const copy = row.createEl('button', { cls: 'plexus-log-more', text: 'Copy link' });
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(`[[${s.b.replace(/\.md$/i, '')}]]`);
        copy.setText('Copied — paste into the first note');
      });
    }

    const orph = this.card(this.gapsEl, 'pm-gap', 'Unlinked notes agents use', 'unlink');
    orph.createDiv({ cls: 'pm-gap-why', text: 'Notes with no links in or out that agents still open. They’re easy to miss; link them from a hub.' });
    if (!g.usedOrphans.length) orph.createDiv({ cls: 'pm-empty', text: 'Every note agents used has at least one link.' });
    for (const [p, n] of g.usedOrphans) {
      const row = orph.createDiv({ cls: 'pm-gap-row' });
      openLink(row, p);
      row.createDiv({ cls: 'pm-gap-meta', text: `${n} agent accesses` });
    }

    const broken = this.card(this.gapsEl, 'pm-gap', `Broken links · ${g.brokenTotal}`, 'link-2-off');
    broken.createDiv({ cls: 'pm-gap-why', text: 'Links pointing at notes that don’t exist. Either create the note or fix the link.' });
    if (!g.broken.length) broken.createDiv({ cls: 'pm-empty', text: 'No broken links.' });
    for (const b of g.broken.slice(0, 25)) {
      const row = broken.createDiv({ cls: 'pm-gap-row' });
      openLink(row, b.source);
      row.createDiv({ cls: 'pm-gap-meta', text: `→ ${b.targets.slice(0, 4).join(', ')}${b.targets.length > 4 ? ` +${b.targets.length - 4}` : ''}` });
    }
  }

  // ------------------------------------------------------------ bridge traffic

  private buildBridgePage(root: HTMLElement) {
    const page = root.createDiv({ cls: 'pm-page pm-split' });
    this.pages.set('bridge', page);
    const side = this.card(page, 'pm-side', 'Conversations · today', 'network');
    this.bridgePairs = side.createDiv({ cls: 'pm-pairs' });
    const main = this.card(page, 'pm-main', 'Messages', 'messages-square');
    const search = main.createEl('input', { cls: 'plexus-log-search pm-inline-search', attr: { type: 'search', placeholder: 'Filter messages…' } });
    search.addEventListener('input', () => { this.bridgeFilter = search.value.trim().toLowerCase(); this.renderBridge(); });
    this.bridgeList = main.createDiv({ cls: 'pm-msg-list' });
  }

  private renderBridge(fresh = false) {
    if (!this.bridgeList || this.pages.get('bridge')!.style.display === 'none') return;
    const msgs = this.host.bridge();
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const name = (n: string) => (n === 'all' ? 'all' : this.host.alias(n));

    // Who talks to whom today.
    const today = dayKey(new Date());
    const pairs = new Map<string, { from: string; to: string; n: number; last: number }>();
    for (const m of msgs) {
      if (dayKey(new Date(m.t)) !== today) continue;
      const k = `${name(m.sender)}→${name(m.recipient)}`;
      const p = pairs.get(k) ?? { from: name(m.sender), to: name(m.recipient), n: 0, last: 0 };
      p.n++;
      p.last = Math.max(p.last, m.t);
      pairs.set(k, p);
    }
    this.bridgePairs.empty();
    if (!pairs.size) this.bridgePairs.createDiv({ cls: 'pm-empty', text: 'No bridge messages today.' });
    for (const p of [...pairs.values()].sort((a, b) => b.last - a.last)) {
      const row = this.bridgePairs.createDiv({ cls: 'pm-pair' });
      this.agentChip(row, p.from);
      row.createSpan({ cls: 'pm-arrow', text: '→' });
      this.agentChip(row, p.to);
      row.createSpan({ cls: 'pm-pair-n', text: `${p.n}` });
      row.createSpan({ cls: 'pm-pair-ago', text: agoText(Date.now() - p.last) });
    }

    this.bridgeList.empty();
    const shown = msgs
      .filter((m) => !this.bridgeFilter || `${m.sender} ${m.recipient} ${m.body}`.toLowerCase().includes(this.bridgeFilter))
      .slice(-200)
      .reverse();
    if (!shown.length) this.bridgeList.createDiv({ cls: 'pm-empty', text: 'No messages yet. Traffic appears here live as agents message each other on the bridge.' });
    shown.forEach((m, i) => {
      const el = this.bridgeList.createDiv({ cls: `pm-msg${m.important ? ' is-important' : ''}${fresh && i === 0 ? ' is-new' : ''}` });
      el.style.setProperty('--agent', colorOf(this.host.agents(), name(m.sender)));
      const head = el.createDiv({ cls: 'pm-msg-head' });
      this.agentChip(head, name(m.sender));
      head.createSpan({ cls: 'pm-arrow', text: '→' });
      this.agentChip(head, name(m.recipient));
      if (m.important) {
        const imp = head.createSpan({ cls: 'pm-msg-flag' });
        setIcon(imp.createSpan(), 'star');
        imp.createSpan({ text: 'Important' });
      }
      head.createSpan({ cls: 'pm-msg-time', text: `${new Date(m.t).toLocaleDateString([], { day: 'numeric', month: 'short' })} ${clock(m.t)}` });
      const parent = m.reply_to ? byId.get(m.reply_to) : null;
      if (parent) el.createDiv({ cls: 'pm-msg-reply', text: `↳ reply to ${name(parent.sender)}: ${parent.body.split('\n')[0].slice(0, 90)}` });
      const body = el.createDiv({ cls: 'pm-msg-body' });
      const long = m.body.length > 600;
      body.setText(long ? m.body.slice(0, 600) + '…' : m.body);
      if (long) {
        const more = el.createEl('button', { cls: 'plexus-log-more', text: 'Show full message' });
        more.addEventListener('click', () => { body.setText(m.body); more.remove(); });
      }
    });
  }

  private agentChip(parent: HTMLElement, agent: string) {
    const c = parent.createSpan({ cls: 'pm-agent-chip' });
    c.style.setProperty('--agent', agent === 'all' ? '#e4f8f6' : colorOf(this.host.agents(), agent));
    c.createSpan({ cls: 'plexus-log-dot' });
    c.createSpan({ text: agent === 'all' ? 'everyone' : agent });
    return c;
  }

  // ------------------------------------------------------------ changes (diff & undo)

  private buildChangesPage(root: HTMLElement) {
    const page = root.createDiv({ cls: 'pm-page pm-split' });
    this.pages.set('changes', page);
    const side = this.card(page, 'pm-side', 'Agent writes', 'git-commit-horizontal');
    this.changeList = side.createDiv({ cls: 'pm-change-list' });
    const main = this.card(page, 'pm-main', 'Diff', 'git-compare');
    this.diffEl = main.createDiv({ cls: 'pm-diff' });
  }

  private renderChanges() {
    if (!this.changeList || this.pages.get('changes')!.style.display === 'none') return;
    const recs = this.host.changes.records.slice().reverse();
    this.changeList.empty();
    if (!recs.length) {
      this.changeList.createDiv({ cls: 'pm-empty', text: 'No agent writes captured yet. When an agent edits or creates a note, its before/after lands here.' });
      this.diffEl.empty();
      return;
    }
    if (!this.selectedChange || !recs.some((r) => r.id === this.selectedChange)) this.selectedChange = recs[0].id;
    for (const r of recs.slice(0, 200)) {
      const { added, removed } = diffStats(r);
      const el = this.changeList.createDiv({ cls: `pm-change${r.id === this.selectedChange ? ' is-on' : ''}` });
      el.style.setProperty('--agent', colorOf(this.host.agents(), r.agent));
      const head = el.createDiv({ cls: 'pm-change-head' });
      this.agentChip(head, r.agent);
      if (r.before === null) head.createSpan({ cls: 'pm-tag', text: 'Created' });
      if (r.restoreOf) head.createSpan({ cls: 'pm-tag', text: 'Undo' });
      head.createSpan({ cls: 'pm-msg-time', text: clock(r.t) });
      el.createDiv({ cls: 'pm-change-note', text: noteTitle(r.path) });
      const meta = el.createDiv({ cls: 'pm-change-meta' });
      meta.createSpan({ cls: 'pm-plus', text: `+${added}` });
      meta.createSpan({ cls: 'pm-minus', text: `−${removed}` });
      if (r.purpose) meta.createSpan({ text: ` · ${r.purpose}` });
      el.addEventListener('click', () => { this.selectedChange = r.id; this.renderChanges(); });
    }
    const sel = recs.find((r) => r.id === this.selectedChange)!;
    this.renderDiff(sel);
  }

  private renderDiff(r: ChangeRecord) {
    this.diffEl.empty();
    const head = this.diffEl.createDiv({ cls: 'pm-diff-head' });
    const title = head.createDiv({ cls: 'pm-diff-title' });
    title.createDiv({ cls: 'pm-change-note', text: noteTitle(r.path) });
    title.createDiv({ cls: 'plexus-log-note-folder', text: `${r.path} · ${r.agent} · ${new Date(r.t).toLocaleString([], { hour12: false })}${r.source ? ` · via ${r.source}` : ''}` });
    if (r.purpose) title.createDiv({ cls: 'pm-task-text', text: r.purpose });
    const actions = head.createDiv({ cls: 'pm-diff-actions' });
    const open = actions.createEl('button', { cls: 'plexus-log-chip', text: 'Open note' });
    open.addEventListener('click', () => this.host.openNote(r.path, r.agent));
    const undo = actions.createEl('button', { cls: 'pm-undo', text: r.before === null ? 'Undo (move to trash)' : 'Restore before this change' });
    undo.addEventListener('click', () => this.host.restore(r));

    const body = this.diffEl.createDiv({ cls: 'pm-diff-body' });
    const before = r.before ?? '';
    const after = r.after ?? '';
    const ops = diffLines(before, after);
    // Unchanged runs longer than 6 lines collapse to 3 lines of context either side.
    const CONTEXT = 3;
    let i = 0;
    while (i < ops.length) {
      if (ops[i].kind === 'same') {
        let j = i;
        while (j < ops.length && ops[j].kind === 'same') j++;
        const run = j - i;
        const lead = i === 0 ? 0 : CONTEXT, trail = j === ops.length ? 0 : CONTEXT;
        if (run > lead + trail + 2) {
          for (let k = i; k < i + lead; k++) this.diffLine(body, ops[k]);
          body.createDiv({ cls: 'pm-diff-gap', text: `⋯ ${run - lead - trail} unchanged lines` });
          for (let k = j - trail; k < j; k++) this.diffLine(body, ops[k]);
        } else {
          for (let k = i; k < j; k++) this.diffLine(body, ops[k]);
        }
        i = j;
      } else {
        this.diffLine(body, ops[i]);
        i++;
      }
    }
    if (!ops.some((o) => o.kind !== 'same')) body.createDiv({ cls: 'pm-empty', text: 'No textual difference.' });
  }

  private diffLine(parent: HTMLElement, op: { kind: string; text: string; a?: number; b?: number }) {
    const row = parent.createDiv({ cls: `pm-dl is-${op.kind}` });
    row.createSpan({ cls: 'pm-dl-n', text: op.a ? String(op.a) : '' });
    row.createSpan({ cls: 'pm-dl-n', text: op.b ? String(op.b) : '' });
    row.createSpan({ cls: 'pm-dl-sign', text: op.kind === 'add' ? '+' : op.kind === 'del' ? '−' : ' ' });
    row.createSpan({ cls: 'pm-dl-text', text: op.text || ' ' });
  }

  // ------------------------------------------------------------ status board

  private renderStatus() {
    const now = Date.now();
    const dayStart = new Date(new Date().toDateString()).getTime();
    const statuses = agentStatuses(this.host.log.entries, this.host.agents().map((a) => a.name), now, dayStart);
    this.statusEl.empty();
    const seen = statuses.filter((s) => s.state !== 'unseen');
    for (const s of seen) {
      const row = this.statusEl.createDiv({ cls: `pm-agent is-${s.state}` });
      row.style.setProperty('--agent', colorOf(this.host.agents(), s.agent));
      const top = row.createDiv({ cls: 'pm-agent-top' });
      top.createSpan({ cls: 'plexus-log-dot' });
      top.createSpan({ cls: 'pm-agent-name', text: s.agent });
      const pill = top.createSpan({ cls: `pm-state is-${s.state}` });
      setIcon(pill.createSpan({ cls: 'pm-state-icon' }), STATE_ICON[s.state]);
      pill.createSpan({ text: STATE_LABEL[s.state] });
      top.createSpan({ cls: 'pm-agent-ago', text: s.lastSeen ? agoText(now - s.lastSeen) : '' });
      row.createDiv({ cls: 'pm-agent-task', text: s.task || (s.lastNote ? `Last note: ${noteTitle(s.lastNote)}` : 'No task reported') });
      const meta = row.createDiv({ cls: 'pm-agent-meta' });
      meta.setText(`${s.reads} reads · ${s.writes} writes · ${s.searches} searches · ~${fmtTokens(s.tokens)} tokens today`);
    }
    const unseen = statuses.filter((s) => s.state === 'unseen').map((s) => s.agent);
    if (unseen.length) this.statusEl.createDiv({ cls: 'pm-agent-unseen', text: `Not seen in the log: ${unseen.join(', ')}` });
  }

  // ------------------------------------------------------------ collisions

  private renderAlerts(fresh = false) {
    const alerts = this.host.alerts().slice().reverse();
    const today = dayKey(new Date());
    const todays = alerts.filter((a) => dayKey(new Date(a.t)) === today);
    this.alertBadge.setText(todays.length ? String(todays.length) : '');
    this.alertBadge.toggleClass('is-hot', todays.length > 0);
    this.alertsEl.empty();
    if (!alerts.length) {
      const ok = this.alertsEl.createDiv({ cls: 'pm-alert-ok' });
      setIcon(ok.createSpan({ cls: 'pm-state-icon' }), 'shield-check');
      ok.createSpan({ text: 'All clear: no collisions and no watched notes touched.' });
      return;
    }
    alerts.slice(0, 30).forEach((a, i) => {
      if (a.kind === 'watch' || a.kind === 'blocked') { this.watchRow(a, fresh && i === 0); return; }
      const serious = a.kind === 'write-write';
      const row = this.alertsEl.createDiv({ cls: `pm-alert ${serious ? 'is-serious' : 'is-warning'}${fresh && i === 0 ? ' is-new' : ''}` });
      const head = row.createDiv({ cls: 'pm-alert-head' });
      setIcon(head.createSpan({ cls: 'pm-alert-icon' }), serious ? 'octagon-alert' : 'triangle-alert');
      head.createSpan({ cls: 'pm-alert-kind', text: serious ? 'Write clash' : 'Edited while in use' });
      head.createSpan({ cls: 'pm-alert-time', text: clock(a.t) });
      const link = row.createEl('a', { cls: 'plexus-log-note-title', text: noteTitle(a.note), attr: { title: a.note } });
      link.addEventListener('click', (ev) => { ev.preventDefault(); this.host.openNote(a.note, a.writer); });
      const gap = agoText(a.t - a.otherAt).replace(' ago', '');
      row.createDiv({
        cls: 'pm-alert-text',
        text: serious
          ? `${a.writer} wrote it ${gap} after ${a.other} wrote it — check that neither overwrote the other.`
          : `${a.writer} edited it ${gap} after ${a.other} read it — ${a.other} may be working from a stale copy.`,
      });
    });
  }

  private watchRow(a: Collision, fresh: boolean) {
    const blocked = a.kind === 'blocked';
    const row = this.alertsEl.createDiv({ cls: `pm-alert is-watch${fresh ? ' is-new' : ''}` });
    const head = row.createDiv({ cls: 'pm-alert-head' });
    setIcon(head.createSpan({ cls: 'pm-alert-icon' }), blocked ? 'shield-x' : 'eye');
    head.createSpan({ cls: 'pm-alert-kind', text: blocked ? 'Blocked by permissions' : 'Watched note' });
    if (blocked) {
      head.createSpan({ cls: 'pm-alert-time', text: clock(a.t) });
      row.createDiv({ cls: 'pm-change-note', text: a.note ? noteTitle(a.note) : a.action ?? '' });
      row.createDiv({ cls: 'pm-alert-text', text: `${a.writer} tried to ${a.action}${a.note ? ` (${a.note})` : ''}; its permissions don't allow that.` });
      return;
    }
    head.createSpan({ cls: 'pm-alert-time', text: clock(a.t) });
    const link = row.createEl('a', { cls: 'plexus-log-note-title', text: noteTitle(a.note), attr: { title: a.note } });
    link.addEventListener('click', (ev) => { ev.preventDefault(); this.host.openNote(a.note, a.writer); });
    const verb = a.action === 'write' ? 'wrote' : a.action === 'read' ? 'read' : 'searched';
    row.createDiv({ cls: 'pm-alert-text', text: `${a.writer} ${verb} it — matches your watchlist entry “${a.rule}”.` });
  }

  // ------------------------------------------------------------ context budget

  private async renderBudget() {
    const range = this.budgetRange;
    const days = RANGE_DAYS[range];
    const dayStart = new Date(new Date().toDateString()).getTime();
    const from = range === 'day' ? dayStart : dayStart - (days - 1) * 86_400_000;
    const today = this.host.log.entries.filter((e) => e.t >= dayStart);
    const entries = range === 'day' ? today : [...(await this.host.log.pastDays(days - 1)), ...today];
    if (range !== this.budgetRange) return; // switched again while loading
    const { rows, heavy } = budgetByTask(entries, from);
    const total = rows.reduce((n, r) => n + r.tokens, 0);
    this.budgetTitle.setText(`Context budget · ${RANGE_LABEL[range]}`);
    this.budgetEl.empty();
    const hero = this.budgetEl.createDiv({ cls: 'pm-budget-hero' });
    hero.createDiv({ cls: 'pm-tile-value', text: `~${fmtTokens(total)}` });
    hero.createDiv({ cls: 'pm-tile-sub', text: `tokens of notes pulled into agent context ${RANGE_LABEL[range]} (≈4 bytes per token)${range === 'day' ? '' : ` · ~${fmtTokens(Math.round(total / days))} a day`}` });
    if (range !== 'day') this.budgetBars(entries, from, range);

    const byAgent = new Map<string, number>();
    for (const r of rows) byAgent.set(r.agent, (byAgent.get(r.agent) ?? 0) + r.tokens);
    const max = Math.max(1, ...byAgent.values());
    const agentsEl = this.budgetEl.createDiv({ cls: 'pm-budget-agents' });
    for (const [agent, n] of [...byAgent].sort((a, b) => b[1] - a[1])) {
      const r = agentsEl.createDiv({ cls: 'pm-budget-row' });
      r.style.setProperty('--agent', colorOf(this.host.agents(), agent));
      const name = r.createDiv({ cls: 'pm-budget-name' });
      name.createSpan({ cls: 'plexus-log-dot' });
      name.createSpan({ text: agent });
      r.createDiv({ cls: 'pm-hot-bar' }).createDiv({ cls: 'pm-hot-fill' }).style.width = `${Math.max(3, (n / max) * 100)}%`;
      r.createDiv({ cls: 'pm-budget-n', text: fmtTokens(n) });
    }

    if (rows.length) {
      this.budgetEl.createDiv({ cls: 'pm-subhead', text: 'Biggest tasks' });
      for (const r of rows.slice(0, 5)) {
        const t = this.budgetEl.createDiv({ cls: 'pm-task' });
        t.style.setProperty('--agent', colorOf(this.host.agents(), r.agent));
        t.createDiv({ cls: 'pm-task-text', text: r.key });
        t.createDiv({ cls: 'pm-task-meta', text: `${r.agent} · ${r.reads} reads · ~${fmtTokens(r.tokens)}` });
      }
    }
    this.budgetEl.createDiv({ cls: 'pm-subhead', text: `Heavy whole-file reads (≥ ${fmtTokens(HEAVY_READ_TOKENS)})` });
    if (!heavy.length) {
      this.budgetEl.createDiv({ cls: 'pm-empty', text: `None ${RANGE_LABEL[range]}. Agents are reading in ranges or searching first.` });
    }
    for (const e of heavy.slice(0, 6)) {
      const h = this.budgetEl.createDiv({ cls: 'pm-heavy' });
      h.style.setProperty('--agent', colorOf(this.host.agents(), e.agent));
      const a = h.createEl('a', { cls: 'plexus-log-note-title', text: noteTitle(e.notes[0]), attr: { title: e.notes[0] } });
      a.addEventListener('click', (ev) => { ev.preventDefault(); this.host.openNote(e.notes[0], e.agent); });
      h.createDiv({ cls: 'pm-task-meta', text: `${e.agent} · ~${fmtTokens(e.tokens ?? 0)} · ${clock(e.t)} · a search or ranged read would be cheaper` });
    }
  }

  /** Tokens per day (per month for a year), stacked by agent, so each day can be checked. */
  private budgetBars(entries: AccessEntry[], from: number, range: BudgetRange) {
    const byMonth = range === 'year';
    const keyOf = (t: number) => { const d = new Date(t); return byMonth ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : dayKey(d); };
    const buckets: string[] = [];
    if (byMonth) {
      const d = new Date(); d.setDate(1);
      for (let i = 11; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); buckets.push(keyOf(m.getTime())); }
    } else {
      for (let t = from; t <= Date.now(); t += 86_400_000) buckets.push(keyOf(t));
    }
    const sums = new Map<string, Map<string, number>>();
    for (const e of entries) {
      if (e.t < from || !e.tokens || isSyntheticEntry(e)) continue;
      const k = keyOf(e.t);
      const m = sums.get(k) ?? new Map<string, number>();
      m.set(e.agent, (m.get(e.agent) ?? 0) + e.tokens);
      sums.set(k, m);
    }
    const totals = buckets.map((k) => [...(sums.get(k)?.values() ?? [])].reduce((a, b) => a + b, 0));
    const max = Math.max(1, ...totals);
    const chart = this.budgetEl.createDiv({ cls: 'pm-bars' });
    buckets.forEach((k, i) => {
      const col = chart.createDiv({ cls: 'pm-bar' });
      const label = byMonth ? new Date(`${k}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' }) : new Date(`${k}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      col.setAttr('aria-label', `${label}: ~${fmtTokens(totals[i])} tokens`);
      col.setAttr('title', `${label}: ~${fmtTokens(totals[i])} tokens`);
      const stack = col.createDiv({ cls: 'pm-bar-stack' });
      stack.style.height = `${(totals[i] / max) * 100}%`;
      for (const [agent, n] of [...(sums.get(k) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])) {
        const seg = stack.createDiv({ cls: 'pm-bar-seg' });
        seg.style.flexGrow = String(n);
        seg.style.background = colorOf(this.host.agents(), agent);
      }
    });
    const axis = this.budgetEl.createDiv({ cls: 'pm-bars-axis' });
    const fmt = (k: string) => byMonth ? new Date(`${k}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) : new Date(`${k}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    axis.createSpan({ text: fmt(buckets[0]) });
    axis.createSpan({ text: `peak ~${fmtTokens(max)}` });
    axis.createSpan({ text: fmt(buckets[buckets.length - 1]) });
  }

  private renderBrainCounts() {
    const g = this.host.graphInfo();
    this.brainCounts.empty();
    const item = (n: number, label: string) => {
      const d = this.brainCounts.createDiv({ cls: 'pm-count' });
      d.createDiv({ cls: 'pm-count-n', text: n.toLocaleString() });
      d.createDiv({ cls: 'pm-count-label', text: label });
    };
    item(g.notes, 'notes');
    item(g.links, 'links');
    item(g.hubs, 'index hubs');
    item(g.unlinked, 'unlinked');
  }

  private renderHot() {
    const today = dayKey(new Date());
    const counts = new Map<string, { n: number; agents: Set<string> }>();
    for (const e of this.host.log.entries) {
      if (e.action === 'search' || dayKey(new Date(e.t)) !== today) continue;
      for (const p of e.notes) {
        const c = counts.get(p) ?? { n: 0, agents: new Set<string>() };
        c.n++;
        c.agents.add(e.agent);
        counts.set(p, c);
      }
    }
    const top = [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
    this.hotEl.empty();
    if (!top.length) {
      this.hotEl.createDiv({ cls: 'pm-empty', text: 'No notes read or written yet today.' });
      return;
    }
    const max = top[0][1].n;
    top.forEach(([path, c], i) => {
      const row = this.hotEl.createDiv({ cls: 'pm-hot-row' });
      row.createDiv({ cls: 'pm-hot-rank', text: String(i + 1) });
      const body = row.createDiv({ cls: 'pm-hot-body' });
      const a = body.createEl('a', { cls: 'plexus-log-note-title', text: noteTitle(path), attr: { title: path } });
      a.addEventListener('click', (ev) => { ev.preventDefault(); this.host.openNote(path, [...c.agents][0]); });
      const bar = body.createDiv({ cls: 'pm-hot-bar' });
      bar.createDiv({ cls: 'pm-hot-fill' }).style.width = `${Math.max(4, (c.n / max) * 100)}%`;
      body.createDiv({ cls: 'pm-hot-who', text: [...c.agents].join(' · ') });
      row.createDiv({ cls: 'pm-hot-n', text: String(c.n) });
    });
  }

  // ------------------------------------------------------------ access log

  private buildFilters(parent: HTMLElement) {
    const filters = parent.createDiv({ cls: 'plexus-log-filters' });
    const chips = filters.createDiv({ cls: 'plexus-log-chips' });
    const allChip = chips.createEl('button', { cls: 'plexus-log-chip is-on', text: 'All agents' });
    const agentChips: HTMLButtonElement[] = [];
    allChip.addEventListener('click', () => {
      this.agentFilter.clear();
      agentChips.forEach((c) => c.removeClass('is-on'));
      allChip.addClass('is-on');
      this.renderAll();
    });
    for (const a of this.host.agents()) {
      const chip = chips.createEl('button', { cls: 'plexus-log-chip' });
      chip.style.setProperty('--agent', a.color);
      chip.createSpan({ cls: 'plexus-log-dot' });
      chip.createSpan({ text: a.name });
      chip.addEventListener('click', () => {
        if (this.agentFilter.has(a.name)) { this.agentFilter.delete(a.name); chip.removeClass('is-on'); }
        else { this.agentFilter.add(a.name); chip.addClass('is-on'); }
        allChip.toggleClass('is-on', this.agentFilter.size === 0);
        this.renderAll();
      });
      agentChips.push(chip);
    }
    const row2 = filters.createDiv({ cls: 'plexus-log-row2' });
    const seg = row2.createDiv({ cls: 'plexus-log-seg' });
    for (const key of ['all', 'read', 'write', 'search']) {
      const b = seg.createEl('button', { text: key === 'all' ? 'All' : ACTION_LABEL[key], cls: key === 'all' ? 'is-on' : '' });
      b.addEventListener('click', () => {
        this.actionFilter = key;
        seg.querySelectorAll('button').forEach((x) => x.removeClass('is-on'));
        b.addClass('is-on');
        this.renderAll();
      });
    }
    const search = row2.createEl('input', { cls: 'plexus-log-search', attr: { type: 'search', placeholder: 'Filter by note or purpose…' } });
    search.addEventListener('input', () => { this.query = search.value.trim().toLowerCase(); this.renderAll(); });
  }

  private matches(e: AccessEntry) {
    if (this.agentFilter.size && !this.agentFilter.has(e.agent)) return false;
    if (this.actionFilter !== 'all' && e.action !== this.actionFilter) return false;
    if (this.query) {
      const hay = `${e.notes.join(' ')} ${e.purpose} ${e.agent}`.toLowerCase();
      if (!hay.includes(this.query)) return false;
    }
    return true;
  }

  private renderAll() {
    this.list.empty();
    const rows = this.host.log.entries.filter((e) => this.matches(e)).slice(-MAX_ROWS).reverse();
    if (!rows.length) {
      const empty = this.list.createDiv({ cls: 'plexus-log-empty' });
      empty.createDiv({ text: 'No access yet' });
      empty.createDiv({ cls: 'plexus-log-empty-sub', text: 'When an agent reads, writes or searches a note, it appears here instantly.' });
    }
    let lastDay = '';
    for (const e of rows) {
      const day = dayKey(new Date(e.t));
      if (day !== lastDay) { this.list.appendChild(this.dayRow(e.t)); lastDay = day; }
      this.list.appendChild(this.row(e));
    }
    this.renderStats();
  }

  private onEntry(e: AccessEntry) {
    this.renderStats();
    this.renderHot();
    this.renderStatus();
    // The budget can span a year of entries: redraw at most once a second.
    this.budgetTimer ??= window.setTimeout(() => { this.budgetTimer = null; void this.renderBudget(); }, 1000);
    this.lanes.draw();
    if (!this.matches(e)) return;
    this.list.querySelector('.plexus-log-empty')?.remove();
    const first = this.list.firstElementChild as HTMLElement | null;
    const row = this.row(e);
    row.addClass('is-new');
    if (first?.dataset.day === dayKey(new Date(e.t))) first.after(row);
    else { this.list.prepend(row); this.list.prepend(this.dayRow(e.t)); }
    const rows = this.list.querySelectorAll('.plexus-log-entry');
    if (rows.length > MAX_ROWS) rows[rows.length - 1].remove();
  }

  private renderStats() {
    this.statsEl.empty();
    const today = dayKey(new Date());
    const counts = new Map<string, number>();
    for (const e of this.host.log.entries) {
      if (dayKey(new Date(e.t)) !== today) continue;
      counts.set(e.agent, (counts.get(e.agent) ?? 0) + (e.action === 'search' ? 1 : e.notes.length));
    }
    if (!counts.size) { this.statsEl.createSpan({ cls: 'plexus-log-stat-empty', text: 'Nothing accessed yet today' }); return; }
    for (const [agent, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      const s = this.statsEl.createSpan({ cls: 'plexus-log-stat' });
      s.style.setProperty('--agent', colorOf(this.host.agents(), agent));
      s.createSpan({ cls: 'plexus-log-dot' });
      s.createSpan({ cls: 'plexus-log-stat-name', text: agent });
      s.createSpan({ cls: 'plexus-log-stat-n', text: String(n) });
    }
  }

  private dayRow(t: number) {
    const d = new Date(t);
    const el = createDiv({ cls: 'plexus-log-day' });
    el.dataset.day = dayKey(d);
    const today = dayKey(new Date()) === dayKey(d);
    el.setText(`${today ? 'Today · ' : ''}${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}`);
    return el;
  }

  private row(e: AccessEntry) {
    const el = createDiv({ cls: `plexus-log-entry is-${e.action}` });
    el.style.setProperty('--agent', colorOf(this.host.agents(), e.agent));
    el.createDiv({ cls: 'plexus-log-time', text: clock(e.t) });
    const who = el.createDiv({ cls: 'plexus-log-agent' });
    who.createSpan({ cls: 'plexus-log-dot' });
    who.createSpan({ text: e.agent });
    const act = el.createDiv({ cls: 'plexus-log-action' });
    setIcon(act.createSpan({ cls: 'plexus-log-action-icon' }), ACTION_ICON[e.action]);
    act.createSpan({ text: ACTION_LABEL[e.action] });

    const notes = el.createDiv({ cls: 'plexus-log-notes' });
    const addNote = (path: string, withFolder: boolean) => {
      const n = notes.createDiv({ cls: 'plexus-log-note' });
      const link = n.createEl('a', { cls: 'plexus-log-note-title', text: noteTitle(path), attr: { title: `Open ${path}` } });
      link.addEventListener('click', (ev) => { ev.preventDefault(); this.host.openNote(path, e.agent); });
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (withFolder && folder) n.createSpan({ cls: 'plexus-log-note-folder', text: folder });
    };
    const shown = e.action === 'search' ? e.notes.slice(0, 3) : e.notes;
    for (const path of shown) addNote(path, true);
    if (e.action === 'search' && e.notes.length > shown.length) {
      const more = notes.createEl('button', { cls: 'plexus-log-more', text: `+ ${e.notes.length - shown.length} more` });
      more.addEventListener('click', () => { more.remove(); for (const p of e.notes.slice(shown.length)) addNote(p, false); });
    }

    const why = el.createDiv({ cls: 'plexus-log-purpose' });
    if (e.purpose) why.setText(e.purpose);
    else why.createSpan({ cls: 'plexus-log-purpose-none', text: e.source ? `via ${e.source}` : 'purpose not reported' });
    if (e.purpose && e.source) why.setAttr('title', `via ${e.source}`);
    return el;
  }
}

function fmtTokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n));
}

function agoText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

function colorOf(agents: AgentStyle[], agent: string) {
  return (agents.find((a) => a.name === agent) ?? agents.find((a) => a.name === 'other'))?.color ?? '#ffffff';
}

// ------------------------------------------------------------------ charts

interface ChartOpts { max: number | null; unit: string; digits?: number; maxOf?: (s: Sample) => number | null }

/** Single-series rolling line (last 3 min) with a crosshair + tooltip on hover. */
class LineChart {
  private canvas: HTMLCanvasElement;
  private tip: HTMLElement;
  private hoverX: number | null = null;
  private last: Sample[] = [];

  constructor(private el: HTMLElement, private label: string, private pick: (s: Sample) => number | null, private o: ChartOpts) {
    this.canvas = el.createEl('canvas');
    this.tip = el.createDiv({ cls: 'pm-tip' });
    this.canvas.addEventListener('pointermove', (e) => { this.hoverX = e.offsetX; this.draw(this.last); });
    this.canvas.addEventListener('pointerleave', () => { this.hoverX = null; this.tip.setCssStyles({ display: 'none' }); this.draw(this.last); });
  }

  draw(samples: Sample[]) {
    this.last = samples;
    const win = this.canvas.ownerDocument.defaultView ?? window;
    const dpr = win.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = themeColors(this.canvas);

    const pts = samples.map((s) => ({ t: s.t, v: this.pick(s) }));
    const vals = pts.map((p) => p.v).filter((v): v is number => v !== null);
    const capFromData = this.o.maxOf ? samples.map(this.o.maxOf).find((v) => v) ?? null : null;
    const top = this.o.max ?? capFromData ?? niceMax(Math.max(1, ...vals) * 1.15);
    const pad = 3;
    const now = Date.now(), span = 180_000;
    const x = (t: number) => ((t - (now - span)) / span) * w;
    const y = (v: number) => h - pad - (Math.min(v, top) / top) * (h - pad * 2);

    // Recessive guides at 50% and 100% of the scale.
    ctx.strokeStyle = 'rgba(47, 211, 201, 0.10)';
    ctx.lineWidth = 1;
    for (const f of [0.5, 1]) { ctx.beginPath(); ctx.moveTo(0, Math.round(y(top * f)) + 0.5); ctx.lineTo(w, Math.round(y(top * f)) + 0.5); ctx.stroke(); }

    const seg = pts.filter((p) => p.v !== null) as { t: number; v: number }[];
    if (seg.length > 1) {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(47, 211, 201, 0.28)');
      grad.addColorStop(1, 'rgba(47, 211, 201, 0)');
      ctx.beginPath();
      ctx.moveTo(x(seg[0].t), h);
      for (const p of seg) ctx.lineTo(x(p.t), y(p.v));
      ctx.lineTo(x(seg[seg.length - 1].t), h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      seg.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.v)) : ctx.moveTo(x(p.t), y(p.v))));
      ctx.strokeStyle = css.cyan;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.shadowColor = css.cyan;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (this.hoverX !== null && seg.length) {
      const t = now - span + (this.hoverX / w) * span;
      let best = seg[0];
      for (const p of seg) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      const bx = x(best.t), by = y(best.v);
      ctx.strokeStyle = css.dim;
      ctx.beginPath(); ctx.moveTo(Math.round(bx) + 0.5, 0); ctx.lineTo(Math.round(bx) + 0.5, h); ctx.stroke();
      ctx.fillStyle = css.cyan;
      ctx.strokeStyle = css.bg;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      this.tip.setText(`${clock(best.t)} · ${best.v.toFixed(this.o.digits ?? 0)}${this.o.unit}`);
      this.tip.setCssStyles({ display: 'block' });
      this.tip.style.left = `${Math.min(Math.max(bx, 40), w - 40)}px`;
    }
  }
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** One row per agent; a tick for every access in the last 30 minutes. */
class Lanes {
  private canvas: HTMLCanvasElement;
  private tip: HTMLElement;
  private hits: { x: number; y: number; e: AccessEntry }[] = [];
  private hover: { x: number; y: number } | null = null;

  constructor(private el: HTMLElement, private host: LogHost) {
    this.canvas = el.createEl('canvas');
    this.tip = el.createDiv({ cls: 'pm-tip' });
    this.canvas.addEventListener('pointermove', (e) => { this.hover = { x: e.offsetX, y: e.offsetY }; this.draw(); });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.tip.setCssStyles({ display: 'none' }); this.draw(); });
    this.canvas.addEventListener('click', () => {
      const h = this.nearest();
      if (h) this.host.openNote(h.e.notes[0], h.e.agent);
    });
  }

  private nearest() {
    if (!this.hover) return null;
    let best: (typeof this.hits)[number] | null = null, bd = 12 * 12;
    for (const h of this.hits) {
      const d = (h.x - this.hover.x) ** 2 + (h.y - this.hover.y) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  draw() {
    const now = Date.now();
    const recent = this.host.log.entries.filter((e) => e.t > now - LANE_WINDOW);
    const agents = this.host.agents().filter((a) => recent.some((e) => e.agent === a.name));
    const rowH = 30, labelW = 92, axisH = 18;
    const h = Math.max(1, agents.length) * rowH + axisH + 6;
    this.el.style.height = `${h}px`;
    const win = this.canvas.ownerDocument.defaultView ?? window;
    const dpr = win.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    if (!w) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = themeColors(this.canvas);
    this.hits = [];
    const font = getComputedStyle(this.el).fontFamily || 'sans-serif';

    if (!agents.length) {
      ctx.fillStyle = css.dim;
      ctx.font = `13px ${font}`;
      ctx.fillText('No agent has touched a note in the last 30 minutes.', 4, 20);
      this.tip.setCssStyles({ display: 'none' });
      return;
    }

    const trackW = w - labelW - 46;
    const x = (t: number) => labelW + ((t - (now - LANE_WINDOW)) / LANE_WINDOW) * trackW;
    agents.forEach((a, row) => {
      const cy = row * rowH + rowH / 2 + 2;
      // Label carries identity in text, not colour alone.
      ctx.fillStyle = a.color;
      ctx.beginPath(); ctx.arc(8, cy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css.text;
      ctx.font = `600 12.5px ${font}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(a.name, 20, cy);
      ctx.strokeStyle = 'rgba(47, 211, 201, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(labelW, Math.round(cy) + 0.5); ctx.lineTo(labelW + trackW, Math.round(cy) + 0.5); ctx.stroke();
      const mine = recent.filter((e) => e.agent === a.name);
      for (const e of mine) {
        const ex = x(e.t);
        const tall = e.action === 'write' ? 20 : e.action === 'read' ? 15 : 9;
        ctx.fillStyle = a.color;
        ctx.globalAlpha = e.action === 'search' ? 0.55 : 1;
        roundRect(ctx, ex - 1.5, cy - tall / 2, 3, tall, 1.5);
        ctx.fill();
        ctx.globalAlpha = 1;
        this.hits.push({ x: ex, y: cy, e });
      }
      const lastT = mine.length ? mine[mine.length - 1].t : 0;
      ctx.fillStyle = css.dim;
      ctx.font = `12px ${font}`;
      ctx.textAlign = 'right';
      ctx.fillText(ago(now - lastT), w - 2, cy);
      ctx.textAlign = 'left';
    });
    // Time axis
    ctx.fillStyle = css.faint;
    ctx.font = `11px ${font}`;
    ctx.textBaseline = 'alphabetic';
    const axisY = agents.length * rowH + axisH;
    for (const m of [30, 20, 10, 0]) {
      const ax = x(now - m * 60_000);
      ctx.textAlign = m === 30 ? 'left' : m === 0 ? 'right' : 'center';
      ctx.fillText(m === 0 ? 'now' : `−${m} min`, ax, axisY);
    }
    ctx.textAlign = 'left';

    const hit = this.nearest();
    if (hit) {
      ctx.strokeStyle = css.text;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hit.x, hit.y, 7, 0, Math.PI * 2); ctx.stroke();
      const what = hit.e.action === 'search' ? `${hit.e.notes.length} notes` : noteTitle(hit.e.notes[0]);
      this.tip.setText(`${hit.e.agent} ${hit.e.action} · ${what} · ${clock(hit.e.t)}`);
      this.tip.setCssStyles({ display: 'block' });
      this.tip.style.left = `${Math.min(Math.max(hit.x, 90), w - 90)}px`;
      this.tip.style.top = `${hit.y - 34}px`;
    } else {
      this.tip.setCssStyles({ display: 'none' });
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ago(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

/** Monitor colours from the active theme's CSS variables (dark or light). */
function themeColors(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return { cyan: v('--pl-cyan', CYAN), text: v('--pl-text', '#e4f8f6'), dim: v('--pl-dim', '#8fb3b0'), faint: v('--pl-faint', '#5d7f7c'), bg: v('--pl-bg', '#03080a') };
}
