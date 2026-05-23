import { and, count, desc, eq, isNull, sum } from "drizzle-orm";

import type {
  AssignRecallEntryInput,
  CreateRecallEntryInput,
  DreamAnalysisBundle,
  DreamAnalysisRepository,
  EntityType,
  DreamRepository,
  EntityCooccurrence,
  EntityMerge,
  EntityRepository,
  RecallEntryRepository,
  SleepSessionRepository,
  UUID,
  DreamGraph,
  DreamQueryFilters,
  DreamQueryResult,
} from "@lucidmemo/core";

import type { LucidmemoDatabase } from "./client.js";
import {
  dreamAnalyses,
  dreamEntities,
  dreams,
  entityCooccurrences,
  entityMerges,
  entities,
  hvdcRecords,
  recallAudio,
  recallEntries,
  sleepSessions,
} from "./schema.js";

function nowIso(): string {
  return new Date().toISOString();
}

async function hardDeleteDream(db: LucidmemoDatabase, dreamId: UUID): Promise<void> {
  const linkedRecalls = await db.select({ id: recallEntries.id }).from(recallEntries).where(eq(recallEntries.dreamId, dreamId));
  for (const recall of linkedRecalls) {
    await db.delete(recallAudio).where(eq(recallAudio.recallEntryId, recall.id));
  }
  await db.delete(recallEntries).where(eq(recallEntries.dreamId, dreamId));

  const linkedAnalyses = await db.select({ id: dreamAnalyses.id }).from(dreamAnalyses).where(eq(dreamAnalyses.dreamId, dreamId));
  for (const analysis of linkedAnalyses) {
    await db.delete(dreamEntities).where(eq(dreamEntities.analysisId, analysis.id));
    await db.delete(hvdcRecords).where(eq(hvdcRecords.analysisId, analysis.id));
  }
  await db.delete(dreamAnalyses).where(eq(dreamAnalyses.dreamId, dreamId));
  await db.delete(dreams).where(eq(dreams.id, dreamId));
}

