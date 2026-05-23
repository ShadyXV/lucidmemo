#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import {
  createDreamAnalysis,
  createSubmittedDreamAnalysis,
  DEFAULT_DATABASE_PATH,
  getDefaultConfigPath,
  loadLucidmemoConfig,
  normalizeEntityName,
  normalizeSubmittedAnalysisInput,
  planAudioRetention,
  validateAudioInput,
  type AudioRetention,
  type CaptureMethod,
  type DreamAnalysis,
  type DreamAnalysisRepository,
  type DreamGraph,
  type DreamQueryFilters,
  type DreamQueryResult,
  type DreamRecord,
  type DreamRepository,
  type EntityType,
  type HvdCRecord,
  type HvdCRecordFields,
  type ISODate,
  type ISODateTime,
  type RecallAudio,
  type RecallEntry,
  type RecallEntryRepository,
  type SleepSession,
  type SleepSessionRepository,
  type SubmittedDreamAnalysisInput,
  type TranscriptionStatus,
} from "@lucidmemo/core";
import {
  createDatabase,
  initializeDatabase,
  LibSqlDreamAnalysisRepository,
  LibSqlDreamQueryRepository,
  LibSqlDreamRepository,
  LibSqlJournalExportRepository,
  LibSqlMediaRepository,
  LibSqlRecallEntryRepository,
  LibSqlSleepSessionRepository,
} from "@lucidmemo/db";
import { HashEmbeddingAdapter } from "@lucidmemo/embedding";
import { HeuristicExtractionAdapter } from "@lucidmemo/extraction";

export type LucidmemoPackage = "cli";

export const packageName: LucidmemoPackage = "cli";

interface ParsedArgs {
  command: string | null;
  flags: Record<string, string | boolean>;
}

interface CliContext {
  output: Pick<typeof console, "log" | "error">;
  now: () => Date;
  readFile: (path: string) => Uint8Array;
  fileExists: (path: string) => boolean;
  ensureDir: (path: string) => void;
  homeDir: string;
}

interface RecordCommandResult {
  recallEntry: RecallEntry;
  dream: DreamRecord | null;
  sleepSession: SleepSession | null;
  analysis: DreamAnalysis | null;
  audioStored: boolean;
}

interface DeleteCommandResult {
  deleted: true;
  entity: "recall" | "dream" | "session";
  id: string;
  mode: "soft" | "hard";
}

const DEFAULT_CONTEXT: CliContext = {
  output: console,
  now: () => new Date(),
  readFile: (path) => readFileSync(path),
  fileExists: existsSync,
  ensureDir: (path) => mkdirSync(path, { recursive: true }),
  homeDir: homedir(),
};

