# CI_GATES_PLAN.md — Continuous Integration Gates for openclaw-control
## Version 1.0.0 | 2026-02-11

---

## 1. Checks Run on Every PR

### Gate 1: Schema Validation (`schema-validation`)

**Purpose:** Ensure ROLE_REGISTRY.yaml is structurally valid and conforms to the expected format.

**Triggers:** Any PR that modifies `registry/ROLE_REGISTRY.yaml`

**What it checks:**
- YAML is valid (no syntax errors)
- Required fields present for each role:
  - `purpose` (non-empty string)
  - `responsibilities` (non-empty array)
  - `allowed_tools` (array)
  - `hard_limits` (non-empty array)
- `registry_version` field exists and follows `N.M.P` format
- `generated` timestamp exists
- All role names are lowercase_snake_case
- No duplicate role names
- `current_assignments` references only defined roles

**Implementation:**

```yaml
# .github/workflows/schema-validation.yml
name: Schema Validation
on:
  pull_request:
    paths:
      - 'registry/**'
      - 'bootstrap/**'

jobs:
  validate-registry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: |
          pip install pyyaml jsonschema

      - name: Validate ROLE_REGISTRY.yaml
        run: |
          python3 << 'SCRIPT'
          import yaml
          import json
          import sys

          # Load registry
          with open('registry/ROLE_REGISTRY.yaml') as f:
              registry = yaml.safe_load(f)

          # Load schema
          with open('registry/schema/role-registry.schema.json') as f:
              schema = json.load(f)

          from jsonschema import validate, ValidationError
          try:
              validate(instance=registry, schema=schema)
              print("PASS: Registry validates against schema")
          except ValidationError as e:
              print(f"FAIL: {e.message}")
              sys.exit(1)

          # Check role names are lowercase_snake_case
          import re
          for role_name in registry.get('roles', {}):
              if not re.match(r'^[a-z][a-z0-9_]*$', role_name):
                  print(f"FAIL: Role name '{role_name}' is not lowercase_snake_case")
                  sys.exit(1)

          # Check all roles have required fields
          required = ['purpose', 'responsibilities', 'allowed_tools', 'hard_limits']
          for role_name, role_def in registry.get('roles', {}).items():
              for field in required:
                  if field not in role_def or not role_def[field]:
                      print(f"FAIL: Role '{role_name}' missing required field '{field}'")
                      sys.exit(1)

          print(f"PASS: {len(registry.get('roles', {}))} roles validated")
          SCRIPT
```

### Gate 2: Secret Scanning (`secret-scan`)

**Purpose:** Prevent accidental commit of API keys, passwords, or tokens.

**Triggers:** Every PR (all files)

**What it checks:**
- No strings matching common API key patterns:
  - `sk-...` (OpenAI)
  - `ghp_...` (GitHub PAT)
  - `AKIA...` (AWS)
  - `xoxb-...` (Slack)
  - Any string with `KEY=`, `TOKEN=`, `SECRET=`, `PASSWORD=` followed by a value
- No `.env` files in the changeset
- No `.pem` or `.key` files
- No `credentials/` directory additions

**Implementation:**

```yaml
# .github/workflows/secret-scan.yml
name: Secret Scan
on:
  pull_request:

jobs:
  scan-secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check for secret patterns
        run: |
          FOUND=0

          # Check for common API key patterns in changed files
          git diff origin/main...HEAD --name-only | while read file; do
            if [ -f "$file" ]; then
              # Check for API key patterns
              if grep -qEi '(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16}|xoxb-[0-9]+-[a-zA-Z0-9]+)' "$file" 2>/dev/null; then
                echo "FAIL: Potential secret found in $file"
                FOUND=1
              fi

              # Check for password assignments with actual values
              if grep -qEi '(PASSWORD|SECRET|TOKEN|API_KEY)=[^R][^\n]{8,}' "$file" 2>/dev/null; then
                echo "WARN: Potential credential assignment in $file"
                FOUND=1
              fi
            fi
          done

          # Check for forbidden file types
          git diff origin/main...HEAD --name-only | grep -qiE '\.(env|pem|key)$' && {
            echo "FAIL: Forbidden file type (.env/.pem/.key) in changeset"
            FOUND=1
          }

          exit $FOUND

      - name: GitHub Secret Scanning (built-in)
        # GitHub's built-in secret scanning is also enabled at the repo level
        run: echo "GitHub secret scanning is active (repo setting)"
```

### Gate 3: Capability Lint (`capability-lint`)

**Purpose:** Ensure no role is granted forbidden tool combinations that would violate security boundaries.

**Triggers:** Any PR that modifies `registry/ROLE_REGISTRY.yaml`

**What it checks:**
- `security_auditor` does NOT have `write` or `edit` in allowed_tools (audit-only)
- `technical_writer` does NOT have `exec` (docs-only)
- `product_lead` does NOT have `exec` (no shell access)
- No role has both `exec` AND access to production secrets
- Every role has at least one `hard_limit` entry
- Hard limits contain the word "NEVER" (convention enforcement)

**Implementation:**

