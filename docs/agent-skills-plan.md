# User-Facing Agent Skills Plan

## Summary

lucidmemo should ship user-facing agent skills beside the CLI and MCP server. The CLI and MCP server expose capabilities; skills teach an agent how to use those capabilities correctly in dream-journal workflows.

The first skills should stay focused on end-user behavior: capture fragile recall, submit Dream Analysis, query the journal, and export data. They should not become duplicated API documentation.

## Why Skills Exist

lucidmemo's core workflow depends on agent behavior, not just tool availability. An agent needs to know when to save a Recall Entry, when to ask a Clarification Request, when to submit Dream Analysis, and when provenance is appropriate.

MCP tool descriptions explain what each tool does. Skills explain how to combine tools into a safe workflow:

- Save fragile recall before assignment or analysis.
- Leave unclear recall unassigned instead of guessing.
- Submit analysis only when the agent has structured interpretation.
- Query current Dream Analyses by default.
- Include provenance in exports only when the user asks for audit or migration detail.

## Initial Skill Set

Add a top-level `skills/` directory with one small folder per workflow:

```
skills/
  lucidmemo-capture/
    SKILL.md
  lucidmemo-analysis/
    SKILL.md
  lucidmemo-query/
    SKILL.md
  lucidmemo-export/
    SKILL.md
```

### `lucidmemo-capture`

Guides agents through Recall Entry-first capture. It should reference `record_recall_entry`, `assign_recall_entry`, and `record_sleep_session`.

The skill should emphasize saving first, asking clarification when linkage is unclear, and never silently merging late recall.

### `lucidmemo-analysis`

Guides agents through official Dream Analysis submission. It should reference `submit_dream_analysis`, `extract_dream_structure`, and `reanalyze_dream`.

The skill should emphasize versioned Dream Analysis, current-analysis behavior, and keeping remembered-content corrections separate from text edits.

### `lucidmemo-query`

Guides agents through journal search and graph lookup. It should reference `get_dreams`, `get_dream`, and `get_dream_graph`.

The skill should emphasize current Dream Analyses, composable filters, and avoiding audio/media access unless the user asks for diagnostics.

### `lucidmemo-export`

Guides agents through user-directed exports. It should reference `export_journal` and the CLI `lucidmemo export` command.

The skill should emphasize the difference between normal active-data export and provenance export.

## Documentation Updates

- `README.md`: add a short Agent Skills section after MCP.
- `PLAN.md`: include skills as an optional user-facing workflow layer in v1 distribution.
- `docs/index.html`: mention skills near MCP setup because they are part of agent-client onboarding.
- `docs/adr/0003-agent-skills-layer.md`: record the decision to ship skills as guidance, not as a replacement for MCP validation.
- `CONTEXT.md`: no update. It remains a domain glossary.

## Pros

- Agents behave more consistently across clients.
- The Recall Entry-first rule is easier to preserve in real user workflows.
- MCP prompts, README examples, and setup instructions need less duplicated procedural text.
- OpenClaw, Hermes, Claude, Codex, and future clients get clearer onboarding.
- Multi-step workflows fit skills better than individual MCP tool descriptions.

## Cons

- Skills are another artifact to keep in sync with MCP tools and README examples.
- Client support varies, so skills cannot be the only agent integration path.
- Too many skills can fragment behavior.
- Stale skills can become misleading prompt lore.
- Skills do not replace validation in core, CLI, MCP tools, or tests.

## Acceptance Criteria

- Each skill contains only a concise `SKILL.md`.
- Each skill references real current MCP tools or CLI commands.
- Skills describe workflow behavior instead of copying full API docs.
- Domain terminology links back to `CONTEXT.md` where appropriate.
- Command examples remain in `README.md`; skills point agents to the relevant command or tool names.
- MCP and CLI behavior remain the source of truth for enforcement.

