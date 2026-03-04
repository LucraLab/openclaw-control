# Clean Tree Gate

**Version:** 1.0
**Date:** 2026-03-04
**Status:** Active

---

## Purpose

The **Clean Tree Gate** prevents accidental commits that include non-allowlisted changes. It enforces a fail-closed policy to ensure that only intended modifications are committed to the repository.

### Problem It Solves

**Scenario:**
- You're working on Port P2 which only allows changes to `docs/` and `proofs/`
- You accidentally modify `scripts/important.js` during testing
- Without the gate, you might commit both allowed and disallowed changes together
- **Result:** Scope creep, unintended changes, failed CI

**Solution:**
The Clean Tree Gate **fails immediately** if uncommitted changes exist outside the allowlist, forcing you to either:
1. Revert the non-allowlisted changes
2. Commit them separately with proper justification
3. Stash them for later

---

## How It Works

The gate uses `git status --porcelain=v1` to detect **all uncommitted changes** (staged and unstaged):
1. **No changes detected?** → ✅ **PASS**
2. **Changes detected + no allowlist?** → ❌ **FAIL** (lists all changes)
3. **Changes detected + allowlist specified?**
   - All changes within allowlist → ✅ **PASS**
   - Any change outside allowlist → ❌ **FAIL** (lists violations)

---

## Usage

### Basic Usage (No Allowlist)

Fails if **any** uncommitted changes exist:

```bash
node scripts/clean_tree_gate.js
```

**Output (clean tree):**
```
CLEAN_TREE_GATE: PASS
Working tree clean (no uncommitted changes)
```

**Output (changes detected):**
```
CLEAN_TREE_GATE: FAIL
Detected 3 uncommitted change(s):
  scripts/important.js
  registry/config.yaml
  docs/notes.md

Run with --allow to permit specific paths.
```

---

### With Allowlist

Permits changes **only** within specified path prefixes:

```bash
node scripts/clean_tree_gate.js --allow "docs/,proofs/"
```

**Output (all changes within allowlist):**
```
CLEAN_TREE_GATE: PASS
All 2 change(s) within allowlist:
  docs/NEW_FEATURE.md
  proofs/PROOF_P2_*.md

Allowlist prefixes: docs/, proofs/
```

**Output (violations detected):**
```
CLEAN_TREE_GATE: FAIL
Detected 1 change(s) outside allowlist:
  scripts/important.js

Allowlist prefixes: docs/, proofs/
```

---

## Recommended Workflows

### Workflow 1: Pre-Commit Check (Local Development)

Run the gate **before** staging changes:

```bash
# Check if you have any uncommitted changes
node scripts/clean_tree_gate.js --allow "docs/,proofs/"

# If PASS, proceed to commit
git add docs/ proofs/
git commit -m "docs: add new feature documentation (Port P2)"
```

### Workflow 2: CI Pipeline Integration

Add to `.github/workflows/` or CI config:

```yaml
- name: Clean Tree Gate
  run: node scripts/clean_tree_gate.js
```

This ensures no uncommitted changes are left in the working directory during CI builds.

### Workflow 3: Port Execution (Master Prompt)

The OpenClaw Master Prompt enforces this pattern:

```
1. Baseline proofs (tests + drift gates)
2. Run clean_tree_gate.js --allow "docs/,proofs/" (verify starting clean)
3. Implement changes (only modify allowlisted paths)
4. Run clean_tree_gate.js --allow "docs/,proofs/" (verify only allowlist changed)
5. Post-change verification (tests + drift gates)
6. Proof pack generation
```

---

## Exit Codes

| Code | Meaning | Example |
|------|---------|---------|
| `0` | **PASS** - Clean tree or all changes within allowlist | Safe to commit |
| `1` | **FAIL** - Uncommitted changes detected outside allowlist | Fix before committing |

---

## Allowlist Format

The `--allow` argument accepts a **comma-separated list** of path prefixes:

```bash
--allow "docs/,proofs/"
--allow "scripts/,tests/"
--allow "docs/,proofs/,ops/"
```

**Rules:**
1. Prefixes are matched from the **start** of the file path
2. Use **forward slashes** (even on Windows) - Git normalizes paths
3. Include trailing slash to match directories (e.g., `docs/` matches `docs/file.md`)
4. Paths are relative to repository root

**Examples:**

| Allowlist | Matches | Does NOT Match |
|-----------|---------|----------------|
| `docs/` | `docs/README.md`, `docs/guides/setup.md` | `README.md`, `src/docs.js` |
| `scripts/` | `scripts/gate.js`, `scripts/lib/utils.js` | `script.js`, `tests/scripts/` |
| `proofs/,ops/` | `proofs/P2.md`, `ops/report.md` | `docs/proofs.md` |

---

## Integration with Master Prompt

The Clean Tree Gate is designed to work with the **OpenClaw Master Prompt** (v3):

### Port Variable Configuration

```yaml
# In PORT_ID variables section
ALLOWLIST_PATHS:
  - docs/
  - proofs/

# Before implementation
$ node scripts/clean_tree_gate.js --allow "docs/,proofs/"
CLEAN_TREE_GATE: PASS

# After implementation
$ node scripts/clean_tree_gate.js --allow "docs/,proofs/"
CLEAN_TREE_GATE: PASS (with 3 changes in docs/ and proofs/)
```

