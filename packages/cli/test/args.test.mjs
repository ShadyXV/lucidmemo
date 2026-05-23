import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runGraphCommand,
  runDeleteCommand,
  runDoctorStorageCommand,
  runExportCommand,
  runIndexCommand,
  runMediaInspectCommand,
  runMediaListCommand,
  runQueryCommand,
  runRecallCorrectCommand,
  runRecallEditCommand,
  runReanalyzeCommand,
  runRecordCommand,
  runSleepCommand,
} from "../dist/index.js";

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
  assert.equal(result.analysis?.dreamId, result.dream?.id);
  assert.match(result.analysis?.canonicalText ?? "", /lucid/);
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

test("reanalyze creates a new current analysis from linked recall text", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const record = await runRecordCommand(
    {
      text: "I looked at my hands and became lucid.",
      "new-dream": true,
      "dream-date": "2026-05-22",
    },
    testContext(home),
  );

  const analysis = await runReanalyzeCommand(
    {
      "dream-id": record.dream.id,
    },
    testContext(home),
  );

  assert.equal(analysis.dreamId, record.dream.id);
  assert.notEqual(analysis.id, record.analysis.id);
  assert.equal(analysis.realityCheck, "hands");
});

test("query filters current analyses without loading audio", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  await runRecordCommand(
    {
      text: "I looked at my hands and became lucid.",
      "new-dream": true,
      "dream-date": "2026-05-22",
    },
    testContext(home),
  );
  await runRecordCommand(
    {
      text: "I was walking through a school feeling confused.",
      "new-dream": true,
      "dream-date": "2026-05-23",
    },
    testContext(home),
  );

  const results = await runQueryCommand(
    {
      text: "hands lucid",
      lucidity: "3+",
    },
    testContext(home),
  );

  assert.equal(results.length, 1);
  assert.match(results[0].canonicalText, /hands/);
  assert.equal(results[0].lucidityLevel, 4);
  assert.equal(typeof results[0].score, "number");
});

test("index regenerates embeddings for current analyses", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  await runRecordCommand(
    {
      text: "A mirror appeared in the bedroom.",
      "new-dream": true,
      "dream-date": "2026-05-22",
    },
    testContext(home),
  );

  const result = await runIndexCommand({}, testContext(home));
  assert.equal(result.updated, 1);
});

test("graph returns current-analysis entity cooccurrence data", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  await runRecordCommand(
    {
      text: "My brother was in a school and I felt happy.",
      "new-dream": true,
      "dream-date": "2026-05-22",
    },
    testContext(home),
  );

  const graph = await runGraphCommand({}, testContext(home));
  assert.ok(graph.nodes.some((node) => node.id === "person:brother"));
  assert.ok(graph.nodes.some((node) => node.id === "setting:school"));
  assert.ok(graph.edges.length > 0);
});

test("recall edit updates typo text in place", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const record = await runRecordCommand(
    {
      text: "I saw a scool hallway.",
    },
    testContext(home),
  );

  const edited = await runRecallEditCommand(
    {
      "recall-id": record.recallEntry.id,
      text: "I saw a school hallway.",
    },
    testContext(home),
  );

  assert.equal(edited.id, record.recallEntry.id);
  assert.equal(edited.text, "I saw a school hallway.");
  assert.equal(edited.supersedesEntryId, null);
});

test("recall correction creates superseding entry and reanalysis hides original", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const record = await runRecordCommand(
    {
      text: "I saw a school hallway.",
      "new-dream": true,
      "dream-date": "2026-05-22",
    },
    testContext(home),
  );

  const corrected = await runRecallCorrectCommand(
    {
      "recall-id": record.recallEntry.id,
      text: "I saw a school hallway and then checked my hands.",
    },
    testContext(home),
  );
  const results = await runQueryCommand({ text: "hands" }, testContext(home));

  assert.equal(corrected.replacement.supersedesEntryId, record.recallEntry.id);
  assert.equal(corrected.original.isSuperseded, true);
  assert.equal(corrected.analysis?.dreamId, record.dream.id);
  assert.match(results[0].canonicalText, /checked my hands/);
});

