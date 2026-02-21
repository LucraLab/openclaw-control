# Proof: Sentinel WARN Policy — Baseline

**Date:** 2026-02-21T214826Z
**Branch:** ops/provider-drift-sentinel
**HEAD:** 0fd2c46

---

## Purpose

Capture the current sentinel + smoke suite behavior before adding
the `SENTINEL_WARN_IS_FAIL` policy switch.

## Current Behavior (no policy switch)

| Sentinel Exit | Smoke Suite Action |
|---------------|-------------------|
| 0 (OK) | Proceeds normally |
| 1 (WARN) | Prints WARN banner, continues to run all tests |
| 2 (FAIL) | Aborts immediately with exit 1 |

There is **no way** to make WARN abort the smoke suite.
This baseline documents that gap.

## Current Simulation Modes

| Mode | What It Simulates | Sentinel Exit |
|------|-------------------|---------------|
| `SENTINEL_SIMULATE=baseline_dead_chain` | Prior incident (dead chain + bad base URL) | 2 |
| _(none for WARN)_ | No WARN simulation exists yet | — |

## Gap

An operator who wants zero-tolerance (any provider issue = hard stop)
cannot achieve this without a new env flag.

## Next Step

Add `SENTINEL_SIMULATE=warn_upstream` to the sentinel, and
`SENTINEL_WARN_IS_FAIL=1` to the smoke suite preflight.

---

**sha256:** 640f9453f6d0c7fe4cc2b9127aec5fc75f5cc5813741a70b8b49b105fd3c5511