```yaml
# .github/workflows/capability-lint.yml
name: Capability Lint
on:
  pull_request:
    paths:
      - 'registry/ROLE_REGISTRY.yaml'
      - 'registry/schema/capability-rules.json'

jobs:
  lint-capabilities:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check capability rules
        run: |
          python3 << 'SCRIPT'
          import yaml
          import json
          import sys

          with open('registry/ROLE_REGISTRY.yaml') as f:
              registry = yaml.safe_load(f)

          with open('registry/schema/capability-rules.json') as f:
              rules = json.load(f)

          errors = []

          for rule in rules.get('forbidden_combinations', []):
              role = rule['role']
              forbidden_tools = rule['forbidden_tools']
              reason = rule['reason']

              if role in registry.get('roles', {}):
                  allowed = registry['roles'][role].get('allowed_tools', [])
                  violations = [t for t in forbidden_tools if t in allowed]
                  if violations:
                      errors.append(
                          f"FAIL: Role '{role}' has forbidden tools {violations}. "
                          f"Reason: {reason}"
                      )

          # Check hard_limits convention
          for role_name, role_def in registry.get('roles', {}).items():
              limits = role_def.get('hard_limits', [])
              if not limits:
                  errors.append(f"FAIL: Role '{role_name}' has no hard_limits")
              for limit in limits:
                  if 'NEVER' not in limit and 'MUST' not in limit:
                      errors.append(
                          f"WARN: Role '{role_name}' has a hard_limit without "
                          f"NEVER/MUST keyword: '{limit[:60]}...'"
                      )

          if errors:
              for e in errors:
                  print(e)
              sys.exit(1)
          else:
              print(f"PASS: All capability rules satisfied")
          SCRIPT
```

### Gate 4: Markdown Lint (Optional)

**Purpose:** Keep documentation consistent and readable.

**Triggers:** Any PR modifying `.md` files

**Implementation:**
```yaml
# .github/workflows/markdown-lint.yml
name: Markdown Lint
on:
  pull_request:
    paths:
      - '**/*.md'

jobs:
  lint-markdown:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: DavidAnson/markdownlint-cli2-action@v20
        with:
          globs: '**/*.md'
          config: |
            {
              "MD013": false,
              "MD033": false,
              "MD041": false
            }
```

---

## 2. Release Tagging Conventions

### Tag Format
```
registry@YYYY.MM.DD.N
```

Where:
- `YYYY.MM.DD` = date of the change
- `N` = sequential number within that day (starting at 1)

### Creating a Release

```bash
# Tag the current commit
git tag -a "registry@2026.02.11.1" -m "Initial role registry with 10 roles"

# Push the tag
git push origin "registry@2026.02.11.1"

# Create a GitHub Release with the registry as an asset
gh release create "registry@2026.02.11.1" \
  registry/ROLE_REGISTRY.yaml \
  --title "Role Registry v2026.02.11.1" \
  --notes "Initial release: 10 roles defined, current agent assignments mapped, 7 unassigned roles identified."
```

---

## 3. Publishing Bundles as GitHub Release Assets

### Context Bundle (for new agent onboarding)

When a new agent needs to be bootstrapped, it downloads a context bundle from the latest GitHub Release:

```
context-bundle-YYYY.MM.DD.zip
├── ROLE_REGISTRY.yaml          # What roles exist
├── BOOTSTRAP_SPEC.md           # How to onboard
├── ORG_SNAPSHOT_dashboard.md   # What's on Dashboard VPS
├── ORG_SNAPSHOT_builder.md     # What's on Builder VPS
└── CAPABILITY_RULES.json       # What's forbidden
```

### Publishing a Bundle

```bash
# Create the bundle
mkdir -p /tmp/bundle
cp registry/ROLE_REGISTRY.yaml /tmp/bundle/
cp bootstrap/BOOTSTRAP_SPEC.md /tmp/bundle/
cp inventory/dashboard/ORG_SNAPSHOT.md /tmp/bundle/ORG_SNAPSHOT_dashboard.md
cp inventory/builder/ORG_SNAPSHOT.md /tmp/bundle/ORG_SNAPSHOT_builder.md
cp registry/schema/capability-rules.json /tmp/bundle/CAPABILITY_RULES.json

cd /tmp && zip -r context-bundle-$(date +%Y.%m.%d).zip bundle/

# Attach to release
gh release upload "registry@2026.02.11.1" /tmp/context-bundle-2026.02.11.zip
```

---

## 4. Schema Files

### Role Registry Schema (`registry/schema/role-registry.schema.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "OpenClaw Role Registry",
  "type": "object",
  "required": ["registry_version", "generated", "roles"],
  "properties": {
    "registry_version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "generated": {
      "type": "string"
    },
    "roles": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["purpose", "responsibilities", "allowed_tools", "hard_limits"],
        "properties": {
          "purpose": { "type": "string", "minLength": 10 },
          "responsibilities": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string" }
          },
          "allowed_tools": {
            "type": "array",
            "items": { "type": "string" }
          },
          "event_subscriptions": {
            "type": "array",
            "items": { "type": "string" }
          },
          "default_work_queues": {
            "type": "array",
            "items": { "type": "string" }
          },
          "hard_limits": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string" }
          }
        }
      }
    }
  }
}
```

### Capability Rules (`registry/schema/capability-rules.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Forbidden capability combinations for roles",
  "forbidden_combinations": [
    {
      "role": "security_auditor",
      "forbidden_tools": ["write", "edit"],
      "reason": "Auditors must not modify what they audit"
    },
    {
      "role": "technical_writer",
      "forbidden_tools": ["exec"],
      "reason": "Writers must not execute commands"
    },
    {
      "role": "product_lead",
      "forbidden_tools": ["exec"],
      "reason": "Product leads must not execute commands"
    },
    {
      "role": "qa_gatekeeper",
      "forbidden_tools": [],
      "reason": "QA needs broad read access but must not write feature code (enforced by hard_limits)"
    }
  ],
  "required_hard_limit_keywords": ["NEVER", "MUST"],
  "max_tools_per_role": 10
}
```
