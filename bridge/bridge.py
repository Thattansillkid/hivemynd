"""H!V3MYND reference bridge.

A small HTTP server that lets agents on other machines (or in other sandboxes) read and
write notes in one Obsidian vault, with per-agent tokens and permissions, and lights up
the H!V3MYND brain as they work. It deliberately does NOT run commands, open apps, take
screenshots or touch files outside the vault.

    python bridge.py init --vault "/path/to/vault"     # once: writes config.json
    python bridge.py add-agent my-agent                  # prints that agent's token once
    python bridge.py serve                               # 127.0.0.1:8788 by default

See BRIDGE.md for the protocol and for exposing it beyond this computer safely.
Licensed under the Apache License, Version 2.0.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import urllib.request
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
CONFIG = Path(os.environ.get("HIVEMYND_BRIDGE_CONFIG", HERE / "config.json"))
# The H!V3MYND listener key. Since plugin 1.2 each vault saves a Bridge key under
# ~/.hivemynd/vaults/<vault>/ (its path is shown in the plugin settings); point
# HIVEMYND_KEY_FILE or "plugin_key_file" in config.json at it. The 1.1 shared file
# below is only a fallback while the shared key is still accepted.
LEGACY_KEY_FILE = Path.home() / ".hivemynd" / "listener.key"
MAX_BYTES = 5 * 1024 * 1024
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
PROTECTED = (".obsidian", ".trash", ".git")  # plugin code and settings, deleted notes, history


# --------------------------------------------------------------------------- config

def load_config() -> dict:
    if not CONFIG.exists():
        raise SystemExit(f"No {CONFIG.name}. Run: python bridge.py init --vault <path>")
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def save_config(cfg: dict) -> None:
    CONFIG.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    try:
        os.chmod(CONFIG, 0o600)
    except OSError:
        pass


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- plugin link

def plugin_key_file() -> Path:
    env = os.environ.get("HIVEMYND_KEY_FILE")
    if env:
        return Path(env)
    configured = load_config().get("plugin_key_file")
    return Path(configured) if configured else LEGACY_KEY_FILE


def plugin_key() -> str:
    try:
        return plugin_key_file().read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def to_plugin(route: str, data: dict | None = None, method: str = "POST", timeout: float = 1.5) -> dict | None:
    """Talks to the H!V3MYND listener on this computer. Visual only; never required."""
    cfg = load_config()
    url = cfg.get("plugin_url", "http://127.0.0.1:27183") + route
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json", "X-Hivemynd-Key": plugin_key()})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except Exception:
        return None


def pulse(agent: str, kind: str, paths: list[str], purpose: str = "", before: str | None = None, missing: bool = False) -> None:
    data = {"agent": agent, "kind": kind, "texts": paths[:200], "purpose": purpose[:300], "source": "bridge"}
    if kind == "write":
        data["before"] = None if missing else before
    threading.Thread(target=to_plugin, args=("/pulse", data), daemon=True).start()


# --------------------------------------------------------------------------- policies

def policy(agent: str) -> dict:
    """Per-agent rules written by the plugin (Settings → Agent permissions)."""
    path = load_config().get("policy_file")
    if not path:
        return {}
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if data.get("enforce") is False:
        return {}
    return (data.get("agents") or {}).get(agent) or {}


def check(agent: str, rel: str, write: bool) -> None:
    first = rel.split("/", 1)[0].lower() if rel else ""
    if first in PROTECTED:
        refuse(agent, "protected path", rel)
    p = policy(agent)
    low = rel.lower()
    for d in p.get("deny") or []:
        d = str(d).replace("\\", "/").strip("/").lower()
        if d and (low == d or low.startswith(d + "/")):
            refuse(agent, "hidden folder", rel)
    if write and p.get("readOnly"):
        refuse(agent, "read-only", rel)


def refuse(agent: str, why: str, rel: str) -> None:
    threading.Thread(target=to_plugin, args=("/policy-block", {"agent": agent, "action": why, "detail": rel}), daemon=True).start()
    raise HTTPException(403, f"not allowed: {why}")


# --------------------------------------------------------------------------- paths

def vault_root() -> Path:
    return Path(load_config()["vault"]).resolve()


def resolve(raw: str) -> tuple[Path, str]:
    """Vault-relative path in, (absolute path, normalized relative path) out. Rejects escapes."""
    if "\x00" in raw:
        raise HTTPException(400, "bad path")
    rel = raw.replace("\\", "/").strip().strip("/")
    if re.match(r"^[A-Za-z]:", rel) or any(part in ("..",) for part in rel.split("/")):
        raise HTTPException(400, "path must stay inside the vault")
    root = vault_root()
    target = (root / rel).resolve() if rel else root
    if target != root and root not in target.parents:
        raise HTTPException(403, "path escapes the vault")  # also catches symlinks pointing out
    return target, target.relative_to(root).as_posix() if target != root else ""


# --------------------------------------------------------------------------- app

app = FastAPI(title="H!V3MYND bridge", version="1.0.0", docs_url=None, redoc_url=None)


def agent_from(authorization: str | None = Header(None), x_bridge_token: str | None = Header(None)) -> str:
    token = (x_bridge_token or (authorization or "").removeprefix("Bearer ").strip()).strip()
    if not token:
        raise HTTPException(401, "missing token (header X-Bridge-Token or Authorization: Bearer)")
    h = token_hash(token)
    for name, stored in (load_config().get("agents") or {}).items():
        if hmac.compare_digest(stored, h):
            return name
    raise HTTPException(401, "unknown token")


class Write(BaseModel):
    path: str = Field(min_length=1, max_length=1000)
    content: str
    purpose: str = Field(default="", max_length=300)


class Folder(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


@app.get("/health")
def health():
    return {"ok": True, "service": "hivemynd-bridge", "version": "1.0.0"}


@app.get("/vault/list")
def vault_list(path: str = Query(""), purpose: str = Query("", max_length=300), agent: str = Depends(agent_from)):
    target, rel = resolve(path)
    check(agent, rel, False)
    if not target.is_dir():
        raise HTTPException(404, "not a folder")
    out = []
    for child in sorted(target.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
        crel = f"{rel}/{child.name}" if rel else child.name
        try:
            check(agent, crel, False)
        except HTTPException:
            continue  # hidden from this agent: don't list it either
        out.append({"name": child.name, "path": crel, "type": "folder" if child.is_dir() else "file"})
    pulse(agent, "scan", [e["path"] for e in out if e["path"].endswith(".md")], purpose)
    return {"path": rel, "entries": out}


@app.get("/vault/file")
def vault_read(path: str, purpose: str = Query("", max_length=300), agent: str = Depends(agent_from)):
    target, rel = resolve(path)
    check(agent, rel, False)
    if not target.is_file():
        raise HTTPException(404, "not found")
    if target.stat().st_size > MAX_BYTES:
        raise HTTPException(413, "file too large")
    try:
        text = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(415, "not a text file")
    pulse(agent, "read", [rel], purpose)
    return {"path": rel, "content": text}


@app.put("/vault/file")
def vault_write(body: Write, agent: str = Depends(agent_from)):
    target, rel = resolve(body.path)
    check(agent, rel, True)
    data = body.content.encode("utf-8")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "content too large")
    existed = target.exists()
    before = target.read_text(encoding="utf-8", errors="replace") if existed and target.suffix == ".md" else None
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    pulse(agent, "write", [rel], body.purpose, before, missing=not existed)
    return {"ok": True, "path": rel, "created": not existed}


@app.post("/vault/folder")
def vault_folder(body: Folder, agent: str = Depends(agent_from)):
    target, rel = resolve(body.path)
    check(agent, rel, True)
    target.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": rel}


@app.get("/vault/context-pack")
def context_pack(q: str = Query(..., min_length=2, max_length=300), budget: int = Query(6000, ge=500, le=50000), agent: str = Depends(agent_from)):
    """The notes most relevant to a task within a token budget (ranked by the plugin)."""
    from urllib.parse import urlencode
    pack = to_plugin("/context-pack?" + urlencode({"q": q, "budget": budget, "agent": agent}), method="GET", timeout=20)
    if pack is None:
        raise HTTPException(503, "Obsidian with H!V3MYND is not running")
    kept = []
    for n in pack.get("notes") or []:
        try:
            check(agent, str(n.get("path", "")), False)
            kept.append(n)
        except HTTPException:
            pass
    pack["notes"] = kept
    pack["tokens"] = sum(int(n.get("tokens") or 0) for n in kept)
    return pack


# --------------------------------------------------------------------------- CLI

def main() -> None:
    ap = argparse.ArgumentParser(description="H!V3MYND reference bridge")
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init", help="create config.json")
    i.add_argument("--vault", required=True)
    i.add_argument("--policy-file", default="", help="agent_policies.json written by the plugin (optional)")
    i.add_argument("--key-file", default="", help="the Bridge key file shown in the plugin settings (optional)")
    a = sub.add_parser("add-agent", help="create an agent and print its token")
    a.add_argument("name")
    r = sub.add_parser("remove-agent", help="revoke an agent's token")
    r.add_argument("name")
    s = sub.add_parser("serve", help="run the bridge")
    s.add_argument("--host", default="127.0.0.1", help="keep 127.0.0.1 unless you know why (see BRIDGE.md)")
    s.add_argument("--port", type=int, default=8788)
    args = ap.parse_args()

    if args.cmd == "init":
        vault = Path(args.vault).expanduser().resolve()
        if not (vault / ".obsidian").is_dir():
            raise SystemExit(f"{vault} doesn't look like an Obsidian vault (no .obsidian folder)")
        save_config({"vault": str(vault), "policy_file": args.policy_file, "plugin_key_file": args.key_file,
                     "plugin_url": "http://127.0.0.1:27183", "agents": {}})
        print(f"Wrote {CONFIG}. Next: python bridge.py add-agent <name>")
    elif args.cmd == "add-agent":
        if not NAME_RE.match(args.name):
            raise SystemExit("agent names: lowercase letters, digits, - and _ (max 40)")
        cfg = load_config()
        token = secrets.token_urlsafe(32)
        cfg.setdefault("agents", {})[args.name] = token_hash(token)
        save_config(cfg)
        print(f"Token for {args.name} (shown once; only its hash is stored):\n{token}")
    elif args.cmd == "remove-agent":
        cfg = load_config()
        if cfg.get("agents", {}).pop(args.name, None) is None:
            raise SystemExit(f"no agent named {args.name}")
        save_config(cfg)
        print(f"Removed {args.name}; its token no longer works.")
    elif args.cmd == "serve":
        import uvicorn
        load_config()
        uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