### Fail-Closed Behavior

If the gate fails:
1. **STOP immediately** - Do not proceed with commit
2. **Review violations** - Check which files are outside allowlist
3. **Take action:**
   - Revert unintended changes: `git checkout -- <file>`
   - Stash for later: `git stash push <file>`
   - Commit separately: Handle in different port

---

## Troubleshooting

### Issue: Gate fails but I don't see the file in `git status`

**Cause:** File might be in `.gitignore` but staged

**Solution:**
```bash
git status --ignored
git rm --cached <file>  # Unstage ignored file
```

---

### Issue: Gate passes but file isn't in allowlist

**Cause:** Allowlist prefix might be too broad

**Example:**
```bash
--allow "docs"  # Matches docs/, docs.txt, documentation/
--allow "docs/" # Matches only docs/ directory
```

**Solution:** Always include trailing slash for directories.

---

### Issue: Windows path separators

**Cause:** Windows uses backslashes, Git uses forward slashes

**Solution:** The gate automatically normalizes paths. Use forward slashes in `--allow`:
```bash
# Correct (always use forward slashes)
--allow "docs/,proofs/"

# Incorrect (don't use backslashes)
--allow "docs\,proofs\"
```

---

## Testing

### Manual Test: Clean Tree

```bash
# Ensure working tree is clean
git status
# Should show: "nothing to commit, working tree clean"

# Run gate
node scripts/clean_tree_gate.js

# Expected output:
# CLEAN_TREE_GATE: PASS
# Working tree clean (no uncommitted changes)
```

### Manual Test: With Changes

```bash
# Create a test file
echo "test" > test_file.txt

# Run gate (no allowlist)
node scripts/clean_tree_gate.js

# Expected output:
# CLEAN_TREE_GATE: FAIL
# Detected 1 uncommitted change(s):
#   test_file.txt

# Cleanup
rm test_file.txt
```

### Manual Test: Allowlist

```bash
# Create test file in allowed location
echo "test" > docs/test.md

# Run gate with allowlist
node scripts/clean_tree_gate.js --allow "docs/,proofs/"

# Expected output:
# CLEAN_TREE_GATE: PASS
# All 1 change(s) within allowlist:
#   docs/test.md

# Cleanup
rm docs/test.md
```

---

## Automatic Enforcement

**Status:** ✅ **ENFORCED** (as of Port P3)

The Clean Tree Gate is automatically enforced by the following gate runner(s):

- **`scripts/run_drift_telemetry_gate.js`** - Primary drift detection gate

**How It Works:**
1. Gate runner calls: `node scripts/clean_tree_gate.js --allow "scripts/,docs/,proofs/,tax/"`
2. If FAIL → Gate chain stops immediately with `GATE_CHAIN: FAIL (clean_tree_gate)`
3. If PASS → Gate runner continues with drift/telemetry checks

**Allowlist History:**
- Port P3: Initial allowlist `scripts/,docs/,proofs/`
- Port P4.1: Expanded to include `tax/` for Tax Pod skeleton support

**Impact:**
- All CI builds will fail if uncommitted changes exist outside the allowlist
- Port commits (P1, P2, P3, etc.) that follow the allowlist pattern will pass
- Accidental mixed commits (allowed + disallowed changes) will be blocked

**To Override (Local Testing Only):**
If you need to temporarily bypass for local testing, modify the gate runner's allowlist argument. **Do not commit this change.**

---

## Security Considerations

1. **No secrets exposure:** The gate only prints file paths, never file contents
2. **Read-only operation:** Uses `git status` which doesn't modify any files
3. **Fail-closed:** Defaults to FAIL if any changes exist (unless allowlist specified)
4. **Deterministic:** Same inputs always produce same outputs (no randomness)

---

## Performance

- **Fast:** Typically completes in < 100ms
- **No dependencies:** Uses only Node.js stdlib and Git
- **No file I/O:** Reads status from Git index, not filesystem scanning
- **Scalable:** Performance independent of repository size (Git handles indexing)

---

## Related Gates

| Gate | Purpose | Relationship |
|------|---------|--------------|
| **Drift Telemetry Gate** | Detect config/workflow drift | Runs after Clean Tree Gate |
| **Isolation Guard** | Validate agent path scoping | Independent of tree state |
| **Arbitration** | Resource lock management | Independent of tree state |

The **Clean Tree Gate** should run **first** in any gate sequence to ensure a known-good starting state.

---

## Version History

**v1.0 (2026-03-04):**
- Initial implementation
- Support for `--allow` comma-separated allowlist
- Fail-closed default behavior
- Stable output format for parsing
- Full Windows/Linux compatibility

---

## References

- OpenClaw Master Prompt: `docs/CLAUDE_CODE_MASTER_PROMPT.md`
- Git Status Porcelain: https://git-scm.com/docs/git-status#_porcelain_format_version_1
- Port P2 Proof Pack: `proofs/PROOF_OPENCLAW_CONTROL_P2_CLEAN_TREE_GATE_*.md`

---

**End of Clean Tree Gate Documentation**
