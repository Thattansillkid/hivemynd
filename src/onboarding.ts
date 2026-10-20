import { App, Modal, Notice, Setting } from 'obsidian';

// First-run welcome and the "Connect your agents" snippets. Everything here is
// generated from the user's own port and key, so it can be pasted as-is.

export function claudeCodeHooks(port: number, key: string) {
  const base = `http://127.0.0.1:${port}`;
  const h = (path: string, timeout: number) => ({ type: 'http', url: `${base}${path}`, timeout, headers: { 'X-Hivemynd-Key': key } });
  return JSON.stringify({
    hooks: {
      UserPromptSubmit: [{ hooks: [h('/prompt/claude', 1)] }],
      PostToolUse: [{ matcher: 'Read|Edit|Write|MultiEdit|Grep|Glob|Bash|mcp__.*', hooks: [h('/hook/claude', 1)] }],
      PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [h('/prewrite/claude', 2)] }],
    },
  }, null, 2);
}

export function curlExample(port: number, key: string) {
  return [
    '# Any tool that reads or writes notes can light up the brain. Send one of these:',
    `curl -s -m 1 -H "X-Hivemynd-Key: ${key}" -H "Content-Type: application/json" \\`,
    `  -d '{"agent":"my-agent","kind":"read","texts":["Projects/Plan.md"]}' \\`,
    `  http://127.0.0.1:${port}/pulse`,
    '',
    '# kind: read | write | scan.  texts: vault paths (or any text containing them).',
    '# Hook payloads from agent CLIs can be piped straight to /hook/<agent-name>:',
    `#   ... | curl -s -m 1 -H "X-Hivemynd-Key: ${key}" --data-binary @- http://127.0.0.1:${port}/hook/my-agent`,
  ].join('\n');
}

/** Adds the "Connect your agents" section to the settings tab. */
export function connectSection(containerEl: HTMLElement, port: number, key: string) {
  new Setting(containerEl).setName('Connect your agents').setHeading();
  containerEl.createEl('p', {
    cls: 'setting-item-description',
    text: 'Agents report what they read and write to a listener on this computer only (127.0.0.1). Copy a snippet below; it already contains your port and key. Keep the key private: anyone with it can send activity to your brain view.',
  });
  const copy = (label: string, text: () => string) => (b: import('obsidian').ButtonComponent) =>
    b.setButtonText(label).onClick(() => { void navigator.clipboard.writeText(text()); new Notice('H!V3MYND: copied'); });
  new Setting(containerEl).setName('Claude Code').setDesc('Paste into ~/.claude/settings.json (merge with any hooks you already have). Restart Claude Code.')
    .addButton(copy('Copy hooks', () => claudeCodeHooks(port, key)));
  new Setting(containerEl).setName('Any other agent or script').setDesc('A curl example for /pulse and /hook/<agent>. Works from shells, Python, Node, or agent hook systems.')
    .addButton(copy('Copy example', () => curlExample(port, key)));
  new Setting(containerEl).setName('Remote agents').setDesc('Agents on other machines connect through the optional bridge in the project repository (bridge folder), which adds per-agent tokens and permissions. See BRIDGE.md.');
}

/** Shown once after install. */
export class WelcomeModal extends Modal {
  constructor(app: App, private openBrain: () => void, private openSettings: () => void) {
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
    row.createEl('button', { text: 'Connect agents' }).addEventListener('click', () => { this.close(); this.openSettings(); });
    row.createEl('button', { cls: 'mod-cta', text: 'Open the brain' }).addEventListener('click', () => { this.close(); this.openBrain(); });
  }

  onClose() { this.contentEl.empty(); }
}
