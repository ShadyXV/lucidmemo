import { parse as parseToml } from "smol-toml";

import type { AudioRetention } from "./types.js";

export const DEFAULT_MAX_AUDIO_DURATION_SECONDS = 10 * 60;
export const DEFAULT_MAX_AUDIO_SIZE_BYTES = 100 * 1024 * 1024;
export const DEFAULT_DATABASE_PATH = "~/.lucidmemo/journal.db";

export interface AudioConfig {
  maxDurationSeconds: number;
  maxSizeBytes: number;
  retention: AudioRetention;
}

export interface DatabaseConfig {
  path: string;
}

export interface LucidmemoConfig {
  database: DatabaseConfig;
  audio: AudioConfig;
}

export interface ConfigEnv {
  LUCIDMEMO_DATABASE_PATH?: string;
  LUCIDMEMO_AUDIO_MAX_DURATION_SECONDS?: string;
  LUCIDMEMO_AUDIO_MAX_SIZE_BYTES?: string;
  LUCIDMEMO_AUDIO_RETENTION?: string;
}

export interface LoadLucidmemoConfigOptions {
  toml?: string | null;
  env?: ConfigEnv;
}

export interface PartialAudioConfig {
  maxDurationSeconds?: number;
  maxSizeBytes?: number;
  retention?: AudioRetention;
}

export interface PartialDatabaseConfig {
  path?: string;
}

export interface PartialLucidmemoConfig {
  database?: PartialDatabaseConfig;
  audio?: PartialAudioConfig;
}

export const DEFAULT_LUCIDMEMO_CONFIG: LucidmemoConfig = {
  database: {
    path: DEFAULT_DATABASE_PATH,
  },
  audio: {
    maxDurationSeconds: DEFAULT_MAX_AUDIO_DURATION_SECONDS,
    maxSizeBytes: DEFAULT_MAX_AUDIO_SIZE_BYTES,
    retention: "keep",
  },
};

export function getDefaultConfigPath(homeDir = "~"): string {
  return `${stripTrailingSlash(homeDir)}/.lucidmemo/config.toml`;
}

export function loadLucidmemoConfig(options: LoadLucidmemoConfigOptions = {}): LucidmemoConfig {
  const fileConfig = options.toml ? configFromToml(options.toml) : {};
  const envConfig = configFromEnv(options.env ?? {});

  return mergeLucidmemoConfig(DEFAULT_LUCIDMEMO_CONFIG, fileConfig, envConfig);
}

export function parseLucidmemoConfigToml(toml: string): PartialLucidmemoConfig {
  return configFromToml(toml);
}

export function mergeLucidmemoConfig(
  base: LucidmemoConfig,
  ...overrides: PartialLucidmemoConfig[]
): LucidmemoConfig {
  return overrides.reduce<LucidmemoConfig>(
    (current, override) => ({
      database: {
        ...current.database,
        ...(override.database ?? {}),
      },
      audio: {
        ...current.audio,
        ...(override.audio ?? {}),
      },
    }),
    cloneConfig(base),
  );
}

function configFromToml(toml: string): PartialLucidmemoConfig {
  const parsed = parseToml(toml);
  if (!isRecord(parsed)) {
    throw new Error("Config TOML must parse to an object.");
  }

  return normalizeConfigObject(parsed);
}

function configFromEnv(env: ConfigEnv): PartialLucidmemoConfig {
  return normalizeConfigObject({
    database: {
      path: env.LUCIDMEMO_DATABASE_PATH,
    },
    audio: {
      maxDurationSeconds: env.LUCIDMEMO_AUDIO_MAX_DURATION_SECONDS,
      maxSizeBytes: env.LUCIDMEMO_AUDIO_MAX_SIZE_BYTES,
      retention: env.LUCIDMEMO_AUDIO_RETENTION,
    },
  });
}

function normalizeConfigObject(input: Record<string, unknown>): PartialLucidmemoConfig {
  const output: PartialLucidmemoConfig = {};

  if (input.database !== undefined) {
    if (!isRecord(input.database)) {
      throw new Error("Config database section must be an object.");
    }

    const path = optionalString(input.database.path, "database.path");
    output.database = path === undefined ? {} : { path };
  }

  if (input.audio !== undefined) {
    if (!isRecord(input.audio)) {
      throw new Error("Config audio section must be an object.");
    }

    const audio: PartialAudioConfig = {};
    const maxDurationSeconds = optionalPositiveInteger(
      input.audio.maxDurationSeconds,
      "audio.maxDurationSeconds",
    );
    const maxSizeBytes = optionalPositiveInteger(input.audio.maxSizeBytes, "audio.maxSizeBytes");
    const retention = optionalAudioRetention(input.audio.retention, "audio.retention");

    if (maxDurationSeconds !== undefined) {
      audio.maxDurationSeconds = maxDurationSeconds;
    }
    if (maxSizeBytes !== undefined) {
      audio.maxSizeBytes = maxSizeBytes;
    }
    if (retention !== undefined) {
      audio.retention = retention;
    }

    output.audio = audio;
  }

  return output;
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Config ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, key: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const numericValue = typeof value === "string" ? Number(value) : value;
  if (
    typeof numericValue !== "number" ||
    !Number.isInteger(numericValue) ||
    numericValue <= 0
  ) {
    throw new Error(`Config ${key} must be a positive integer.`);
  }

  return numericValue;
}

function optionalAudioRetention(value: unknown, key: string): AudioRetention | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "keep" || value === "delete_after_transcription" || value === "never_store") {
    return value;
  }
  throw new Error(
    `Config ${key} must be one of: keep, delete_after_transcription, never_store.`,
  );
}

function cloneConfig(config: LucidmemoConfig): LucidmemoConfig {
  return {
    database: { ...config.database },
    audio: { ...config.audio },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}
