# delivery_loop_v1 — Threat Model

## What This Skill Refuses To Do

### Hard Blocks (exit 1, no override)

| Threat | Control | Why |
|--------|---------|-----|
| Commit secrets | Pre-commit scan + CI `scan-secrets` gate | Secrets in public repo = breach |
| Commit real IPs/hostnames | Pre-commit scan + CI `scan-public-safe` gate | Public repo exposes infrastructure |
| Push to non-allowed repo | Hard-coded allowlist (`LucraLab/openclaw-control` only) | Blast radius containment |
| Force push | `--force` flag never used | Branch protection + history preservation |
| Deploy to production | No prod deploy path exists in v1 | Staging only scope |
| Modify CI workflows | `.github/workflows/` in forbidden paths | Prevents gate weakening |
| Add binary files | Extension blocklist in pre-commit | Prevents blob bloat + hiding secrets |
| Send outbound comms | `outbound_comms` in forbidden_ops | No email/SMS/Slack from delivery loop |
| Rotate secrets | `secret_rotation` in forbidden_ops | Out of scope, requires manual process |
| Skip QA gate | `qa-approved` label required by branch protection | QA review is non-negotiable |
| Skip CODEOWNERS review | Branch protection enforces CODEOWNERS | Code ownership is non-negotiable |
| Merge with failing checks | Branch protection requires `scan-secrets`, `scan-public-safe`, `qa-gate` | CI gates are non-negotiable |

### Soft Blocks (warn + require explicit override)

| Threat | Control | Override |
|--------|---------|---------|
| Medium-risk change | Extra review notes required | CODEOWNERS approval |
| High-risk change | 2 approvals + explicit sign-off | CODEOWNERS + admin approval |
| Large diff (>500 lines) | Warning emitted | Continue with review |

## Attack Vectors Considered

### 1. Prompt Injection via Objective Title

**Risk:** Malicious objective title containing shell metacharacters.
**Control:** All user inputs quoted and passed through JSON encoding, never interpolated into shell commands directly.

### 2. Secret Exfiltration via PR Content

**Risk:** Skill accidentally includes secrets in committed files.
**Control:** Pre-commit scan in `delivery_loop.sh` runs the same patterns as CI `scan-secrets` gate. Double-checked by GitHub Actions.

### 3. Gate Bypass via Label Manipulation

**Risk:** Unauthorized user adds `qa-approved` label.
**Control:** `gate-qa-approval.yml` verifies label provenance (who added it). Only authorized users accepted.

### 4. Repo Escape (targeting wrong repo)

**Risk:** Objective specifies a different repo to expand blast radius.
**Control:** Hard-coded allowlist in both `skill.yaml` and `delivery_loop.sh`. Checked before any git operation.

### 5. State Tampering (modifying task files)

**Risk:** Adversary modifies task state files to skip gates.
**Control:** Task state files are 600-permission. Delivery loop re-validates gate status from GitHub API before any merge action.

### 6. Stale Approval Attack

**Risk:** PR approved, then new push adds malicious content.
**Control:** Branch protection has `dismiss_stale_reviews: true` and `require_last_push_approval: true`.

## Trust Boundaries

```text
+-------------------+     +-------------------+     +------------------+
|  Delivery OS      |     |  GitHub           |     |  CI Runners      |
|  (Builder VPS)    |<--->|  (github.com)     |<--->|  (ubuntu-latest) |
|                   |     |                   |     |                  |
|  objectives/      |     |  PRs, branches    |     |  gate-secrets    |
|  tasks/           |     |  labels, reviews  |     |  gate-publicsafe |
|  events/          |     |  CODEOWNERS       |     |  gate-qa-approval|
+-------------------+     +-------------------+     +------------------+
        ^                         ^
        |                         |
   File perms (600)          Branch protection
   Workspace isolation       enforce_admins=true
```

## Residual Risks (Accepted)

| Risk | Mitigation | Residual |
|------|-----------|----------|
| gh token compromise | Token scoped to repo, stored in gh config | If compromised, can push to allowed repos |
| CI runner compromise | GitHub-hosted runners, ephemeral | Low probability, GitHub's responsibility |
| CODEOWNERS single owner | Only @mcdonjam82 currently | Bus factor = 1, acceptable for v1 |
| Public repo visibility | All gates enforce public-safe content | Content is intentionally public |
