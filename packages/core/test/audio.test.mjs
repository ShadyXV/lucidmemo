import assert from "node:assert/strict";
import test from "node:test";

import { loadLucidmemoConfig, planAudioRetention, validateAudioInput } from "../dist/index.js";

const config = loadLucidmemoConfig().audio;

test("accepts input-native audio metadata under configured limits", () => {
  const result = validateAudioInput(
    {
      mimeType: "audio/webm",
      extension: ".WEBM",
      originalName: "dream.webm",
      sizeBytes: 1024,
      durationMs: 30_000,
    },
    config,
  );

  assert.deepEqual(result.metadata, {
    mimeType: "audio/webm",
    extension: "webm",
    originalName: "dream.webm",
    sizeBytes: 1024,
    durationMs: 30_000,
  });
});

test("rejects audio larger than the configured byte limit", () => {
  assert.throws(
    () =>
      validateAudioInput(
        {
          mimeType: "audio/wav",
          extension: "wav",
          originalName: "too-large.wav",
          sizeBytes: config.maxSizeBytes + 1,
          durationMs: 30_000,
        },
        config,
      ),
    /exceeds/,
  );
});

test("rejects audio longer than the configured duration when duration is known", () => {
  assert.throws(
    () =>
      validateAudioInput(
        {
          mimeType: "audio/mp4",
          extension: "m4a",
          originalName: "too-long.m4a",
          sizeBytes: 1024,
          durationMs: config.maxDurationSeconds * 1000 + 1,
        },
        config,
      ),
    /exceeds/,
  );
});

test("allows imported audio when duration cannot be inspected but size is valid", () => {
  const result = validateAudioInput(
    {
      mimeType: null,
      extension: null,
      originalName: null,
      sizeBytes: 1024,
      durationMs: null,
    },
    config,
  );

  assert.equal(result.metadata.durationMs, null);
});

test("maps audio retention to storage behavior", () => {
  assert.deepEqual(planAudioRetention("keep"), {
    retention: "keep",
    shouldStoreAudio: true,
    shouldDeleteAfterTranscription: false,
  });
  assert.deepEqual(planAudioRetention("delete_after_transcription"), {
    retention: "delete_after_transcription",
    shouldStoreAudio: true,
    shouldDeleteAfterTranscription: true,
  });
  assert.deepEqual(planAudioRetention("never_store"), {
    retention: "never_store",
    shouldStoreAudio: false,
    shouldDeleteAfterTranscription: false,
  });
});
