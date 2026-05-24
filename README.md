# <img src="docs/assets/logo-mark-96.png" alt="lucidmemo logo" width="38" height="38" style="vertical-align: middle; margin-right: 12px;" /> lucidmemo

lucidmemo is a local-first dream journal for agent-assisted recall capture and later analysis. V1 is audio-first, free, open source, and built around a simple rule: save the Recall Entry first, assign and analyze it later.

The current workspace includes a TypeScript monorepo with a CLI, MCP server, libSQL storage, local config, audio metadata validation, deterministic extraction/embedding adapters, agent-submitted analysis, query/graph commands, correction history, deletion controls, diagnostics, and export.

The main use case is connecting lucidmemo to an MCP-capable agent client, such as OpenClaw, Hermes, Claude, or another local assistant. The agent can capture dream recall, ask clarification questions, submit structured dream analysis, query the journal, and read graph data through structured MCP tools.

The visual documentation page lives at [`docs/index.html`](docs/index.html).

## Setup

```sh
pnpm install
pnpm build
pnpm test
```

The default journal database is `~/.lucidmemo/journal.db`. Override it per command with `--db /path/to/journal.db` or in `~/.lucidmemo/config.toml`:

```toml
[database]
path = "~/.lucidmemo/journal.db"

[audio]
max_duration_seconds = 600
max_size_bytes = 104857600
retention = "keep"
```

## Capture

Record text, audio, or both:

```sh
lucidmemo record --text "I checked my hands and became lucid."
lucidmemo record --audio ./dream.webm --duration-ms 120000 --mime-type audio/webm
lucidmemo record --text "I was in a school." --audio ./dream.m4a --duration-ms 45000
```

Create and link a Dream Record during capture:

```sh
lucidmemo record --text "I checked my hands." --new-dream --dream-date 2026-05-22 --title "Hands"
```

Create or update sleep metadata:

```sh
lucidmemo sleep --session-date 2026-05-22 --sleep-started-at 2026-05-22T22:30:00.000Z --woke-at 2026-05-23T06:45:00.000Z --quality 4
```

## Analysis and search

```sh
lucidmemo reanalyze --dream-id <dream-id>
lucidmemo submit-analysis --file analysis.json
lucidmemo index
lucidmemo query --text "hands lucid" --lucidity 3+
lucidmemo graph
```

`reanalyze` uses the local deterministic extraction path. `submit-analysis` is for OpenClaw, Hermes, or another agent after it has produced structured analysis.

```json
{
  "dreamId": "<dream-id>",
  "canonicalText": "I met my brother at a glowing train station and became lucid.",
  "sourceAgent": "OpenClaw",
  "sourceModel": "hermes-analysis",
  "lucidityLevel": 4,
  "dreamSigns": ["train station"],
  "emotions": ["wonder"],
  "hvdc": {
    "characters": ["brother"],
    "settings": ["train station"],
    "objects": ["ticket"]
  },
  "entities": [
    { "type": "person", "name": "Brother", "context": "waited near the platform" },
    { "type": "place", "name": "Train Station" }
  ]
}
```

Dream Analysis is versioned. A submitted agent analysis becomes the new current analysis, prior analyses are preserved as non-current history, and normal query and graph output use the current analysis.

## Corrections and deletes

Use edit for typo or transcription fixes:

```sh
lucidmemo recall-edit --recall-id <recall-id> --text "fixed text"
```

Use correction when the remembered dream content changes:

```sh
lucidmemo recall-correct --recall-id <recall-id> --text "new remembered content"
```

Soft delete is the default. Hard delete must be explicit:

```sh
lucidmemo delete recall <recall-id> --reason "duplicate"
lucidmemo delete recall <recall-id> --hard --confirm-hard-delete
```

## Diagnostics

Audio is stored in a separate `recall_audio` table so normal journal queries do not load audio blobs. Use diagnostics when the database feels large or slow:

```sh
lucidmemo doctor storage
lucidmemo media list --largest
lucidmemo media inspect <recall-id>
```

## Export

```sh
lucidmemo export --format json
lucidmemo export --format markdown
lucidmemo export --format csv
lucidmemo export --format json --provenance
```

Default exports include active journal data. `--provenance` includes deleted, superseded, and non-current analysis history for audit and migration use.

## MCP

Build the MCP server and point your MCP client at `packages/mcp-server/dist/index.js`.

```sh
pnpm --filter @lucidmemo/mcp-server build
node packages/mcp-server/dist/index.js
```

Most MCP clients accept a server entry like this. Use an absolute path unless your client starts from this repository:

```json
{
  "mcpServers": {
    "lucidmemo": {
      "command": "node",
      "args": [
        "/absolute/path/to/lucidmemo/packages/mcp-server/dist/index.js"
      ]
    }
  }
}
```

The MCP server exposes the same capture model as the CLI: record recall immediately, leave ambiguous linkage unassigned, and ask for clarification instead of silently merging late recall. It also exposes `submit_dream_analysis` so an agent can store structured analysis as the official current Dream Analysis.

Useful MCP tools include `record_recall_entry`, `assign_recall_entry`, `submit_dream_analysis`, `get_dreams`, `get_dream`, `get_dream_graph`, `correct_recall_content`, and `export_journal`. The server also provides `lucidmemo/capture` and `lucidmemo/query` prompts for agent workflows.

## Agent Skills

The `skills/` directory contains optional workflow skills for agent clients. They do not replace the CLI or MCP server; they teach an agent how to combine MCP tools for capture, analysis, query, and export while preserving lucidmemo's Recall Entry-first model.

Start with `skills/lucidmemo-capture` for morning recall capture, then add `skills/lucidmemo-analysis`, `skills/lucidmemo-query`, or `skills/lucidmemo-export` depending on what your agent client supports.
