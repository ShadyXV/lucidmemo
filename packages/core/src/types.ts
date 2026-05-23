export type UUID = string;
export type ISODate = string;
export type ISODateTime = string;

export type CaptureMethod = "agent" | "cli" | "mobile" | "desktop";
export type TranscriptionStatus = "not_needed" | "pending" | "complete" | "failed";
export type AudioRetention = "keep" | "delete_after_transcription" | "never_store";
export type EntityType = "person" | "place" | "symbol" | "object" | "emotion";
export type CorrectionSource = "user" | "agent" | "system";

export interface SoftDeleteFields {
  deletedAt: ISODateTime | null;
  deleteReason: string | null;
}

export interface SleepSession extends SoftDeleteFields {
  id: UUID;
  sessionDate: ISODate;
  sleepStartedAt: ISODateTime | null;
  wokeAt: ISODateTime | null;
  sleepQuality: number | null;
  isNap: boolean;
  inductionAttempts: unknown[];
  supplements: string[];
  alarms: unknown[];
  notes: string | null;
  updatedAt: ISODateTime;
}

export interface DreamRecord extends SoftDeleteFields {
  id: UUID;
  sleepSessionId: UUID | null;
  dreamDate: ISODate;
  title: string | null;
}

export interface RecallEntry extends SoftDeleteFields {
  id: UUID;
  dreamId: UUID | null;
  transcriptionStatus: TranscriptionStatus;
  supersedesEntryId: UUID | null;
  supersededByEntryId: UUID | null;
  capturedAt: ISODateTime;
  captureMethod: CaptureMethod;
  sourceAgent: string | null;
  text: string | null;
  hasAudio: boolean;
  audioRetention: AudioRetention;
  audioDeletedAt: ISODateTime | null;
  isSuperseded: boolean;
  notes: string | null;
}

export interface RecallAudio {
  recallEntryId: UUID;
  audioBlob: Uint8Array;
  audioMimeType: string | null;
  audioExtension: string | null;
  audioOriginalName: string | null;
  audioSizeBytes: number;
  audioDurationMs: number | null;
  createdAt: ISODateTime;
}

export interface DreamAnalysis extends SoftDeleteFields {
  id: UUID;
  dreamId: UUID;
  createdAt: ISODateTime;
  isCurrent: boolean;
  sourceAdapter: string;
  sourceModel: string;
  promptVersion: string;
  correctionSource: CorrectionSource | null;
  canonicalText: string;
  lucidityLevel: number | null;
  inductionTech: string | null;
  realityCheck: string | null;
  controlLevel: number | null;
  onsetType: string | null;
  dreamSigns: string[];
  emotions: string[];
  embedding: Uint8Array | null;
}

export interface HvdCRecord {
  analysisId: UUID;
  characters: unknown[];
  socialInteractions: unknown[];
  activities: unknown[];
  emotions: unknown[];
  settings: unknown[];
  objects: unknown[];
  outcomes: unknown[];
}

export interface Entity {
  id: UUID;
  type: EntityType;
  name: string;
  embedding: Uint8Array | null;
}

export interface SubmittedDreamEntityInput {
  type: EntityType;
  name: string;
  context?: string | null;
}

export interface SubmittedDreamAnalysisInput {
  dreamId: UUID;
  canonicalText: string;
  sourceAgent: string;
  sourceModel: string;
  promptVersion?: string;
  lucidityLevel?: number | null;
  inductionTech?: string | null;
  realityCheck?: string | null;
  controlLevel?: number | null;
  onsetType?: string | null;
  dreamSigns?: string[];
  emotions?: string[];
  hvdc?: Partial<{
    characters: unknown[];
    socialInteractions: unknown[];
    activities: unknown[];
    emotions: unknown[];
    settings: unknown[];
    objects: unknown[];
    outcomes: unknown[];
  }>;
  entities?: SubmittedDreamEntityInput[];
}

export interface EntityMerge {
  id: UUID;
  canonicalEntityId: UUID;
  mergedEntityId: UUID;
  confirmedAt: ISODateTime;
  confirmedBy: string;
  reversedAt: ISODateTime | null;
  reversedBy: string | null;
  reason: string | null;
}

export interface DreamEntity {
  analysisId: UUID;
  entityId: UUID;
  context: string | null;
}

export interface EntityCooccurrence {
  entityAId: UUID;
  entityBId: UUID;
  dreamCount: number;
  lastSeen: ISODateTime;
}
