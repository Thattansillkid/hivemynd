# Security

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository ("Security" tab → "Report a vulnerability"). Don't open a public issue. You'll get an answer within 7 days. Fixes for confirmed issues ship as a new release with a note in the changelog.

## What H!V3MYND trusts and what it doesn't

**Assets:** your notes, the listener keys, the access log (which agent touched which note, and optionally what it was asked), change history (note text before and after agent writes) and bridge messages.

**Out of scope:** code already running as your user account. H!V3MYND runs inside Obsidian with your user's file-system rights (Obsidian plugins have no OS sandbox), and any program running as you can read its files and SecretStorage. The protections below are against web pages, other users, leaked or over-shared keys, and misbehaving or manipulated agents.

**Trust boundaries:**

1. **Local listener (`127.0.0.1:27183`).** Bound to this computer only. Every request needs a key in the `X-Hivemynd-Key` header, compared in constant time. Keys in the URL (`?key=`) are not accepted, because URLs end up in logs. Any request carrying an `Origin` header (that is, from a web page) is refused. Malformed requests get `400` and can't stop the listener.
2. **Keys.** Each key has a scope and, for agent keys, belongs to one agent:

   | Scope | Can | Used by |
   |---|---|---|
   | Observer | Report activity (`/pulse`, `/hook/<own agent>`, `/prompt/<own agent>`), liveness | Telemetry senders that should see nothing |
   | Agent | Observer + pre-write checks, context packs, tasks, claims, handoffs, trust, gaps, daily brief, spanning | One agent's hooks (Claude Code, Grok, …) |
   | Bridge | Agent + naming the agent per request, approvals, policy blocks, bridge messages | The Agent Bridge, which authenticates its own agents |
   | Admin | Everything, including Developer mode tooling | Development only |

   The agent a request acts as comes from its key. An agent key that names a different agent (`/hook/<other>`, `?agent=`, `"agent"` in the body) is refused with `403`, and events sent with it are always recorded as its own agent. An agent without its own permission rule gets the union of every agent's hidden folders, never an empty list. Notes in an agent's hidden folders are also left out of every team answer that key gets (claims, handoffs and handoff packs, tasks, gaps, trust, authorship, the HUD), and a hidden note answers like one that doesn't exist. Only Bridge and Admin keys may send a note's previous text with a write event (used for undo); from other keys it is dropped.
3. **Agents.** Treat every agent as able to be manipulated: a prompt-injected agent will do what the injected text says. A leaked key grants exactly that key's scope. Give each agent its own key.
4. **Bridge (optional, `bridge/`).** Vault-only routes. It never runs commands, opens apps or reads files outside the vault. `.obsidian/`, `.trash/` and `.git/` are always refused (plugin code lives in `.obsidian`). Tokens are random, shown once, and stored only as SHA-256 hashes. Binds `127.0.0.1` by default. Its H!V3MYND key has Bridge scope, so the bridge is trusted to name its agents correctly.
5. **Web viewer (off by default).** Its own key, separate from the listener keys; read-only; no note contents; single-use tickets for the live stream; strict Content-Security-Policy; local-network access is a second opt-in. Over the local network it is plain HTTP: only turn that on for a network you trust.
6. **Phone alerts and glasses (off by default).** Only the alert line is sent, never note contents. Optionally hide note names too.

## Paths in agent events

Paths named in hook payloads and pulses are reports, not trusted input. Before H!V3MYND snapshots or reads a note named in one, the path must be a plain vault-relative Markdown path (no `..`, absolute paths only inside the vault, no drive-relative, UNC or device paths, no NTFS streams, not the configuration folder), and the real file, with links, junctions and Windows short names (such as `OBSIDI~1`) resolved, must be inside the vault and outside its configuration folder. Restore applies the same check. Anything else is treated as a new note and nothing is read. A folder linked into the vault from elsewhere is therefore not captured in change history.

## What is advisory, not enforced