test("delete is soft by default and hard delete is explicit", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const record = await runRecordCommand(
    {
      text: "I remembered a fragment.",
    },
    testContext(home),
  );

  const softDeleted = await runDeleteCommand(
    {
      entity: "recall",
      id: record.recallEntry.id,
      reason: "duplicate",
    },
    testContext(home),
  );

  await assert.rejects(
    runDeleteCommand(
      {
        entity: "recall",
        id: record.recallEntry.id,
        hard: true,
      },
      testContext(home),
    ),
    /confirm-hard-delete/,
  );

  const hardDeleted = await runDeleteCommand(
    {
      entity: "recall",
      id: record.recallEntry.id,
      hard: true,
      "confirm-hard-delete": true,
    },
    testContext(home),
  );

  assert.equal(softDeleted.mode, "soft");
  assert.equal(hardDeleted.mode, "hard");
});

test("storage diagnostics list audio metadata without returning blobs", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const audioPath = join(home, "dream.webm");
  writeFileSync(audioPath, Buffer.from("fake audio bytes"));
  const record = await runRecordCommand(
    {
      audio: audioPath,
      "duration-ms": "1000",
      "mime-type": "audio/webm",
    },
    testContext(home),
  );

  const storage = await runDoctorStorageCommand({}, testContext(home));
  const list = await runMediaListCommand({ limit: "1" }, testContext(home));
  const inspected = await runMediaInspectCommand({ "recall-id": record.recallEntry.id }, testContext(home));

  assert.equal(storage.audioRows, 1);
  assert.equal(storage.totalAudioBytes, Buffer.byteLength("fake audio bytes"));
  assert.equal(list[0].recallEntryId, record.recallEntry.id);
  assert.equal(inspected.audioMimeType, "audio/webm");
  assert.equal(Object.hasOwn(inspected, "audioBlob"), false);
});

test("export emits json markdown and csv with provenance opt-in", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const record = await runRecordCommand(
    {
      text: "I checked my hands near a mirror and became lucid.",
      "new-dream": true,
      "dream-date": "2026-05-22",
      title: "Mirror",
    },
    testContext(home),
  );
  await runRecallCorrectCommand(
    {
      "recall-id": record.recallEntry.id,
      text: "I checked my hands near a mirror and became lucid in a school.",
    },
    testContext(home),
  );

  const json = JSON.parse(await runExportCommand({ format: "json" }, testContext(home)));
  const provenanceJson = JSON.parse(await runExportCommand({ format: "json", provenance: true }, testContext(home)));
  const markdown = await runExportCommand({ format: "markdown" }, testContext(home));
  const csv = await runExportCommand({ format: "csv" }, testContext(home));

  assert.equal(json.provenance, false);
  assert.equal(json.recallEntries.length, 1);
  assert.equal(provenanceJson.provenance, true);
  assert.equal(provenanceJson.recallEntries.length, 2);
  assert.match(markdown, /# lucidmemo Export/);
  assert.match(markdown, /Mirror/);
  assert.match(csv, /dream_id,dream_date,title/);
  assert.match(csv, /Mirror/);
});

test("full integration flow covers capture assignment analysis query delete diagnostics export", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucidmemo-cli-"));
  const audioPath = join(home, "dream.webm");
  writeFileSync(audioPath, Buffer.from("fake audio bytes"));
  const audioOnly = await runRecordCommand(
    {
      audio: audioPath,
      "duration-ms": "1000",
      "mime-type": "audio/webm",
    },
    testContext(home),
  );
  const linked = await runRecordCommand(
    {
      text: "I met my brother at school and checked my hands.",
      "new-dream": true,
      "dream-date": "2026-05-22",
    },
    testContext(home),
  );
  const query = await runQueryCommand({ text: "brother school" }, testContext(home));
  const storage = await runDoctorStorageCommand({}, testContext(home));
  const deleted = await runDeleteCommand(
    {
      entity: "recall",
      id: audioOnly.recallEntry.id,
      reason: "test cleanup",
    },
    testContext(home),
  );
  const exported = JSON.parse(await runExportCommand({ format: "json", provenance: true }, testContext(home)));

  assert.equal(audioOnly.recallEntry.transcriptionStatus, "pending");
  assert.equal(linked.analysis?.dreamId, linked.dream.id);
  assert.equal(query.length, 1);
  assert.equal(storage.audioRows, 1);
  assert.equal(deleted.mode, "soft");
  assert.ok(exported.recallEntries.some((entry) => entry.id === audioOnly.recallEntry.id && entry.deletedAt !== null));
});
