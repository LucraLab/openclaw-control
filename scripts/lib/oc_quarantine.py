#!/usr/bin/env python3
"""oc_quarantine.py — Quarantine management for Delivery OS (Port #11)

Atomic read/write of quarantine.json with threshold-based auto-quarantine.

Usage (CLI):
    python3 oc_quarantine.py record <quarantine_file> <obj_id> <event_type> [detail]
    python3 oc_quarantine.py check  <quarantine_file> <obj_id>
    python3 oc_quarantine.py remove <quarantine_file> <obj_id>
    python3 oc_quarantine.py list   <quarantine_file>
    python3 oc_quarantine.py valid  <quarantine_file>

Event types: failure | breach | arb_block

Exit codes:
    0 = success / is quarantined / is valid
    1 = not quarantined / not found
    2 = file corrupt (fail closed)
    3 = write error
"""

import json
import os
import stat
import sys
import tempfile
import time
from datetime import datetime, timezone

# Default thresholds (configurable via env)
THRESHOLDS = {
    'failure':   {'count': int(os.environ.get('OC_QUARANTINE_FAILURE_COUNT', '3')),
                  'window_hours': int(os.environ.get('OC_QUARANTINE_FAILURE_WINDOW_H', '24'))},
    'breach':    {'count': int(os.environ.get('OC_QUARANTINE_BREACH_COUNT', '2')),
                  'window_hours': int(os.environ.get('OC_QUARANTINE_BREACH_WINDOW_H', '24'))},
    'arb_block': {'count': int(os.environ.get('OC_QUARANTINE_ARB_COUNT', '5')),
                  'window_hours': int(os.environ.get('OC_QUARANTINE_ARB_WINDOW_H', '1'))},
}


def _now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _read_quarantine(filepath):
    """Read quarantine.json. Returns dict or raises ValueError on corrupt."""
    if not os.path.exists(filepath):
        return {}
    with open(filepath) as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError('quarantine.json root is not an object')
    return data