export async function main(argv = process.argv.slice(2), context = DEFAULT_CONTEXT): Promise<void> {
  const parsed = parseArgs(argv);

  try {
    if (parsed.command === "record") {
      const result = await runRecordCommand(parsed.flags, context);
      printRecordResult(result, context);
      return;
    }

    if (parsed.command === "sleep") {
      const result = await runSleepCommand(parsed.flags, context);
      context.output.log(`Sleep Session saved: ${result.id}`);
      return;
    }

    if (parsed.command === "reanalyze") {
      const result = await runReanalyzeCommand(parsed.flags, context);
      context.output.log(`Dream Analysis created: ${result.id}`);
      return;
    }

    if (parsed.command === "submit-analysis") {
      const result = await runSubmitAnalysisCommand(parsed.flags, context);
      context.output.log(`Dream Analysis submitted: ${result.id}`);
      return;
    }

    if (parsed.command === "index") {
      const result = await runIndexCommand(parsed.flags, context);
      context.output.log(`Indexed current Dream Analyses: ${result.updated}`);
      return;
    }

    if (parsed.command === "query") {
      const result = await runQueryCommand(parsed.flags, context);
      printQueryResult(result, context);
      return;
    }

    if (parsed.command === "graph") {
      const result = await runGraphCommand(parsed.flags, context);
      context.output.log(JSON.stringify(result, null, 2));
      return;
    }

    if (parsed.command === "export") {
      const result = await runExportCommand(parsed.flags, context);
      context.output.log(result);
      return;
    }

    if (parsed.command === "recall-edit") {
      const result = await runRecallEditCommand(parsed.flags, context);
      context.output.log(`Recall Entry edited: ${result.id}`);
      return;
    }

    if (parsed.command === "recall-correct") {
      const result = await runRecallCorrectCommand(parsed.flags, context);
      context.output.log(`Recall Entry corrected: ${result.original.id} -> ${result.replacement.id}`);
      return;
    }

    if (parsed.command === "delete") {
      const result = await runDeleteCommand(parsed.flags, context);
      context.output.log(`${result.mode === "hard" ? "Hard-deleted" : "Soft-deleted"} ${result.entity}: ${result.id}`);
      return;
    }

    if (parsed.command === "doctor storage") {
      const result = await runDoctorStorageCommand(parsed.flags, context);
      context.output.log(JSON.stringify(result, null, 2));
      return;
    }

    if (parsed.command === "media list") {
      const result = await runMediaListCommand(parsed.flags, context);
      context.output.log(JSON.stringify(result, null, 2));
      return;
    }

    if (parsed.command === "media inspect") {
      const result = await runMediaInspectCommand(parsed.flags, context);
      context.output.log(JSON.stringify(result, null, 2));
      return;
    }

    printHelp(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.output.error(`lucidmemo: ${message}`);
    process.exitCode = 1;
  }
}

export async function runRecordCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<RecordCommandResult> {
  const config = loadCliConfig(flags, context);
  const databaseUrl = databasePathToUrl(config.database.path, context.homeDir);
  context.ensureDir(dirname(fileURLToPath(databaseUrl)));
  await initializeDatabase({ url: databaseUrl });

  const db = createDatabase({ url: databaseUrl });
  const sleepSessions = new LibSqlSleepSessionRepository(db);
  const dreams = new LibSqlDreamRepository(db);
  const recalls = new LibSqlRecallEntryRepository(db);
  const analyses = new LibSqlDreamAnalysisRepository(db);

  const now = context.now().toISOString();
  const text = optionalFlag(flags, "text") ?? null;
  const audioPath = optionalFlag(flags, "audio");
  if (!text && !audioPath) {
    throw new Error("record requires --text, --audio, or both.");
  }

  const retention = parseRetention(optionalFlag(flags, "retention") ?? config.audio.retention);
  const audioRetentionPlan = planAudioRetention(retention);
  const audio = audioPath
    ? buildRecallAudio({
        recallEntryId: "",
        audioPath,
        retention,
        context,
        flags,
        config,
        now,
      })
    : null;

  const assignment = await resolveAssignment({
    flags,
    sleepSessions,
    dreams,
    now,
  });

  const recallEntryId = randomUUID();
  const storedAudio = audio && audioRetentionPlan.shouldStoreAudio ? { ...audio, recallEntryId } : undefined;
  const recallEntry: RecallEntry = {
    id: recallEntryId,
    dreamId: assignment.dream?.id ?? null,
    transcriptionStatus: getTranscriptionStatus(Boolean(storedAudio), text),
    supersedesEntryId: null,
    supersededByEntryId: null,
    capturedAt: now,
    captureMethod: "cli",
    sourceAgent: null,
    text,
    hasAudio: Boolean(storedAudio),
    audioRetention: retention,
    audioDeletedAt: null,
    isSuperseded: false,
    notes: optionalFlag(flags, "notes") ?? null,
    deletedAt: null,
    deleteReason: null,
  };

  await recalls.create({
    recallEntry,
    audio: storedAudio,
  });

  const analysis = assignment.dream
    ? await createDreamAnalysis({
        dreamId: assignment.dream.id,
        recalls,
        analyses,
        extraction: new HeuristicExtractionAdapter(),
        embedding: new HashEmbeddingAdapter(),
        now,
      })
    : null;

  return {
    recallEntry,
    dream: assignment.dream,
    sleepSession: assignment.sleepSession,
    analysis,
    audioStored: Boolean(storedAudio),
  };
}

export async function runSleepCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<SleepSession> {
  const config = loadCliConfig(flags, context);
  const databaseUrl = databasePathToUrl(config.database.path, context.homeDir);
  context.ensureDir(dirname(fileURLToPath(databaseUrl)));
  await initializeDatabase({ url: databaseUrl });

  const db = createDatabase({ url: databaseUrl });
  const sleepSessions = new LibSqlSleepSessionRepository(db);
  const now = context.now().toISOString();
  const sessionDate = requiredFlag(flags, "session-date");
  const sleepSession: SleepSession = {
    id: optionalFlag(flags, "id") ?? randomUUID(),
    sessionDate,
    sleepStartedAt: optionalFlag(flags, "sleep-started-at") ?? null,
    wokeAt: optionalFlag(flags, "woke-at") ?? null,
    sleepQuality: optionalIntegerFlag(flags, "quality"),
    isNap: Boolean(flags.nap),
    inductionAttempts: parseJsonArrayFlag(flags, "induction-attempts"),
    supplements: parseCsvFlag(flags, "supplements"),
    alarms: parseJsonArrayFlag(flags, "alarms"),
    notes: optionalFlag(flags, "notes") ?? null,
    updatedAt: now,
    deletedAt: null,
    deleteReason: null,
  };

  return sleepSessions.upsert(sleepSession);
}

export async function runReanalyzeCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<DreamAnalysis> {
  const config = loadCliConfig(flags, context);
  const databaseUrl = databasePathToUrl(config.database.path, context.homeDir);
  context.ensureDir(dirname(fileURLToPath(databaseUrl)));
  await initializeDatabase({ url: databaseUrl });

  const db = createDatabase({ url: databaseUrl });
  const dreams = new LibSqlDreamRepository(db);
  const recalls = new LibSqlRecallEntryRepository(db);
  const analyses = new LibSqlDreamAnalysisRepository(db);
  const dreamId = requiredFlag(flags, "dream-id");
  const dream = await dreams.findById(dreamId);
  if (!dream) {
    throw new Error(`Dream Record not found: ${dreamId}`);
  }

  return createDreamAnalysis({
    dreamId,
    recalls,
    analyses,
    extraction: new HeuristicExtractionAdapter(),
    embedding: new HashEmbeddingAdapter(),
    now: context.now().toISOString(),
  });
}

export async function runSubmitAnalysisCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<DreamAnalysis> {
  const config = loadCliConfig(flags, context);
  const databaseUrl = databasePathToUrl(config.database.path, context.homeDir);
  context.ensureDir(dirname(fileURLToPath(databaseUrl)));
  await initializeDatabase({ url: databaseUrl });

  const input = parseSubmittedAnalysisFile(requiredFlag(flags, "file"), context);
  const db = createDatabase({ url: databaseUrl });
  const dreams = new LibSqlDreamRepository(db);
  const analyses = new LibSqlDreamAnalysisRepository(db);
  return createSubmittedDreamAnalysis({
    submitted: input,
    dreams,
    analyses,
    embedding: new HashEmbeddingAdapter(),
    now: context.now().toISOString(),
  });
}

export async function runIndexCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<{ updated: number }> {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  const queries = new LibSqlDreamQueryRepository(db);
  const analyses = new LibSqlDreamAnalysisRepository(db);
  const embeddingAdapter = new HashEmbeddingAdapter();
  const rows = await queries.listCurrent();

  for (const row of rows) {
    const embedding = await embeddingAdapter.embed({ text: row.canonicalText });
    await analyses.updateEmbedding(row.analysisId, embedding.embedding);
  }

  return { updated: rows.length };
}

export async function runQueryCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<DreamQueryResult[]> {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  const queries = new LibSqlDreamQueryRepository(db);
  const filters = parseQueryFilters(flags);
  const queryEmbedding = filters.text
    ? (await new HashEmbeddingAdapter().embed({ text: filters.text })).embedding
    : undefined;
  const limit = optionalIntegerFlag(flags, "limit") ?? 10;
  return (await queries.query(filters, queryEmbedding)).slice(0, limit);
}

export async function runGraphCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<DreamGraph> {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  return new LibSqlDreamQueryRepository(db).graph();
}

export async function runExportCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<string> {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  const journal = await new LibSqlJournalExportRepository(db).export({ provenance: Boolean(flags.provenance) });
  const format = optionalFlag(flags, "format") ?? "json";

  if (format === "json") return JSON.stringify(journal, null, 2);
  if (format === "markdown" || format === "md") return journalToMarkdown(journal);
  if (format === "csv") return journalToCsv(journal);
  throw new Error("--format must be one of: json, markdown, csv.");
}

export async function runRecallEditCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<RecallEntry> {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  return new LibSqlRecallEntryRepository(db).updateText(requiredFlag(flags, "recall-id"), requiredFlag(flags, "text"));
}

export async function runRecallCorrectCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<{ original: RecallEntry; replacement: RecallEntry; analysis: DreamAnalysis | null }> {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  const recalls = new LibSqlRecallEntryRepository(db);
  const analyses = new LibSqlDreamAnalysisRepository(db);
  const original = await recalls.findById(requiredFlag(flags, "recall-id"));
  if (!original) {
    throw new Error(`Recall Entry not found: ${requiredFlag(flags, "recall-id")}`);
  }

  const now = context.now().toISOString();
  const replacement: RecallEntry = {
    ...original,
    id: optionalFlag(flags, "new-recall-id") ?? randomUUID(),
    text: requiredFlag(flags, "text"),
    capturedAt: now,
    captureMethod: "cli",
    sourceAgent: null,
    transcriptionStatus: "complete",
    supersedesEntryId: original.id,
    supersededByEntryId: null,
    hasAudio: false,
    audioDeletedAt: null,
    isSuperseded: false,
    notes: optionalFlag(flags, "notes") ?? original.notes,
    deletedAt: null,
    deleteReason: null,
  };

  await recalls.supersede(original.id, replacement);
  const analysis = replacement.dreamId
    ? await createDreamAnalysis({
        dreamId: replacement.dreamId,
        recalls,
        analyses,
        extraction: new HeuristicExtractionAdapter(),
        embedding: new HashEmbeddingAdapter(),
        now,
      })
    : null;

  return { original: { ...original, isSuperseded: true, supersededByEntryId: replacement.id }, replacement, analysis };
}

export async function runDeleteCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
): Promise<DeleteCommandResult> {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  const entity = parseDeleteEntity(requiredFlag(flags, "entity"));
  const id = requiredFlag(flags, "id");
  const hard = Boolean(flags.hard);

  if (hard && !flags["confirm-hard-delete"]) {
    throw new Error("Hard delete requires --confirm-hard-delete.");
  }

  if (entity === "recall") {
    const recalls = new LibSqlRecallEntryRepository(db);
    if (hard) await recalls.hardDelete(id);
    else await recalls.softDelete(id, optionalFlag(flags, "reason"));
  }

  if (entity === "dream") {
    const dreams = new LibSqlDreamRepository(db);
    if (hard) await dreams.hardDelete(id);
    else await dreams.softDelete(id, optionalFlag(flags, "reason"));
  }

  if (entity === "session") {
    const sleepSessions = new LibSqlSleepSessionRepository(db);
    if (hard) await sleepSessions.hardDelete(id);
    else await sleepSessions.softDelete(id, optionalFlag(flags, "reason"));
  }

  return { deleted: true, entity, id, mode: hard ? "hard" : "soft" };
}

