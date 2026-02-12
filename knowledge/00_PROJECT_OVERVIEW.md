# Project Overview

**Last Verified Commit:** `b298289` (main)

## What This Repo Is

LucraLab/openclaw-control is a deterministic delivery orchestration system
that ranks objectives, recommends actions, and manages multi-stage delivery
pipelines. The Executive Strategy Engine scores objectives via three
intelligence lenses (dev, ops, business), produces advisory hints for the
Arbiter, and generates receipts-first evidence graphs explaining every
derivation. All outputs are artifacts — JSON and Markdown — consumed
downstream by the Arbiter's main arbitration loop.

## Non-Negotiable Safety Posture

| Rule | Detail |
|------|--------|
| **Fail closed** | Every module returns a safe default on any error. No crash, no partial output. |
| **Zero regressions** | A new port must not break any existing test or gate. |
| **Advisory only** | Strategy scores and hints never mutate objectives, execute code, or bypass kill switch / quarantine. |
| **Deterministic** | Same inputs produce byte-identical output (caller supplies timestamps). |
| **No secrets in artifacts** | All outputs are sanitized via `SECRET_PATTERN` before writing. |
| **Branch protection** | Main requires all 15 CI checks to pass before merge. |

## "Never Do" List

1. **Never weaken a gate** — do not reduce check counts, remove required contexts, or skip fixture validation.
2. **Never weaken branch protection** — only add new checks; never remove existing ones except temporarily for bootstrap merge (restore immediately after).
3. **Never weaken supply-chain enforcement** — `scan-secrets`, `scan-public-safe`, and `two-stage-pr-review` are permanent required checks.
4. **Never commit secrets** — no tokens, keys, passwords, private IPs, or auth headers in any file.
5. **Never shell out to network in tests** — all CI gates are fixture-only.
6. **Never use LLM by default** — `llm_enabled` defaults to `false`; never enabled in CI.
7. **Never mutate objectives** — strategy engine, hints, and evidence graph are read-only / advisory.
8. **Never bypass kill switch or quarantine** — safety overrides are unconditional.

## Repo Layout

```
.github/workflows/     CI workflow files (one per gate + release)
artifacts/             Generated JSON/MD artifacts (gitignored, produced by gates)
bootstrap/             Bootstrap configuration
bundles/               Release bundles
capabilities/          Capability definitions
docs/                  Feature documentation (one .md per port)
knowledge/             Stable project knowledge files (this directory)
ops/                   Operational scripts and configs
plans/                 Port task plans (plans/obj-N/task-M.md)
proofs/                Proof packs from port completions
registry/              Agent/module registry
scripts/               Core code, tests, gate runners, fixtures
  ├── modules/         Intelligence lenses (dev_intel, ops_intel, business_intel)
  ├── lib/             Shell + Python libraries (events, paths, quarantine, hints)
  ├── fixtures/        Test fixtures (branch protection, strategy, hints)
  ├── *_gate.js        CI gate runners (run_*_gate.js)
  ├── *.test.js        Test suites
  └── *.js / *.sh      Core modules and shell scripts
skills/                Skill definitions
tmp/                   Temporary files (gitignored, produced by gates)
```

## Assumptions / Invariants

- Node.js >= 18, Python 3.9+ available in CI.
- All gates run on `ubuntu-latest` via GitHub Actions.
- The Arbiter (`scripts/arbiter.sh`) reads objectives via `_enumerate_objectives()` (Python inline, sorts by `created_at` then `objective_id`).
- Hints are applied as a pipe filter between `_enumerate_objectives` and the main arbitration loop.
- Evidence graph is built post-hoc from engine report + hints; it does not modify scoring internals.
