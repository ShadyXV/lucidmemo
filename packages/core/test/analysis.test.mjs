import assert from "node:assert/strict";
import test from "node:test";

import { buildCanonicalSourceText } from "../dist/index.js";

function entry(overrides = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    dreamId: "dream-1",
    transcriptionStatus: "complete",
    supersedesEntryId: null,
    supersededByEntryId: null,
    capturedAt: "2026-05-23T06:00:00.000Z",
    captureMethod: "cli",
    sourceAgent: null,
    text: "I was flying over a city.",
    hasAudio: false,
    audioRetention: "never_store",
    audioDeletedAt: null,
    isSuperseded: false,
    notes: null,
    deletedAt: null,
    deleteReason: null,
    ...overrides,
  };
}

test("returns null for empty array", () => {
  assert.equal(buildCanonicalSourceText([]), null);
});

test("returns null when all entries have null text", () => {
  const result = buildCanonicalSourceText([
    entry({ text: null, transcriptionStatus: "pending" }),
    entry({ text: null, transcriptionStatus: "pending", id: "00000000-0000-0000-0000-000000000002" }),
  ]);
  assert.equal(result, null);
});

test("returns null when all entries have whitespace-only text", () => {
  assert.equal(buildCanonicalSourceText([entry({ text: "   " })]), null);
});

test("returns null when all entries are soft-deleted", () => {
  assert.equal(
    buildCanonicalSourceText([entry({ deletedAt: "2026-05-23T07:00:00.000Z" })]),
    null,
  );
});

test("returns null when all entries are superseded", () => {
  assert.equal(buildCanonicalSourceText([entry({ isSuperseded: true })]), null);
});

test("returns text for a single valid entry", () => {
  assert.equal(
    buildCanonicalSourceText([entry({ text: "I was flying." })]),
    "I was flying.",
  );
});

test("excludes deleted entries from mixed set", () => {
  const result = buildCanonicalSourceText([
    entry({ text: "Valid recall.", capturedAt: "2026-05-23T06:00:00.000Z" }),
    entry({
      id: "00000000-0000-0000-0000-000000000002",
      text: "Deleted recall.",
      capturedAt: "2026-05-23T06:01:00.000Z",
      deletedAt: "2026-05-23T07:00:00.000Z",
    }),
  ]);
  assert.equal(result, "Valid recall.");
});

test("excludes superseded entries from mixed set", () => {
  const result = buildCanonicalSourceText([
    entry({ text: "Original recall.", capturedAt: "2026-05-23T06:00:00.000Z", isSuperseded: true }),
    entry({
      id: "00000000-0000-0000-0000-000000000002",
      text: "Corrected recall.",
      capturedAt: "2026-05-23T06:05:00.000Z",
    }),
  ]);
  assert.equal(result, "Corrected recall.");
});

test("excludes pending entries (null text) from mixed set", () => {
  const result = buildCanonicalSourceText([
    entry({ text: "Written recall.", capturedAt: "2026-05-23T06:00:00.000Z" }),
    entry({
      id: "00000000-0000-0000-0000-000000000002",
      text: null,
      transcriptionStatus: "pending",
      capturedAt: "2026-05-23T06:01:00.000Z",
    }),
  ]);
  assert.equal(result, "Written recall.");
});

test("sorts entries by capturedAt ascending regardless of input order", () => {
  const result = buildCanonicalSourceText([
    entry({ text: "Second fragment.", capturedAt: "2026-05-23T09:00:00.000Z", id: "00000000-0000-0000-0000-000000000002" }),
    entry({ text: "First fragment.", capturedAt: "2026-05-23T06:00:00.000Z" }),
  ]);
  assert.equal(result, "First fragment.\n\nSecond fragment.");
});

test("joins multiple entries with double newline", () => {
  const result = buildCanonicalSourceText([
    entry({ text: "A.", capturedAt: "2026-05-23T06:00:00.000Z" }),
    entry({ text: "B.", capturedAt: "2026-05-23T07:00:00.000Z", id: "00000000-0000-0000-0000-000000000002" }),
    entry({ text: "C.", capturedAt: "2026-05-23T08:00:00.000Z", id: "00000000-0000-0000-0000-000000000003" }),
  ]);
  assert.equal(result, "A.\n\nB.\n\nC.");
});

test("applies all filters together — deleted, superseded, and pending excluded; valid entries sorted", () => {
  const result = buildCanonicalSourceText([
    entry({ text: "Second valid.", capturedAt: "2026-05-23T08:00:00.000Z", id: "00000000-0000-0000-0000-000000000003" }),
    entry({ text: "Pending.", capturedAt: "2026-05-23T06:30:00.000Z", text: null, id: "00000000-0000-0000-0000-000000000004" }),
    entry({ text: "First valid.", capturedAt: "2026-05-23T06:00:00.000Z" }),
    entry({ text: "Superseded.", capturedAt: "2026-05-23T05:00:00.000Z", isSuperseded: true, id: "00000000-0000-0000-0000-000000000005" }),
    entry({ text: "Deleted.", capturedAt: "2026-05-23T07:00:00.000Z", deletedAt: "2026-05-23T09:00:00.000Z", id: "00000000-0000-0000-0000-000000000006" }),
  ]);
  assert.equal(result, "First valid.\n\nSecond valid.");
});
