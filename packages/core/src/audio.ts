import type { AudioRetention } from "./types.js";
import type { AudioConfig } from "./config.js";

export interface AudioInputMetadata {
  mimeType: string | null;
  extension: string | null;
  originalName: string | null;
  sizeBytes: number;
  durationMs: number | null;
}

export interface AudioValidationResult {
  metadata: AudioInputMetadata;
}

export interface AudioRetentionPlan {
  retention: AudioRetention;
  shouldStoreAudio: boolean;
  shouldDeleteAfterTranscription: boolean;
}

export function validateAudioInput(
  metadata: AudioInputMetadata,
  config: Pick<AudioConfig, "maxDurationSeconds" | "maxSizeBytes">,
): AudioValidationResult {
  if (!Number.isInteger(metadata.sizeBytes) || metadata.sizeBytes < 0) {
    throw new Error("Audio sizeBytes must be a non-negative integer.");
  }

  if (metadata.sizeBytes > config.maxSizeBytes) {
    throw new Error(
      `Audio is ${metadata.sizeBytes} bytes, which exceeds the ${config.maxSizeBytes} byte limit.`,
    );
  }

  if (metadata.durationMs !== null) {
    if (!Number.isInteger(metadata.durationMs) || metadata.durationMs < 0) {
      throw new Error("Audio durationMs must be a non-negative integer when provided.");
    }

    const maxDurationMs = config.maxDurationSeconds * 1000;
    if (metadata.durationMs > maxDurationMs) {
      throw new Error(
        `Audio is ${metadata.durationMs} ms, which exceeds the ${maxDurationMs} ms limit.`,
      );
    }
  }

  return {
    metadata: {
      ...metadata,
      extension: normalizeExtension(metadata.extension),
    },
  };
}

export function planAudioRetention(retention: AudioRetention): AudioRetentionPlan {
  return {
    retention,
    shouldStoreAudio: retention !== "never_store",
    shouldDeleteAfterTranscription: retention === "delete_after_transcription",
  };
}

function normalizeExtension(extension: string | null): string | null {
  if (extension === null) {
    return null;
  }

  const normalized = extension.trim().replace(/^\./, "").toLowerCase();
  return normalized.length === 0 ? null : normalized;
}
