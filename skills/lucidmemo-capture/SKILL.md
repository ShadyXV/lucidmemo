---
name: lucidmemo-capture
description: Guides agents through lucidmemo Recall Entry-first capture. Use when a user wants to record, save, narrate, dictate, transcribe, or assign dream recall through lucidmemo.
---

# lucidmemo Capture

## Workflow

1. Save fragile recall immediately with `record_recall_entry`.
2. If the user gives sleep metadata, use `record_sleep_session`.
3. If the user clearly identifies where the recall belongs, assign it with `assign_recall_entry`.
4. If dream or sleep-session linkage is unclear, leave the Recall Entry unassigned and ask one concise clarification question.

## Rules

- Do not wait for perfect classification before saving recall.
- Do not silently merge late recall into an existing Dream Record.
- Do not analyze a Recall Entry that is still unassigned or has no text.
- Keep audio input-native; provide MIME type and duration when available.
- Use lucidmemo domain terms from `CONTEXT.md`: Recall Entry, Dream Record, Sleep Session, Clarification Request.

## MCP Tools

- `record_recall_entry`
- `assign_recall_entry`
- `record_sleep_session`

