# Commit Message Conventions

## Format

```text
<type>(<scope>): <subject>

<body>

Objective: <objective-id>
Task: <task-key>
Risk: <risk-tier>
```

## Types

| Type | When |
|------|------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change that neither fixes nor adds |
| `test` | Adding or correcting tests |
| `chore` | Maintenance tasks |
| `schema` | Schema/registry changes |

## Scopes

| Scope | Directory |
|-------|-----------|
| `registry` | `registry/` |
| `bootstrap` | `bootstrap/` |
| `ops` | `ops/` |
| `scripts` | `scripts/` |
| `skills` | `skills/` |
| `ci` | `.github/workflows/` |

## Examples

```text
feat(skills): add delivery_loop_v1 skill

Adds the delivery loop skill with SPEC, runbook, threat model,
and implementation scripts for end-to-end objective delivery.

Objective: obj-delivery-loop-v1
Task: implement
Risk: low
```
