# Port #16 → main: Merge Plan

**Date:** 2026-02-12
**Branch:** `feat/delivery-os-gates`
**Commit:** `878618b` (base) → merged to main via PR
**Status:** RESOLVED — merged to main, debt cleared
**Current state:** Production VPSes aligned with repo main

---

## Why This Document Exists

Port #16 (Autonomy Runtime v1 library + CLIs) and Port #17 (wiring contract tests) were deployed to production VPSes as Port #18 before being merged to `main`. This was authorized because:

1. All 47 runtime tests pass
2. All 23 wiring contract tests pass
3. 8/8 regression tests pass (78 total, 0 failures)
4. CLI checksums verified across 3 locations (local, Dashboard VPS, Builder VPS)
5. Live drills verified on both VPSes

This document tracks the pending merge to `main` so the deployed code and repo align.

---

## Files to Merge

### Port #16 (New files)
| File | Purpose |
|------|---------|
| `scripts/autonomy_runtime.js` | Core library (~310 lines) |
| `scripts/quarantine_agent.js` | Quarantine CLI |
| `scripts/killswitch.js` | Kill switch CLI |
| `scripts/spend_alert.js` | Spend monitoring CLI |
| `scripts/canonical_artifact.js` | Canonical artifact CLI |
| `scripts/autonomy_runtime.test.js` | 47 tests |
| `.github/workflows/gate-autonomy-runtime.yml` | CI gate |

### Port #17 (New files)
| File | Purpose |
|------|---------|
| `scripts/wiring_contract.test.js` | 23 wiring contract tests |
| `.github/workflows/gate-wiring-contract.yml` | CI gate |
| `docs/AUTONOMY_RUNTIME_WIRING.md` | Operating guide |
| `plans/obj-17/task-1.md` | Wiring plan |

### Port #18 (New files)
| File | Purpose |
|------|---------|
| `plans/obj-17/patch-autopilot.py` | Surgical autopilot patcher |
| `plans/obj-17/patch-builder.sh` | Builder VPS patch script |
| `plans/obj-17/patch-dashboard.sh` | Dashboard VPS patch script |
| `ops/proofs/PROOF_PACK_PORT18_DEPLOYMENT_*.md` | Deployment proof |

### Modified files
| File | Change |
|------|--------|
| `.gitignore` | Added `.openclaw_runtime/` |

---

## Pre-Merge Checklist

- [ ] All local tests pass: `node scripts/autonomy_runtime.test.js` (47/47)
- [ ] Wiring contract tests pass: `node scripts/wiring_contract.test.js` (23/23)
- [ ] Regression tests pass: `node scripts/coverage_report.test.js` (8/8)
- [ ] No merge conflicts with `main`
- [ ] CI gates added: `autonomy-runtime-v1`, `wiring-contract`
- [ ] Branch protection updated to require new gates

## Merge Command

```bash
git checkout main
git merge feat/delivery-os-gates --no-ff -m "Merge Port #16/#17/#18: Autonomy Runtime v1 + Wiring"
git push origin main
```

## Post-Merge

- [ ] Verify CI passes on `main`
- [ ] Add `autonomy-runtime-v1` and `wiring-contract` to branch protection required checks
- [ ] Delete feature branch: `git branch -d feat/delivery-os-gates && git push origin --delete feat/delivery-os-gates`

---

## Risk Assessment

**Risk: LOW** — All files are additive (new scripts, new CI gates, new docs). The only modification is `.gitignore` which adds one line. No existing functionality is changed.

The VPS entrypoint changes are NOT in git (bash scripts live on VPSes only, not in this repo). Those changes are documented in `docs/AUTONOMY_RUNTIME_WIRING.md` and the Port #18 proof pack.
