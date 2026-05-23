import type {
  DreamAnalysis,
  DreamRecord,
  Entity,
  EntityCooccurrence,
  EntityMerge,
  HvdCRecord,
  RecallAudio,
  RecallEntry,
  SleepSession,
  UUID,
} from "./types.js";

export interface CreateRecallEntryInput {
  recallEntry: RecallEntry;
  audio?: RecallAudio;
}

export interface AssignRecallEntryInput {
  recallEntryId: UUID;
  dreamId: UUID;
}

export interface DreamAnalysisBundle {
  analysis: DreamAnalysis;
  hvdcRecord: HvdCRecord;
  entities: Entity[];
}

export interface SleepSessionRepository {
  upsert(session: SleepSession): Promise<SleepSession>;
  findById(id: UUID): Promise<SleepSession | null>;
  softDelete(id: UUID, reason?: string): Promise<void>;
}

export interface DreamRepository {
  create(dream: DreamRecord): Promise<DreamRecord>;
  findById(id: UUID): Promise<DreamRecord | null>;
  softDelete(id: UUID, reason?: string): Promise<void>;
}

export interface RecallEntryRepository {
  create(input: CreateRecallEntryInput): Promise<RecallEntry>;
  assign(input: AssignRecallEntryInput): Promise<RecallEntry>;
  findById(id: UUID): Promise<RecallEntry | null>;
  listByDreamId(dreamId: UUID): Promise<RecallEntry[]>;
  findAudio(recallEntryId: UUID): Promise<RecallAudio | null>;
  softDelete(id: UUID, reason?: string): Promise<void>;
}

export interface DreamAnalysisRepository {
  createCurrent(bundle: DreamAnalysisBundle): Promise<DreamAnalysis>;
  findCurrentByDreamId(dreamId: UUID): Promise<DreamAnalysis | null>;
  updateEmbedding(id: UUID, embedding: Uint8Array): Promise<void>;
  softDelete(id: UUID, reason?: string): Promise<void>;
}

export interface EntityRepository {
  merge(merge: EntityMerge): Promise<EntityMerge>;
  unmerge(mergeId: UUID, reversedBy: string): Promise<EntityMerge>;
  listCooccurrences(): Promise<EntityCooccurrence[]>;
}
