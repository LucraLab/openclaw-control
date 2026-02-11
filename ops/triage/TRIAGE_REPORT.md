# TRIAGE_REPORT.md — Dashboard VPS Stability Triage
## Timestamp: 2026-02-11T00:00Z
## Host: Dashboard.LucraLab (31.97.106.33)

---

## Issue 1: youtube-intelligence Crash Loop

### Symptom
PM2 process `youtube-intelligence` (id 5) has **138,551+ restarts** and is restarting every ~1 second. Uptime consistently shows "0s". This constitutes a continuous crash loop consuming CPU and filling log files.

### Evidence (Redacted)

**PM2 describe output:**
```
status:     online (momentarily)
restarts:   138,551
uptime:     0s
script:     /root/lucralab-projects/youtube-intelligence/server.js
node.js:    v22.22.0
```

**Log pattern (repeats every ~1 second):**
```
INFO: Initializing services...
INFO: Database connected successfully
ERROR: Failed to initialize Google Sheets service: No key or keyFile set.
ERROR: Failed to initialize services: No key or keyFile set.
ERROR: Failed to start server: No key or keyFile set.
```

**Stack trace root:**
```
at GoogleToken._getTokenAsyncInner2
  → gtoken/build/cjs/src/index.cjs:319:31
```

**.env file analysis (key names only, values redacted):**
```
GOOGLE_API_KEY=REDACTED
# GOOGLE_AI_API_KEY=REDACTED
# Google Sheets (add when setting up channel list)
# GOOGLE_SHEETS_ID=
# GOOGLE_SERVICE_ACCOUNT_EMAIL=
# GOOGLE_PRIVATE_KEY=REDACTED
```

The Google Sheets configuration is **entirely commented out**. The app requires a Google service account with key/keyFile to initialize its Sheets integration, and crashes when this is missing.

### Root Cause
**Missing Google service account credentials.** The `.env` file has the Google Sheets variables commented out with a note "add when setting up channel list". The application treats the Sheets service as mandatory at startup — failure to init causes the entire server to crash rather than gracefully degrading.

### Proposed Fix Options (Safest First)

**Option A: Stop the process (Immediate, Safe)**
```bash
# Stop the crash loop immediately — no data loss, no side effects
pm2 stop youtube-intelligence
pm2 save
```
- **Risk:** Zero. The process isn't functioning anyway.
- **Rollback:** `pm2 start youtube-intelligence && pm2 save`
- **Recommended:** Yes — this is the immediate triage action.

**Option B: Make Sheets service optional (Code fix, via PR)**
- Modify `server.js` to catch the Google Sheets init error and continue without it
- Submit as PR to `github:lucralab-personal/youtube-intelligence`
- Deploy after review
- **Risk:** Low. Defensive coding change.
- **Rollback:** Revert commit.

**Option C: Provide Google service account credentials**
- Create a Google service account with Sheets API access
- Add credentials to `.env` (uncomment and fill in values)
- Restart process
- **Risk:** Medium. Requires creating/managing new credentials.
- **Rollback:** Re-comment the env vars, stop process.

### What NOT to Do
- Do NOT delete the process from PM2 (may lose config)
- Do NOT modify `.env` on production without backup
- Do NOT ignore this — 138K restarts waste CPU and fill logs

### Impact Assessment
- **Resource waste:** ~1 restart/second = constant Node.js startup overhead
- **Log pollution:** PM2 logs growing with repeated error stacks
- **No customer impact:** youtube-intelligence is not customer-facing
- **Dependencies:** None — no other service depends on this

---

## Issue 2: ai-sdr-backend Crash Loop

### Symptom
PM2 process `ai-sdr-backend` (id 4) has **22,216+ restarts**. Status fluctuates between `online` and `stopped`. When running, it successfully starts the server on port 3001, connects to MySQL, and mounts all routes — but then immediately crashes due to unhandled Redis promise rejections.

### Evidence (Redacted)

**PM2 describe output:**
```
status:     stopped (at observation time)
restarts:   22,216
script:     /root/lucralab-projects/ai-assistant/ai-sdr-backend/server.js
node.js:    v22.22.0
node_env:   production
```

**Successful startup sequence (from logs):**
```
✓ OpenAI initialized
✓ Anthropic Claude initialized
✓ Multi-provider mode: OpenAI + Claude
✅ Database connection pool initialized
✅ All route modules mounted successfully (including 3 optimization modules)
🚀 Enhanced AI SDR Backend running on port 3001
✅ Database: ai_sdr_platform
✅ Redis client connected successfully
✅ Database connected successfully (shared pool)
```

**Crash trigger (immediately after startup):**
```
Unhandled Rejection: {"command":{"name":"psubscribe","args":["bull:call-analysis:waiting*"]}}
Unhandled Rejection: {"command":{"name":"psubscribe","args":["bull:prompt-generation:waiting*"]}}
Unhandled Rejection: {"command":{"name":"psubscribe","args":["bull:quality-monitoring:waiting*"]}}
Unhandled Rejection: {"command":{"name":"psubscribe","args":["bull:enrichment:waiting*"]}}
```

**Error log (stderr):**
```
ReplyError: NOAUTH Authentication required.
    at parseError (redis-parser/lib/parser.js:179:12)
  command: { name: 'psubscribe', args: [ 'bull:call-analysis:waiting*' ] }
```

