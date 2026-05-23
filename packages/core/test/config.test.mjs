import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LUCIDMEMO_CONFIG,
  getDefaultConfigPath,
  loadLucidmemoConfig,
} from "../dist/index.js";

test("loads defaults for v1 local config", () => {
  assert.deepEqual(loadLucidmemoConfig(), DEFAULT_LUCIDMEMO_CONFIG);
  assert.equal(getDefaultConfigPath("/Users/shady"), "/Users/shady/.lucidmemo/config.toml");
});

test("loads TOML config overrides", () => {
  const config = loadLucidmemoConfig({
    toml: `
      [database]
      path = "/tmp/lucidmemo.db"

      [audio]
      maxDurationSeconds = 300
      maxSizeBytes = 12345
      retention = "delete_after_transcription"
    `,
  });

  assert.equal(config.database.path, "/tmp/lucidmemo.db");
  assert.equal(config.audio.maxDurationSeconds, 300);
  assert.equal(config.audio.maxSizeBytes, 12345);
  assert.equal(config.audio.retention, "delete_after_transcription");
});

test("env overrides TOML config", () => {
  const config = loadLucidmemoConfig({
    toml: `
      [database]
      path = "/tmp/from-file.db"

      [audio]
      maxDurationSeconds = 300
      maxSizeBytes = 12345
      retention = "keep"
    `,
    env: {
      LUCIDMEMO_DATABASE_PATH: "/tmp/from-env.db",
      LUCIDMEMO_AUDIO_MAX_DURATION_SECONDS: "60",
      LUCIDMEMO_AUDIO_MAX_SIZE_BYTES: "98765",
      LUCIDMEMO_AUDIO_RETENTION: "never_store",
    },
  });

  assert.equal(config.database.path, "/tmp/from-env.db");
  assert.equal(config.audio.maxDurationSeconds, 60);
  assert.equal(config.audio.maxSizeBytes, 98765);
  assert.equal(config.audio.retention, "never_store");
});

test("rejects invalid retention values", () => {
  assert.throws(
    () =>
      loadLucidmemoConfig({
        toml: `
          [audio]
          retention = "archive"
        `,
      }),
    /audio\.retention/,
  );
});
