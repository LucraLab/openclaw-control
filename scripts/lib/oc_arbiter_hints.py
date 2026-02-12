#!/usr/bin/env python3
"""
oc_arbiter_hints.py — Apply executive strategy hints to arbiter ranking (Port #13)

Reads objective JSON lines from stdin, applies bounded rank deltas from hints file,
writes re-sorted JSON lines to stdout.

Safety guarantees:
  - rank_delta_hint clamped to [-10, +10]
  - STOP/HOLD/confidence<0.4/risk>=90 → delta forced to 0
  - Missing/invalid hints → passthrough (fail closed)
  - Never mutates objectives, never executes code

Usage (stdin filter):
  _enumerate_objectives | python3 oc_arbiter_hints.py --hints <path> --status-file <path>

Exit codes:
  0 = success (applied, skipped, or failclosed — always outputs objectives)
"""

import sys
import json
import os


VALID_RECOMMENDATION_CODES = {'STOP', 'HOLD', 'INVESTIGATE', 'PLAN', 'FOCUS', 'CONTAIN'}
HINTS_VERSION = '1.0.0'
MAX_DELTA = 10


def write_status(status_file, status):
    """Write status string to sideband file."""
    if status_file:
        try:
            with open(status_file, 'w') as f:
                f.write(status)
        except IOError:
            pass


def validate_hints(data):
    """Validate hints schema. Returns (valid: bool, reason: str)."""
    if not isinstance(data, dict):
        return False, 'not_an_object'
    if data.get('version') != HINTS_VERSION:
        return False, 'bad_version'
    if not isinstance(data.get('computed_at'), str) or not data['computed_at']:
        return False, 'bad_computed_at'
    hints = data.get('hints')
    if not isinstance(hints, list):
        return False, 'hints_not_array'

    for i, h in enumerate(hints):
        if not isinstance(h, dict):
            return False, f'hints[{i}]_not_object'
        if not isinstance(h.get('objective_id'), str) or not h['objective_id']:
            return False, f'hints[{i}]_bad_objective_id'
        if not isinstance(h.get('rank_delta_hint'), (int, float)):
            return False, f'hints[{i}]_bad_rank_delta'
        rc = h.get('recommendation_code')
        if rc not in VALID_RECOMMENDATION_CODES:
            return False, f'hints[{i}]_bad_recommendation_code:{rc}'

    return True, 'ok'


def apply_safety_override(hint):
    """Check if safety override forces delta=0."""
    if hint.get('recommendation_code') in ('STOP', 'HOLD'):
        return True
    if isinstance(hint.get('confidence'), (int, float)) and hint['confidence'] < 0.4:
        return True
    if isinstance(hint.get('risk_score'), (int, float)) and hint['risk_score'] >= 90:
        return True
    return False


def main():
    # Parse arguments
    hints_file = None
    status_file = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--hints' and i + 1 < len(args):
            hints_file = args[i + 1]
            i += 2
        elif args[i] == '--status-file' and i + 1 < len(args):
            status_file = args[i + 1]
            i += 2
        else:
            i += 1

    # Read ALL objectives from stdin first (buffered for fail-closed safety)
    objectives = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            objectives.append(json.loads(line))
        except (json.JSONDecodeError, ValueError):
            continue

    def passthrough():
        """Output objectives unchanged."""
        for obj in objectives:
            print(json.dumps(obj))

    # Check hints file exists
    if not hints_file or not os.path.isfile(hints_file):
        passthrough()
        write_status(status_file, 'SKIPPED:missing_hints_file')
        return

    # Read and parse hints
    try:
        with open(hints_file, 'r') as f:
            hints_data = json.load(f)
    except (json.JSONDecodeError, IOError, ValueError):
        passthrough()
        write_status(status_file, 'FAILCLOSED:corrupt_hints_file')
        return

    # Validate schema
    valid, reason = validate_hints(hints_data)
    if not valid:
        passthrough()
        write_status(status_file, f'FAILCLOSED:invalid_schema:{reason}')
        return

    # Build hint lookup by objective_id
    hint_map = {}
    for h in hints_data.get('hints', []):
        hint_map[h['objective_id']] = h

    # Apply deltas and track original position
    for idx, obj in enumerate(objectives):
        obj_id = obj.get('objective_id', '')
        hint = hint_map.get(obj_id)
        if hint:
            delta = hint.get('rank_delta_hint', 0)
            # Clamp to [-10, +10]
            delta = max(-MAX_DELTA, min(MAX_DELTA, int(round(delta))))
            # Safety override
            if apply_safety_override(hint):
                delta = 0
            obj['_rank_delta'] = delta
        else:
            obj['_rank_delta'] = 0
        obj['_original_position'] = idx

    # Re-sort: higher delta first, ties broken by original position (stable)
    objectives.sort(key=lambda x: (-x.get('_rank_delta', 0), x.get('_original_position', 0)))

    # Count applied (non-zero deltas)
    applied_count = sum(1 for o in objectives if o.get('_rank_delta', 0) != 0)

    # Output cleaned objectives
    for obj in objectives:
        obj.pop('_rank_delta', None)
        obj.pop('_original_position', None)
        print(json.dumps(obj))

    write_status(status_file, f'APPLIED:count={applied_count}')


if __name__ == '__main__':
    main()
