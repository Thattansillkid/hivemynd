# Connecting agents: protocol and bridge walkthrough

H!V3MYND learns what agents do in two ways:

1. **Directly** (same computer): the agent's tool hooks POST to the plugin's local listener.
2. **Through the bridge** (other machines, sandboxes, hosted agents): the agent reads and writes notes through `bridge/bridge.py`, which tells the plugin what happened.

## 1. The local listener

`http://127.0.0.1:27183` (port configurable). Every request needs the header `X-Hivemynd-Key: <key>`. The key is in Settings → H!V3MYND → Listener key, and in `~/.hivemynd/listener.key`. Requests with an `Origin` header are refused.

| Method and path | Body | Effect |
|---|---|---|
| `POST /pulse` | `{"agent","kind","texts","purpose?","source?"}` | Lights notes and logs the access. `kind` is `read`, `write` or `scan` (search results). `texts` is a list of vault paths, or any strings containing them. |
| `POST /hook/<agent>` | a raw tool-hook payload (Claude Code PostToolUse format, or similar) | Parsed for note paths per tool type. |
| `POST /prompt/<agent>` | a UserPromptSubmit-style payload | Remembers what the agent was asked, shown as the purpose of its next accesses. |
| `POST /prewrite/<agent>` | a PreToolUse-style payload | Snapshots a note before an agent edits it, so the change can be diffed and undone in the Brain Monitor. |
| `GET /context-pack?q=&budget=&agent=` | | The notes most relevant to `q`, trimmed to `budget` tokens, as JSON. That agent's hidden folders are excluded. |
| `POST /approve` | `{"agent","action","detail"}` | Asks the person at the computer to approve an action; answers `{"approved": true\|false}` (60 s timeout = false). Used by the bridge. |
| `POST /policy-block` | `{"agent","action","detail"}` | Shows a red "blocked by permissions" alert. Used by the bridge. |
| `GET /health` | | `{"ok", "notes", "version"}` |

Agent names are free-form (lowercase letters, digits, `-` and `_`). Give each a colour in settings.

### Claude Code

Settings → H!V3MYND → Connect your agents → Copy hooks, then merge into `~/.claude/settings.json`. It adds three `http` hooks: UserPromptSubmit to `/prompt/claude`, PostToolUse to `/hook/claude`, and PreToolUse to `/prewrite/claude`.

### Any agent with shell hooks

Pipe the hook's JSON payload to the listener:

```bash
curl -s -m 1 -H "X-Hivemynd-Key: $KEY" --data-binary @- http://127.0.0.1:27183/hook/my-agent
```

## 2. The bridge (agents elsewhere)

```bash
cd bridge
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python bridge.py init --vault "/path/to/your/vault"
python bridge.py add-agent my-agent               # prints the token once
python bridge.py serve                            # 127.0.0.1:8788
```

The agent sends `X-Bridge-Token: <token>` (or `Authorization: Bearer <token>`) with every request:

| Method and path | Purpose |
|---|---|
| `GET /vault/list?path=` | List a folder (hidden folders are left out) |
| `GET /vault/file?path=` | Read a text file |
| `PUT /vault/file` | `{"path","content","purpose?"}` writes a file |
| `POST /vault/folder` | `{"path"}` creates a folder |
| `GET /vault/context-pack?q=&budget=` | Notes for a task, within a budget |
| `GET /health` | Liveness |

Every request lights the brain and lands in the access log under that agent's name.

**Permissions:** in Settings → H!V3MYND → Agent permissions, set the bridge policy file path to a file the bridge can read. Then pass the same path to `init --policy-file`. Per-agent hidden folders and read-only take effect immediately. `.obsidian/`, `.trash/` and `.git/` are always refused.

### Reaching the bridge from other machines

The bridge binds `127.0.0.1`. To reach it from elsewhere, keep it there and put a protected path in front:

- **Private network (recommended):** Tailscale or WireGuard. Then `serve --host <your tailnet IP>`, or proxy to `127.0.0.1:8788`.
- **Public tunnel:** only with authentication in front (for example, ngrok with OAuth or an IP allowlist). Never expose it without that, even though it has tokens.

Treat agent tokens like passwords. A leaked token lets someone read and write your vault as that agent.
