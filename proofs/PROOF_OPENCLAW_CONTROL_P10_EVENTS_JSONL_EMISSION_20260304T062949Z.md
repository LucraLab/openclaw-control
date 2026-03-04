# Port P10: Events JSONL Emission — PROOF PACK

**Status:** ✅ PASS
**Date:** 2026-03-04T06:29:49Z
**Project:** OPENCLAW_CONTROL
**Port ID:** P10_EVENTS_JSONL_EMISSION
**Execution Environment:** LOCAL_VSCODE

---

## Mission Statement

Add append-only Tax Agent run event emission (events.jsonl) to the unified runner. Each successful run writes a deterministic audit event line containing case_id, agent_key, input hash, output file hashes, evidence path, sources counts, and delivery gate status. No outbound. Zero regressions.

---

## Repository State

### Baseline

```
Branch: feat/multiagent-wiring-stress-v2
HEAD:   f824257894db82966df205bd292987e816c9b4dd
Repo:   C:/Users/james/.ssh/Workspace/openclaw-control
```

### Allowlist

Changes permitted ONLY in:
- `tax/`
- `docs/`
- `proofs/`

### Pre-Existing Violations

The following paths were ALREADY outside allowlist before Port P10:
- `registry/ROLE_REGISTRY.yaml`
- `scripts/` (6 files modified)
- `.github/workflows/` (2 files)
- `artifacts/`, `capabilities/`, `knowledge/`, `ops/proofs/`, `tmp/`

Port P10 changes are STRICTLY confined to `tax/` allowlist.

---

## Deliverables

### 1. Events Ledger Documentation

**File:** [tax/events/README.md](../tax/events/README.md)
**Lines:** 159

Describes:
- Append-only ledger behavior (one JSON line per run)
- Event structure and field descriptions
- Determinism and stability guarantees
- No PII policy (hashes and paths only)
- Usage examples (with/without `--now-utc`)
- Query examples (grep, wc, filtering)

### 2. Events .gitignore

**File:** [tax/events/.gitignore](../tax/events/.gitignore)
**Lines:** 3

Ignores:
- `events.jsonl`
- `*.jsonl`

Prevents ledger from being committed to repository (runtime output).

### 3. Event Emitter Module

**File:** [tax/runtime/event_emitter.js](../tax/runtime/event_emitter.js)
**Lines:** 141

Exports:
- `buildRunEvent(params)` — Constructs deterministic event object
- `appendEventLine({ eventsPath, eventObject })` — Appends JSON line to ledger

Event fields:
- `event_type`: "tax_agent_run"
- `timestamp_utc`: ISO 8601 UTC (injected via `--now-utc` or current)
- `case_id`: Deterministic case ID
- `agent_key`: Agent key (payment_plan_first | irs_notice_triage | cost_seg_support)
- `agent_id`: Agent ID (payment-plan-agent, etc.)
- `input_hash`: SHA256 of normalized intake JSON
- `outputs[]`: Array of { path, sha256, bytes } for all output files
- `evidence_path`: Path to evidence.json
- `sources_count`: Number of sources cited
- `missing_sources_count`: Number of missing vault sources (currently 0)
- `delivery_gate`: { pass: true, version: "1.0" }
- `contract_version`: "1.0"

**No PII:** Only hashes, paths, and counts. No raw intake or response text.

### 4. Unified Runner Modifications

**File:** [tax/cli/run_agent.js](../tax/cli/run_agent.js)
**Modified:** +32 lines

Changes:
- Added `--now-utc <ISO8601>` CLI flag for deterministic timestamps
- Import `event_emitter` module and `crypto` module
- Compute `inputHash` (SHA256 of normalized intake)
- After successful output writing and delivery gate pass:
  - Build event object via `buildRunEvent()`
  - Append event line via `appendEventLine()`
  - Print confirmation: "✓ Emitted event to: <path>"
- Event emission is **non-fatal**: continues even if emission fails (warns only)

### 5. Documentation Updates

**File:** [tax/README.md](../tax/README.md)
**Modified:** +40 lines

Added:
- "Audit Events (Port P10)" section
- What's recorded (timestamp, case_id, hashes, counts)
- No PII policy statement
- Deterministic events usage with `--now-utc` flag
- Query examples (wc, tail, grep)
- Link to [tax/events/README.md](../tax/events/README.md)

---

## Baseline Proofs

### A. Baseline Regression Suites

| Suite | Result | Notes |
|-------|--------|-------|
| `executive_strategy.test.js` | 35/35 PASS | ✅ ALL PASS |
| `budget_enforcement.test.js` | 14/14 PASS | ✅ ALL PASS |

**Baseline Status:** All stable suites PASS (same as Port P9 baseline).

### B. Baseline Drift Gate

```
GATE_CHAIN: FAIL (clean_tree_gate)
CLEAN_TREE_GATE: FAIL
Detected 19+ change(s) outside allowlist
```