- **Event labels.** Which agent read or wrote a note, and the read/write/search kind, are what that agent's key reported. With per-agent keys the agent name is authenticated; the activity itself is the client's claim, not an independent observation.
- **Pre-write replies.** Claims, the secret scanner and trust warnings answer an agent's pre-write hook. The write is only held back if the agent's hook system honours the reply (Claude Code does, for agents listed in "Agents that can hear replies"). When a check fails, H!V3MYND holds the write back if "If a pre-write check fails" is Hold back (or Automatic with claims or secret scanning set to Block); otherwise it is let through with the header `X-Hivemynd-Check: failed`.
- **Trust scores, context packs, handoffs and briefs** are aids for agents. They don't approve documentation, verify that anything works, or replace your own review.

## What is stored, and where

Everything lives in the plugin folder (`.obsidian/plugins/hivemynd/`) unless noted.

| Data | Contents | Control |
|---|---|---|
| Change history (`changes/`) | Before/after of agent writes | **Redacted** by default (keys and tokens masked before saving; undo restores the masked text). **Raw** keeps exact text including secrets. **Metadata** keeps who/when/which note/line counts only. Deleted after the retention period (default 30 days). |
| Bridge messages (`bridge/`) | Messages relayed by the bridge, secrets masked | Full or metadata only; same retention (no message is dated before 2000, so none escapes it) |
| Access log | Which agent touched which note; optionally what it was asked | "Store agent prompts" off keeps no prompts anywhere (access log, change history, claims) and deletes remembered ones |
| Remembered prompts (`purposes.json`) | Latest prompt per agent, for a short time | As above |
| SecretStorage | Listener keys, viewer key, alert URL | Never in `data.json` |
| `~/.hivemynd/vaults/<vault>-<id>/` | Bridge keys, one file per key | Owner-only: mode 0600; on Windows inherited permissions are removed and only your account is granted access |
| `~/.hivemynd/listener.key` | The 1.1 shared key | Only while the shared key is still accepted; removed when you retire it |

"Delete stored history" in settings removes change history, bridge messages and remembered prompts. Masking a secret an agent wrote keeps the unmasked text as an undo point only when change history is Raw.

## Limits

Request bodies are capped per route (20 KB to 1 MB), at most 500 events or 100 bridge messages per request, 50 requests a second per key with bursts of 300 (`429`), and 24 requests in progress plus 5 pending approvals (`503`). Bridge messages are acknowledged (`204`) only after they are on disk; a failed write answers `500` and can be retried with the same id. Failed history writes are reported to you and counted in `/health`.

## Release builds

Releases are built from a tag by GitHub Actions in two jobs. The build job installs dependencies, runs the audit and tests, and builds with a read-only token; the publish job runs no dependency code and only attests (build provenance) and releases the files the build job produced. Verify a download with `gh attestation verify main.js --repo Thattansillkid/hivemynd`.

## Safe defaults

- No network use, telemetry or accounts by default.
- Fresh installs get one key per agent; the 1.1 shared key is only kept working for upgrades until you retire it.
- The reference bridge has no PC actions at all. If you build a bridge that adds them, the plugin's permission model defaults them to **Ask** (a person approves; unanswered = denied after 60 s).
- No `innerHTML` with untrusted content; agent-supplied text is rendered as text.
- External programs (`nvidia-smi`, `icacls`) are run by full path, never looked up on `PATH`.

## If a key or token leaks

- **Agent, bridge or admin key:** Settings → H!V3MYND → Agent keys → regenerate (↻) or revoke (🗑) that key, then update whatever used it.
- **Shared 1.1 key:** Settings → H!V3MYND → Agent keys → Retire shared key.
- **Web viewer key:** Settings → Web viewer → New key (open viewers disconnect).
- **Bridge token:** `python bridge.py remove-agent <name>`, then `add-agent` to issue a new one.

## Exposing the bridge beyond this computer

Don't put it directly on the internet. Use a private network (Tailscale, WireGuard) or a tunnel with an authentication layer in front (for example ngrok with OAuth or an IP allowlist). See [docs/BRIDGE.md](docs/BRIDGE.md).
