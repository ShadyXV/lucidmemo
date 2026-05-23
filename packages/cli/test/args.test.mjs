import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRecordCommand, runSleepCommand } from "../dist/index.js";

function testContext(homeDir) {
  return {
    output: {
      log() {},
      error() {},
    },
    now: () => new Date("2026-05-23T00:00:00.000Z"),
    readFile: (path) => new Uint8Array(Buffer.from(readFileSync(path))),
    fileExists: existsSync,
    ensureDir: (path) => mkdirSync(path, { recursive: true }),
    homeDir,
  };
}

test("record saves text-only unassigned recall", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const result = await runRecordCommand(
    {
      text: "I remembered a hallway dream at noon.",
    },
    testContext(home),
  );

  assert.equal(result.recallEntry.text, "I remembered a hallway dream at noon.");
  assert.equal(result.recallEntry.dreamId, null);
  assert.equal(result.recallEntry.transcriptionStatus, "not_needed");
  assert.equal(result.audioStored, false);
});

test("record saves audio-only recall as pending transcription", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const audioPath = join(home, "dream.webm");
  writeFileSync(audioPath, Buffer.from("fake audio"));

  const result = await runRecordCommand(
    {
      audio: audioPath,
      "duration-ms": "1000",
      "mime-type": "audio/webm",
    },
    testContext(home),
  );

  assert.equal(result.recallEntry.text, null);
  assert.equal(result.recallEntry.transcriptionStatus, "pending");
  assert.equal(result.recallEntry.hasAudio, true);
  assert.equal(result.audioStored, true);
});

test("record can create a sleep session and dream before linking recall", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const result = await runRecordCommand(
    {
      text: "I became lucid after checking my hands.",
      "new-sleep-session": true,
      "new-dream": true,
      "session-date": "2026-05-22",
      title: "Hands",
    },
    testContext(home),
  );

  assert.equal(result.sleepSession?.sessionDate, "2026-05-22");
  assert.equal(result.dream?.dreamDate, "2026-05-22");
  assert.equal(result.recallEntry.dreamId, result.dream?.id);
});

test("sleep upserts sleep metadata", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const result = await runSleepCommand(
    {
      "session-date": "2026-05-22",
      "sleep-started-at": "2026-05-22T22:00:00.000Z",
      "woke-at": "2026-05-23T06:30:00.000Z",
      quality: "4",
      supplements: "magnesium,tea",
    },
    testContext(home),
  );

  assert.equal(result.sessionDate, "2026-05-22");
  assert.equal(result.sleepQuality, 4);
  assert.deepEqual(result.supplements, ["magnesium", "tea"]);
});
