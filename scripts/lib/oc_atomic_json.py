#!/usr/bin/env python3
"""oc_atomic_json.py — Atomic JSON write with root containment validation.

Usage (CLI):
    echo '{"key":"value"}' | python3 scripts/lib/oc_atomic_json.py target.json --root /safe/dir

Usage (import):
    from oc_atomic_json import atomic_write_json
    atomic_write_json('/path/to/file.json', {"key": "value"}, root='/safe/dir')

Exit codes:
    0 = success
    1 = path traversal / containment violation
    2 = write error
    3 = invalid JSON on stdin
"""

import json
import os
import stat
import sys
import tempfile


def atomic_write_json(filepath, data, root=None):
    """Write JSON to filepath atomically.

    Steps:
        1. Resolve filepath and validate containment under root (if provided)
        2. Write to temp file in same directory
        3. chmod 600 (owner read/write only)
        4. Rename to target (atomic on same filesystem)

    Returns True on success.
    Raises ValueError on path traversal, OSError on write failure.
    """
    filepath = os.path.abspath(filepath)

    if root is not None:
        root = os.path.abspath(root)
        # Must be under root or equal to root
        if not filepath.startswith(root + os.sep) and filepath != root:
            raise ValueError(
                f"Path escapes root: {filepath} (root: {root})"
            )

    # Ensure parent directory exists
    parent = os.path.dirname(filepath)
    os.makedirs(parent, mode=0o700, exist_ok=True)

    # Write to temp file in same directory for atomic rename
    fd, tmp_path = tempfile.mkstemp(dir=parent, prefix='.oc_', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        os.chmod(tmp_path, stat.S_IRUSR | stat.S_IWUSR)
        os.rename(tmp_path, filepath)
        return True
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def main():
    """CLI: read JSON from stdin, write atomically to filepath."""
    import argparse
    parser = argparse.ArgumentParser(description='Atomic JSON write')
    parser.add_argument('filepath', help='Target file path')
    parser.add_argument('--root', default=None, help='Root directory for containment check')
    args = parser.parse_args()

    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON on stdin: {e}", file=sys.stderr)
        sys.exit(3)

    try:
        atomic_write_json(args.filepath, data, root=args.root)
    except ValueError as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        sys.exit(1)
    except OSError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
