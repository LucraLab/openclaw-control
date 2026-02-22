# Proof: PORT4.2 Apply Door — Sandbox NON-DRY-RUN Apply

**Created:** 2026-02-22T074917Z
**Author:** Claude Code (Opus 4.6)
**Main branch:** `8014d0b` (post PR #49 merge)

---

## Phase 0 — Baseline

- **Main commit:** `8014d0b`
- **Tests:** 197/197 PASS (PORT0:34 + PORT1:24 + PORT2:40 + PORT3:63 + PORT4.2:36)

---

## Phase 1 — Sandbox Runtime Root

Sandbox created at `/tmp/taxpod_apply_sandbox_20260222T080000Z/` with:

```
tax_work/sbx_case/models/payment_plan_model.json   (copied from fixture)
tax_work/sbx_case/strategy/strategy_recommendation.json  (minimal synthetic)
tax_work/sbx_case/audit/                            (empty dir)
audit/                                              (empty dir)
```

---

## Phase 2 — Sandbox Changeset + Approval

**Changeset:** `sbx_case_cs_20260222T080000Z`

| # | Action | Type | Target Path | Old | New |
|---|--------|------|-------------|-----|-----|
| act_001 | PATCH_JSON | replace | `/liability_summary/tax_years/0/interest` | 250 | 475 |
| act_002 | PATCH_JSON | replace | `/liability_summary/tax_years/0/total_liability` | 5650 | 5875 |
| act_003 | REQUIRE_RERUN_PORT2 | cascade marker | — | — | — |

**Changeset SHA-256:** `252ed503980c59911e35ec0328e29649be7570d72d0a07fdcf2f17d0b38de925`
**Approval SHA-256:** `a18b1a06692816b49b3eda5b8f91cd0ee58d0f4503229f632b15a79bbb804bba`

---

## Phase 3 — Apply Door NON-DRY-RUN

```bash
node apply_changeset_v1.js \
  --changeset /tmp/.../changeset.json \
  --case sbx_case \
  --approve-proof /tmp/.../approval.md \
  --approve-proof-sha256 a18b1a06692816b49b3eda5b8f91cd0ee58d0f4503229f632b15a79bbb804bba \
  --out /tmp/.../tax_work/sbx_case/audit \
  --runtime-root /tmp/taxpod_apply_sandbox_20260222T080000Z \
  --created-utc 20260222T080100Z
```

**Exit code:** `0` (APPLIED)
**Result:** `APPLIED`
**dry_run:** `false`

---

## Phase 4 — Atomic Write + Audit Proof

### Model File (payment_plan_model.json)

| Metric | Value |
|--------|-------|
| Pre-SHA256 | `c4d61b1f00ffe3c8c157a948696c575a578b90bf8d11f020f05884bded79e48a` |
| Post-SHA256 | `225cc3202aa18a1ae8d289a03013e28caf22d38b17bb1609cf82cbdc64e5106a` |
| **Changed** | **YES** (expected — 2 PATCH_JSON applied) |
| Patched `interest` | `475` (expected 475) |
| Patched `total_liability` | `5875` (expected 5875) |

### Strategy File (strategy_recommendation.json)

| Metric | Value |
|--------|-------|
| Pre-SHA256 | `879b09f450b878af12959d6cca46333cccb473bf5ff4439040e1a331922ed3b3` |
| Post-SHA256 | `879b09f450b878af12959d6cca46333cccb473bf5ff4439040e1a331922ed3b3` |
| **Changed** | **NO** (expected — no patches targeted strategy) |

### Receipt

- **Receipt ID:** `782815073e90e8afd712cf7a441c449afa6af1dfb5ca941300899243cb15665e`
- **Receipt SHA-256:** `a37a23c79bd46eebe019738f8cdcfcda6191896599c81e275e751705692e3d4f`
- **Actions applied:** 3 (act_001 PATCH_JSON, act_002 PATCH_JSON, act_003 REQUIRE_RERUN_PORT2)
- **Files mutated:** 1 (`models/payment_plan_model.json`)
- **Pre/post SHA-256 in receipt match** independently computed values above

### Cascade Marker

```
-rw-r--r-- 1 root root 186  /tmp/.../tax_work/sbx_case/.require_rerun_port2
```

Marker file created as expected for `REQUIRE_RERUN_PORT2` action.

### Audit JSONL

- **Path:** `/tmp/.../audit/taxpod_apply.jsonl`
- **Lines:** 1
- **SHA-256:** `0251bfb843e4c7577fad976a06101c925a826a9bb4b9dbacf7f42a191d371848`
- **Content:**

```json
{"event":"APPLY","utc":"20260222T080100Z","case_id":"sbx_case","changeset_id":"sbx_case_cs_20260222T080000Z","result":"APPLIED","receipt_id":"782815073e90e8afd712cf7a441c449afa6af1dfb5ca941300899243cb15665e","dry_run":false}
```

### Files Created by Apply

| File | Source |
|------|--------|
| `audit/taxpod_apply.jsonl` | Audit append (gate 9) |
| `tax_work/sbx_case/audit/apply_receipt.json` | Receipt write (gate 9) |
| `tax_work/sbx_case/.require_rerun_port2` | Cascade marker (gate 8) |

**No files written outside sandbox.**

---

## Phase 5 — Refusal Proof (Destructive Op)

A second changeset with `op: "remove"` was submitted against the same sandbox.

**Exit code:** `2` (REFUSED_VALIDATION — expected)
**Refusal reason:** `Patch op "remove" is not allowed. Allowed: replace, add`

### Zero-Change Confirmation After Refusal

| Metric | Before Refusal | After Refusal | Changed? |
|--------|---------------|--------------|----------|
| Model SHA-256 | `225cc320...64e5106a` | `225cc320...64e5106a` | **NO** |
| Audit JSONL lines | 1 | 1 | **NO** |

The refusal produced **zero writes** — no artifact mutation, no audit append, no receipt.

---

## Real Runtime Untouched Confirmation

The real runtime at `/home/openclaw/.openclaw/` was **never touched** during this exercise:

| File | SHA-256 | Same as pre-exercise? |
|------|---------|-----------------------|
| `mcdonald-family-tn/models/payment_plan_model.json` | `8821948d7666c8638738e629df7e396d99cc9e2c0b7e9a1277729a25e5014151` | **YES** |
| `mcdonald-family-tn/strategy/strategy_recommendation.json` | `c246144b85f1767315c6ed6ede249ff430afe12fc3411053acfd7e665a988e6b` | **YES** |

---

## Summary

| Gate | Result |
|------|--------|
| Atomic write (temp + rename) | PASS — model patched, strategy untouched |
| Schema validation | PASS — changeset accepted |
| Allowlist gate | PASS — PATCH_JSON + cascade allowed |
| Destructive op refusal | PASS — `remove` refused with exit 2 |
| Audit append | PASS — 1 JSONL line written |
| Receipt correctness | PASS — 3 actions, pre/post hashes match |
| Cascade marker | PASS — `.require_rerun_port2` created |
| Real runtime isolation | PASS — zero changes to `/home/openclaw/.openclaw/` |
| Refusal = zero writes | PASS — no artifacts, no audit, no receipt on refusal |

**All 9 checks PASS. Apply Door V1 is safe for NON-DRY-RUN operation.**

---

*Proof generated by Claude Code (Opus 4.6) | 2026-02-22T074917Z*