export async function runDoctorStorageCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
) {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  return new LibSqlMediaRepository(db).summary(fileURLToPath(databaseUrl), optionalIntegerFlag(flags, "limit") ?? 5);
}

export async function runMediaListCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
) {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  return new LibSqlMediaRepository(db).listLargest(optionalIntegerFlag(flags, "limit") ?? 20);
}

export async function runMediaInspectCommand(
  flags: Record<string, string | boolean>,
  context: CliContext = DEFAULT_CONTEXT,
) {
  const { databaseUrl } = await prepareCliDatabase(flags, context);
  const db = createDatabase({ url: databaseUrl });
  const item = await new LibSqlMediaRepository(db).inspect(requiredFlag(flags, "recall-id"));
  if (!item) {
    throw new Error(`Recall Entry audio not found: ${requiredFlag(flags, "recall-id")}`);
  }
  return item;
}

async function prepareCliDatabase(flags: Record<string, string | boolean>, context: CliContext) {
  const config = loadCliConfig(flags, context);
  const databaseUrl = databasePathToUrl(config.database.path, context.homeDir);
  context.ensureDir(dirname(fileURLToPath(databaseUrl)));
  await initializeDatabase({ url: databaseUrl });
  return { config, databaseUrl };
}


function parseSubmittedAnalysisFile(path: string, context: CliContext): SubmittedDreamAnalysisInput {
  const raw = Buffer.from(context.readFile(path)).toString("utf8");
  return normalizeSubmittedAnalysis(JSON.parse(raw) as unknown);
}