**.env Redis configuration:**
```
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=REDACTED
REDIS_DB=0
```

### Root Cause
**Bull job queue Redis connections missing authentication.** The application has TWO Redis connection paths:
1. **Main Redis client** — Uses `REDIS_PASSWORD` from `.env` → connects successfully
2. **Bull queue subscriber connections** — Creates separate Redis connections for `psubscribe` that do NOT pass the Redis password → fails with `NOAUTH`

This is a common bug pattern with Bull/BullMQ: the library creates its own internal Redis connections for pub/sub, and if the Redis config object doesn't include the password, those connections fail. The main Redis client is configured correctly, but Bull's queue initialization uses a different config path.

### Proposed Fix Options (Safest First)

**Option A: Fix Bull queue Redis configuration (Code fix, via PR)**
Find where Bull queues are initialized in the codebase and ensure the Redis password is passed:

```javascript
// BEFORE (broken):
const queue = new Bull('call-analysis', { redis: { host: '127.0.0.1', port: 6379 } });

// AFTER (fixed):
const queue = new Bull('call-analysis', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: process.env.REDIS_DB || 0
  }
});
```

- **Risk:** Low. Only changes how Redis credentials are passed.
- **Rollback:** Revert commit.
- **Recommended:** Yes — this is the correct fix.

**Option B: Stop the process (Immediate triage)**
```bash
pm2 stop ai-sdr-backend
pm2 save
```
- **Risk:** AI SDR demos will stop working.
- **Rollback:** `pm2 start ai-sdr-backend && pm2 save`
- **Note:** Only if the crash loop is causing broader issues.

**Option C: Remove Redis auth requirement**
- Not recommended — Redis should require authentication.

### What NOT to Do
- Do NOT remove Redis `requirepass` to "fix" this
- Do NOT increase PM2 `max_restarts` — the problem will persist
- Do NOT modify the `.env` file without understanding the Bull config code

### Impact Assessment
- **Resource waste:** High — 22K+ restarts, each creating MySQL + Redis connections
- **Connection pool exhaustion risk:** Each restart attempt opens new DB connections
- **Customer impact:** AI SDR demo system unavailable when process is crashed
- **Health check:** Port 3001 /health returns healthy during the brief moments the server is up

---

## Issue 3: LiteLLM Health Check — RESOLVED (False Alarm)

### Symptom (Reported)
Discovery script reported "LiteLLM: not on this host" when testing `http://127.0.0.1:4010/health`.

### Evidence (Current)

**systemctl status:**
```
● litellm.service - LiteLLM Proxy
     Active: active (running) since 2026-02-10 05:47:34 UTC; 17h ago
     Main PID: 1211897
     Memory: 267.3M
     Config: /home/openclaw/.openclaw/litellm/config.yaml
     Binding: 127.0.0.1:4010
```

**Health check (live):**
```
curl http://127.0.0.1:4010/health → HTTP 200
  healthy_endpoints: 3 (kimi-k2.5 x2, claude-opus-4-6)
  unhealthy_endpoints: 0

curl http://127.0.0.1:4010/health/liveliness → HTTP 200
  "I'm alive!"

curl http://127.0.0.1:4010/models → HTTP 200
  3 models: kimi-k2.5, kimi_manager, anthropic_opus
```

**Port binding:**
```
tcp LISTEN 127.0.0.1:4010 users:(("litellm",pid=1211897))
```

**Journal (hourly health checks, all 200 OK):**
```
22:00:01 - "GET /health/liveliness HTTP/1.1" 200 OK
21:00:02 - "GET /health/liveliness HTTP/1.1" 200 OK
... (consistent hourly 200s since 06:06 UTC)
```

### Root Cause of False Alarm
The discovery script's curl test likely had a timing issue or was testing the wrong endpoint. The text "not on this host" may have come from the script's own fallback echo when curl failed to connect (perhaps during a brief connection timeout). LiteLLM has been healthy and responding correctly for 17+ hours.

### Status: NO ACTION NEEDED
LiteLLM on Dashboard VPS is **fully operational** with 3 healthy model endpoints, $20/day Anthropic budget cap, and Redis caching enabled.

### Configuration Summary
| Property | Value |
|---|---|
| **Bind** | 127.0.0.1:4010 |
| **Models** | kimi-k2.5, kimi_manager, anthropic_opus |
| **Healthy endpoints** | 3/3 |
| **Budget cap** | $20/day on Anthropic |
| **Uptime** | 17+ hours |
| **Config file** | /home/openclaw/.openclaw/litellm/config.yaml |

---

## Summary Table

| Issue | Severity | Root Cause | Fix Complexity | Customer Impact |
|---|---|---|---|---|
| youtube-intelligence | CRITICAL (resource waste) | Missing Google Sheets credentials | Simple (stop or add creds) | None |
| ai-sdr-backend | CRITICAL (functional) | Bull queue Redis NOAUTH | Medium (code fix in queue init) | AI SDR demos down |
| LiteLLM health | FALSE ALARM | Discovery script error | None needed | None |

## Recommended Immediate Actions

1. `pm2 stop youtube-intelligence && pm2 save` — Stop the crash loop now
2. Investigate Bull queue Redis config in ai-sdr-backend codebase
3. Fix Bull Redis auth, test locally, deploy via PR
4. Update the canary/health monitor to detect crash-loop patterns (>100 restarts = alert)
