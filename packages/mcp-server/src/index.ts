#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  runGraphCommand,
  runDeleteCommand,
  runDoctorStorageCommand,
  runMediaInspectCommand,
  runMediaListCommand,
  runQueryCommand,
  runReanalyzeCommand,
  runRecallCorrectCommand,
  runRecallEditCommand,
  runRecordCommand,
  runSleepCommand,
} from "@lucidmemo/cli";
import type { EntityMerge, RecallEntry, UUID } from "@lucidmemo/core";
import {
  createDatabase,
  initializeDatabase,
  LibSqlDreamAnalysisRepository,
  LibSqlDreamRepository,
  LibSqlDreamQueryRepository,
  LibSqlEntityRepository,
  LibSqlRecallEntryRepository,
  LibSqlSleepSessionRepository,
} from "@lucidmemo/db";

export type LucidmemoPackage = "mcp-server";

export const packageName: LucidmemoPackage = "mcp-server";

type ToolContent = { type: "text"; text: string };

interface McpContext {
  homeDir: string;
  now: () => Date;
  output: Pick<typeof console, "log" | "error">;
}

const DEFAULT_CONTEXT: McpContext = {
  homeDir: homedir(),
  now: () => new Date(),
  output: console,
};

const globalFlagsSchema = {
  db: z.string().optional(),
  config: z.string().optional(),
};

