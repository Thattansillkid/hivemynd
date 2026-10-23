# Changelog

## 1.2.0

Security and reliability release, from an external audit of 1.1.0. Thank you to the reviewer who reported it.

**Upgrading:** your 1.1 key keeps working. To finish the move, open Settings → H!V3MYND → Agent keys, click **Create agent keys**, paste each agent's new snippet (and point the bridge at its new key file, see docs/BRIDGE.md), then **Retire shared key**. Developer mode tools now need an Admin key.

- **One key per agent.** Keys have a kind (Observer, Agent, Bridge, Admin) that limits which routes they can use, and an agent key only ever acts as its own agent: naming another agent is refused, and its reports are recorded under its own name. An observer key can report activity but read nothing. An agent without its own permission rule gets every agent's hidden folders in context packs instead of none.
- **Keys only in the header.** `?key=` is no longer accepted. Malformed requests are answered with 400 and can't stop the listener.
- **Change history no longer keeps secrets by default.** Keys and tokens are masked before history is saved (Redacted); Raw and Metadata only are options. Masking a secret an agent wrote no longer keeps the unmasked text as an undo point unless history is Raw. History and bridge messages are deleted after 30 days (configurable), and **Delete stored history** clears them.
- **"Store agent prompts" off now means off everywhere:** access log, change history and claims, and remembered prompts are deleted. Kept prompts have secrets masked. Bridge messages can be stored as metadata only.
- **Paths in agent events are checked** before any note is read: no `..`, absolute paths outside the vault, drive-relative, UNC or device paths, configuration folder, or links and junctions leading out of the vault.
- **Limits:** request size caps on every route, per-key rate limits, a cap on requests in progress, at most 2,000 bridge messages in memory, one bridge-message file per day, and bounded reads at startup.
- **Bridge messages are acknowledged only once saved**, and a failed save answers 500 (retry with the same id is safe). Failed history writes are reported.
- **Pre-write checks fail closed when you enforce:** if a check can't run, the write is held back when claims or the secret scanner are set to Block (setting: "If a pre-write check fails"). A failed check is always marked `X-Hivemynd-Check: failed`.
- **Restore checks for edits made after you opened it** and replaces nothing if the note changed.
- **Key files per vault** under `~/.hivemynd/vaults/`, owner-only on every platform (Windows ACLs are set, not just a POSIX mode). The bridge reads `--key-file` / `HIVEMYND_KEY_FILE`.
- `nvidia-smi` and `icacls` are run by full path.
- Tests (vitest) for every audit finding, run in CI and before each release; patched dev dependencies (`npm audit`: 0).
- SECURITY.md now documents the threat model, key kinds, what is advisory (event labels, pre-write replies, trust scores and context packs), what is stored where, and the limits.

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
