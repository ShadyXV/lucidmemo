import { relations, sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const sleepSessions = sqliteTable("sleep_sessions", {
  id: text("id").primaryKey(),
  sessionDate: text("session_date").notNull(),
  sleepStartedAt: text("sleep_started_at"),
  wokeAt: text("woke_at"),
  sleepQuality: integer("sleep_quality"),
  isNap: integer("is_nap", { mode: "boolean" }).notNull().default(false),
  inductionAttempts: text("induction_attempts", { mode: "json" }).$type<unknown[]>().notNull().default(sql`'[]'`),
  supplements: text("supplements", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  alarms: text("alarms", { mode: "json" }).$type<unknown[]>().notNull().default(sql`'[]'`),
  notes: text("notes"),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  deleteReason: text("delete_reason"),
});

export const dreams = sqliteTable(
  "dreams",
  {
    id: text("id").primaryKey(),
    sleepSessionId: text("sleep_session_id").references(() => sleepSessions.id),
    dreamDate: text("dream_date").notNull(),
    title: text("title"),
    deletedAt: text("deleted_at"),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("dreams_sleep_session_id_idx").on(table.sleepSessionId),
    index("dreams_dream_date_idx").on(table.dreamDate),
  ],
);

export const recallEntries = sqliteTable(
  "recall_entries",
  {
    id: text("id").primaryKey(),
    dreamId: text("dream_id").references(() => dreams.id),
    transcriptionStatus: text("transcription_status", {
      enum: ["not_needed", "pending", "complete", "failed"],
    }).notNull(),
    supersedesEntryId: text("supersedes_entry_id"),
    supersededByEntryId: text("superseded_by_entry_id"),
    capturedAt: text("captured_at").notNull(),
    captureMethod: text("capture_method", {
      enum: ["agent", "cli", "mobile", "desktop"],
    }).notNull(),
    sourceAgent: text("source_agent"),
    text: text("text"),
    hasAudio: integer("has_audio", { mode: "boolean" }).notNull().default(false),
    audioRetention: text("audio_retention", {
      enum: ["keep", "delete_after_transcription", "never_store"],
    }).notNull(),
    audioDeletedAt: text("audio_deleted_at"),
    isSuperseded: integer("is_superseded", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    deletedAt: text("deleted_at"),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("recall_entries_dream_id_idx").on(table.dreamId),
    index("recall_entries_captured_at_idx").on(table.capturedAt),
    index("recall_entries_deleted_at_idx").on(table.deletedAt),
  ],
);

export const recallAudio = sqliteTable("recall_audio", {
  recallEntryId: text("recall_entry_id")
    .primaryKey()
    .references(() => recallEntries.id, { onDelete: "cascade" }),
  audioBlob: blob("audio_blob", { mode: "buffer" }).notNull(),
  audioMimeType: text("audio_mime_type"),
  audioExtension: text("audio_extension"),
  audioOriginalName: text("audio_original_name"),
  audioSizeBytes: integer("audio_size_bytes").notNull(),
  audioDurationMs: integer("audio_duration_ms"),
  createdAt: text("created_at").notNull(),
});

export const dreamAnalyses = sqliteTable(
  "dream_analyses",
  {
    id: text("id").primaryKey(),
    dreamId: text("dream_id")
      .notNull()
      .references(() => dreams.id),
    createdAt: text("created_at").notNull(),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
    sourceAdapter: text("source_adapter").notNull(),
    sourceModel: text("source_model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    correctionSource: text("correction_source", { enum: ["user", "agent", "system"] }),
    canonicalText: text("canonical_text").notNull(),
    lucidityLevel: integer("lucidity_level"),
    inductionTech: text("induction_tech"),
    realityCheck: text("reality_check"),
    controlLevel: integer("control_level"),
    onsetType: text("onset_type"),
    dreamSigns: text("dream_signs", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    emotions: text("emotions", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    embedding: blob("embedding", { mode: "buffer" }),
    deletedAt: text("deleted_at"),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("dream_analyses_dream_id_idx").on(table.dreamId),
    index("dream_analyses_current_idx").on(table.dreamId, table.isCurrent),
  ],
);

export const hvdcRecords = sqliteTable("hvdc_records", {
  analysisId: text("analysis_id")
    .primaryKey()
    .references(() => dreamAnalyses.id, { onDelete: "cascade" }),
  characters: text("characters", { mode: "json" }).notNull().default(sql`'[]'`),
  socialInteractions: text("social_interactions", { mode: "json" }).notNull().default(sql`'[]'`),
  activities: text("activities", { mode: "json" }).notNull().default(sql`'[]'`),
  emotions: text("emotions", { mode: "json" }).notNull().default(sql`'[]'`),
  settings: text("settings", { mode: "json" }).notNull().default(sql`'[]'`),
  objects: text("objects", { mode: "json" }).notNull().default(sql`'[]'`),
  outcomes: text("outcomes", { mode: "json" }).notNull().default(sql`'[]'`),
});

export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["person", "place", "symbol", "object", "emotion"] }).notNull(),
    name: text("name").notNull(),
    embedding: blob("embedding", { mode: "buffer" }),
  },
  (table) => [index("entities_type_name_idx").on(table.type, table.name)],
);

export const entityMerges = sqliteTable(
  "entity_merges",
  {
    id: text("id").primaryKey(),
    canonicalEntityId: text("canonical_entity_id")
      .notNull()
      .references(() => entities.id),
    mergedEntityId: text("merged_entity_id")
      .notNull()
      .references(() => entities.id),
    confirmedAt: text("confirmed_at").notNull(),
    confirmedBy: text("confirmed_by").notNull(),
    reversedAt: text("reversed_at"),
    reversedBy: text("reversed_by"),
    reason: text("reason"),
  },
  (table) => [
    index("entity_merges_canonical_idx").on(table.canonicalEntityId),
    index("entity_merges_merged_idx").on(table.mergedEntityId),
  ],
);

export const dreamEntities = sqliteTable(
  "dream_entities",
  {
    analysisId: text("analysis_id")
      .notNull()
      .references(() => dreamAnalyses.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    context: text("context"),
  },
  (table) => [
    primaryKey({ columns: [table.analysisId, table.entityId] }),
    index("dream_entities_entity_id_idx").on(table.entityId),
  ],
);

export const entityCooccurrences = sqliteTable(
  "entity_cooccurrences",
  {
    entityAId: text("entity_a_id")
      .notNull()
      .references(() => entities.id),
    entityBId: text("entity_b_id")
      .notNull()
      .references(() => entities.id),
    dreamCount: integer("dream_count").notNull().default(0),
    lastSeen: text("last_seen").notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityAId, table.entityBId] })],
);

