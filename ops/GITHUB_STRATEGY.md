# GITHUB_STRATEGY.md — OpenClaw Control Plane Repository
## Version 1.0.0 | 2026-02-11

---

## 1. Repository Strategy

### Single Control Repo (Phase 1)

Create **one repository** called `openclaw-control` under the `mcdonjam82` GitHub account. This repo becomes the single source of truth for:

- Platform inventories (both VPSes)
- Role registry (canonical, merged)
- Bootstrap specifications
- Operational runbooks and SOPs
- Sanitized proof packs
- Schema definitions for policy/registry validation
- CI gates that enforce correctness

**Why one repo, not many:**
- The platform is small (2 VPSes, 13 agents)
- All governance artifacts reference each other
- One PR can update related artifacts atomically
- Simpler CI, simpler CODEOWNERS, simpler mental model

**When to split (Phase 2, future):**
- If agent teams need independent release cycles
- If secret management requires separate access controls
- If the repo grows beyond ~500 files

### Relationship to Existing Repos

| Existing Repo | Relationship to openclaw-control |
|---|---|
| mcdonjam82/ai-assistant | Application code — NOT in control repo |
| mcdonjam82/lucralab-ai-sdr-platform | Application code — NOT in control repo |
| mcdonjam82/lucralab-ai-receptionist | Application code — NOT in control repo |
| mcdonjam82/unified-dashboard | Application code — NOT in control repo |
| mcdonjam82/audit_tool | Application code — NOT in control repo |
| lucralab-personal/youtube-intelligence | Application code — NOT in control repo |
| **mcdonjam82/openclaw-control** | **NEW — Governance/ops artifacts only** |

The control repo holds **governance**, not code. Application code stays in its own repo. The control repo references application repos but never duplicates their code.

---

## 2. Branch Protection Rules

### `main` Branch

| Rule | Setting | Why |
|---|---|---|
| Require pull request | YES | All changes reviewed before merge |
| Required approvals | 1 (James or Dude dispatch) | Prevents unreviewed changes |
| Dismiss stale approvals | YES | Re-review after new pushes |
| Require status checks | YES | CI must pass (schema lint, secret scan) |
| Require branches up to date | YES | No stale merges |
| Restrict who can push | James only | No direct pushes, even from automation |
| Allow force push | NO | Never lose history |
| Allow deletion | NO | Protect main branch |

### Working Branches

| Pattern | Purpose | Rules |
|---|---|---|
| `inventory/*` | Snapshot updates | Require schema validation CI |
| `registry/*` | Role registry changes | Require schema validation + capability lint |
| `ops/*` | Runbook/proof pack additions | Require markdown lint |
| `hotfix/*` | Emergency changes | Same rules as main, but expedited review |

---

## 3. PR Labels

| Label | Color | Purpose |
|---|---|---|
| `inventory-update` | #0075ca | ORG_SNAPSHOT or service inventory changes |
| `registry-change` | #e4e669 | Role registry modifications |
| `bootstrap-change` | #d876e3 | Bootstrap spec updates |
| `runbook` | #0e8a16 | New or updated runbook |
| `proof-pack` | #c5def5 | Sanitized proof pack addition |
| `ci-gates` | #f9d0c4 | CI/CD workflow changes |
| `security` | #b60205 | Security-relevant change (extra review) |
| `breaking` | #d93f0b | Breaking change to registry schema |

---

## 4. CODEOWNERS Model

```
# File: .github/CODEOWNERS
# Default: James owns everything
*                                   @mcdonjam82

# Inventory updates — James
/inventory/                         @mcdonjam82

# Registry changes — require James (critical)
/registry/                          @mcdonjam82

# Bootstrap spec — require James
/bootstrap/                         @mcdonjam82

# Ops docs — James
/ops/                               @mcdonjam82

# CI workflows — James (security-sensitive)
/.github/                           @mcdonjam82
```

**Future:** When Builder agents can create PRs, add `@lucralab-builders` team as reviewers for `/ops/proofs/` (read-only additions).