def _write_quarantine(filepath, data):
    """Write quarantine.json atomically."""
    parent = os.path.dirname(filepath) or '.'
    os.makedirs(parent, mode=0o700, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=parent, prefix='.oc_q_', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        os.chmod(tmp_path, stat.S_IRUSR | stat.S_IWUSR)
        os.rename(tmp_path, filepath)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def record_event(filepath, obj_id, event_type, detail=''):
    """Record an event for an objective. Returns (quarantined_now, entry)."""
    data = _read_quarantine(filepath)

    entry = data.get(obj_id, {})
    if not isinstance(entry, dict):
        entry = {}

    events = entry.get('events', [])
    if not isinstance(events, list):
        events = []

    events.append({
        'type': event_type,
        'at': _now_iso(),
        'detail': detail[:200] if detail else ''
    })
    entry['events'] = events

    # Check threshold
    thresh = THRESHOLDS.get(event_type)
    if thresh:
        window_sec = thresh['window_hours'] * 3600
        cutoff = time.time() - window_sec
        cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

        recent = [e for e in events if e.get('type') == event_type and e.get('at', '') >= cutoff_iso]

        if len(recent) >= thresh['count'] and not entry.get('quarantined'):
            entry['quarantined'] = True
            entry['quarantined_at'] = _now_iso()
            entry['reason'] = f'repeated_{event_type}'

    data[obj_id] = entry
    _write_quarantine(filepath, data)

    return entry.get('quarantined', False), entry


def is_quarantined(filepath, obj_id):
    """Check if an objective is quarantined. Returns True/False.
    Raises ValueError on corrupt file."""
    data = _read_quarantine(filepath)
    entry = data.get(obj_id, {})
    if not isinstance(entry, dict):
        return False
    return entry.get('quarantined', False)


def remove_quarantine(filepath, obj_id):
    """Remove quarantine for an objective. Returns True if found, False if not."""
    data = _read_quarantine(filepath)
    if obj_id not in data:
        return False
    entry = data[obj_id]
    if isinstance(entry, dict):
        entry['quarantined'] = False
        entry.pop('quarantined_at', None)
        entry.pop('reason', None)
    data[obj_id] = entry
    _write_quarantine(filepath, data)
    return True


def list_quarantines(filepath):
    """List all quarantined objectives. Returns list of (obj_id, entry) tuples."""
    data = _read_quarantine(filepath)
    result = []
    for obj_id, entry in sorted(data.items()):
        if isinstance(entry, dict) and entry.get('quarantined'):
            result.append((obj_id, entry))
    return result


def is_valid(filepath):
    """Check if quarantine.json is valid. Returns True/False."""
    try:
        _read_quarantine(filepath)
        return True
    except (json.JSONDecodeError, ValueError, OSError):
        return False


def main():
    if len(sys.argv) < 3:
        print('Usage: oc_quarantine.py <command> <quarantine_file> [args...]', file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    filepath = sys.argv[2]

    if cmd == 'record':
        if len(sys.argv) < 5:
            print('Usage: oc_quarantine.py record <file> <obj_id> <event_type> [detail]', file=sys.stderr)
            sys.exit(1)
        obj_id = sys.argv[3]
        event_type = sys.argv[4]
        detail = sys.argv[5] if len(sys.argv) > 5 else ''
        try:
            quarantined, entry = record_event(filepath, obj_id, event_type, detail)
            if quarantined:
                print(f'QUARANTINED: {obj_id} ({entry.get("reason", "unknown")})')
                sys.exit(0)
            else:
                print(f'RECORDED: {obj_id} {event_type}')
                sys.exit(1)  # not quarantined yet
        except (json.JSONDecodeError, ValueError):
            print('ERROR: quarantine.json is corrupt', file=sys.stderr)
            sys.exit(2)
        except OSError as e:
            print(f'ERROR: {e}', file=sys.stderr)
            sys.exit(3)

    elif cmd == 'check':
        if len(sys.argv) < 4:
            print('Usage: oc_quarantine.py check <file> <obj_id>', file=sys.stderr)
            sys.exit(1)
        obj_id = sys.argv[3]
        try:
            if is_quarantined(filepath, obj_id):
                print(f'QUARANTINED: {obj_id}')
                sys.exit(0)
            else:
                print(f'NOT_QUARANTINED: {obj_id}')
                sys.exit(1)
        except (json.JSONDecodeError, ValueError):
            print('CORRUPT: quarantine.json is corrupt — fail closed', file=sys.stderr)
            sys.exit(2)

    elif cmd == 'remove':
        if len(sys.argv) < 4:
            print('Usage: oc_quarantine.py remove <file> <obj_id>', file=sys.stderr)
            sys.exit(1)
        obj_id = sys.argv[3]
        try:
            if remove_quarantine(filepath, obj_id):
                print(f'UNQUARANTINED: {obj_id}')
                sys.exit(0)
            else:
                print(f'NOT_FOUND: {obj_id}')
                sys.exit(1)
        except (json.JSONDecodeError, ValueError):
            print('ERROR: quarantine.json is corrupt', file=sys.stderr)
            sys.exit(2)
        except OSError as e:
            print(f'ERROR: {e}', file=sys.stderr)
            sys.exit(3)

    elif cmd == 'list':
        try:
            entries = list_quarantines(filepath)
            if not entries:
                print('No quarantined objectives')
                sys.exit(0)
            for obj_id, entry in entries:
                reason = entry.get('reason', 'unknown')
                at = entry.get('quarantined_at', 'unknown')
                print(f'  {obj_id}: reason={reason} quarantined_at={at}')
            sys.exit(0)
        except (json.JSONDecodeError, ValueError):
            print('ERROR: quarantine.json is corrupt', file=sys.stderr)
            sys.exit(2)

    elif cmd == 'valid':
        if is_valid(filepath):
            print('VALID')
            sys.exit(0)
        else:
            print('CORRUPT')
            sys.exit(1)

    else:
        print(f'Unknown command: {cmd}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