function normalizeSubmittedAnalysis(input: unknown): ReturnType<typeof normalizeSubmittedAnalysisInput> {
  if (!isRecord(input)) {
    throw new Error("Submitted analysis must be a JSON object.");
  }

  return normalizeSubmittedAnalysisInput({
    dreamId: requiredStringField(input, "dreamId"),
    canonicalText: requiredStringField(input, "canonicalText"),
    sourceAgent: requiredStringField(input, "sourceAgent"),
    sourceModel: requiredStringField(input, "sourceModel"),
    promptVersion: optionalStringField(input, "promptVersion") ?? undefined,
    lucidityLevel: optionalNumberField(input, "lucidityLevel"),
    inductionTech: optionalStringField(input, "inductionTech"),
    realityCheck: optionalStringField(input, "realityCheck"),
    controlLevel: optionalNumberField(input, "controlLevel"),
    onsetType: optionalStringField(input, "onsetType"),
    dreamSigns: optionalStringArrayField(input, "dreamSigns"),
    emotions: optionalStringArrayField(input, "emotions"),
    hvdc: normalizeHvdC(input.hvdc),
    entities: parseEntityArray(input.entities),
  });
}

function normalizeHvdC(value: unknown): HvdCRecordFields {
  const input = isRecord(value) ? value : {};
  return {
    characters: optionalArrayField(input, "characters"),
    socialInteractions: optionalArrayField(input, "socialInteractions"),
    activities: optionalArrayField(input, "activities"),
    emotions: optionalArrayField(input, "emotions"),
    settings: optionalArrayField(input, "settings"),
    objects: optionalArrayField(input, "objects"),
    outcomes: optionalArrayField(input, "outcomes"),
  };
}

