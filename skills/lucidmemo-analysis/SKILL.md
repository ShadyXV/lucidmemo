---
name: lucidmemo-analysis
description: Guides agents through lucidmemo Dream Analysis submission and reanalysis. Use when a user asks an agent to interpret, structure, analyze, reanalyze, or submit analysis for a dream in lucidmemo.
---

# lucidmemo Analysis

## Workflow

1. Confirm the Dream Record exists and has assigned text recall.
2. Use `submit_dream_analysis` when the agent has structured canonical text, lucidity fields, HVdC fields, and entities.
3. Use `extract_dream_structure` or `reanalyze_dream` when the user wants lucidmemo to create a new current Dream Analysis from stored recall.
4. Explain that new analysis becomes current while older analyses remain available for provenance export.

## Rules

- Dream Analysis is versioned; do not describe reanalysis as overwriting history.
- Canonical narrative belongs to Dream Analysis, not Dream Record.
- Treat typo and transcription fixes as text edits, not remembered-content corrections.
- Treat remembered-content changes as corrections that may require a new analysis.
- Do not merge similar Entities without explicit user confirmation.

## MCP Tools

- `submit_dream_analysis`
- `extract_dream_structure`
- `reanalyze_dream`

