#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import {
  DEFAULT_DATABASE_PATH,
  getDefaultConfigPath,
  loadLucidmemoConfig,
  planAudioRetention,
  validateAudioInput,
  type AudioRetention,
  type CaptureMethod,
  type DreamAnalysis,
  type DreamAnalysisBundle,
  type DreamGraph,
  type DreamQueryFilters,
  type DreamQueryResult,
  type DreamRecord,
  type HvdCRecord,
  type ISODate,
  type ISODateTime,
  type RecallAudio,
  type RecallEntry,
  type SleepSession,
  type TranscriptionStatus,
} from "@lucidmemo/core";
import {
  createDatabase,
  initializeDatabase,
  LibSqlDreamAnalysisRepository,
  LibSqlDreamQueryRepository,
  LibSqlDreamRepository,
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

async function prepareCliDatabase(flags: Record<string, string | boolean>, context: CliContext) {
  const config = loadCliConfig(flags, context);
  const databaseUrl = databasePathToUrl(config.database.path, context.homeDir);
  context.ensureDir(dirname(fileURLToPath(databaseUrl)));
  await initializeDatabase({ url: databaseUrl });
  return { config, databaseUrl };
}

async function createDreamAnalysis(input: {
  dreamId: string;
  recalls: LibSqlRecallEntryRepository;
  analyses: LibSqlDreamAnalysisRepository;
  now: ISODateTime;
}): Promise<DreamAnalysis> {
  const recallEntries = await input.recalls.listByDreamId(input.dreamId);
  const canonicalSourceText = recallEntries
    .filter((entry) => entry.text !== null && entry.text.trim().length > 0)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .map((entry) => entry.text)
    .join("\n\n");

  if (!canonicalSourceText) {
    throw new Error("Dream Analysis requires at least one text Recall Entry.");
  }

  const extraction = await new HeuristicExtractionAdapter().extract({ text: canonicalSourceText });
  const embedding = await new HashEmbeddingAdapter().embed({ text: extraction.canonicalText });
  const analysisId = randomUUID();
  const bundle: DreamAnalysisBundle = {
    analysis: {
      id: analysisId,
      dreamId: input.dreamId,
      createdAt: input.now,
      isCurrent: true,
      sourceAdapter: extraction.sourceAdapter,
      sourceModel: extraction.sourceModel,
      promptVersion: extraction.promptVersion,
      correctionSource: null,
      canonicalText: extraction.canonicalText,
      lucidityLevel: extraction.lucidityLevel,
      inductionTech: extraction.inductionTech,
      realityCheck: extraction.realityCheck,
      controlLevel: extraction.controlLevel,
      onsetType: extraction.onsetType,
      dreamSigns: extraction.dreamSigns,
      emotions: extraction.emotions,
      embedding: embedding.embedding,
      deletedAt: null,
      deleteReason: null,
    },
    hvdcRecord: buildHvdCRecord(analysisId, extraction.hvdc),
    entities: [],
  };

  return input.analyses.createCurrent(bundle);
}

function buildHvdCRecord(analysisId: string, hvdc: HvdCRecordFields): HvdCRecord {
  return {
    analysisId,
    characters: hvdc.characters,
    socialInteractions: hvdc.socialInteractions,
    activities: hvdc.activities,
    emotions: hvdc.emotions,
    settings: hvdc.settings,
    objects: hvdc.objects,
    outcomes: hvdc.outcomes,
  };
}

interface HvdCRecordFields {
  characters: unknown[];
  socialInteractions: unknown[];
  activities: unknown[];
  emotions: unknown[];
  settings: unknown[];
  objects: unknown[];
  outcomes: unknown[];
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
  sleepSessions: LibSqlSleepSessionRepository;
  dreams: LibSqlDreamRepository;
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
  sleepSessions: LibSqlSleepSessionRepository,
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

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      if (command === "query" && flags.text === undefined) {
        flags.text = token;
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

  return { command, flags };
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
  lucidmemo index
  lucidmemo query --text "hands lucid" [--from YYYY-MM-DD] [--lucidity 3+]
  lucidmemo graph

Global flags:
  --config PATH   Config TOML path, defaults to ~/.lucidmemo/config.toml
  --db PATH       Database path override, defaults to ~/.lucidmemo/journal.db`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
