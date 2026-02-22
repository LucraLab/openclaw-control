# PROOF: TaxPod PORT1 — Baseline
**Generated:** 2026-02-22T00:07:30Z
**Operator:** Claude (automated)
**Repo SHA:** 8075f0cf7fbfac95fcec5df922a49cedca32eaf4
**Branch base:** taxpod/port0-1-tn-coverage-proof

## Existing PORT0 Artifacts
| File | Purpose |
|------|---------|
| ops/taxpod/export_payment_plan_bundle_v1.js | Bundle exporter (Node.js) |
| ops/taxpod/export_payment_plan_bundle_v1.sh | Bash wrapper |
| ops/taxpod/schemas/payment_plan_bundle_v1.schema.json | Bundle manifest schema |
| ops/taxpod/tests/test_export_bundle_v1.sh | 34-check test suite |
| ops/taxpod/fixtures/bundles/case_demo_1/ | Original fixture |
| ops/taxpod/fixtures/bundles/case_demo_tn/ | TN coverage fixture |

## Live Bundle Paths
| Case | UTC | Path |
|------|-----|------|
| mcdonald-family | 20260221T231418Z | /home/openclaw/.openclaw/tax_inputs/bundles/mcdonald-family/20260221T231418Z/payment_plan_bundle_v1/ |
| mcdonald-family-tn | 20260221T233958Z | /home/openclaw/.openclaw/tax_inputs/bundles/mcdonald-family-tn/20260221T233958Z/payment_plan_bundle_v1/ |

## PORT1 New Files Plan
| File | Purpose |
|------|---------|
| docs/taxpod/PAYMENT_PLAN_MODEL_V1.md | Contract specification |
| ops/taxpod/build_payment_plan_model_v1.js | Model builder (Node.js) |
| ops/taxpod/render_financial_docs_needed_md.js | Markdown checklist renderer |
| ops/taxpod/run_port1_payment_capacity.sh | Orchestration wrapper |
| ops/taxpod/fixtures/port1/case_tight/bundle/liability_snapshot.json | Tight-budget fixture |
| ops/taxpod/fixtures/port1/case_tight/intake/financial_intake.json | Tight-budget intake |
| ops/taxpod/fixtures/port1/case_tight/expected/payment_plan_model.json | Expected model output |
| ops/taxpod/fixtures/port1/case_tight/expected/financial_docs_needed.md | Expected checklist |
| ops/taxpod/fixtures/port1/case_stressed/bundle/liability_snapshot.json | Stressed fixture |
| ops/taxpod/fixtures/port1/case_stressed/intake/financial_intake.json | Stressed intake |
| ops/taxpod/fixtures/port1/case_stressed/expected/payment_plan_model.json | Expected model output |
| ops/taxpod/fixtures/port1/case_stressed/expected/financial_docs_needed.md | Expected checklist |
| ops/taxpod/tests/test_port1_payment_model_v1.sh | PORT1 test runner |
| ops/proofs/PROOF_TAXPOD_PORT1_BASELINE_2026-02-22T000730Z.md | This file |
| ops/proofs/PROOF_TAXPOD_PORT1_RUN_<UTC>.md | Live run proof |
