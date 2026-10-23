# Hivemynd

**H!V3MYND: your Obsidian vault as a living 3D brain, and a window into what your AI agents do in it.**

Notes are neurons, links are connections, and the brain fires on its own. When an AI agent (Claude Code, Codex, Gemini, Grok, Cursor or anything you script) reads or writes a note, its signal travels through the brain in that agent's colour. You can watch it live, replay it, audit it, and limit what each agent may touch.

Hivemynd is the name in Obsidian's community plugins; H!V3MYND is the brand. Free and open source (Apache-2.0). Desktop only.

## Features

- **The brain:** a GPU-rendered 3D graph of your vault with neuron firing, depth of field and bloom; full screen.
- **Looks:** ten themes (Multiverse, Inkblot, Mycelium, Lifeblood, Matrix and more), eleven brain shapes, a clustering slider, agent orbits, and Randomize, which morphs between looks on a timer. All looks only: your notes and layout never change.
- **Cinematic camera and span:** an endless flythrough, and one brain spread across several monitors.
- **Agent trails:** every read, write and search by an agent lights a path in its colour, with lightning from the agent's satellite into the note.
- **Brain Monitor:** a separate, modular window. Move, resize and hide its panels: agent status, alerts, context budget (day, week, month, year), activity lanes, hot notes, and a full access log with filters.
- **Replay and time-lapse:** scrub back through agent activity, or watch the vault grow note by note.
- **Search and hover cards:** press `/` to find a note and fly to it; hover any node for a preview.
- **Meaning map:** lay the brain out by topic instead of links (computed locally).
- **Daily brain report:** a summary note per day: who did what, most-used notes, alerts, re-reads, searches that found nothing.
- **Context packs:** agents can ask for the notes most relevant to a task, trimmed to a token budget.
- **Agent teamwork:** claims (agents warned or blocked from editing a note another agent is working on), handoff packs, trust scores, a gap radar, tasks for agents, a secret scanner, and an optional daily brief with a time-lapse.
- **Permissions:** per-agent hidden folders and read-only, enforced by the optional bridge. Bridges you extend with PC actions can ask you to approve each one.
- **Optional extras (off by default):** music reactivity, phone alerts, a read-only web viewer for other devices.

## User manual

The full manual is built into the plugin: run **Hivemynd: Open the user manual** from the command palette, or click **User manual** at the top of the plugin's settings. You can also read it here: [MANUAL.md](MANUAL.md).

## Install

**From Obsidian:** Settings → Community plugins → Browse → search **Hivemynd** → Install → Enable.

**Manual:** download `main.js`, `manifest.json` and `styles.css` from the latest [release](../../releases) into `<your vault>/.obsidian/plugins/hivemynd/`, then enable it under Community plugins.

Requires Obsidian 1.11.4 or newer on Windows, macOS or Linux.

## Connect an agent (about a minute)

Open **Settings → H!V3MYND → Agent keys** and copy the snippet from that agent's row. It already contains your port and that agent's own key.

- **Claude Code:** paste the hooks into `~/.claude/settings.json` and restart Claude Code.
- **Anything else:** POST to the local listener:

```bash
curl -s -m 1 -H "X-Hivemynd-Key: <your key>" -H "Content-Type: application/json" \
  -d '{"kind":"read","texts":["Projects/Plan.md"]}' \
  http://127.0.0.1:27183/pulse
```

Agents on other machines use the optional **bridge** in [`bridge/`](bridge/). The protocol and a walkthrough are in [docs/BRIDGE.md](docs/BRIDGE.md).

## Network use and files outside the vault

Obsidian asks plugins to disclose these. Here is everything H!V3MYND does beyond your vault:

| What | When | Why |
|---|---|---|
| Local HTTP listener on `127.0.0.1:27183` | When "Agent listener" is on (default) | Receives activity from agents on this computer. Bound to this computer only; every request needs a key, and each agent's key only acts as that agent; browser-originated requests are refused. |
| Writes bridge keys to `~/.hivemynd/vaults/<vault>-<id>/` | When you have a Bridge key | Lets the bridge read its key without copying it by hand. Owner-only (mode 0600; on Windows only your account has access). |
| Writes `~/.hivemynd/listener.key` | Only while the 1.1 shared key is still accepted | For bridges set up with 1.1. Removed when you retire the shared key. |
| Writes the bridge policy file | Only if you set its path | Your per-agent permission rules, for the optional bridge to enforce. |
| Runs `nvidia-smi` | While the Brain Monitor is open | Shows GPU load in the System panel. Run from NVIDIA's install folder only; skipped silently if not present. |
| Runs `icacls` (Windows) | When it writes a key file | Restricts the key file to your account. |
| Captures system audio | Only when you turn on music reactivity | Local analysis to animate the brain. Nothing is recorded or sent. |
| HTTPS POST to your ntfy, Discord or webhook URL | Only if you turn on phone alerts | Sends the alert line (never note contents) to the address you choose. |
| Sends short lines to the bridge's `glasses` inbox | Only if you turn on the glasses feed | Puts the daily brief summary and approval requests on Even G2 glasses through your own bridge. Reads the sender's token from the bridge token file you choose, at send time; it is never stored. |
| Local web server on port 27184 | Only if you turn on the web viewer | Serves a read-only view of the brain (note names and links, never note contents) with its own key. Local network access is a separate opt-in. |

No telemetry, no analytics, no accounts, and nothing is sent anywhere by default. Keys and webhook URLs are kept in Obsidian's SecretStorage, not in plugin settings.

## Privacy

The access log (in the plugin's folder) records which agent touched which note and when. By default it also stores the first line of what each agent was asked to do. Turn that off with **Store agent prompts**. If you sync your vault's `.obsidian` folder, the log syncs too.

## Security

See [SECURITY.md](SECURITY.md) for the threat model, safe defaults and how to report a vulnerability.

## Development

```bash
npm install
npm run dev                                    # unminified build to ./main.js
HIVEMYND_VAULT="/path/to/test-vault" npm run dev  # also copies into that vault
npm run build                                  # production build
```

A synthetic vault for testing is in [`demo-vault/`](demo-vault/). Releases are built by GitHub Actions when a version tag is pushed (`npm version 1.0.1 && git push --follow-tags`).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Bundled third-party code (three.js, d3-force-3d and related d3 modules) keeps its own MIT/ISC licenses, listed in NOTICE.

## Trademarks

"H!V3MYND" and "Hivemynd" are the project's names. The Apache License covers the code, not the names or logos. Forks are welcome under the license, but please give them a different name.

Made by J Tansill.