function parseEntityArray(value: unknown): Array<{ type: EntityType; name: string; context: string | null }> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("entities must be an array.");
  }
  return value.map((entity) => {
    if (!isRecord(entity)) {
      throw new Error("Each submitted entity must be an object.");
    }
    return {
      type: parseEntityType(requiredStringField(entity, "type")),
      name: requiredStringField(entity, "name"),
      context: optionalStringField(entity, "context"),
    };
  });
}

function parseEntityType(value: string): EntityType {
  if (value === "person" || value === "place" || value === "symbol" || value === "object" || value === "emotion") {
    return value;
  }
  throw new Error("Submitted entity type must be one of: person, place, symbol, object, emotion.");
}


function requiredStringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Submitted analysis requires ${key}.`);
  }
  return value;
}

function optionalStringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }
  return value.trim() || null;
}

function optionalNumberField(input: Record<string, unknown>, key: string): number | null {
  const value = input[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number.`);
  }
  return value;
}

function optionalStringArrayField(input: Record<string, unknown>, key: string): string[] {
  return optionalArrayField(input, key).map((item) => String(item).trim()).filter((item) => item.length > 0);
}

function optionalArrayField(input: Record<string, unknown>, key: string): unknown[] {
  const value = input[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildRecallAudio(input: {
  recallEntryId: string;
  audioPath: string;
  retention: AudioRetention;
  context: CliContext;
  flags: Record<string, string | boolean>;
  config: ReturnType<typeof loadLucidmemoConfig>;
  now: ISODateTime;
}): RecallAudio | null {
  const resolvedPath = resolve(input.audioPath);
  if (!input.context.fileExists(resolvedPath)) {
    throw new Error(`Audio file not found: ${resolvedPath}`);
  }

  const audioBlob = input.context.readFile(resolvedPath);
  const durationMs = optionalIntegerFlag(input.flags, "duration-ms");
  const metadata = validateAudioInput(
    {
      mimeType: optionalFlag(input.flags, "mime-type") ?? null,
      extension: optionalFlag(input.flags, "extension") ?? extname(resolvedPath),
      originalName: optionalFlag(input.flags, "original-name") ?? resolvedPath.split("/").at(-1) ?? null,
      sizeBytes: audioBlob.byteLength,
      durationMs,
    },
    input.config.audio,
  ).metadata;

  if (!planAudioRetention(input.retention).shouldStoreAudio) {
    return null;
  }

  return {
    recallEntryId: input.recallEntryId,
    audioBlob,
    audioMimeType: metadata.mimeType,
    audioExtension: metadata.extension,
    audioOriginalName: metadata.originalName,
    audioSizeBytes: metadata.sizeBytes,
    audioDurationMs: metadata.durationMs,
    createdAt: input.now,
  };
}

async function resolveAssignment(input: {
  flags: Record<string, string | boolean>;
  sleepSessions: SleepSessionRepository;
  dreams: DreamRepository;
  now: ISODateTime;
}): Promise<{ dream: DreamRecord | null; sleepSession: SleepSession | null }> {
  const dreamId = optionalFlag(input.flags, "dream-id");
  if (dreamId) {
    const dream = await input.dreams.findById(dreamId);
    if (!dream) {
      throw new Error(`Dream Record not found: ${dreamId}`);
    }
    return { dream, sleepSession: null };
  }

  const createDream = Boolean(input.flags["new-dream"]);
  const createSleepSession = Boolean(input.flags["new-sleep-session"]);
  if (!createDream && !createSleepSession) {
    return { dream: null, sleepSession: null };
  }

  const sleepSession = createSleepSession
    ? await input.sleepSessions.upsert(buildSleepSessionFromFlags(input.flags, input.now))
    : await findExistingSleepSession(input.flags, input.sleepSessions);

  if (!createDream) {
    return { dream: null, sleepSession };
  }

  const dreamDate = resolveDreamDate(input.flags, sleepSession);
  const dream: DreamRecord = {
    id: optionalFlag(input.flags, "new-dream-id") ?? randomUUID(),
    sleepSessionId: sleepSession?.id ?? null,
    dreamDate,
    title: optionalFlag(input.flags, "title") ?? null,
    deletedAt: null,
    deleteReason: null,
  };
  await input.dreams.create(dream);
  return { dream, sleepSession };
}

async function findExistingSleepSession(
  flags: Record<string, string | boolean>,
  sleepSessions: SleepSessionRepository,
): Promise<SleepSession | null> {
  const sleepSessionId = optionalFlag(flags, "sleep-session-id");
  if (!sleepSessionId) {
    return null;
  }

  const sleepSession = await sleepSessions.findById(sleepSessionId);
  if (!sleepSession) {
    throw new Error(`Sleep Session not found: ${sleepSessionId}`);
  }
  return sleepSession;
}

function buildSleepSessionFromFlags(
  flags: Record<string, string | boolean>,
  now: ISODateTime,
): SleepSession {
  const sessionDate = requiredFlag(flags, "session-date");
  return {
    id: optionalFlag(flags, "new-sleep-session-id") ?? optionalFlag(flags, "sleep-session-id") ?? randomUUID(),
    sessionDate,
    sleepStartedAt: optionalFlag(flags, "sleep-started-at") ?? null,
    wokeAt: optionalFlag(flags, "woke-at") ?? null,
    sleepQuality: optionalIntegerFlag(flags, "quality"),
    isNap: Boolean(flags.nap),
    inductionAttempts: parseJsonArrayFlag(flags, "induction-attempts"),
    supplements: parseCsvFlag(flags, "supplements"),
    alarms: parseJsonArrayFlag(flags, "alarms"),
    notes: optionalFlag(flags, "sleep-notes") ?? optionalFlag(flags, "notes") ?? null,
    updatedAt: now,
    deletedAt: null,
    deleteReason: null,
  };
}

function resolveDreamDate(flags: Record<string, string | boolean>, sleepSession: SleepSession | null): ISODate {
  const dreamDate = optionalFlag(flags, "dream-date");
  if (dreamDate) {
    return dreamDate;
  }
  if (sleepSession) {
    return sleepSession.sessionDate;
  }
  throw new Error("Creating a Dream Record without a Sleep Session requires --dream-date.");
}

function loadCliConfig(flags: Record<string, string | boolean>, context: CliContext) {
  const configPath = optionalFlag(flags, "config") ?? getDefaultConfigPath(context.homeDir);
  const toml = context.fileExists(configPath) ? new TextDecoder().decode(context.readFile(configPath)) : null;
  const config = loadLucidmemoConfig({ toml, env: process.env });
  const databasePath = optionalFlag(flags, "db");
  return databasePath
    ? {
        ...config,
        database: { path: databasePath },
      }
    : config;
}

function parseQueryFilters(flags: Record<string, string | boolean>): DreamQueryFilters {
  const positionalText = optionalFlag(flags, "text") ?? optionalFlag(flags, "q");
  const lucidityRaw = optionalFlag(flags, "lucidity");
  const filters: DreamQueryFilters = {
    text: positionalText,
    date: optionalFlag(flags, "date"),
    from: optionalFlag(flags, "from"),
    to: optionalFlag(flags, "to"),
    symbol: optionalFlag(flags, "symbol"),
    person: optionalFlag(flags, "person"),
    setting: optionalFlag(flags, "setting"),
    emotion: optionalFlag(flags, "emotion"),
    object: optionalFlag(flags, "object"),
    interaction: optionalFlag(flags, "interaction"),
    technique: optionalFlag(flags, "technique"),
  };

  if (lucidityRaw?.endsWith("+")) {
    filters.lucidityMin = parseNonNegativeInteger(lucidityRaw.slice(0, -1), "--lucidity");
  } else if (lucidityRaw !== undefined) {
    filters.lucidity = parseNonNegativeInteger(lucidityRaw, "--lucidity");
  }

  return filters;
}

function databasePathToUrl(databasePath: string, homeDir: string): `file:${string}` {
  const expanded =
    databasePath === DEFAULT_DATABASE_PATH || databasePath.startsWith("~/")
      ? databasePath.replace(/^~/, homeDir)
      : databasePath;
  return `file:${resolve(expanded)}`;
}

function getTranscriptionStatus(hasAudio: boolean, text: string | null): TranscriptionStatus {
  if (!hasAudio) {
    return "not_needed";
  }
  return text ? "complete" : "pending";
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = null, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  let start = 0;

  if (command === "doctor" && rest[0] === "storage") {
    start = 1;
  } else if (command === "media" && (rest[0] === "list" || rest[0] === "inspect")) {
    start = 1;
    if (rest[0] === "inspect" && rest[1] && !rest[1].startsWith("--")) {
      flags["recall-id"] = rest[1];
      start = 2;
    }
  } else if (command === "delete") {
    if (rest[0] && !rest[0].startsWith("--")) {
      flags.entity = rest[0];
      start = 1;
      if (rest[1] && !rest[1].startsWith("--")) {
        flags.id = rest[1];
        start = 2;
      }
    }
  }

  for (let index = start; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      if (command === "query" && flags.text === undefined) {
        flags.text = token;
        continue;
      }
      if (command === "delete") {
        if (flags.entity === undefined) {
          flags.entity = token;
          continue;
        }
        if (flags.id === undefined) {
          flags.id = token;
          continue;
        }
      }
      if (command === "doctor" && token === "storage") {
        flags["_doctor-command"] = token;
        continue;
      }
      if (command === "media" && (token === "list" || token === "inspect")) {
        flags["_media-command"] = token;
        continue;
      }
      if (command === "media" && flags["_media-command"] === "inspect" && flags["recall-id"] === undefined) {
        flags["recall-id"] = token;
        continue;
      }
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }

  return { command: commandPath(command, rest, flags), flags };
}

function commandPath(command: string | null, rest: string[], flags: Record<string, string | boolean>): string | null {
  if (command === "doctor" && (rest[0] === "storage" || flags["_doctor-command"] === "storage")) return "doctor storage";
  if (command === "media") {
    const mediaCommand = flags["_media-command"] ?? rest.find((token) => token === "list" || token === "inspect");
    if (mediaCommand === "list" || mediaCommand === "inspect") return `media ${mediaCommand}`;
  }
  return command;
}

function optionalFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  if (value === undefined || typeof value === "boolean") {
    return undefined;
  }
  return value;
}

function requiredFlag(flags: Record<string, string | boolean>, key: string): string {
  const value = optionalFlag(flags, key);
  if (!value) {
    throw new Error(`Missing required --${key}.`);
  }
  return value;
}

function optionalIntegerFlag(flags: Record<string, string | boolean>, key: string): number | null {
  const value = optionalFlag(flags, key);
  if (value === undefined) {
    return null;
  }

  return parseNonNegativeInteger(value, `--${key}`);
}

function parseNonNegativeInteger(value: string, label: string): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return numberValue;
}

