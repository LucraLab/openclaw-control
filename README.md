# openclaw-control

Canonical governance and control-plane repository for the OpenClaw multi-agent platform.

## What This Repo Contains

| Directory | Contents |
|---|---|
| `registry/` | Role Registry (YAML) — defines roles, capabilities, assignments |
| `registry/schemas/` | JSON Schema for registry validation |
| `bootstrap/` | Agent onboarding specifications |
| `inventory/` | VPS platform state snapshots (Dashboard + Builder) |
| `ops/` | Triage reports, proof packs, strategy docs |
| `.github/workflows/` | CI gates: schema validation, secret scanning, capability lint, markdown lint |

## Key Rules

- **Secrets are NEVER committed.** All credentials stay on VPS in `.env` files.
- **Bundles and registry are versioned.** Tags follow `registry@YYYY.MM.DD.N` format.
- **All changes go through PRs.** Branch protection enforces reviews + CI checks.
- **This is governance, not application code.** App repos are separate.

## CI Gates

| Gate | Triggers On | What It Checks |
|---|---|---|
| Schema Validation | `registry/**` changes | YAML syntax, required fields, naming conventions |
| Secret Scanning | All PRs | API key patterns, credential files, `.env` files |
| Capability Lint | `registry/**` changes | Forbidden tool combinations per role |
| Markdown Lint | `**/*.md` changes | Consistent formatting |

## Related Repos

- `LucraLab/lucralab-ai-sdr-platform` — AI SDR application
- `mcdonjam82/LucraLab-lead-nurture-workflow` — Lead nurture system
