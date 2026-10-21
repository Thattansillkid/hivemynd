# H!V3MYND user manual

Hivemynd for Obsidian, version 1.1.0.

H!V3MYND shows your Obsidian vault as a living 3D brain and shows you what your AI agents do in it. Notes are neurons and links are connections. When an agent reads, writes or searches a note, a signal runs through the brain in that agent's colour. You can watch it live, replay it, review every change, and set limits on what each agent may touch.

This manual is also built into the plugin: open the command palette and run **Hivemynd: Open the user manual**, or use the **User manual** button at the top of the plugin's settings.

## Contents

1. [Install and first run](#1-install-and-first-run)
2. [Where everything is](#2-where-everything-is)
3. [The brain](#3-the-brain)
4. [Cinematic camera](#4-cinematic-camera)
5. [Span across monitors](#5-span-across-monitors)
6. [Connecting agents](#6-connecting-agents)
7. [Brain Monitor](#7-brain-monitor)
8. [Agent teamwork](#8-agent-teamwork)
9. [Permissions and safety](#9-permissions-and-safety)
10. [Watchlist and alerts](#10-watchlist-and-alerts)
11. [Reports, logs and context packs](#11-reports-logs-and-context-packs)
12. [Music reactivity](#12-music-reactivity)
13. [Web viewer and Even G2 glasses](#13-web-viewer-and-even-g2-glasses)
14. [Agent API reference](#14-agent-api-reference)
15. [Files, network and privacy](#15-files-network-and-privacy)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Install and first run

**From Obsidian:** Settings → Community plugins → Browse → search for **Hivemynd** → Install → Enable.

**By hand:** download `main.js`, `manifest.json` and `styles.css` from the latest GitHub release into `<your vault>/.obsidian/plugins/hivemynd/`, then enable Hivemynd under Community plugins.

You need Obsidian 1.11.4 or newer on Windows, macOS or Linux. Hivemynd is desktop only. The brain needs a graphics card with WebGL 2, which almost every computer from the last ten years has.

The first time you enable it, a welcome window offers two buttons:

- **Open the brain** shows your vault in 3D.
- **Connect agents** takes you to the copy-and-paste setup for your AI tools (see [section 6](#6-connecting-agents)).

Nothing leaves your computer unless you turn on phone alerts or the web viewer.

## 2. Where everything is

### Ribbon (left edge of Obsidian)

| Icon | What it does |
|---|---|
| Brain | Opens the brain |
| Pulse line | Opens the Brain Monitor in its own window |

### Brain toolbar (top right of the brain)

The toolbar fades when the pointer is elsewhere and comes back when you move over the brain. While the brain [spans several monitors](#5-span-across-monitors), the toolbar sits at the bottom middle of the centre monitor and stays visible.

| Button | What it does | Key |
|---|---|---|
| Expand arrows | Full screen | `F` |
| Crosshair | Recenter the camera (or double-click the brain) | |
| Lightning | Demo agent activity, to see what agent trails look like | |
| Flame | Heat & decay view | `H` |
| Clock with arrow | Replay agent activity | `R` |
| Sprout | Vault growth time-lapse | `G` |
| Shapes | Meaning map: arrange by topic instead of links | `S` |
| Music note | Music reactivity | `M` |
| Magnifier | Search the brain | `/` or `Ctrl+F` |
| Clapperboard | Cinematic camera menu | `C` starts and stops |
| Monitor | Span across monitors menu | |
| Eye in a frame | Focus on a project folder | `Esc` leaves |
| Palette | Theme menu | |
| Pulse line | Brain Monitor in its own window | |

### Keyboard (with the brain focused)

| Key | Action |
|---|---|
| `F` | Full screen on and off |
| `C` | Start or stop the cinematic camera |
| `H` | Heat & decay view |
| `R` | Replay bar |
| `G` | Vault growth time-lapse |
| `S` | Meaning map |
| `M` | Music reactivity |
| `/` or `Ctrl+F` | Search |
| `Esc` | Close search or a menu; leave focus mode; stop spanning monitors |

### Command palette

Press `Ctrl+P` (`Cmd+P` on a Mac) and type "Hivemynd":

- Open the brain
- Open Brain Monitor in its own window
- Open Brain Monitor in the sidebar
- Open the user manual
- Toggle heat & decay view
- Toggle music reactivity
- Toggle meaning map (arrange by topic)
- Toggle cinematic camera
- Toggle low-latency mode
- Focus the brain on a project (folder)
- Play vault growth time-lapse
- Demo agent activity
- Turn agent permissions on or off

### Settings

Settings → **H!V3MYND**. The sections, top to bottom:

| Section | What you set there |
|---|---|
| User manual | Opens this manual |
| Look, Motion, Performance | Colours, node and link sizes, glow, auto-rotate speed, quality |
| Notes | Folders to leave out of the brain |
| Access log | Logging searches, storing agent prompts, the daily digest note, the daily brain report |
| Cinematic camera | Start when the brain opens, resume after idle, flight speed |
| Agent teamwork | Claims, claim length, handoffs, trust warnings, gap notes folder, live presence rings, secret scanner |
| Performance | Low-latency mode |
| Even G2 glasses | Sending short lines to your glasses through the Agent Bridge |
| Daily brief | Brief on or off, the hour it is written, folder, time-lapse, how long to keep videos |
| Music reactivity | Audio input, bass cutoff, sensitivity, palette, strength, sync delay |
| Agent permissions | The bridge policy file, enforcing rules, default PC control, per-agent hidden folders and read-only |
| Watchlist | Folders and notes that raise an alert when an agent touches them |
| Agents | Agent names and colours, listener port and key, agent aliases |
| Connect your agents | Ready-made snippets with your port and key filled in |
| Phone alerts | Alert URL (ntfy, Discord or any webhook) and format |
| Web viewer | Viewer port and a link for other devices |

## 3. The brain

### Moving around

- **Drag** to orbit. **Scroll** to zoom. **Right-drag** (or `Shift`+drag) to pan.
- **Double-click** to recenter on the whole brain.
- **Hover** a node to see the note's name and a short preview.
- **Click** a node to open the note. `Ctrl+click` (`Cmd+click`) opens it in a split.

When you leave the brain alone, it slowly turns on its own. Touching it hands control back to you.

### What you are looking at

- **Nodes** are notes. Bigger and brighter nodes have more links.
- **Lines** are links between notes. Faint extra threads connect nearby notes, so the brain reads as a network.
- **Satellites** orbiting outside the brain are your agents, each in its own colour.
- **Agent trails:** when an agent reads a note, a signal travels to it in the agent's colour. A write glows stronger. A search lights up every note it found. The first access after a pause strikes the note with lightning from the agent's satellite.

### Search

Press `/` and type part of a note's name. The brain flies to the best match as you type. The arrow keys move through the results, and `Enter` opens the note.

### Heat & decay (`H`)

Colours each note by how much agents use it. Gold and large means used often and recently. Dim means no agent has touched it, and it hasn't been edited, for 30 to 90 days. A legend explains the scale.

### Meaning map (`S`)

Lays the brain out by topic instead of by links, so notes about similar things sit together even if they don't link to each other. It is computed on your computer from the note text. The original links stay visible as faint threads.

### Replay (`R`)

A bar appears at the bottom. Choose a range (1 hour, 6 hours, 24 hours, 7 days, or **Pick a day** with a date), drag the playhead to any moment, or press play at 1× to 1200× speed. The brain shows agent activity as it happened. The agent menu narrows the replay to one agent, so you can watch everything a single agent did on a given day.

### Vault growth (`G`)

Plays your vault's history: notes appear in the order they were created, so you can watch the brain grow.

### Themes

Click the **palette** button and choose a theme. It changes every open brain view at once, including all monitors while spanning. The Brain Monitor has its own theme menu, so the two can differ.

| Theme | Look |
|---|---|
| **Multiverse** | Glowing glass on black. Close up, every note becomes a slowly turning galaxy. |
| **Inkblot** | Ink on paper. Notes are small oil blobs that wobble and change shape, with a glint and an oil-slick edge. |
| **Violet Dusk** | Lilac notes on a dim blue-grey room. Calm, for late-night work. |
| **Tide Pulse** | Aqua notes on charcoal. Clean and technical, a good everyday choice. |
| **Copper Ember** | Sand-coloured notes on warm brown, with copper sparks. Grounded and earthy. |
| **Aurora Moss** | Lime notes on deep forest green, with pink sparks. Like bioluminescence. |
| **Solar Ink** | Coral and gold on indigo. Bold, for demos. |

The colours you pick under Settings → Look apply to Multiverse; the other themes bring their own.

### Focus mode

Click the **eye in a frame** button, or right-click a folder and choose **Focus the brain on this folder**, to dim everything except one project: the notes in that folder and the notes they link to. Press `Esc` or the button again to leave.

### Who wrote this note

The status bar at the bottom of Obsidian shows how much of the open note agents wrote, and its trust score, for example "🤖 35% agent-written · trust 82". Click it for the breakdown by agent. Hover cards in the brain show the same line. Lines count as an agent's when that agent's recorded edit added them.

### Low-latency mode

For slower computers: Settings → **Performance → Low-latency mode**, or the command **Toggle low-latency mode**. It turns off glow, depth of field, the background haze, sparks, the close-up galaxies and the daily brief's time-lapse, and draws at one pixel per screen pixel.

### Full screen (`F`)

The brain fills the screen it is on. Press `F` or `Esc` to leave.

## 4. Cinematic camera

The cinematic camera flies through the brain on its own, on a path that never repeats. Use it as an opening shot, a screensaver-style display, or just to look around.

Click the **clapperboard** to open its menu:

- **Start flythrough / Stop flythrough.**
- **Start by itself after:** Off, 30 s, 1 min, 2 min, 5 min or 10 min. After that long without you touching the brain, the flythrough starts again. **Off** means it only runs when you start it.
- **Start when the brain opens.**
- **Speed:** 0.3× to 2×.

Close the menu with its **×**, the clapperboard, `Esc`, or a click on the brain. Closing it never stops the flythrough.

`C` starts and stops the flythrough without opening the menu.

**You stay in control.** If you stop the flythrough yourself (button, `C` or command), it stays stopped until you start it again or choose an auto-start time. If you only drag or click the brain, it pauses and comes back after the auto-start time.

## 5. Span across monitors

With more than one monitor, the brain can stretch across them as one picture. The centre monitor keeps the normal view, and the others continue it to the sides, above or below, matching how your monitors are arranged in your operating system's display settings.

Click the **monitor** button to open its menu:

- **Map:** your monitors as they are arranged. Click one to include it or leave it out.
- **List:** a checkbox for each monitor, its size, and a **Center** button. The centre monitor leads the camera and carries the toolbar.
- **Span across N monitors** starts. **Stop spanning** ends it.

While spanning:

- Every chosen monitor shows a full-screen window. The toolbar sits at the bottom middle of the centre monitor and stays visible. Its menus open upward.
- The flythrough, replay and agent trails carry across every monitor.
- `Esc` on any monitor stops spanning. Clicking a note stops spanning and opens the note.
- The normal brain view pauses while spanning, to save your graphics card.

Your monitor choices are saved. If none are chosen, all monitors are used, with your main monitor in the centre.

Monitors with very different pixel densities may not line up exactly at the edges.

## 6. Connecting agents

Agents report what they do to a listener that runs inside Obsidian, on your computer only (`127.0.0.1`, port `27183` by default). Every request needs your key, which keeps other programs out.

The quickest way: **Settings → H!V3MYND → Connect your agents**. Each snippet already contains your port and key; copy it and paste it where it says.

### Claude Code

Copy the hooks snippet and merge it into `~/.claude/settings.json`, then restart Claude Code. It adds three hooks:

| Hook | Sends to | Why |
|---|---|---|
| UserPromptSubmit | `/prompt/claude` | Remembers what Claude was asked, shown as the purpose of what it does next |
| PostToolUse | `/hook/claude` | Every read, write and search lights the brain and is logged |
| PreToolUse | `/prewrite/claude` | Saves a copy of a note before Claude edits it (for diffs and undo) and lets Hivemynd warn Claude about claimed notes and low-trust notes |

### Any other tool

Anything that can make a web request can report activity:

```bash
curl -s -m 1 -H "X-Hivemynd-Key: <your key>" -H "Content-Type: application/json" \
  -d '{"agent":"my-agent","kind":"read","texts":["Projects/Plan.md"]}' \
  http://127.0.0.1:27183/pulse
```

`kind` is `read`, `write` or `scan` (search results). `texts` holds vault paths, or any text that contains them.

Tools with shell hooks can pipe their hook payload straight in:

```bash
curl -s -m 1 -H "X-Hivemynd-Key: $KEY" --data-binary @- http://127.0.0.1:27183/hook/my-agent
```

### Agents on other machines

Use the bridge in the repository's `bridge/` folder. Agents read and write notes through it, and every request lights the brain and lands in the access log. Setup and the full protocol are in `docs/BRIDGE.md` in the repository.

### Names and colours

Agent names are free-form: lowercase letters, digits, `-` and `_`. Set each agent's colour under **Settings → Agents**. If a tool reports under the wrong name, add an alias there, for example `bot2=claude`.

## 7. Brain Monitor

The Brain Monitor is a dashboard of what your agents are doing. Open it from the ribbon, the brain toolbar or the command palette. It normally opens in its own window, so you can put it on another monitor or make it full screen (`F`).

Header buttons: **Theme** (the same themes as the brain, chosen separately), **Panels** (show, hide, lock or reset the layout), open in its own window, and full screen.

### Overview

Panels you can move, resize and hide:

- **System:** CPU, memory and graphics load.
- **Brain vitals:** notes, links, frame rate.
- **Agent status:** each agent's state (active, idle, quiet, not seen) and what it is working on.
- **Alerts:** collisions, claim conflicts, watchlist hits and permission blocks.
- **Context budget:** how many tokens of notes each agent pulled into its context, by day, week, month or year, with heavy reads flagged.
- **Agent activity · last 30 min:** a lane per agent.
- **Hot notes · today:** the notes agents use most.
- **Access log:** every access with filters for agent, action and text.

### Bridge traffic

Messages between agents that go through a bridge, newest first.

### Changes

Every note an agent changed, with a line-by-line diff. **Restore before this change** puts the note back as it was. For a note the agent created, the button reads **Undo (move to trash)**: the note goes to Obsidian's trash, so you can still recover it. A restore is itself a change you can undo.

### Tasks

Agent work grouped by task: what each agent was asked, which notes it read and wrote, and how many tokens it used. **Show in brain** lights the task's notes. **Export as note** writes the task as a note.

### Team

Claims, handoffs, tasks for agents and the daily brief. See [section 8](#8-agent-teamwork).

### Gaps

- **Gap radar · top 5 this week** and **Notes to double-check** (see [section 8](#8-agent-teamwork)).
- **Searches that found nothing:** what agents looked for and didn't find.
- **Read again and again · today:** notes one agent opened three or more times.
- **Suggested links:** notes agents keep using together that don't link to each other, with a **Copy link** button.
- **Unlinked notes agents use** and **Broken links.**

## 8. Agent teamwork

These features help several agents share one vault without getting in each other's way. They need agents connected through hooks or the bridge. The pre-write warnings need a PreToolUse hook (Claude Code's format).

### Claims

When an agent edits a note, it **claims** that note for 20 minutes, and every further edit renews the claim. Agents can also claim notes on purpose before starting work (see `POST /claim` in [section 14](#14-agent-api-reference)).

If another agent tries to edit a claimed note, its pre-write hook gets a short message: who holds the note, what they are working on, until when, and where to get their handoff. What happens next depends on **Settings → Agent teamwork → Claims**:

| Mode | What happens |
|---|---|
| **Warn** (default) | The first attempt is held back with the message. If the agent tries the same edit again, it goes through. |
| **Block** | The edit is held back until the claim ends or you release it. |
| **Off** | No claims. |

Edits you make yourself in Obsidian are never held back.

In the brain, claimed notes wear a pulsing ring in the claiming agent's colour. In the Brain Monitor, **Team → Claims** lists every active claim with a **Release** button.

Which agents hear these messages is set in **Agents that can hear replies** (default: `claude`). Only add agents whose hooks understand Claude Code's reply format.

### Handoffs

When an agent picks up a note that another agent edited in the last six hours, and that other agent has gone quiet for at least ten minutes, Hivemynd records a **handoff**:

- A notice says who picked up whose work.
- A glowing **trail** runs through the first agent's notes in the order it worked on them, in its colour.
- A **handoff pack** is ready: what the first agent was working on, what it changed (with line counts, and a warning if you undid any of it), what it read, notes it still holds, and searches that came up empty.

Find handoffs under **Brain Monitor → Team → Handoffs**: **View pack**, **Copy pack** and **Show trail**. Agents can fetch a pack themselves with `GET /handoff?from=<agent>`.

### Trust scores

Every note gets a trust score from 0 to 100. It starts at 100 and drops when:

- the note hasn't been edited for a long time (from 3 months on);
- agents had to read it over and over this week (it may be unclear or incomplete);
- agent edits to it were undone;
- it is almost empty.

70 and up is fine, 40 to 69 is worth a look, and under 40 is low.

Before an agent edits, Hivemynd checks the notes it read in the last 30 minutes and the note it is about to change. If one has low trust, the agent gets one warning naming the note and the reasons, and retrying goes through. Turn this off with **Trust warnings**.

**Brain Monitor → Gaps → Notes to double-check** lists the least trusted notes agents used this week.

### Gap radar

The gap radar ranks what your vault is missing by how much agent time it cost this week:

- **Missing:** searches that kept coming back empty.
- **Thin:** short notes agents kept opening, and notes agents keep returning to.

The top five are at the top of **Brain Monitor → Gaps**. Thin notes show as faint dashed outlines in the brain. For a missing topic, **Draft starter note** creates a note in your gap folder (default `H!V3MYND/Gaps`) that records what agents were looking for and related notes, ready for you or an agent to fill in. **Make task** turns the gap into a task agents can claim (below). Agents can read the radar with `GET /gaps`.

### Tasks for agents

**Brain Monitor → Team → Tasks for agents** lists work agents can pick up:

- Tasks you make from the gap radar are ready at once.
- An agent can propose a task (`POST /tasks`). It waits for your **Approve**.
- An agent claims an open task (`POST /tasks/claim`), which also claims its note, and marks it done (`POST /tasks/done`) with a short result.

### Live presence

Besides claimed notes, the note each active agent is working on right now wears a ring in that agent's colour, so you can see who is where at a glance. Turn it off with **Live presence rings**.

### Secret scanner

Hivemynd watches for API keys, tokens and private keys in what agents write:

- **Before an edit** (agents with the pre-write hook): the agent is told the edit contains a key or token and asked to write `[REDACTED]` instead. Warn (default) lets a retry through; Block holds it back.
- **After an edit:** with **Mask secrets agents write** on, a key that still lands in a note is replaced with a short masked stub like `sk-a…[masked by H!V3MYND]`. This is recorded in Brain Monitor → Changes, so you can undo it if the value was meant to be there.
- Keys are also masked before Hivemynd stores agent prompts, bridge messages and task details.

Placeholders such as `your-api-key` or `sk-xxxx` are left alone.

### Daily brief

Each morning (06:00 by default), Hivemynd writes a note about the previous day of agent work into `H!V3MYND/Briefs`:

- **In short:** which agents worked, how much, the busiest area, and how many notes changed.
- **A 30-second time-lapse** of the day's activity in the brain, recorded with the cinematic camera running. The brain view must be open for this; otherwise the brief says it was skipped.
- **Busiest areas**, **most used notes**, and **what each agent did**.
- **Teamwork:** handoffs and collisions.
- **Gaps worth filling** and **notes to double-check.**

**Brain Monitor → Team → Write today's brief now** writes one on demand. Settings → **Daily brief** sets the hour, the folder, the time-lapse, and how many days of videos to keep (14 by default; older videos go to Obsidian's trash). Each video is a few megabytes.

If Obsidian was closed at brief time, the brief is written the next time it runs.

## 9. Permissions and safety

Permissions are enforced by the optional bridge, for agents that work through it. Set them in **Settings → H!V3MYND → Agent permissions**:

- **Bridge policy file:** the path of `agent_policies.json` next to your bridge. The plugin writes your rules there, and the bridge reads them.
- **Enforce agent permissions:** with this off, agents work without your rules. The rules stay saved for when you turn it back on.
- **Per agent:** hidden folders (the agent can't see them) and read-only.
- **Default PC control:** for bridges you extend with actions on your computer, choose allow, ask or block. **Ask** pops up an approval window in Obsidian for each action; no answer within 60 seconds counts as no.

`.obsidian/`, `.trash/` and `.git/` are always refused through the bridge, whatever your settings.

Claims and trust warnings (section 8) are coordination aids, not security. Agents that don't use the hooks or the bridge aren't covered by them.

## 10. Watchlist and alerts

**Watchlist:** list folders or notes in **Settings → Watchlist**, one per line, optionally followed by `: read, write, search` to choose what counts. You can also right-click any note or folder and choose **Watch in H!V3MYND**. When an agent touches a watched note, it flashes red in the brain and an alert is raised.

**Collisions:** two agents editing the same note within ten minutes, or one agent editing a note another agent just read, raise an alert.

**Phone alerts** (off by default): enter an ntfy topic URL, a Discord webhook URL, or any URL that accepts a JSON POST. Alerts send one line about what happened, never note contents. Use a hard-to-guess ntfy topic, because anyone who knows a topic can read it. **Test** sends a sample alert.

## 11. Reports, logs and context packs

- **Access log:** every agent access is stored in the plugin's folder, one file per day, outside your notes.
- **Daily digest note** (optional): a readable list of the day's accesses in your digest folder (default `Access Log`).
- **Daily brain report** (optional): a summary note per day in `Access Log/Reports`.
- **Daily brief:** see section 8.
- **Store agent prompts:** on by default. Stores the first line of what each agent was asked, shown as the purpose of its work. Turn it off to keep only which notes were touched.
- **Context packs:** an agent can ask `GET /context-pack?q=<task>&budget=<tokens>` for the notes most relevant to a task, trimmed to fit its token budget. Each agent's hidden folders are left out.

## 12. Music reactivity

Off by default. Turn it on with the music button or `M`. The brain swells on bass and kick drums, and mids and highs fire coloured signals along the links.

A small panel on the brain has sliders for bass, mids and highs, a kick-sensitivity slider and an audio-source picker. **Find sound** listens to every source and picks the one that is playing. In Settings you can change the bass cutoff, sensitivity, palette, strength, and a sync delay for Bluetooth headphones.

Audio is analysed on your computer. Nothing is recorded or sent.

## 13. Web viewer and Even G2 glasses

### Web viewer

Off by default. It serves a read-only view of the brain to other devices, such as a tablet or a TV: note names and links, never note contents, with live agent activity. Turn it on in **Settings → Web viewer**, then open the **Viewer link** on the other device. Reaching it from other devices on your network is a separate opt-in.

### Even G2 glasses

Hivemynd can put short lines on Even Realities G2 glasses: the daily brief's summary and approval requests from agents.

- **Any glasses app** can read the current lines from `GET /hud`: which agent is on which note, claims, and tasks waiting for approval.
- **Through the Agent Bridge:** turn on **Settings → Even G2 glasses → Send to glasses**, and set the bridge address, the bridge's token file, and the sender and glasses agent names. The sender's token is read from the token file each time a line is sent and is never stored in Hivemynd. **Test** sends a sample line.

It is off by default, so nothing piles up before your glasses are connected.

## 14. Agent API reference

Base address: `http://127.0.0.1:27183`. Every request needs the header `X-Hivemynd-Key: <key>`. The key is in Settings and in `~/.hivemynd/listener.key`. Requests from web pages (with an `Origin` header) are refused.

### Activity

| Method and path | Body | Effect |
|---|---|---|
| `POST /pulse` | `{"agent","kind","texts","purpose?"}` | Lights notes and logs the access |
| `POST /hook/<agent>` | a tool-hook payload | Parsed for note paths |
| `POST /prompt/<agent>` | a prompt payload | Remembers the agent's current task |
| `POST /prewrite/<agent>` | a PreToolUse payload | Saves a copy of the note for undo; may reply with a claim or trust warning |
| `GET /context-pack?q=&budget=&agent=` | | Relevant notes within a token budget |
| `GET /health` | | `{"ok", "notes", "version"}` |

### Teamwork

| Method and path | Body | Answer |
|---|---|---|
| `GET /claims` | | All active claims |
| `POST /claim` | `{"agent","path" or "paths","purpose?","minutes?"}` | `{"ok","claimed","conflicts"}`; each conflict names the holder and its handoff link |
| `POST /release` | `{"agent","paths?"}` | Releases that agent's claims (all, or the listed notes) |
| `GET /check?agent=&path=` | | Whether another agent holds the note, and the note's trust score |
| `GET /trust?path=` | | The trust score and its reasons |
| `GET /handoff?from=&to=&task=` | | The handoff pack as Markdown |
| `GET /handoffs` | | Recent handoffs |
| `GET /gaps` | | The gap radar and least trusted notes |
| `POST /brief/now` | `{"day?":"YYYY-MM-DD","timelapse?":true}` | Writes a daily brief and returns its path |
| `GET /tasks` | | Tasks for agents (proposed, open, claimed, and done today) |
| `POST /tasks` | `{"agent","title","detail?","path?"}` | Proposes a task; it waits for your approval |
| `POST /tasks/claim` | `{"agent","id"}` | Claims an open task (and its note) |
| `POST /tasks/done` | `{"agent","id","result?"}` | Marks a task done |
| `POST /tasks/withdraw` | `{"agent","id"}` | Takes back a task the agent proposed, while it still waits for approval |
| `GET /authorship?path=` | | How many of the note's lines agents wrote, by agent |

### Heads-up display

| Method and path | Body | Answer |
|---|---|---|
| `GET /hud` | | `{"lines"}`: short status lines for glasses or other small screens |

### Monitors and approvals

| Method and path | Body | Effect |
|---|---|---|
| `POST /span/on`, `POST /span/off` | | Start or stop spanning the brain across your chosen monitors |
| `POST /approve` | `{"agent","action","detail"}` | Asks you to approve an action; `{"approved": true\|false}` |
| `POST /policy-block` | `{"agent","action","detail"}` | Shows a "blocked by permissions" alert |

## 15. Files, network and privacy

### What Hivemynd stores

| Where | What |
|---|---|
| `.obsidian/plugins/hivemynd/` | Settings, the access log, change copies for undo, claims, handoffs, saved layouts |
| `H!V3MYND/Briefs/` | Daily briefs and time-lapse videos (if the brief is on) |
| `H!V3MYND/Gaps/` | Starter notes you create from the gap radar |
| `Access Log/` | Digest notes and brain reports (only if you turn them on) |
| `~/.hivemynd/listener.key` | The listener key, readable only by you |
| Obsidian's SecretStorage | Listener key, viewer key and alert URL |

If you sync your vault's `.obsidian` folder, the access log syncs with it.

### Network

- The listener answers only on `127.0.0.1` (this computer) and needs your key.
- Phone alerts send a one-line alert to the URL you set, only if you turn them on.
- The web viewer serves note names and links, only if you turn it on.
- No telemetry, no analytics, no accounts.

## 16. Troubleshooting

**The brain is black or says it needs WebGL 2.** Update your graphics driver, and check that hardware acceleration is on in Obsidian (Settings → Appearance → Advanced).

**Agents don't light up the brain.**
- Check the agent uses the right port and key. Copy the snippet again from **Connect your agents**.
- Run `curl -H "X-Hivemynd-Key: <key>" http://127.0.0.1:27183/health`. It should answer with your note count.
- If Obsidian shows "agent listener couldn't start", another program uses the port. Pick another port in Settings and copy the snippets again.

**An agent shows under the wrong name.** Add an alias in Settings → Agents, for example `bot2=claude`.

**Undo isn't offered for a change.** Undo needs the copy taken just before the edit. Agents need the PreToolUse hook (Claude Code) or must go through the bridge.

**Claim or trust warnings don't reach an agent.** Check the agent's name is listed under **Agents that can hear replies**, and that its PreToolUse hook sends to `/prewrite/<agent>`.

**The daily brief says the time-lapse was skipped.** The brain view must be open and visible when the brief is written. Click **Write today's brief now** with the brain open, or leave the brain open overnight.

**Spanning monitors doesn't line up.** Check the monitor arrangement in your operating system's display settings. Hivemynd follows it exactly. Monitors with different scaling may show small offsets at the edges.

**The cinematic camera keeps starting.** Open the clapperboard menu and set **Start by itself after** to **Off**.

**The brain is slow or the fan spins up.** Turn on **Low-latency mode** (Settings → Performance).

**A key I meant to keep was masked.** Open Brain Monitor → Changes, find the "Masked … secret" entry and restore it. To stop masking, turn off **Mask secrets agents write**.

**Something else.** Open an issue on the GitHub repository with what you did, what you expected, and what happened. Please leave out your keys and note contents.

---

H!V3MYND is free and open source under the Apache License 2.0. Made by J Tansill.