---

## 5. Environment Gates

### Current (Phase 1)
No deployment from this repo — it's governance artifacts only. Changes take effect when:
1. PR merged to `main`
2. GitHub Release created with tagged version
3. Release asset (bundle) downloaded to VPS manually or via dispatch

### Future (Phase 2)
| Environment | Gate | What Happens |
|---|---|---|
| `staging` | PR approved + CI passes | Bundle published as pre-release |
| `production` | Release tagged + James approves | Bundle downloaded to VPS via dispatch |

### Capability Token Approach

The registry defines what tools each role CAN use (the "capability catalog"). But having a capability listed does NOT grant access — execution is gated by:

1. **Registry** defines allowed_tools per role (visible, declarative)
2. **OpenClaw gateway** enforces tool access (runtime gate)
3. **Dispatch gates** control state-changing commands (approval tokens)
4. **Budget caps** limit LLM spend (LiteLLM enforcement)

This means the control repo is a **policy declaration layer**, not an execution layer. An agent seeing `exec` in their allowed_tools doesn't mean they can execute anything — the gateway still applies sandboxing.

---

## 6. Versioning Approach

### Registry Versions
Format: `registry@YYYY.MM.DD.N` (N = sequential within day)

Examples:
- `registry@2026.02.11.1` — First version today
- `registry@2026.02.11.2` — Second change today

### Inventory Versions
Format: `inventory-<vps>@YYYY.MM.DD`

Examples:
- `inventory-dashboard@2026.02.10`
- `inventory-builder@2026.02.10`

### Bootstrap Versions
Format: `bootstrap@N.M.P` (semver)
- Major: Breaking changes to onboarding contract
- Minor: New optional fields/steps
- Patch: Clarifications/typos

---

## 7. Implementation Commands

### Windows PowerShell (from Developer Workstation)

```powershell
# Navigate to workspace
cd C:\Users\james\.ssh\Workspace

# Create the repo directory
mkdir openclaw-control
cd openclaw-control

# Initialize git
git init -b main

# Create the folder structure
mkdir -p inventory/dashboard, inventory/builder
mkdir -p registry/schema
mkdir -p bootstrap
mkdir -p ops/runbooks, ops/proofs
mkdir -p .github/workflows

# Copy existing deliverables into the repo
# (From the deploy-skippy deliverables folder)
Copy-Item "..\deploy-skippy\deliverables\DASHBOARD_ORG_SNAPSHOT.md" "inventory\dashboard\ORG_SNAPSHOT.md"
Copy-Item "..\deploy-skippy\deliverables\ORG_SNAPSHOT.md" "inventory\builder\ORG_SNAPSHOT.md" -ErrorAction SilentlyContinue
Copy-Item "..\deploy-skippy\deliverables\control-plane\MERGED_ROLE_REGISTRY.yaml" "registry\ROLE_REGISTRY.yaml"
Copy-Item "..\deploy-skippy\deliverables\BOOTSTRAP_SPEC_V1.md" "bootstrap\BOOTSTRAP_SPEC.md" -ErrorAction SilentlyContinue
Copy-Item "..\deploy-skippy\deliverables\DASHBOARD_BOOTSTRAP_SPEC_V1.md" "bootstrap\DASHBOARD_SUPPLEMENT.md"
Copy-Item "..\deploy-skippy\deliverables\control-plane\TRIAGE_REPORT.md" "ops\runbooks\TRIAGE_REPORT_20260211.md"
Copy-Item "..\deploy-skippy\deliverables\control-plane\CONTROL_REPO_LAYOUT.md" "."
Copy-Item "..\deploy-skippy\deliverables\control-plane\CI_GATES_PLAN.md" ".github\"
Copy-Item "..\deploy-skippy\deliverables\control-plane\GITHUB_STRATEGY.md" "."

# Create .gitignore
@"
# Never commit secrets
.env
*.key
*.pem
credentials/
secrets/

# No raw proof dumps (use sanitized versions)
*.raw.log
*.raw.txt

# OS files
.DS_Store
Thumbs.db
"@ | Out-File -Encoding utf8 .gitignore

# Create initial commit
git add -A
git commit -m "feat: initialize openclaw-control governance repo

Includes:
- Inventory snapshots for Dashboard + Builder VPSes
- Merged role registry (10 roles, current assignments)
- Bootstrap specification (agent + service onboarding)
- Initial triage report (crash loops diagnosed)
- CI gates plan
- GitHub strategy document

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

# Create the GitHub repo (private)
gh repo create mcdonjam82/openclaw-control --private --source=. --push --description "OpenClaw platform governance: inventories, role registry, bootstrap specs, ops runbooks"

# Set up branch protection (after repo is created)
gh api repos/mcdonjam82/openclaw-control/branches/main/protection -X PUT -f "required_status_checks[strict]=true" -f "required_status_checks[contexts][]=schema-validation" -f "enforce_admins=false" -f "required_pull_request_reviews[required_approving_review_count]=1" -f "restrictions=null"
```