export class LibSqlSleepSessionRepository implements SleepSessionRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async upsert(session: Parameters<SleepSessionRepository["upsert"]>[0]) {
    await this.db.insert(sleepSessions).values(session).onConflictDoUpdate({
      target: sleepSessions.id,
      set: session,
    });
    return session;
  }

  async findById(id: UUID) {
    const rows = await this.db.select().from(sleepSessions).where(eq(sleepSessions.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async softDelete(id: UUID, reason?: string) {
    await this.db
      .update(sleepSessions)
      .set({ deletedAt: nowIso(), deleteReason: reason ?? null })
      .where(eq(sleepSessions.id, id));
  }

  async hardDelete(id: UUID) {
    const linkedDreams = await this.db.select({ id: dreams.id }).from(dreams).where(eq(dreams.sleepSessionId, id));
    for (const dream of linkedDreams) {
      await hardDeleteDream(this.db, dream.id);
    }
    await this.db.delete(sleepSessions).where(eq(sleepSessions.id, id));
  }
}

export class LibSqlDreamRepository implements DreamRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async create(dream: Parameters<DreamRepository["create"]>[0]) {
    await this.db.insert(dreams).values(dream);
    return dream;
  }

  async findById(id: UUID) {
    const rows = await this.db.select().from(dreams).where(eq(dreams.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async softDelete(id: UUID, reason?: string) {
    await this.db
      .update(dreams)
      .set({ deletedAt: nowIso(), deleteReason: reason ?? null })
      .where(eq(dreams.id, id));
  }

  async hardDelete(id: UUID) {
    await hardDeleteDream(this.db, id);
  }
}

export class LibSqlRecallEntryRepository implements RecallEntryRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async create(input: CreateRecallEntryInput) {
    await this.db.insert(recallEntries).values(input.recallEntry);
    if (input.audio) {
      await this.db.insert(recallAudio).values({
        ...input.audio,
        audioBlob: Buffer.from(input.audio.audioBlob),
      });
    }
    return input.recallEntry;
  }

  async assign(input: AssignRecallEntryInput) {
    await this.db
      .update(recallEntries)
      .set({ dreamId: input.dreamId })
      .where(eq(recallEntries.id, input.recallEntryId));

    const updated = await this.findById(input.recallEntryId);
    if (!updated) {
      throw new Error(`Recall Entry not found: ${input.recallEntryId}`);
    }
    return updated;
  }

  async findById(id: UUID) {
    const rows = await this.db.select().from(recallEntries).where(eq(recallEntries.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async listByDreamId(dreamId: UUID) {
    return this.db
      .select()
      .from(recallEntries)
      .where(
        and(
          eq(recallEntries.dreamId, dreamId),
          isNull(recallEntries.deletedAt),
          eq(recallEntries.isSuperseded, false),
        ),
      );
  }

  async findAudio(recallEntryId: UUID) {
    const rows = await this.db
      .select()
      .from(recallAudio)
      .where(eq(recallAudio.recallEntryId, recallEntryId))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateText(id: UUID, text: string | null) {
    await this.db.update(recallEntries).set({ text }).where(eq(recallEntries.id, id));
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Recall Entry not found: ${id}`);
    }
    return updated;
  }

  async supersede(originalId: UUID, replacement: Parameters<RecallEntryRepository["supersede"]>[1]) {
    await this.db.insert(recallEntries).values(replacement);
    await this.db
      .update(recallEntries)
      .set({ isSuperseded: true, supersededByEntryId: replacement.id })
      .where(eq(recallEntries.id, originalId));
    return replacement;
  }

  async softDelete(id: UUID, reason?: string) {
    await this.db
      .update(recallEntries)
      .set({ deletedAt: nowIso(), deleteReason: reason ?? null })
      .where(eq(recallEntries.id, id));
  }

  async hardDelete(id: UUID) {
    await this.db.delete(recallAudio).where(eq(recallAudio.recallEntryId, id));
    await this.db.delete(recallEntries).where(eq(recallEntries.id, id));
  }
}

export class LibSqlDreamAnalysisRepository implements DreamAnalysisRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async createCurrent(bundle: DreamAnalysisBundle) {
    await this.db
      .update(dreamAnalyses)
      .set({ isCurrent: false })
      .where(and(eq(dreamAnalyses.dreamId, bundle.analysis.dreamId), isNull(dreamAnalyses.deletedAt)));

    await this.db.insert(dreamAnalyses).values({
      ...bundle.analysis,
      embedding: bundle.analysis.embedding ? Buffer.from(bundle.analysis.embedding) : null,
    });
    await this.db.insert(hvdcRecords).values(bundle.hvdcRecord);

    if (bundle.entities.length > 0) {
      await this.db
        .insert(entities)
        .values(
          bundle.entities.map((entity) => ({
            ...entity,
            embedding: entity.embedding ? Buffer.from(entity.embedding) : null,
          })),
        )
        .onConflictDoNothing();
      await this.db.insert(dreamEntities).values(
        bundle.entities.map((entity) => ({
          analysisId: bundle.analysis.id,
          entityId: entity.id,
          context: entity.context ?? null,
        })),
      );
    }

    return bundle.analysis;
  }

  async findCurrentByDreamId(dreamId: UUID) {
    const rows = await this.db
      .select()
      .from(dreamAnalyses)
      .where(
        and(
          eq(dreamAnalyses.dreamId, dreamId),
          eq(dreamAnalyses.isCurrent, true),
          isNull(dreamAnalyses.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async updateEmbedding(id: UUID, embedding: Uint8Array) {
    await this.db
      .update(dreamAnalyses)
      .set({ embedding: Buffer.from(embedding) })
      .where(eq(dreamAnalyses.id, id));
  }

  async softDelete(id: UUID, reason?: string) {
    await this.db
      .update(dreamAnalyses)
      .set({ deletedAt: nowIso(), deleteReason: reason ?? null })
      .where(eq(dreamAnalyses.id, id));
  }
}

export class LibSqlEntityRepository implements EntityRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async merge(merge: EntityMerge) {
    await this.db.insert(entityMerges).values(merge);
    return merge;
  }

  async unmerge(mergeId: UUID, reversedBy: string) {
    await this.db
      .update(entityMerges)
      .set({ reversedAt: nowIso(), reversedBy })
      .where(eq(entityMerges.id, mergeId));

    const rows = await this.db.select().from(entityMerges).where(eq(entityMerges.id, mergeId)).limit(1);
    const merge = rows[0];
    if (!merge) {
      throw new Error(`Entity Merge not found: ${mergeId}`);
    }
    return merge;
  }

  async listCooccurrences(): Promise<EntityCooccurrence[]> {
    return this.db.select().from(entityCooccurrences);
  }
}

interface CurrentAnalysisRow {
  dreamId: string;
  analysisId: string;
  dreamDate: string;
  title: string | null;
  canonicalText: string;
  lucidityLevel: number | null;
  inductionTech: string | null;
  dreamSigns: string[];
  emotions: string[];
  embedding: Uint8Array | null;
  characters: unknown[];
  socialInteractions: unknown[];
  activities: unknown[];
  settings: unknown[];
  objects: unknown[];
  outcomes: unknown[];
  entities: Array<{ type: EntityType; name: string }>;
}

export class LibSqlDreamQueryRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async listCurrent(): Promise<CurrentAnalysisRow[]> {
    const rows = await this.db
      .select({
        dreamId: dreams.id,
        analysisId: dreamAnalyses.id,
        dreamDate: dreams.dreamDate,
        title: dreams.title,
        canonicalText: dreamAnalyses.canonicalText,
        lucidityLevel: dreamAnalyses.lucidityLevel,
        inductionTech: dreamAnalyses.inductionTech,
        dreamSigns: dreamAnalyses.dreamSigns,
        emotions: dreamAnalyses.emotions,
        embedding: dreamAnalyses.embedding,
        characters: hvdcRecords.characters,
        socialInteractions: hvdcRecords.socialInteractions,
        activities: hvdcRecords.activities,
        settings: hvdcRecords.settings,
        objects: hvdcRecords.objects,
        outcomes: hvdcRecords.outcomes,
      })
      .from(dreamAnalyses)
      .innerJoin(dreams, eq(dreamAnalyses.dreamId, dreams.id))
      .innerJoin(hvdcRecords, eq(hvdcRecords.analysisId, dreamAnalyses.id))
      .where(
        and(
          eq(dreamAnalyses.isCurrent, true),
          isNull(dreamAnalyses.deletedAt),
          isNull(dreams.deletedAt),
        ),
      );

    const entityRows = await this.db
      .select({
        analysisId: dreamEntities.analysisId,
        type: entities.type,
        name: entities.name,
      })
      .from(dreamEntities)
      .innerJoin(entities, eq(entities.id, dreamEntities.entityId));
    const entitiesByAnalysis = new Map<string, Array<{ type: EntityType; name: string }>>();
    for (const row of entityRows) {
      const analysisEntities = entitiesByAnalysis.get(row.analysisId) ?? [];
      analysisEntities.push({ type: row.type, name: row.name });
      entitiesByAnalysis.set(row.analysisId, analysisEntities);
    }

    return rows.map((row) => ({
      ...row,
      embedding: row.embedding ? new Uint8Array(row.embedding) : null,
      dreamSigns: asStringArray(row.dreamSigns),
      emotions: asStringArray(row.emotions),
      characters: asArray(row.characters),
      socialInteractions: asArray(row.socialInteractions),
      activities: asArray(row.activities),
      settings: asArray(row.settings),
      objects: asArray(row.objects),
      outcomes: asArray(row.outcomes),
      entities: entitiesByAnalysis.get(row.analysisId) ?? [],
    }));
  }

  async query(filters: DreamQueryFilters, queryEmbedding?: Uint8Array): Promise<DreamQueryResult[]> {
    const rows = (await this.listCurrent()).filter((row) => matchesFilters(row, filters));
    const queryVector = queryEmbedding ? new Float32Array(queryEmbedding.buffer) : null;

    return rows
      .map<DreamQueryResult>((row) => ({
        dreamId: row.dreamId,
        analysisId: row.analysisId,
        dreamDate: row.dreamDate,
        title: row.title,
        canonicalText: row.canonicalText,
        lucidityLevel: row.lucidityLevel,
        inductionTech: row.inductionTech,
        dreamSigns: row.dreamSigns,
        emotions: row.emotions,
        score: queryVector && row.embedding ? cosine(queryVector, new Float32Array(row.embedding.buffer)) : null,
      }))
      .sort((a, b) => {
        if (a.score !== null || b.score !== null) {
          return (b.score ?? -1) - (a.score ?? -1);
        }
        return b.dreamDate.localeCompare(a.dreamDate);
      });
  }

  async graph(): Promise<DreamGraph> {
    const rows = await this.listCurrent();
    const nodeCounts = new Map<string, { label: string; type: string; count: number }>();
    const edgeCounts = new Map<string, { source: string; target: string; weight: number }>();

    for (const row of rows) {
      const nodes = uniqueGraphTerms([
        ...terms(row.dreamSigns, "symbol"),
        ...terms(row.emotions, "emotion"),
        ...terms(row.characters, "person"),
        ...terms(row.settings, "setting"),
        ...terms(row.objects, "object"),
        ...row.entities.map((entity) => term(entity.name, entity.type)),
      ]);

      for (const node of nodes) {
        const existing = nodeCounts.get(node.id);
        nodeCounts.set(node.id, {
          ...node,
          count: (existing?.count ?? 0) + 1,
        });
      }

      for (let left = 0; left < nodes.length; left += 1) {
        for (let right = left + 1; right < nodes.length; right += 1) {
          const source = nodes[left].id < nodes[right].id ? nodes[left].id : nodes[right].id;
          const target = nodes[left].id < nodes[right].id ? nodes[right].id : nodes[left].id;
          const id = `${source}--${target}`;
          edgeCounts.set(id, {
            source,
            target,
            weight: (edgeCounts.get(id)?.weight ?? 0) + 1,
          });
        }
      }
    }

    return {
      nodes: [...nodeCounts.entries()].map(([id, node]) => ({ id, ...node })),
      edges: [...edgeCounts.entries()].map(([id, edge]) => ({ id, ...edge })),
    };
  }
}

export interface MediaSummary {
  databasePath: string | null;
  recallEntries: number;
  audioRows: number;
  totalAudioBytes: number;
  largestAudio: MediaItem[];
}

export interface MediaItem {
  recallEntryId: string;
  dreamId: string | null;
  capturedAt: string;
  audioMimeType: string | null;
  audioExtension: string | null;
  audioOriginalName: string | null;
  audioSizeBytes: number;
  audioDurationMs: number | null;
  createdAt: string;
  deletedAt: string | null;
  deleteReason: string | null;
}

export class LibSqlMediaRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async summary(databasePath: string | null, limit = 5): Promise<MediaSummary> {
    const recallCount = await this.db.select({ value: count() }).from(recallEntries);
    const audioAggregate = await this.db
      .select({ count: count(), totalBytes: sum(recallAudio.audioSizeBytes) })
      .from(recallAudio);

    return {
      databasePath,
      recallEntries: recallCount[0]?.value ?? 0,
      audioRows: audioAggregate[0]?.count ?? 0,
      totalAudioBytes: Number(audioAggregate[0]?.totalBytes ?? 0),
      largestAudio: await this.listLargest(limit),
    };
  }

  async listLargest(limit = 20): Promise<MediaItem[]> {
    return this.db
      .select({
        recallEntryId: recallAudio.recallEntryId,
        dreamId: recallEntries.dreamId,
        capturedAt: recallEntries.capturedAt,
        audioMimeType: recallAudio.audioMimeType,
        audioExtension: recallAudio.audioExtension,
        audioOriginalName: recallAudio.audioOriginalName,
        audioSizeBytes: recallAudio.audioSizeBytes,
        audioDurationMs: recallAudio.audioDurationMs,
        createdAt: recallAudio.createdAt,
        deletedAt: recallEntries.deletedAt,
        deleteReason: recallEntries.deleteReason,
      })
      .from(recallAudio)
      .innerJoin(recallEntries, eq(recallEntries.id, recallAudio.recallEntryId))
      .orderBy(desc(recallAudio.audioSizeBytes))
      .limit(limit);
  }

  async inspect(recallEntryId: UUID): Promise<MediaItem | null> {
    const rows = await this.db
      .select({
        recallEntryId: recallAudio.recallEntryId,
        dreamId: recallEntries.dreamId,
        capturedAt: recallEntries.capturedAt,
        audioMimeType: recallAudio.audioMimeType,
        audioExtension: recallAudio.audioExtension,
        audioOriginalName: recallAudio.audioOriginalName,
        audioSizeBytes: recallAudio.audioSizeBytes,
        audioDurationMs: recallAudio.audioDurationMs,
        createdAt: recallAudio.createdAt,
        deletedAt: recallEntries.deletedAt,
        deleteReason: recallEntries.deleteReason,
      })
      .from(recallAudio)
      .innerJoin(recallEntries, eq(recallEntries.id, recallAudio.recallEntryId))
      .where(eq(recallAudio.recallEntryId, recallEntryId))
      .limit(1);
    return rows[0] ?? null;
  }
}

export interface JournalExportOptions {
  provenance: boolean;
}

export interface JournalExport {
  exportedAt: string;
  provenance: boolean;
  sleepSessions: unknown[];
  dreams: unknown[];
  recallEntries: unknown[];
  recallAudio: unknown[];
  dreamAnalyses: unknown[];
  hvdcRecords: unknown[];
  entities: unknown[];
  entityMerges: unknown[];
}

export class LibSqlJournalExportRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async export(options: JournalExportOptions): Promise<JournalExport> {
    const [sleepRows, dreamRows, recallRows, audioRows, analysisRows, hvdcRows, entityRows, mergeRows] = await Promise.all([
      this.db.select().from(sleepSessions),
      this.db.select().from(dreams),
      this.db.select().from(recallEntries),
      this.db
        .select({
          recallEntryId: recallAudio.recallEntryId,
          audioMimeType: recallAudio.audioMimeType,
          audioExtension: recallAudio.audioExtension,
          audioOriginalName: recallAudio.audioOriginalName,
          audioSizeBytes: recallAudio.audioSizeBytes,
          audioDurationMs: recallAudio.audioDurationMs,
          createdAt: recallAudio.createdAt,
        })
        .from(recallAudio),
      this.db.select().from(dreamAnalyses),
      this.db.select().from(hvdcRecords),
      this.db
        .select({
          id: entities.id,
          type: entities.type,
          name: entities.name,
        })
        .from(entities),
      this.db.select().from(entityMerges),
    ]);

    const analyses = options.provenance
      ? analysisRows.map(serializeEmbedding)
      : analysisRows.filter((analysis) => analysis.isCurrent && analysis.deletedAt === null).map(serializeEmbedding);
    const analysisIds = new Set(analyses.map((analysis) => String((analysis as { id: string }).id)));
    const recallEntryIds = new Set(
      (options.provenance
        ? recallRows
        : recallRows.filter((recall) => recall.deletedAt === null && !recall.isSuperseded)
      ).map((recall) => recall.id),
    );

    return {
      exportedAt: nowIso(),
      provenance: options.provenance,
      sleepSessions: options.provenance ? sleepRows : sleepRows.filter((session) => session.deletedAt === null),
      dreams: options.provenance ? dreamRows : dreamRows.filter((dream) => dream.deletedAt === null),
      recallEntries: options.provenance
        ? recallRows
        : recallRows.filter((recall) => recall.deletedAt === null && !recall.isSuperseded),
      recallAudio: audioRows.filter((audio) => recallEntryIds.has(audio.recallEntryId)),
      dreamAnalyses: analyses,
      hvdcRecords: hvdcRows.filter((record) => analysisIds.has(record.analysisId)),
      entities: options.provenance ? entityRows : [],
      entityMerges: options.provenance ? mergeRows : [],
    };
  }
}

function serializeEmbedding<T extends { embedding?: Buffer | Uint8Array | null }>(row: T): Omit<T, "embedding"> & { embeddingBase64: string | null } {
  const { embedding, ...rest } = row;
  return {
    ...rest,
    embeddingBase64: embedding ? Buffer.from(embedding).toString("base64") : null,
  };
}

function matchesFilters(row: CurrentAnalysisRow, filters: DreamQueryFilters): boolean {
  if (filters.date && row.dreamDate !== filters.date) return false;
  if (filters.from && row.dreamDate < filters.from) return false;
  if (filters.to && row.dreamDate > filters.to) return false;
  if (filters.lucidity !== undefined && row.lucidityLevel !== filters.lucidity) return false;
  if (filters.lucidityMin !== undefined && (row.lucidityLevel ?? -1) < filters.lucidityMin) return false;
  if (filters.technique && !matchesText(row.inductionTech, filters.technique)) return false;
  if (filters.symbol && !containsTerm(row.dreamSigns, filters.symbol)) return false;
  if (filters.emotion && !containsTerm(row.emotions, filters.emotion)) return false;
  if (filters.person && !containsTerm(row.characters, filters.person)) return false;
  if (filters.setting && !containsTerm(row.settings, filters.setting)) return false;
  if (filters.object && !containsTerm(row.objects, filters.object)) return false;
  if (filters.interaction && !containsTerm(row.socialInteractions, filters.interaction)) return false;
  return true;
}

function containsTerm(values: unknown[], needle: string): boolean {
  return values.some((value) => matchesText(String(value), needle));
}

function matchesText(value: string | null, needle: string): boolean {
  return value?.toLowerCase().includes(needle.toLowerCase()) ?? false;
}

function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    aMagnitude += a[index] * a[index];
    bMagnitude += b[index] * b[index];
  }
  return aMagnitude === 0 || bMagnitude === 0 ? 0 : dot / Math.sqrt(aMagnitude * bMagnitude);
}

function terms(values: unknown[], type: string): Array<{ id: string; label: string; type: string }> {
  return values
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0)
    .map((label) => term(label, type));
}

function term(label: string, type: string): { id: string; label: string; type: string } {
  return {
    id: `${type}:${label.trim().toLowerCase()}`,
    label: label.trim(),
    type,
  };
}

function uniqueGraphTerms(nodes: Array<{ id: string; label: string; type: string }>) {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).map((item) => String(item));
}
