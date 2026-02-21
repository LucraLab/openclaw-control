# Proof: Sentinel WARN Policy — Selftest

**Date:** 2026-02-21T214826Z
**Branch:** ops/provider-drift-sentinel
**HEAD:** 0fd2c46

---

## Selftest: 3 / 3 PASSED

## Check Results

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | Default mode (WARN continues) | Smoke continues, WARN banner | Smoke exit=0, WARN banner present, tests ran | PASS |
| 2 | Strict mode (WARN aborts) | Smoke exit=2, SENTINEL_WARN_POLICY_FAIL=1 | Smoke exit=2, SENTINEL_WARN_POLICY_FAIL=1 present | PASS |
| 3 | FAIL mode unchanged | Smoke exit=1, drift abort | Smoke exit=1, drift abort message present | PASS |

## How to Enable Strict Mode

```bash
# One-shot:
SENTINEL_WARN_IS_FAIL=1 bash routing_smoke_suite.sh

# Persistent (export):
export SENTINEL_WARN_IS_FAIL=1
bash routing_smoke_suite.sh
```

## Policy Decision Table

| SENTINEL_WARN_IS_FAIL | Sentinel Exit 1 (WARN) | Smoke Behavior |
|----------------------|----------------------|----------------|
| unset / 0 | WARN | Continues with banner |
| 1 | WARN → FAIL | Aborts (exit 2), prints SENTINEL_WARN_POLICY_FAIL=1 |

---

**sha256:** 6e1196d954072fc146bb5c15949708416df2fae5e30cb4817f68e7d45e4bc935
