# Verification Gate

The verification gate prevents committed "evidence artifacts" from
bypassing real CI verification. Every PR is checked for forbidden
proof files, and CI produces a fresh verification summary as a
build artifact (never committed).

## What counts as a forbidden evidence artifact

**Forbidden directories** (files under these are always rejected):

- `proofs/`
- `proof_packs/`
- `artifacts/`
- `logs/`
- `_logs/`
- `outputs/`
- `reports/`

**Forbidden filename patterns** (rejected anywhere except allowlisted docs):

- `PROOF_PACK` (case-insensitive)
- `SCAN_RESULTS` (case-insensitive)
- `regression` (case-insensitive)
- `test_output` (case-insensitive)
- `verification-summary.json` (must never be committed)

## How to document examples safely

Files under `docs/` are allowed if their path contains one of these
markers (case-insensitive):

- `EXAMPLE`
- `TEMPLATE`
- `SAMPLE`

For instance, `docs/PROOF_PACK_EXAMPLE.md` is allowed because it
contains the `EXAMPLE` marker. But `docs/PROOF_PACK_DEPLOY_V3.md`
would be rejected because it looks like a real evidence artifact.

## How to run locally

```bash
# Run the tests
node scripts/verification_gate.test.js

# Run the full gate (produces tmp/verification-summary.json)
node scripts/run_verification_gate.js
```

## CI behavior

The gate runs on every pull request via
`.github/workflows/gate-verification-fresh.yml`. It:

1. Runs 10 unit tests against the policy module
2. Scans changed files for forbidden evidence artifacts
3. Runs a quick schema validation and secret scan
4. Produces `verification-summary.json` as a GitHub Actions artifact

The check name is `verification-gate`.
