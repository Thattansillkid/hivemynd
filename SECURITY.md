# Security

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository ("Security" tab → "Report a vulnerability"). Don't open a public issue. You'll get an answer within 7 days. Fixes for confirmed issues ship as a new release with a note in the changelog.

## What H!V3MYND trusts and what it doesn't

**Assets:** your notes, the listener key, the access log (which agent touched which note, and optionally what it was asked).

**Trust boundaries:**

1. **Local listener (`127.0.0.1:27183`).** Bound to this computer only. Every request needs the key (`X-Hivemynd-Key`), compared in constant time. Any request carrying an `Origin` header (that is, from a web page) is refused, so a website can't drive it from your browser. Tooling endpoints only answer in Developer mode.
2. **Agents.** Treat every agent as able to be manipulated: a prompt-injected agent will do what the injected text says. A leaked agent credential grants exactly that agent's powers. Keep agents on the least access that works.
3. **Bridge (optional, `bridge/`).** Vault-only routes. It never runs commands, opens apps or reads files outside the vault. `.obsidian/`, `.trash/` and `.git/` are always refused (plugin code lives in `.obsidian`). Tokens are random, shown once, and stored only as SHA-256 hashes. Binds `127.0.0.1` by default.
4. **Web viewer (off by default).** Its own key, separate from the listener key; read-only; no note contents; single-use tickets for the live stream; strict Content-Security-Policy; local-network access is a second opt-in.
5. **Phone alerts (off by default).** Only the alert line is sent, never note contents. Optionally hide note names too.

## Safe defaults

- No network use, telemetry or accounts by default.
- The reference bridge has no PC actions at all. If you build a bridge that adds them, the plugin's permission model defaults them to **Ask** (a person approves; unanswered = denied after 60 s).
- Secrets (listener key, viewer key, alert URL) live in Obsidian SecretStorage.
- No `innerHTML` with untrusted content; agent-supplied text is rendered as text.

## If a key or token leaks

- **Listener key:** Settings → H!V3MYND → Listener key → Regenerate, then update your hook configs.
- **Web viewer key:** Settings → Web viewer → New key (open viewers disconnect).
- **Bridge token:** `python bridge.py remove-agent <name>`, then `add-agent` to issue a new one.

## Exposing the bridge beyond this computer

Don't put it directly on the internet. Use a private network (Tailscale, WireGuard) or a tunnel with an authentication layer in front (for example ngrok with OAuth or an IP allowlist). See [docs/BRIDGE.md](docs/BRIDGE.md).
