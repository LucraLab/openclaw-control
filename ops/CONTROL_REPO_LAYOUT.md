# CONTROL_REPO_LAYOUT.md — openclaw-control Repository Structure
## Version 1.0.0 | 2026-02-11

---

## Folder Tree

```
openclaw-control/
│
├── .github/
│   ├── CODEOWNERS                    # Ownership rules
│   ├── workflows/
│   │   ├── schema-validation.yml     # Validate registry YAML on every PR
│   │   ├── secret-scan.yml           # Scan for leaked secrets
│   │   └── capability-lint.yml       # Check for forbidden tool grants
│   └── PULL_REQUEST_TEMPLATE.md      # PR template with checklist
│
├── inventory/
│   ├── dashboard/
│   │   └── ORG_SNAPSHOT.md           # Dashboard VPS authoritative state
│   └── builder/
│       └── ORG_SNAPSHOT.md           # Builder VPS authoritative state
│
├── registry/
│   ├── ROLE_REGISTRY.yaml            # Canonical merged role registry
│   └── schema/
│       ├── role-registry.schema.json # JSON Schema for registry validation
│       └── capability-rules.json     # Forbidden capability combinations
│
├── bootstrap/
│   ├── BOOTSTRAP_SPEC.md             # Agent onboarding contract (Builder VPS)
│   └── DASHBOARD_SUPPLEMENT.md       # Service onboarding (Dashboard VPS)
│
├── ops/
│   ├── runbooks/
│   │   ├── TRIAGE_REPORT_20260211.md # Crash loop triage (initial)
│   │   ├── DEPLOY_RUNBOOK.md         # How to deploy to each VPS
│   │   ├── INCIDENT_TEMPLATE.md      # Incident report template
│   │   └── CANARY_RUNBOOK.md         # How canary health checks work
│   └── proofs/
│       ├── README.md                 # What proof packs are + retention policy
│       ├── builder_discovery_20260210.md   # Sanitized Builder VPS discovery
│       └── dashboard_discovery_20260210.md # Sanitized Dashboard VPS discovery
│
├── .gitignore                        # Excludes secrets, raw dumps, node_modules
├── GITHUB_STRATEGY.md                # This repo's governance rules
├── CONTROL_REPO_LAYOUT.md            # This file
├── CHANGELOG.md                      # Version history
└── README.md                         # Repo overview + quick start
```

---

## What Goes Where

### `/inventory/` — Platform State Snapshots

| File | Contents | Updated When |
|---|---|---|
| `dashboard/ORG_SNAPSHOT.md` | Dashboard VPS: PM2 processes, ports, cron, databases, nginx, Docker | After infrastructure changes |
| `builder/ORG_SNAPSHOT.md` | Builder VPS: OpenClaw agents, LiteLLM, Redis, systemd services | After agent changes |

**Rules:**
- Always overwrite (not append) — each file is the current truth
- Include timestamp in document header
- No secrets — redact all credentials
- PR label: `inventory-update`

### `/registry/` — Role Definitions

| File | Contents | Updated When |
|---|---|---|
| `ROLE_REGISTRY.yaml` | 10 roles + current agent assignments + gaps | When roles or assignments change |
| `schema/role-registry.schema.json` | JSON Schema validating the YAML structure | When registry format changes |
| `schema/capability-rules.json` | Rules like "security_auditor MUST NOT have write" | When security policies change |

**Rules:**
- YAML must pass schema validation (CI enforced)
- Version tag required in YAML header
- Changes require PR with `registry-change` label
- Breaking changes require `breaking` label

### `/bootstrap/` — Onboarding Contracts

| File | Contents | Updated When |
|---|---|---|
| `BOOTSTRAP_SPEC.md` | How to create new OpenClaw agents | When onboarding process changes |
| `DASHBOARD_SUPPLEMENT.md` | How to add PM2 services, cron, monitoring | When Dashboard procedures change |

**Rules:**
- Semver versioned (in document header)
- PR label: `bootstrap-change`
- Must include rollback instructions for any procedure

### `/ops/` — Runbooks & Proof Packs

| Directory | Contents | Updated When |
|---|---|---|
| `runbooks/` | Incident reports, deploy procedures, triage reports | After incidents or process changes |
| `proofs/` | Sanitized proof packs (commands run, key findings) | After discovery or audit runs |

**Rules:**
- Proof packs MUST be sanitized (no raw secrets, redact tokens)
- Use date-stamped filenames: `*_YYYYMMDD.md`
- Runbooks should include rollback procedures
- PR label: `runbook` or `proof-pack`

### `/.github/` — CI/CD & Governance

| File | Contents | Updated When |
|---|---|---|
| `CODEOWNERS` | Who must review what | When team structure changes |
| `workflows/*.yml` | CI checks (schema, secrets, capability lint) | When validation rules change |
| `PULL_REQUEST_TEMPLATE.md` | PR checklist | When review process changes |

**Rules:**
- Changes require `ci-gates` label
- James must approve all workflow changes
- Test workflow changes in a branch first

---

## Versioning Approach

### Document Versioning
Every document includes a header with:
```markdown
## Version X.Y.Z | YYYY-MM-DD
```

### Git Tags
| Tag Pattern | Example | Purpose |
|---|---|---|
| `registry@YYYY.MM.DD.N` | `registry@2026.02.11.1` | Registry version |
| `inventory-dashboard@YYYY.MM.DD` | `inventory-dashboard@2026.02.10` | Dashboard snapshot version |
| `inventory-builder@YYYY.MM.DD` | `inventory-builder@2026.02.10` | Builder snapshot version |
| `bootstrap@N.M.P` | `bootstrap@1.0.0` | Bootstrap spec semver |

### GitHub Releases
When a registry version is tagged, create a GitHub Release containing:
- The ROLE_REGISTRY.yaml as a downloadable asset
- Changelog entry describing what changed
- Links to relevant PRs

---

## What MUST NOT Be Committed

| Never Commit | Why | Instead |
|---|---|---|
| `.env` files | Contain secrets | Reference by name only |
| API keys/tokens | Security exposure | Redact (show last 4 chars) |
| Database dumps | PII + credentials | Describe schema only |
| Raw command outputs | May contain secrets | Sanitize first |
| `node_modules/` | Not governance | Use package.json |
| Docker images | Too large | Reference by tag |
| Private keys (`.pem`, `.key`) | Critical security | Never in git |
| Unredacted proof packs | May contain creds | Always sanitize |

---

## Retention Policy

| Artifact Type | Retention | Reason |
|---|---|---|
| Inventory snapshots | Keep current only (git history retains old) | Single source of truth |
| Role registry | Keep current + git history | Audit trail |
| Proof packs | Keep last 90 days | Compliance evidence |
| Runbooks | Keep indefinitely | Operational knowledge |
| Triage reports | Keep indefinitely | Incident learning |