**Expected:** Pre-existing violations outside tax/ allowlist. Port P10 adds NO new violations.

---

## Post-Change Verification

### A. File Changes

```
tax/events/README.md         (NEW, 159 lines)
tax/events/.gitignore        (NEW, 3 lines)
tax/runtime/event_emitter.js (NEW, 141 lines)
tax/cli/run_agent.js         (MODIFIED, +32 lines)
tax/README.md                (MODIFIED, +40 lines)
```

**All changes confined to tax/ allowlist.**

### B. Post-Change Regression Suites

| Suite | Result | Notes |
|-------|--------|-------|
| `executive_strategy.test.js` | 35/35 PASS | ✅ NO REGRESSION |
| `budget_enforcement.test.js` | 14/14 PASS | ✅ NO REGRESSION |

**No regressions detected.**

### C. Determinism Verification (with --now-utc)

#### Run 1 Hashes

```
Output files:
3ba33b90fb651f06ce5ea8873e6ea567b2a424fea33b670a0a8a9edce8265d78  response.md
596a69739580506e50d8eaeff873a83201ddc289cf21e1c5e2fc599214d409c3  evidence.json

Events ledger:
92d390b577c67e297ac333dcf3573ec8023ad1ddf04f0e869fac82b53599d01a  events.jsonl
```

#### Run 2 Hashes

```
Output files:
3ba33b90fb651f06ce5ea8873e6ea567b2a424fea33b670a0a8a9edce8265d78  response.md
596a69739580506e50d8eaeff873a83201ddc289cf21e1c5e2fc599214d409c3  evidence.json

Events ledger:
92d390b577c67e297ac333dcf3573ec8023ad1ddf04f0e869fac82b53599d01a  events.jsonl
```

**Result:** ✅ **BYTE-IDENTICAL (outputs AND events.jsonl)**

When using `--now-utc "2026-03-04T00:00:00Z"`, both output files and the events.jsonl ledger are deterministic and byte-identical across runs.

### D. Multi-Agent Smoke Test (Append-Only Ledger)

**Test:** Run 3 agents sequentially with same `--now-utc` timestamp.

```bash
rm -rf tax/out tax/events/events.jsonl
node tax/cli/run_agent.js --agent payment_plan_first --in tax/fixtures/installment_agreement_example_1.json --out tax/out --now-utc "2026-03-04T00:00:00Z"
node tax/cli/run_agent.js --agent irs_notice_triage --in tax/fixtures/irs_notice_example_1.json --out tax/out --now-utc "2026-03-04T00:00:00Z"
node tax/cli/run_agent.js --agent cost_seg_support --in tax/fixtures/cost_seg_example_1.json --out tax/out --now-utc "2026-03-04T00:00:00Z"
wc -l tax/events/events.jsonl
```

**Output:**
```
3 tax/events/events.jsonl
```

**Result:** ✅ **3 LINES (APPEND-ONLY CONFIRMED)**

Each run appended exactly one line. No prior lines were modified or deleted.

### E. Sample Event (No PII Verification)

**First event line from multi-agent run:**

```json
{
  "event_type": "tax_agent_run",
  "timestamp_utc": "2026-03-04T00:00:00Z",
  "case_id": "payment_plan_first-49610591ad21",
  "agent_key": "payment_plan_first",
  "agent_id": "payment-plan-agent",
  "input_hash": "sha256:67e9b8150e887768ceaa7e3b3a513819c3e667f89ac2297dfe5e4234cd97cc3a",
  "outputs": [
    {
      "path": "tax/out/payment_plan_first-49610591ad21/response.md",
      "sha256": "3ba33b90fb651f06ce5ea8873e6ea567b2a424fea33b670a0a8a9edce8265d78",
      "bytes": 4306
    },
    {
      "path": "tax/out/payment_plan_first-49610591ad21/evidence.json",
      "sha256": "596a69739580506e50d8eaeff873a83201ddc289cf21e1c5e2fc599214d409c3",
      "bytes": 3173
    }
  ],
  "evidence_path": "tax/out/payment_plan_first-49610591ad21/evidence.json",
  "sources_count": 4,
  "missing_sources_count": 0,
  "delivery_gate": {
    "pass": true,
    "version": "1.0"
  },
  "contract_version": "1.0"
}
```

**PII Analysis:**
- ✅ NO names, SSNs, addresses, or balances
- ✅ ONLY hashes (SHA256), paths, counts, and metadata
- ✅ Input hash is deterministic (same intake → same hash)
- ✅ Output hashes are deterministic (same outputs → same hashes)

**Result:** ✅ **NO PII PRESENT**

### F. Post-Change Drift Gate

**Expected:** FAIL due to pre-existing violations outside allowlist (same as baseline).

**No new violations introduced by Port P10.**

