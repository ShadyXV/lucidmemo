import { and, eq, isNull } from "drizzle-orm";

import type {
  AssignRecallEntryInput,
  CreateRecallEntryInput,
  DreamAnalysisBundle,
  DreamAnalysisRepository,
  DreamRepository,
  EntityCooccurrence,
  EntityMerge,
  EntityRepository,
  RecallEntryRepository,
  SleepSessionRepository,
  UUID,
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
}

export class LibSqlRecallEntryRepository implements RecallEntryRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async create(input: CreateRecallEntryInput) {
    await this.db.insert(recallEntries).values(input.recallEntry);
    if (input.audio) {
      await this.db.insert(recallAudio).values(input.audio);
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

  async findAudio(recallEntryId: UUID) {
    const rows = await this.db
      .select()
      .from(recallAudio)
      .where(eq(recallAudio.recallEntryId, recallEntryId))
      .limit(1);
    return rows[0] ?? null;
  }

  async softDelete(id: UUID, reason?: string) {
    await this.db
      .update(recallEntries)
      .set({ deletedAt: nowIso(), deleteReason: reason ?? null })
      .where(eq(recallEntries.id, id));
  }
}

export class LibSqlDreamAnalysisRepository implements DreamAnalysisRepository {
  constructor(private readonly db: LucidmemoDatabase) {}

  async createCurrent(bundle: DreamAnalysisBundle) {
    await this.db
      .update(dreamAnalyses)
      .set({ isCurrent: false })
      .where(and(eq(dreamAnalyses.dreamId, bundle.analysis.dreamId), isNull(dreamAnalyses.deletedAt)));

    await this.db.insert(dreamAnalyses).values(bundle.analysis);
    await this.db.insert(hvdcRecords).values(bundle.hvdcRecord);

    if (bundle.entities.length > 0) {
      await this.db.insert(entities).values(bundle.entities).onConflictDoNothing();
      await this.db.insert(dreamEntities).values(
        bundle.entities.map((entity) => ({
          analysisId: bundle.analysis.id,
          entityId: entity.id,
          context: null,
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
