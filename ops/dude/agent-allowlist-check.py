#!/usr/bin/env python3
"""
agent-allowlist-check.py — Fail-closed agent allowlist validator

Usage:
    python3 agent-allowlist-check.py <builder_name> <agent_id>

Exit codes:
    0  — agent is allowed
    1  — agent is REFUSED (not in allowlist)
    2  — config error (file missing, parse error) — fail-closed

Output on refusal includes AGENT_ROUTE_REFUSED marker for grep.

Allowlist resolution order:
    1. AGENT_ALLOWLIST_FILE env var (explicit override)
    2. /root/bin/agent-allowlist.json (runtime install path)
    3. <script_dir>/../dude/agent-allowlist.json (repo-relative fallback)
    If none found → fail-closed (exit 2).
"""
import json
import sys
import os

def resolve_allowlist_path():
    """Resolve allowlist file with fail-closed fallback chain."""
    # 1. Explicit env var — if set, this is the ONLY path (no fallback)
    env_path = os.environ.get("AGENT_ALLOWLIST_FILE")
    if env_path:
        return env_path if os.path.isfile(env_path) else None

    # 2. Runtime install path
    runtime_path = "/root/bin/agent-allowlist.json"
    if os.path.isfile(runtime_path):
        return runtime_path

    # 3. Repo-relative fallback (for development/testing)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_path = os.path.join(script_dir, "agent-allowlist.json")
    if os.path.isfile(repo_path):
        return repo_path

    return None

def main():
    if len(sys.argv) != 3:
        print("Usage: agent-allowlist-check.py <builder_name> <agent_id>", file=sys.stderr)
        sys.exit(2)

    builder_name = sys.argv[1]
    agent_id = sys.argv[2]

    allowlist_file = resolve_allowlist_path()

    # Fail-closed: missing file = refuse
    if allowlist_file is None:
        print("AGENT_ROUTE_REFUSED: no allowlist file found (checked env, /root/bin, repo) — fail-closed", file=sys.stderr)
        sys.exit(2)

    try:
        with open(allowlist_file) as f:
            cfg = json.load(f)
    except Exception as e:
        print(f"AGENT_ROUTE_REFUSED: allowlist parse error ({e}) — fail-closed", file=sys.stderr)
        sys.exit(2)

    builder = cfg.get(builder_name)
    if builder is None:
        print(f"AGENT_ROUTE_REFUSED: unknown builder '{builder_name}' — fail-closed", file=sys.stderr)
        sys.exit(1)

    agents = builder.get("agents", [])
    if agent_id in agents:
        # Allowed
        print(f"AGENT_ALLOWED: {agent_id} on {builder_name}")
        sys.exit(0)
    else:
        allowed_list = ", ".join(agents)
        print(f"AGENT_ROUTE_REFUSED: agent '{agent_id}' not in allowlist for {builder_name}", file=sys.stderr)
        print(f"Allowed agents: {allowed_list}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
