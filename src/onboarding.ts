import { App, ButtonComponent, Modal, Notice, Setting } from 'obsidian';

// First-run welcome and the "Connect your agents" snippets. Everything here is
// generated from the user's own port and key, so it can be pasted as-is.

export function claudeCodeHooks(port: number, key: string, agent = 'claude') {
  const base = `http://127.0.0.1:${port}`;
  const h = (path: string, timeout: number) => ({ type: 'http', url: `${base}${path}`, timeout, headers: { 'X-Hivemynd-Key': key } });
  return JSON.stringify({
    hooks: {
      UserPromptSubmit: [{ hooks: [h(`/prompt/${agent}`, 1)] }],
      PostToolUse: [{ matcher: 'Read|Edit|Write|MultiEdit|Grep|Glob|Bash|mcp__.*', hooks: [h(`/hook/${agent}`, 1)] }],
      PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [h(`/prewrite/${agent}`, 2)] }],
    },
  }, null, 2);
}

export function curlExample(port: number, key: string, agent = 'my-agent') {
  return [
    '# Any tool that reads or writes notes can light up the brain. Send one of these:',
    `curl -s -m 1 -H "X-Hivemynd-Key: ${key}" -H "Content-Type: application/json" \\`,
    `  -d '{"kind":"read","texts":["Projects/Plan.md"]}' \\`,
    `  http://127.0.0.1:${port}/pulse`,
    '',
    '# kind: read | write | scan.  texts: vault paths (or any text containing them).',
    `# This key belongs to "${agent}": events sent with it are always recorded as ${agent}.`,
    '# Hook payloads from agent CLIs can be piped straight to /hook/<agent-name>:',
    `#   ... | curl -s -m 1 -H "X-Hivemynd-Key: ${key}" --data-binary @- http://127.0.0.1:${port}/hook/${agent}`,
  ].join('\n');
}

/** Adds the introduction to the "Connect your agents" section of the settings tab. */
export function connectSection(containerEl: HTMLElement) {
  new Setting(containerEl).setName('Connect your agents').setHeading();
  containerEl.createEl('p', {
    cls: 'setting-item-description',
    text: 'Agents report what they read and write to a listener on this computer only (127.0.0.1). Each agent gets its own key, and a key can only act as its own agent: copy the snippet from that agent’s row below; it already contains the port and key. Keep keys private.',
  });
  containerEl.createEl('p', {
    cls: 'setting-item-description',
    text: 'Remote agents connect through the optional bridge in the project repository (bridge folder), which adds per-agent tokens and permissions and uses a Bridge key. See BRIDGE.md.',
  });
}

/** Copies text and confirms. */
export function copyButton(label: string, text: () => string) {
  return (b: ButtonComponent) => b.setButtonText(label).onClick(() => { void navigator.clipboard.writeText(text()); new Notice('H!V3MYND: copied'); });
}

/** Shown once after install. */
export class WelcomeModal extends Modal {
  constructor(app: App, private openBrain: () => void, private openSettings: () => void, private openManual: () => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('plexus-welcome');
    contentEl.createEl('h2', { text: 'Welcome to H!V3MYND' });
    contentEl.createEl('p', { text: 'Your vault as a living 3D brain. Notes are neurons, links are connections, and AI agents that read or write your notes leave glowing trails you can watch, replay and audit.' });
    const ul = contentEl.createEl('ul');
    for (const t of [
      'Open the brain from the ribbon (brain icon) or the command palette.',
      'Connect an agent in Settings → H!V3MYND → Connect your agents (copy-paste, about a minute).',
      'Everything stays on this computer. Nothing is sent anywhere unless you turn on phone alerts or the web viewer.',
    ]) ul.createEl('li', { text: t });
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { text: 'User manual' }).addEventListener('click', () => { this.close(); this.openManual(); });
    row.createEl('button', { text: 'Connect agents' }).addEventListener('click', () => { this.close(); this.openSettings(); });
    row.createEl('button', { cls: 'mod-cta', text: 'Open the brain' }).addEventListener('click', () => { this.close(); this.openBrain(); });
  }

  onClose() { this.contentEl.empty(); }
}
