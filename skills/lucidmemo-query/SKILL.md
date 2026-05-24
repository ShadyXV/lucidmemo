---
name: lucidmemo-query
description: Guides agents through lucidmemo journal search, dream lookup, and Dream Graph exploration. Use when a user asks to search, summarize, inspect, compare, or find patterns in their lucidmemo journal.
---

# lucidmemo Query

## Workflow

1. Use `get_dreams` for filtered, semantic, or natural-language journal search.
2. Use `get_dream` when the user asks about one Dream Record.
3. Use `get_dream_graph` when the user asks about recurring people, places, symbols, emotions, objects, or co-occurrence patterns.
4. Summarize from current Dream Analyses unless the user explicitly asks for history or provenance.

## Rules

- Prefer structured filters for dates, entities, emotions, settings, lucidity, and induction technique.
- Do not scrape exported files when MCP query tools are available.
- Do not request audio blobs for normal query or graph work.
- Use storage/media diagnostics only when the user asks about database size, audio, or storage health.
- Be explicit when a result is based on current analysis rather than historical analysis.

## MCP Tools

- `get_dreams`
- `get_dream`
- `get_dream_graph`