export const sleepSessionsRelations = relations(sleepSessions, ({ many }) => ({
  dreams: many(dreams),
}));

export const dreamsRelations = relations(dreams, ({ one, many }) => ({
  sleepSession: one(sleepSessions, {
    fields: [dreams.sleepSessionId],
    references: [sleepSessions.id],
  }),
  recallEntries: many(recallEntries),
  analyses: many(dreamAnalyses),
}));

export const recallEntriesRelations = relations(recallEntries, ({ one }) => ({
  dream: one(dreams, {
    fields: [recallEntries.dreamId],
    references: [dreams.id],
  }),
  audio: one(recallAudio, {
    fields: [recallEntries.id],
    references: [recallAudio.recallEntryId],
  }),
}));

export const recallAudioRelations = relations(recallAudio, ({ one }) => ({
  recallEntry: one(recallEntries, {
    fields: [recallAudio.recallEntryId],
    references: [recallEntries.id],
  }),
}));

export const dreamAnalysesRelations = relations(dreamAnalyses, ({ one, many }) => ({
  dream: one(dreams, {
    fields: [dreamAnalyses.dreamId],
    references: [dreams.id],
  }),
  hvdcRecord: one(hvdcRecords, {
    fields: [dreamAnalyses.id],
    references: [hvdcRecords.analysisId],
  }),
  dreamEntities: many(dreamEntities),
}));

export const hvdcRecordsRelations = relations(hvdcRecords, ({ one }) => ({
  analysis: one(dreamAnalyses, {
    fields: [hvdcRecords.analysisId],
    references: [dreamAnalyses.id],
  }),
}));

export const entitiesRelations = relations(entities, ({ many }) => ({
  dreamEntities: many(dreamEntities),
  canonicalMerges: many(entityMerges, { relationName: "canonical_entity" }),
  mergedInto: many(entityMerges, { relationName: "merged_entity" }),
}));

export const entityMergesRelations = relations(entityMerges, ({ one }) => ({
  canonicalEntity: one(entities, {
    fields: [entityMerges.canonicalEntityId],
    references: [entities.id],
    relationName: "canonical_entity",
  }),
  mergedEntity: one(entities, {
    fields: [entityMerges.mergedEntityId],
    references: [entities.id],
    relationName: "merged_entity",
  }),
}));

export const dreamEntitiesRelations = relations(dreamEntities, ({ one }) => ({
  analysis: one(dreamAnalyses, {
    fields: [dreamEntities.analysisId],
    references: [dreamAnalyses.id],
  }),
  entity: one(entities, {
    fields: [dreamEntities.entityId],
    references: [entities.id],
  }),
}));

export type SleepSessionRow = typeof sleepSessions.$inferSelect;
export type DreamRow = typeof dreams.$inferSelect;
export type RecallEntryRow = typeof recallEntries.$inferSelect;
export type RecallAudioRow = typeof recallAudio.$inferSelect;
export type DreamAnalysisRow = typeof dreamAnalyses.$inferSelect;
export type HvdCRecordRow = typeof hvdcRecords.$inferSelect;
export type EntityRow = typeof entities.$inferSelect;
export type EntityMergeRow = typeof entityMerges.$inferSelect;
