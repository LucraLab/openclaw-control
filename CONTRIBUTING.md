# Contributing to openclaw-control

This is a **PUBLIC** repository. All content is visible to the internet. Follow these rules to keep it safe.

## Public-Safe Rules

### Never include
- Real IP addresses (IPv4 or IPv6)
- Hostnames or domain names of internal servers
- SSH commands to real hosts (`ssh user@host`)
- Port numbers that reveal internal service topology
- File paths that reveal server directory structure or usernames
- API keys, tokens, passwords, or secrets of any kind
- Private key blocks
- Tailscale or VPN IP addresses
- PID numbers, process IDs, or systemctl output with identifying details
- GitHub token scopes or authentication details

### Use placeholders instead
| Sensitive Value | Placeholder |
|----------------|-------------|
| Dashboard VPS IP | `<DASHBOARD_VPS_IPV4>` |
| Builder VPS IP | `<BUILDER_VPS_IPV4>` |
| Dashboard hostname | `<DASHBOARD_HOST>` |
| Builder hostname | `<BUILDER_HOST>` |
| Tailscale IPs | `<DASHBOARD_TAILSCALE_IP>`, `<BUILDER_TAILSCALE_IP>` |
| Internal endpoints | `<INTERNAL_ENDPOINT>` |
| Ports | `<INTERNAL_PORT>` or `<INTERNAL_PORTS_REDACTED>` |
| File paths on servers | `<PATH_REDACTED>` |
| Local file paths | `<LOCAL_PATH_REDACTED>` |
| Workspace paths | `<BUILDER1_WORKSPACE>`, `<BUILDER2_WORKSPACE>` |
| Credentials | `REDACTED` |
| Token scopes | `<SCOPES_REDACTED>` |

### What IS safe to include
- Role definitions and capability lists
- Agent names and assignments
- Architecture descriptions (without network topology)
- Process names (e.g., "youtube-intelligence") without host details
- Technology names (e.g., "Redis", "LiteLLM") without connection strings
- Error patterns and diagnostic narratives (redacted)
- CI/CD workflow definitions
- Schema files for validation

## For Operational Details

Internal operational details (IPs, ports, paths, credentials) belong in:
- Private `.env` files on the VPS (never committed)
- A future `openclaw-ops` private repo (for inventories and detailed proof packs)
- Local notes on your development machine

## CI Gates

All PRs are checked by these CI gates before merge:

| Gate | What It Checks |
|------|---------------|
| `validate-registry` | YAML syntax, JSON Schema compliance |
| `scan-secrets` | API key patterns, credential files |
| `lint-capabilities` | Forbidden tool combinations per role |
| `lint-markdown` | Markdown formatting |
| `scan-public-safe` | IPv4/IPv6 addresses, hostnames, SSH commands, private keys |

The `scan-public-safe` gate will **block your PR** if it detects any of the patterns listed above.

## Pull Request Process

1. Create a branch from `main`
2. Make your changes following the rules above
3. Push and open a PR
4. Wait for all CI gates to pass
5. Request review from @mcdonjam82
6. Merge after approval