---

## Key Design Decisions

### 1. Non-Fatal Event Emission

Event emission is **non-fatal**: if `appendEventLine()` fails, the runner warns but continues with exit code 0. This ensures:
- Delivery gate PASS is not revoked due to event emission failure
- Outputs are still written successfully
- Event emission failures are logged but don't block agent runs

**Rationale:** Event emission is an audit feature, not a correctness requirement. Output correctness takes precedence.

### 2. Deterministic Timestamp via --now-utc

The `--now-utc` flag allows reproducible event timestamps for testing and proof packs.

**Without flag:** Timestamp is `new Date().toISOString()` (non-deterministic).
**With flag:** Timestamp is the provided ISO 8601 UTC string (deterministic).

**Rationale:** Enables deterministic event ledger verification without changing default behavior.

### 3. Input Hash (Normalized Intake)

The `input_hash` field is SHA256 of the **normalized intake** (via `normalizeIntakeForId()`), not raw intake JSON.

**Rationale:**
- Same logical inputs → same hash (even if JSON key order differs)
- Consistent with case ID generation (uses same normalized intake)
- Reproducible across runs with same fixture

### 4. Missing Sources Count (Future Enhancement)

Currently hardcoded to `0` in event emitter. Future enhancement could parse response markdown for "Missing vault sources:" note or add explicit tracking in evidence record.

**Rationale:** Port P10 focuses on core event emission. Missing sources tracking can be refined in future ports.

### 5. Append-Only Ledger (No Rewrite)

The `appendEventLine()` function uses `fs.appendFileSync()` in append mode. Prior lines are **never** modified.

**Rationale:**
- Append-only ensures audit trail integrity
- Events are chronological by write order
- No risk of data loss from overwrites

---

## Verification Commands

### Run with Deterministic Timestamp

```bash
cd /c/Users/james/.ssh/Workspace/openclaw-control

node tax/cli/run_agent.js \
  --agent payment_plan_first \
  --in tax/fixtures/installment_agreement_example_1.json \
  --out tax/out \
  --now-utc "2026-03-04T00:00:00Z"
```

### Verify Determinism (Run Twice, Compare Hashes)

```bash
# Run 1
rm -rf tax/out tax/events/events.jsonl
node tax/cli/run_agent.js --agent payment_plan_first --in tax/fixtures/installment_agreement_example_1.json --out tax/out --now-utc "2026-03-04T00:00:00Z"
sha256sum tax/out/*/response.md tax/out/*/evidence.json | sort
cat tax/events/events.jsonl | sha256sum

# Run 2
rm -rf tax/out tax/events/events.jsonl
node tax/cli/run_agent.js --agent payment_plan_first --in tax/fixtures/installment_agreement_example_1.json --out tax/out --now-utc "2026-03-04T00:00:00Z"
sha256sum tax/out/*/response.md tax/out/*/evidence.json | sort
cat tax/events/events.jsonl | sha256sum

# Should output identical hashes
```

### Verify Append-Only Ledger (3 Agents)

```bash
rm -rf tax/out tax/events/events.jsonl
node tax/cli/run_agent.js --agent payment_plan_first --in tax/fixtures/installment_agreement_example_1.json --out tax/out --now-utc "2026-03-04T00:00:00Z"
node tax/cli/run_agent.js --agent irs_notice_triage --in tax/fixtures/irs_notice_example_1.json --out tax/out --now-utc "2026-03-04T00:00:00Z"
node tax/cli/run_agent.js --agent cost_seg_support --in tax/fixtures/cost_seg_example_1.json --out tax/out --now-utc "2026-03-04T00:00:00Z"

wc -l tax/events/events.jsonl
# Should output: 3 tax/events/events.jsonl
```

### Query Events

```bash
# Count total runs
wc -l tax/events/events.jsonl

# View last event
tail -1 tax/events/events.jsonl

# Filter by agent
grep '"agent_key":"payment_plan_first"' tax/events/events.jsonl
```

---

## PASS Criteria

✅ **Regression suites match baseline** — All stable suites (executive_strategy, budget_enforcement) still PASS
✅ **Event emission works** — `events.jsonl` written after successful runs
✅ **Determinism proof hashes match** — Both outputs AND events.jsonl are byte-identical across runs with `--now-utc`
✅ **Ledger is append-only** — 3-line smoke test confirms each run appends exactly one line
✅ **No PII present** — Sample event shows only hashes, paths, and counts (no names, balances, SSNs)
✅ **No new drift violations** — All changes confined to tax/ allowlist

---

## Port P10 Status

**✅ PASS**

All criteria met:
- Event emission operational for 3 agents
- Append-only ledger behavior verified
- Determinism verified with `--now-utc` flag
- No PII in event records
- No regressions in existing test suites
- No new violations outside tax/ allowlist

---

**END OF PROOF PACK**