function parseRetention(value: string): AudioRetention {
  if (value === "keep" || value === "delete_after_transcription" || value === "never_store") {
    return value;
  }
  throw new Error("--retention must be one of: keep, delete_after_transcription, never_store.");
}

function parseDeleteEntity(value: string): "recall" | "dream" | "session" {
  if (value === "recall" || value === "dream" || value === "session") {
    return value;
  }
  throw new Error("--entity must be one of: recall, dream, session.");
}

function journalToMarkdown(journal: Awaited<ReturnType<LibSqlJournalExportRepository["export"]>>): string {
  const dreams = journal.dreams as Array<{ id: string; dreamDate: string; title: string | null }>;
  const analyses = new Map(
    (journal.dreamAnalyses as Array<{ dreamId: string; canonicalText: string; lucidityLevel: number | null; dreamSigns: string[]; emotions: string[] }>).map(
      (analysis) => [analysis.dreamId, analysis],
    ),
  );
  const recalls = journal.recallEntries as Array<{ id: string; dreamId: string | null; capturedAt: string; text: string | null }>;

  const lines = [
    "# lucidmemo Export",
    "",
    `Exported at: ${journal.exportedAt}`,
    `Provenance included: ${journal.provenance ? "yes" : "no"}`,
    "",
  ];

  for (const dream of dreams.sort((a, b) => a.dreamDate.localeCompare(b.dreamDate))) {
    const analysis = analyses.get(dream.id);
    lines.push(`## ${dream.dreamDate}${dream.title ? ` - ${dream.title}` : ""}`, "");
    if (analysis) {
      lines.push(analysis.canonicalText, "");
      lines.push(`Lucidity: ${analysis.lucidityLevel ?? ""}`);
      lines.push(`Dream signs: ${analysis.dreamSigns.join(", ")}`);
      lines.push(`Emotions: ${analysis.emotions.join(", ")}`, "");
    }
    const dreamRecalls = recalls.filter((recall) => recall.dreamId === dream.id);
    if (dreamRecalls.length > 0) {
      lines.push("### Recall Entries", "");
      for (const recall of dreamRecalls) {
        lines.push(`- ${recall.capturedAt}: ${recall.text ?? "[audio pending transcription]"}`);
      }
      lines.push("");
    }
  }

  const unassigned = recalls.filter((recall) => recall.dreamId === null);
  if (unassigned.length > 0) {
    lines.push("## Unassigned Recall Entries", "");
    for (const recall of unassigned) {
      lines.push(`- ${recall.capturedAt}: ${recall.text ?? "[audio pending transcription]"}`);
    }
  }

  return lines.join("\n").trimEnd();
}

