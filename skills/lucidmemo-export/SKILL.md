---
name: lucidmemo-export
description: Guides agents through lucidmemo journal export and provenance choices. Use when a user asks to export, back up, migrate, audit, archive, or inspect raw lucidmemo journal data.
---

# lucidmemo Export

## Workflow

1. Ask the user which export format they need only if the format is not clear.
2. Use `export_journal` for MCP-driven export.
3. When working through the CLI, follow the README's `lucidmemo export` examples for JSON, Markdown, or CSV.
4. Add provenance only for audit, migration, deletion review, or history-preserving export.

## Rules

- Default export should include active journal data only.
- Use provenance export when the user asks for deleted records, superseded Recall Entries, or non-current Dream Analyses.
- Be clear that hard-deleted records cannot be exported.
- Do not imply export changes journal data.
- For user-readable review, prefer Markdown. For fidelity, prefer JSON. For spreadsheets, prefer CSV.

## MCP Tool

- `export_journal`