export function createLucidmemoMcpServer(context: McpContext = DEFAULT_CONTEXT): McpServer {
  const server = new McpServer({
    name: "lucidmemo",
    version: "0.0.0",
  });

  server.registerTool(
    "record_recall_entry",
    {
      title: "Record Recall Entry",
      description: "Capture text and/or audio immediately as a Recall Entry. If assignment is unclear, keep it unassigned.",
      inputSchema: {
        ...globalFlagsSchema,
        text: z.string().optional(),
        audioPath: z.string().optional(),
        audioBase64: z.string().optional(),
        mimeType: z.string().optional(),
        durationMs: z.number().int().nonnegative().optional(),
        retention: z.enum(["keep", "delete_after_transcription", "never_store"]).optional(),
        dreamId: z.string().optional(),
        newDream: z.boolean().optional(),
        dreamDate: z.string().optional(),
        title: z.string().optional(),
        sleepSessionId: z.string().optional(),
        newSleepSession: z.boolean().optional(),
        sessionDate: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => jsonTool(await recordRecallEntry(args, context)),
  );

  server.registerTool(
    "assign_recall_entry",
    {
      title: "Assign Recall Entry",
      description: "Link an existing unassigned Recall Entry to an existing or newly-created Dream Record.",
      inputSchema: {
        ...globalFlagsSchema,
        recallEntryId: z.string(),
        dreamId: z.string().optional(),
        newDream: z.boolean().optional(),
        dreamDate: z.string().optional(),
        title: z.string().optional(),
      },
    },
    async (args) => jsonTool(await assignRecallEntry(args, context)),
  );

  server.registerTool(
    "record_sleep_session",
    {
      title: "Record Sleep Session",
      description: "Create or update Sleep Session metadata.",
      inputSchema: {
        ...globalFlagsSchema,
        id: z.string().optional(),
        sessionDate: z.string(),
        sleepStartedAt: z.string().optional(),
        wokeAt: z.string().optional(),
        quality: z.number().int().nonnegative().optional(),
        nap: z.boolean().optional(),
        supplements: z.array(z.string()).optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => jsonTool(await recordSleepSession(args, context)),
  );

  server.registerTool(
    "extract_dream_structure",
    {
      title: "Extract Dream Structure",
      description: "Return the current Dream Analysis for a Dream Record, creating one if needed.",
      inputSchema: {
        ...globalFlagsSchema,
        dreamId: z.string(),
      },
    },
    async (args) => jsonTool(await extractDreamStructure(args, context)),
  );

  server.registerTool(
    "reanalyze_dream",
    {
      title: "Reanalyze Dream",
      description: "Explicitly create a new current Dream Analysis from linked Recall Entries.",
      inputSchema: {
        ...globalFlagsSchema,
        dreamId: z.string(),
      },
    },
    async (args) => jsonTool(await runReanalyzeCommand(toFlags({ "dream-id": args.dreamId, db: args.db, config: args.config }), cliContext(context))),
  );

  server.registerTool(
    "get_dreams",
    {
      title: "Get Dreams",
      description: "Query dreams using current Dream Analyses only.",
      inputSchema: {
        ...globalFlagsSchema,
        text: z.string().optional(),
        date: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        symbol: z.string().optional(),
        person: z.string().optional(),
        setting: z.string().optional(),
        emotion: z.string().optional(),
        object: z.string().optional(),
        interaction: z.string().optional(),
        lucidity: z.string().optional(),
        technique: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => jsonTool(await runQueryCommand(toFlags(args), cliContext(context))),
  );

  server.registerTool(
    "get_dream",
    {
      title: "Get Dream",
      description: "Get one Dream Record with its current Dream Analysis.",
      inputSchema: {
        ...globalFlagsSchema,
        dreamId: z.string(),
      },
    },
    async (args) => jsonTool(await getDream(args, context)),
  );

  server.registerTool(
    "get_dream_graph",
    {
      title: "Get Dream Graph",
      description: "Return current-analysis-only graph data.",
      inputSchema: globalFlagsSchema,
    },
    async (args) => jsonTool(await runGraphCommand(toFlags(args), cliContext(context))),
  );

  server.registerTool(
    "merge_entities",
    {
      title: "Merge Entities",
      description: "Record a reversible Entity Merge decision.",
      inputSchema: {
        ...globalFlagsSchema,
        canonicalEntityId: z.string(),
        mergedEntityId: z.string(),
        confirmedBy: z.string().default("user"),
        reason: z.string().optional(),
      },
    },
    async (args) => jsonTool(await mergeEntities(args, context)),
  );

  server.registerTool(
    "unmerge_entities",
    {
      title: "Unmerge Entities",
      description: "Reverse a prior Entity Merge decision.",
      inputSchema: {
        ...globalFlagsSchema,
        mergeId: z.string(),
        reversedBy: z.string().default("user"),
      },
    },
    async (args) => jsonTool(await unmergeEntities(args, context)),
  );

  for (const entity of ["recall", "dream", "session"] as const) {
    server.registerTool(
      `delete_${entity}`,
      {
        title: `Delete ${entity}`,
        description: `Delete a ${entity}. Soft delete is default; hard delete requires confirmHardDelete.`,
        inputSchema: {
          ...globalFlagsSchema,
          id: z.string(),
          reason: z.string().optional(),
          hard: z.boolean().optional(),
          confirmHardDelete: z.boolean().optional(),
        },
      },
      async (args) => jsonTool(await deleteEntity(entity, args, context)),
    );
  }

  server.registerTool(
    "edit_recall_text",
    {
      title: "Edit Recall Text",
      description: "Fix transcription or typo text in place without creating a correction entry.",
      inputSchema: {
        ...globalFlagsSchema,
        recallEntryId: z.string(),
        text: z.string(),
      },
    },
    async (args) =>
      jsonTool(
        await runRecallEditCommand(
          toFlags({ "recall-id": args.recallEntryId, text: args.text, db: args.db, config: args.config }),
          cliContext(context),
        ),
      ),
  );

  server.registerTool(
    "correct_recall_content",
    {
      title: "Correct Recall Content",
      description: "Create a superseding Recall Entry when remembered dream content changes.",
      inputSchema: {
        ...globalFlagsSchema,
        recallEntryId: z.string(),
        text: z.string(),
        notes: z.string().optional(),
      },
    },
    async (args) =>
      jsonTool(
        await runRecallCorrectCommand(
          toFlags({ "recall-id": args.recallEntryId, text: args.text, notes: args.notes, db: args.db, config: args.config }),
          cliContext(context),
        ),
      ),
  );

  server.registerTool(
    "doctor_storage",
    {
      title: "Doctor Storage",
      description: "Summarize journal storage and largest audio rows without loading audio blobs.",
      inputSchema: {
        ...globalFlagsSchema,
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => jsonTool(await runDoctorStorageCommand(toFlags(args), cliContext(context))),
  );

  server.registerTool(
    "list_media",
    {
      title: "List Media",
      description: "List largest stored audio items by metadata only.",
      inputSchema: {
        ...globalFlagsSchema,
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => jsonTool(await runMediaListCommand(toFlags(args), cliContext(context))),
  );

  server.registerTool(
    "inspect_media",
    {
      title: "Inspect Media",
      description: "Inspect one Recall Entry audio item by metadata only.",
      inputSchema: {
        ...globalFlagsSchema,
        recallEntryId: z.string(),
      },
    },
    async (args) =>
      jsonTool(
        await runMediaInspectCommand(toFlags({ "recall-id": args.recallEntryId, db: args.db, config: args.config }), cliContext(context)),
      ),
  );

  server.registerPrompt(
    "lucidmemo/capture",
    {
      title: "Lucidmemo Capture",
      description: "Guide an agent through Recall Entry-first capture and clarification.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Capture fragile dream recall immediately with record_recall_entry. If linkage to a Dream Record or Sleep Session is unclear, leave it unassigned and ask a concise clarification question. Never silently merge late-day recall.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "lucidmemo/query",
    {
      title: "Lucidmemo Query",
      description: "Guide an agent through journal querying and graph lookup.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Use get_dreams for filtered or semantic search, get_dream for details, and get_dream_graph for entity co-occurrence graph data. Default to current Dream Analyses and avoid requesting audio blobs unless the user explicitly asks for media diagnostics.",
          },
        },
      ],
    }),
  );

  return server;
}

export async function main(): Promise<void> {
  const server = createLucidmemoMcpServer();
  await server.connect(new StdioServerTransport());
}

async function recordRecallEntry(
  args: {
    text?: string;
    audioPath?: string;
    audioBase64?: string;
    mimeType?: string;
    durationMs?: number;
    retention?: string;
    dreamId?: string;
    newDream?: boolean;
    dreamDate?: string;
    title?: string;
    sleepSessionId?: string;
    newSleepSession?: boolean;
    sessionDate?: string;
    notes?: string;
    db?: string;
    config?: string;
  },
  context: McpContext,
) {
  const audioPath = args.audioBase64 ? writeTempAudio(args.audioBase64, args.mimeType) : args.audioPath;
  return runRecordCommand(
    toFlags({
      text: args.text,
      audio: audioPath,
      "mime-type": args.mimeType,
      "duration-ms": args.durationMs,
      retention: args.retention,
      "dream-id": args.dreamId,
      "new-dream": args.newDream,
      "dream-date": args.dreamDate,
      title: args.title,
      "sleep-session-id": args.sleepSessionId,
      "new-sleep-session": args.newSleepSession,
      "session-date": args.sessionDate,
      notes: args.notes,
      db: args.db,
      config: args.config,
    }),
    cliContext(context),
  );
}

async function assignRecallEntry(
  args: {
    recallEntryId: string;
    dreamId?: string;
    newDream?: boolean;
    dreamDate?: string;
    title?: string;
    db?: string;
    config?: string;
  },
  context: McpContext,
) {
  const { databaseUrl } = await prepareDb(args, context);
  const db = createDatabase({ url: databaseUrl });
  const dreams = new LibSqlDreamRepository(db);
  const recalls = new LibSqlRecallEntryRepository(db);

  let dreamId = args.dreamId;
  if (!dreamId && args.newDream) {
    if (!args.dreamDate) {
      throw new Error("assign_recall_entry with newDream requires dreamDate.");
    }
    const dream = {
      id: randomUUID(),
      sleepSessionId: null,
      dreamDate: args.dreamDate,
      title: args.title ?? null,
      deletedAt: null,
      deleteReason: null,
    };
    await dreams.create(dream);
    dreamId = dream.id;
  }

  if (!dreamId) {
    throw new Error("assign_recall_entry requires dreamId or newDream.");
  }

  const recall = await recalls.assign({ recallEntryId: args.recallEntryId, dreamId });
  let analysis = null;
  if (recall.text) {
    analysis = await runReanalyzeCommand(toFlags({ "dream-id": dreamId, db: args.db, config: args.config }), cliContext(context));
  }
  return { recall, analysis };
}

async function recordSleepSession(
  args: {
    id?: string;
    sessionDate: string;
    sleepStartedAt?: string;
    wokeAt?: string;
    quality?: number;
    nap?: boolean;
    supplements?: string[];
    notes?: string;
    db?: string;
    config?: string;
  },
  context: McpContext,
) {
  return runSleepCommand(
    toFlags({
      id: args.id,
      "session-date": args.sessionDate,
      "sleep-started-at": args.sleepStartedAt,
      "woke-at": args.wokeAt,
      quality: args.quality,
      nap: args.nap,
      supplements: args.supplements?.join(","),
      notes: args.notes,
      db: args.db,
      config: args.config,
    }),
    cliContext(context),
  );
}

async function extractDreamStructure(args: { dreamId: string; db?: string; config?: string }, context: McpContext) {
  const { databaseUrl } = await prepareDb(args, context);
  const db = createDatabase({ url: databaseUrl });
  const existing = await new LibSqlDreamAnalysisRepository(db).findCurrentByDreamId(args.dreamId);
  if (existing) return existing;
  return runReanalyzeCommand(toFlags({ "dream-id": args.dreamId, db: args.db, config: args.config }), cliContext(context));
}

async function getDream(args: { dreamId: string; db?: string; config?: string }, context: McpContext) {
  const { databaseUrl } = await prepareDb(args, context);
  const db = createDatabase({ url: databaseUrl });
  const dream = await new LibSqlDreamRepository(db).findById(args.dreamId);
  const analysis = await new LibSqlDreamAnalysisRepository(db).findCurrentByDreamId(args.dreamId);
  const recallEntries = await new LibSqlRecallEntryRepository(db).listByDreamId(args.dreamId);
  return { dream, analysis, recallEntries: recallEntries.map(stripRecallTextAudioBoundary) };
}

async function mergeEntities(
  args: {
    canonicalEntityId: string;
    mergedEntityId: string;
    confirmedBy?: string;
    reason?: string;
    db?: string;
    config?: string;
  },
  context: McpContext,
) {
  const { databaseUrl } = await prepareDb(args, context);
  const merge: EntityMerge = {
    id: randomUUID(),
    canonicalEntityId: args.canonicalEntityId,
    mergedEntityId: args.mergedEntityId,
    confirmedAt: context.now().toISOString(),
    confirmedBy: args.confirmedBy ?? "user",
    reversedAt: null,
    reversedBy: null,
    reason: args.reason ?? null,
  };
  return new LibSqlEntityRepository(createDatabase({ url: databaseUrl })).merge(merge);
}

async function unmergeEntities(args: { mergeId: string; reversedBy?: string; db?: string; config?: string }, context: McpContext) {
  const { databaseUrl } = await prepareDb(args, context);
  return new LibSqlEntityRepository(createDatabase({ url: databaseUrl })).unmerge(args.mergeId, args.reversedBy ?? "user");
}

async function deleteEntity(
  entity: "recall" | "dream" | "session",
  args: { id: UUID; reason?: string; hard?: boolean; confirmHardDelete?: boolean; db?: string; config?: string },
  context: McpContext,
) {
  return runDeleteCommand(
    toFlags({
      entity,
      id: args.id,
      reason: args.reason,
      hard: args.hard,
      "confirm-hard-delete": args.confirmHardDelete,
      db: args.db,
      config: args.config,
    }),
    cliContext(context),
  );
}

async function prepareDb(args: { db?: string; config?: string }, context: McpContext) {
  const flags = toFlags({ db: args.db, config: args.config });
  const dbPath = args.db ?? join(context.homeDir, ".lucidmemo", "journal.db");
  const databaseUrl = `file:${dbPath}`;
  mkdirSync(dirname(fileURLToPath(databaseUrl)), { recursive: true });
  await initializeDatabase({ url: databaseUrl });
  return { flags, databaseUrl };
}

function cliContext(context: McpContext) {
  return {
    output: context.output,
    now: context.now,
    readFile: (path: string) => readFileSync(path),
    fileExists: existsSync,
    ensureDir: (path: string) => mkdirSync(path, { recursive: true }),
    homeDir: context.homeDir,
  };
}

function toFlags(values: Record<string, string | number | boolean | undefined>): Record<string, string | boolean> {
  return Object.fromEntries(
    Object.entries(values)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([key, value]) => [key, typeof value === "number" ? String(value) : value]),
  );
}

function jsonTool(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) } satisfies ToolContent],
  };
}

function writeTempAudio(audioBase64: string, mimeType?: string): string {
  const extension = mimeType?.split("/").at(1)?.replace(/[^a-z0-9]/gi, "") || "audio";
  const path = join(tmpdir(), `lucidmemo-${randomUUID()}.${extension}`);
  writeFileSync(path, Buffer.from(audioBase64, "base64"));
  return path;
}

function stripRecallTextAudioBoundary(recall: RecallEntry) {
  return {
    ...recall,
    hasAudio: recall.hasAudio,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
