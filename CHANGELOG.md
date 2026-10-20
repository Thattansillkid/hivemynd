# Changelog

## 1.1.0 (in progress)

- Built-in user manual: command "Open the user manual", a button in settings and on the welcome screen. Also in MANUAL.md.
- To be ported from the personal build before release: cinematic camera, span across monitors, light theme on every view, claims, handoffs, trust scores, gap radar, daily brief. See the next-update backlog.

## 1.0.4

- Community directory source checks: no lint-rule suppressions. The web viewer and layout worker now satisfy the rules directly (window.fetch, the worker's own timers, no globalThis).

## 1.0.3

- Community directory source checks: styles set through Obsidian's setCssStyles, configDir instead of a hard-coded config folder, FileManager.trashFile, window timers.
- Fix: the optional web viewer failed to load in a plain browser; it now ships the small set of DOM helpers it needs.
- ESLint with Obsidian's official rules (npx eslint src).

## 1.0.2

- Release assets carry GitHub build-provenance attestations.
- Stylesheet cleanup for the community directory checks (no !important, Obsidian font variables).

## 1.0.1

- README title now matches the plugin name (community directory check).

## 1.0.0

First public release.

- 3D brain view of the vault with neuron firing, themes and full screen.
- Live agent trails from Claude Code hooks, any local tool, or the optional bridge.
- Brain Monitor: modular dashboard, access log, alerts, context budget (day, week, month, year), replay.
- Search, hover previews, meaning map, growth time-lapse, daily brain report, context packs.
- Per-agent permissions with approvals; reference bridge (vault-only).
- Optional: music reactivity, phone alerts, read-only web viewer (all off by default).