### Linux Bash (from Dashboard VPS)

```bash
# Navigate to home
cd /root

# Clone deliverables from proof folders
mkdir -p /tmp/openclaw-control/{inventory/dashboard,inventory/builder,registry/schema,bootstrap,ops/runbooks,ops/proofs,.github/workflows}

# Copy dashboard inventory
cp /root/proofs/org_discovery_dashboard_20260210T223433Z/DASHBOARD_ORG_SNAPSHOT.md \
   /tmp/openclaw-control/inventory/dashboard/ORG_SNAPSHOT.md

# Copy builder inventory (via Tailscale SSH)
ssh -o ConnectTimeout=10 openclaw2@100.75.216.57 \
  "cat /home/openclaw/.openclaw/proofs/org_discovery_20260210T221708Z/ORG_SNAPSHOT.md" \
  > /tmp/openclaw-control/inventory/builder/ORG_SNAPSHOT.md

# Copy merged registry (uploaded from local)
# (This file is generated and SCP'd from Windows)

cd /tmp/openclaw-control

# Initialize git
git init -b main

# Create .gitignore
cat > .gitignore << 'GITIGNORE'
# Never commit secrets
.env
*.key
*.pem
credentials/
secrets/

# No raw proof dumps (use sanitized versions)
*.raw.log
*.raw.txt

# OS files
.DS_Store
Thumbs.db
GITIGNORE

# Stage and commit
git add -A
git commit -m "feat: initialize openclaw-control governance repo

Includes:
- Inventory snapshots for Dashboard + Builder VPSes
- Merged role registry (10 roles, current assignments)
- Bootstrap specification (agent + service onboarding)
- Initial triage report (crash loops diagnosed)
- CI gates plan
- GitHub strategy document

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

# Create the GitHub repo (private)
gh repo create mcdonjam82/openclaw-control \
  --private \
  --source=. \
  --push \
  --description "OpenClaw platform governance: inventories, role registry, bootstrap specs, ops runbooks"
```

---

## 8. What MUST NOT Be Committed

| Category | Examples | Why |
|---|---|---|
| **Secrets** | API keys, passwords, tokens | Security — use .env on VPS only |
| **Raw proof dumps** | Unredacted command outputs | May contain env vars, IPs, keys |
| **Database dumps** | .sql files, backup archives | PII and credentials |
| **Node modules** | node_modules/ | Not governance artifacts |
| **Credential files** | .pem, .key, hosts.yml | Direct security exposure |
| **Large binary files** | Docker images, archives | Not appropriate for git |

---

## 9. Future Enhancements

1. **Automated inventory refresh** — Cron job runs discovery script, creates PR with updated snapshot
2. **Agent-initiated PRs** — Builder agents can propose registry changes via GitHub API
3. **Webhook notifications** — Slack/Telegram alerts on registry changes
4. **Audit log** — Git history serves as audit trail for all governance changes
5. **Bundle publishing** — GitHub Releases contain downloadable context bundles for agent onboarding
