# Changelog

## 1.1.0

- **User manual** built into the plugin (command, settings button, welcome screen) and in MANUAL.md.
- **Looks** (none of them change your notes or layout):
  - Ten themes chosen from a palette menu on the brain and, separately, in the Brain Monitor: Multiverse (notes become slowly turning galaxies close up), Inkblot (oil blobs on paper), Violet Dusk, Tide Pulse, Copper Ember, Aurora Moss, Mycelium (fungal threads and dew drops), Lifeblood (blood pumping through arteries and veins on a heartbeat), Matrix (code rain, glyph notes, data packets) and Solar Ink.
  - Eleven brain shapes that morph into each other, a clustering slider, and a shape cycle.
  - Agent orbits (solar system, atom and more) with orbit line colours.
  - Randomize: changes theme, shape, orbit and clustering on a timer, morphing and cross-fading instead of snapping.
- **Cinematic camera:** an endless flythrough, with auto-start after idle and a speed control.
- **Span across monitors:** one brain across the monitors you pick, with the toolbar and music panel on the centre one.
- **Agent teamwork:** claims with warn/block replies to agents' pre-write hooks, handoff packs and trails, trust scores and pre-write trust warnings, a gap radar with starter notes, tasks for agents, live presence rings, a secret scanner (warns or blocks, and masks secrets agents write), authorship badges, per-agent replay, focus mode.
- **Daily brief** (off by default): a note about the previous day with a 30-second time-lapse.
- **Music:** light-show colour choice, a closable panel; in Lifeblood the kick drum drives the heartbeat.
- **Low-latency mode** for slower computers, and optional Even G2 glasses lines (off by default).
- Menus now work in full screen.
- Fixes: a WebGL context leak on reload, and slow start-up with very large change logs.

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
