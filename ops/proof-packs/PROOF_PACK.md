# PROOF_PACK.md — GitHub Control Plane + Stability Triage
## Timestamp: 2026-02-11T00:00Z
## Scope: Dashboard VPS (<DASHBOARD_VPS_IPV4>) + Builder VPS (<BUILDER_VPS_IPV4>)

---

## Safety Compliance

| Check | Result |
|---|---|
| Production configs modified | ZERO |
| Services restarted | ZERO |
| Secrets printed to stdout | ZERO |
| Firewall rules changed | ZERO |
| Packages upgraded | ZERO |
| Files modified on VPS (outside proof dir) | ZERO |
| Destructive commands executed | ZERO |

---

## Commands Executed

### Phase 0: Confirm Inputs (4 commands)

| # | Host | Command | Result |
|---|---|---|---|
| 1 | Dashboard | `ls -la <PATH_REDACTED>/` | 16 files present |
| 2 | Dashboard | `head -40 DASHBOARD_ORG_SNAPSHOT.md` | Valid, no secrets |
| 3 | Builder (via internal network) | `ls -la <PATH_REDACTED>/` | 13 files present |
| 4 | Dashboard | `mkdir -p <PATH_REDACTED>/` | Created |

### Phase 1: Crash Loop Triage (10 commands)

| # | Host | Command | Key Output |
|---|---|---|---|
| 5 | Dashboard | `pm2 describe youtube-intelligence` | 138,551 restarts, uptime 0s |
| 6 | Dashboard | `pm2 logs youtube-intelligence --lines 100 --nostream` | "No key or keyFile set" (Google Sheets) |
| 7 | Dashboard | `pm2 describe ai-sdr-backend` | 22,216 restarts, status: stopped |
| 8 | Dashboard | `pm2 logs ai-sdr-backend --lines 100 --nostream` | Bull psubscribe NOAUTH errors |
| 9 | Dashboard | `tail -60 <PATH_REDACTED>/ai-sdr-backend-error.log` | "ReplyError: NOAUTH Authentication required" |
| 10 | Dashboard | `grep -i redis <PATH_REDACTED>/.env` (redacted) | REDIS_HOST, PORT, PASSWORD, DB all set |
| 11 | Dashboard | `grep -iE '(google\|sheet)' .../youtube-intelligence/.env` (redacted) | Google Sheets vars ALL commented out |
| 12 | Dashboard | `node -v && npm -v` | v22.22.0, 10.9.4 |
| 13 | Dashboard | `redis-cli -a '' ping` | WRONGPASS (auth required, expected) |
| 14 | Dashboard | `python3 --version` | (available via LiteLLM venv) |

### Phase 2: LiteLLM Health (5 commands)

| # | Host | Command | Key Output |
|---|---|---|---|
| 15 | Dashboard | `systemctl status litellm.service` | Active (running) 17h |
| 16 | Dashboard | `journalctl -u litellm -n 50` | Hourly health checks all 200 OK |
| 17 | Dashboard | `curl <INTERNAL_ENDPOINT>/health` | HTTP 200, 3 healthy endpoints, 0 unhealthy |
| 18 | Dashboard | `curl <INTERNAL_ENDPOINT>/health/liveliness` | HTTP 200, "I'm alive!" |
| 19 | Dashboard | `curl <INTERNAL_ENDPOINT>/models` | HTTP 200, 3 models available |

### Phase 3: GitHub Context (2 commands)

| # | Host | Command | Key Output |
|---|---|---|---|
| 20 | Dashboard | `gh auth status` | Logged in as mcdonjam82, scopes: admin:org, repo, workflow |
| 21 | Dashboard | `gh repo list --limit 10` | 3 repos visible; LucraLab org exists |

**Total commands: 21 (all read-only)**

---

## Key Evidence (Redacted)

### youtube-intelligence Root Cause
```
ERROR: Failed to initialize Google Sheets service: No key or keyFile set.
  at GoogleToken._getTokenAsyncInner2 (gtoken/build/cjs/src/index.cjs:319:31)

.env analysis:
  GOOGLE_API_KEY=REDACTED (set)
  # GOOGLE_SHEETS_ID=             (COMMENTED OUT)
  # GOOGLE_SERVICE_ACCOUNT_EMAIL= (COMMENTED OUT)
  # GOOGLE_PRIVATE_KEY=REDACTED   (COMMENTED OUT)
```

### ai-sdr-backend Root Cause
```
Server startup: SUCCESS (all routes mounted, configured port, DB connected)
Redis main client: SUCCESS ("Redis client connected successfully")
Bull queue subscriber: FAIL

ReplyError: NOAUTH Authentication required.
  at parseError (redis-parser/lib/parser.js:179:12)
  command: { name: 'psubscribe', args: [ 'bull:call-analysis:waiting*' ] }
```

Bull creates separate Redis connections for pub/sub that don't inherit the REDIS_PASSWORD.

### LiteLLM Status
```
systemd: active (running), 17h uptime
Health: HTTP 200, 3/3 endpoints healthy
Models: 3 configured (details in private ops notes)
Binding: localhost only (not public)
Budget cap: Active (details in private ops notes)
```
Previous "not on this host" report was a FALSE ALARM from the discovery script.

### GitHub Access
```
Account: mcdonjam82
Org: LucraLab
Token scopes: <SCOPES_REDACTED>
```

---

## Deliverables Generated

| # | File | Size | Description |
|---|---|---|---|
| A | GITHUB_STRATEGY.md | ~10 KB | Repo strategy, branch protection, CODEOWNERS, implementation commands |
| B | TRIAGE_REPORT.md | ~12 KB | Root cause analysis for 3 stability issues |
| C | CONTROL_REPO_LAYOUT.md | ~6 KB | Folder tree, versioning, retention policy |
| D | CI_GATES_PLAN.md | ~10 KB | 4 CI checks, schema files, release conventions |
| E | PROOF_PACK.md | ~4 KB | This file |
| F | MERGED_ROLE_REGISTRY.yaml | ~12 KB | Canonical merged registry (10 roles + 13 agents) |

---

## File Locations

### Local (Windows)
```
<LOCAL_PATH_REDACTED>/deliverables/control-plane/
  GITHUB_STRATEGY.md
  TRIAGE_REPORT.md
  CONTROL_REPO_LAYOUT.md
  CI_GATES_PLAN.md
  PROOF_PACK.md
  MERGED_ROLE_REGISTRY.yaml
```

### VPS (Dashboard)
```
<VPS_PATH_REDACTED>/
  (all 6 files uploaded)
```
