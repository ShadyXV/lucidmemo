# ADR: User-facing agent skills layer

lucidmemo will ship optional user-facing agent skills as a workflow layer beside the CLI and MCP server.

The CLI and MCP server remain the executable interfaces. Skills are guidance artifacts for agent clients: they describe how an agent should combine MCP tools for capture, analysis, query, and export without violating lucidmemo's Recall Entry-first model.

**Why:** lucidmemo depends on agent behavior during fragile recall capture. MCP tool schemas can describe inputs, but they do not fully encode workflow judgment such as when to ask a Clarification Request, when to leave a Recall Entry unassigned, or when provenance export is appropriate.

**Decision:** ship small skills under `skills/`, one workflow per folder. Keep each skill thin and refer back to the repository docs instead of duplicating full domain or API documentation.

**Boundaries:** skills do not replace validation in `@lucidmemo/core`, CLI commands, MCP tools, or tests. If a skill and an MCP tool disagree, the implementation and current README/API docs are the source of truth.

**Future contributor rule:** when adding or renaming MCP tools used by an end-user workflow, update the relevant skill in the same change.

