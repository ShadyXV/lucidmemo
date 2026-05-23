# V1 Architecture Baseline

lucidmemo v1 is a free, open-source, local-first TypeScript monorepo with CLI and MCP surfaces over the same domain model. Capture is Recall Entry-first and audio-first: audio/text is saved immediately, assignment to Dream Records and Sleep Sessions can happen later, and Dream Analysis is versioned after assignment. The local database is libSQL, with audio stored as database BLOBs in a separate table from hot recall metadata so normal journal queries do not load audio payloads.
