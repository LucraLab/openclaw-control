# Tax Pod Events Ledger

**Version:** 1.0.0 (Port P10)

## Purpose

The `events.jsonl` file is an **append-only audit ledger** that records every successful Tax Pod agent run. Each line is a JSON object representing one run event.

---

## File Location

```
tax/events/events.jsonl
```

**Important:** This file is **gitignored** by default (runtime output, not source code). Do not commit it to the repository.

---

## Event Structure

Each event line contains:

```json
{
  "event_type": "tax_agent_run",
  "timestamp_utc": "2026-03-04T00:00:00Z",
  "case_id": "payment_plan_first-49610591ad21",
  "agent_key": "payment_plan_first",
  "agent_id": "payment-plan-agent",
  "input_hash": "sha256:abc123...",
  "outputs": [
    {
      "path": "tax/out/payment_plan_first-49610591ad21/response.md",
      "sha256": "def456...",
      "bytes": 12345
    },
    {
      "path": "tax/out/payment_plan_first-49610591ad21/evidence.json",
      "sha256": "ghi789...",
      "bytes": 6789
    }
  ],
  "evidence_path": "tax/out/payment_plan_first-49610591ad21/evidence.json",
  "sources_count": 2,
  "missing_sources_count": 0,
  "delivery_gate": {
    "pass": true,
    "version": "1.0"
  },
  "contract_version": "1.0"
}
```

---

## Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `event_type` | string | Always `"tax_agent_run"` |
| `timestamp_utc` | string | ISO 8601 UTC timestamp (injected via `--now-utc` or current time) |
| `case_id` | string | Deterministic case ID (includes agent key prefix) |
| `agent_key` | string | Agent key (`payment_plan_first`, `irs_notice_triage`, `cost_seg_support`) |
| `agent_id` | string | Agent ID (`payment-plan-agent`, etc.) |
| `input_hash` | string | SHA256 hash of normalized intake JSON (for reproducibility) |
| `outputs` | array | Array of output files with paths, SHA256 hashes, and byte counts |
| `evidence_path` | string | Path to evidence.json file |
| `sources_count` | number | Number of sources cited in evidence record |
| `missing_sources_count` | number | Number of missing vault sources noted |
| `delivery_gate` | object | Delivery gate status (pass/fail) and version |
| `contract_version` | string | Output contract version |

---

## Stability and Determinism

### Deterministic Fields

Given the same fixture input and `--now-utc` timestamp, the following fields are **deterministic** (byte-identical across runs):

- `case_id`
- `agent_key`
- `agent_id`
- `input_hash`
- `outputs[]` (paths, SHA256 hashes, byte counts)
- `evidence_path`
- `sources_count`
- `missing_sources_count`
- `delivery_gate`
- `contract_version`

### Non-Deterministic Field

- `timestamp_utc`: Only deterministic if `--now-utc` flag is provided to the CLI runner.

---

## No PII Policy

**CRITICAL:** Events contain **NO personally identifiable information (PII)**.

Events record:
- ✅ Hashes (SHA256 of inputs and outputs)
- ✅ Paths (relative file paths)
- ✅ Counts (sources, missing sources, bytes)
- ✅ Metadata (agent keys, case IDs, timestamps)

Events do NOT record:
- ❌ Raw intake JSON (names, SSNs, addresses, balances)
- ❌ Response markdown text (may contain PII in examples)
- ❌ Evidence record contents (sanitized summaries only via counts)

---

## Append-Only Ledger

The `events.jsonl` file is **append-only**:

- Each successful run appends one line
- Prior lines are **never modified or deleted**
- Event sequence is chronological (ordered by write time)

**Do NOT:**
- Manually edit `events.jsonl`
- Rewrite or truncate prior events
- Commit the file to version control (it's gitignored)

---

## Usage

### Run with Deterministic Timestamp

For reproducible events (e.g., testing, proof packs):

```bash
node tax/cli/run_agent.js \
  --agent payment_plan_first \
  --in tax/fixtures/installment_agreement_example_1.json \
  --out tax/out \
  --now-utc "2026-03-04T00:00:00Z"
```

### Run with Current Timestamp

For normal operation (non-deterministic timestamp):

```bash
node tax/cli/run_agent.js \
  --agent payment_plan_first \
  --in tax/fixtures/installment_agreement_example_1.json \
  --out tax/out
```

The timestamp will be set to the current UTC time at run start.

---

## Querying Events

### Count Total Runs

```bash
wc -l tax/events/events.jsonl
```

### View Recent Runs

```bash
tail -10 tax/events/events.jsonl | jq .
```

### Filter by Agent

```bash
grep '"agent_key":"payment_plan_first"' tax/events/events.jsonl | jq .
```

### Filter by Date

```bash
grep '"timestamp_utc":"2026-03-04' tax/events/events.jsonl | jq .
```

---

## Version History

- **1.0.0 (Port P10):** Initial event emission implementation

---

**END OF EVENTS README**
