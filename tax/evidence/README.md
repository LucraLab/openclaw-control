# Tax Pod Evidence Records

This directory contains evidence record schemas and examples for Tax Pod operations.

## Purpose

Evidence records provide:
- Immutable audit trail of all Tax Pod interactions
- Sanitized record of inputs, assumptions, outputs
- Source citations for all recommendations
- Risk disclosures and limitations

## Files

- `evidence_record.schema.json` - JSON Schema definition for evidence records
- `example_evidence_record.json` - Sample evidence record (sanitized, no real PII)

## Storage Pattern

Evidence records stored append-only in JSONL format:
```
evidence/tax_cases.jsonl
```

One JSON object per line, never edited or deleted.

## Retention

Minimum 7 years per policies/retention_and_audit.md.

## Integration

Evidence records follow OpenClaw's events.jsonl immutability pattern and integrate with existing audit/proof discipline.