function journalToCsv(journal: Awaited<ReturnType<LibSqlJournalExportRepository["export"]>>): string {
  const analyses = new Map(
    (journal.dreamAnalyses as Array<{
      dreamId: string;
      canonicalText: string;
      lucidityLevel: number | null;
      inductionTech: string | null;
      dreamSigns: string[];
      emotions: string[];
    }>).map((analysis) => [analysis.dreamId, analysis]),
  );
  const rows = [
    ["dream_id", "dream_date", "title", "lucidity_level", "induction_tech", "dream_signs", "emotions", "canonical_text"],
  ];

  for (const dream of journal.dreams as Array<{ id: string; dreamDate: string; title: string | null }>) {
    const analysis = analyses.get(dream.id);
    rows.push([
      dream.id,
      dream.dreamDate,
      dream.title ?? "",
      analysis?.lucidityLevel === null || analysis?.lucidityLevel === undefined ? "" : String(analysis.lucidityLevel),
      analysis?.inductionTech ?? "",
      analysis?.dreamSigns.join("|") ?? "",
      analysis?.emotions.join("|") ?? "",
      analysis?.canonicalText ?? "",
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function parseCsvFlag(flags: Record<string, string | boolean>, key: string): string[] {
  const value = optionalFlag(flags, key);
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseJsonArrayFlag(flags: Record<string, string | boolean>, key: string): unknown[] {
  const value = optionalFlag(flags, key);
  if (!value) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`--${key} must be a JSON array.`);
  }
  return parsed;
}

function printRecordResult(result: RecordCommandResult, context: CliContext): void {
  context.output.log(`Recall Entry saved: ${result.recallEntry.id}`);
  context.output.log(`Transcription status: ${result.recallEntry.transcriptionStatus}`);
  context.output.log(`Audio stored: ${result.audioStored ? "yes" : "no"}`);

  if (result.dream) {
    context.output.log(`Dream Record linked: ${result.dream.id}`);
    if (result.analysis) {
      context.output.log(`Dream Analysis created: ${result.analysis.id}`);
    }
  } else {
    context.output.log(
      "Recall Entry is unassigned. Clarify whether it belongs to an existing Dream Record or a new Dream Record.",
    );
  }
}

function printQueryResult(results: DreamQueryResult[], context: CliContext): void {
  if (results.length === 0) {
    context.output.log("No matching dreams.");
    return;
  }

  for (const result of results) {
    const score = result.score === null ? "" : ` score=${result.score.toFixed(3)}`;
    context.output.log(
      `${result.dreamDate} ${result.dreamId}${score} ${result.title ? result.title : ""}`.trim(),
    );
    context.output.log(result.canonicalText);
  }
}

function printHelp(context: CliContext): void {
  context.output.log(`lucidmemo commands:
  lucidmemo record --text "..." [--audio ./dream.m4a] [--new-dream --dream-date YYYY-MM-DD]
  lucidmemo record --audio ./dream.m4a --duration-ms 120000
  lucidmemo sleep --session-date YYYY-MM-DD [--sleep-started-at ISO] [--woke-at ISO] [--quality 1-5]
  lucidmemo reanalyze --dream-id <id>
  lucidmemo submit-analysis --file analysis.json
  lucidmemo index
  lucidmemo query --text "hands lucid" [--from YYYY-MM-DD] [--lucidity 3+]
  lucidmemo graph
  lucidmemo export --format json|markdown|csv [--provenance]
  lucidmemo recall-edit --recall-id <id> --text "fixed typo"
  lucidmemo recall-correct --recall-id <id> --text "remembered correction"
  lucidmemo delete recall <id> [--reason "..."]
  lucidmemo delete recall <id> --hard --confirm-hard-delete
  lucidmemo doctor storage
  lucidmemo media list --largest
  lucidmemo media inspect <recall-id>

Global flags:
  --config PATH   Config TOML path, defaults to ~/.lucidmemo/config.toml
  --db PATH       Database path override, defaults to ~/.lucidmemo/journal.db`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
