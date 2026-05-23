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
  type DreamRecord,
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
  LibSqlDreamRepository,
  LibSqlRecallEntryRepository,
  LibSqlSleepSessionRepository,
} from "@lucidmemo/db";

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

  return {
    recallEntry,
    dream: assignment.dream,
    sleepSession: assignment.sleepSession,
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

  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`--${key} must be a non-negative integer.`);
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
  } else {
    context.output.log(
      "Recall Entry is unassigned. Clarify whether it belongs to an existing Dream Record or a new Dream Record.",
    );
  }
}

function printHelp(context: CliContext): void {
  context.output.log(`lucidmemo commands:
  lucidmemo record --text "..." [--audio ./dream.m4a] [--new-dream --dream-date YYYY-MM-DD]
  lucidmemo record --audio ./dream.m4a --duration-ms 120000
  lucidmemo sleep --session-date YYYY-MM-DD [--sleep-started-at ISO] [--woke-at ISO] [--quality 1-5]

Global flags:
  --config PATH   Config TOML path, defaults to ~/.lucidmemo/config.toml
  --db PATH       Database path override, defaults to ~/.lucidmemo/journal.db`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
