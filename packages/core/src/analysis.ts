import { randomUUID } from "node:crypto";

import type {
  DreamAnalysis,
  DreamEntity,
  Entity,
  EntityType,
  HvdCRecord,
  ISODateTime,
  RecallEntry,
  SubmittedDreamAnalysisInput,
  UUID,
} from "./types.js";
import type { DreamAnalysisBundle, DreamAnalysisRepository, DreamRepository, RecallEntryRepository } from "./repositories.js";

// ---------------------------------------------------------------------------
// Adapter interfaces — defined here so core can orchestrate without importing
// concrete adapter packages. Adapter packages implement these interfaces.
// ---------------------------------------------------------------------------

export interface ExtractionInput {
  text: string;
}

export interface ExtractionResult {
  canonicalText: string;
  lucidityLevel: number | null;
  inductionTech: string | null;
  realityCheck: string | null;
  controlLevel: number | null;
  onsetType: string | null;
  dreamSigns: string[];
  emotions: string[];
  hvdc: HvdCRecordFields;
  sourceAdapter: string;
  sourceModel: string;
  promptVersion: string;
}

export interface ExtractionAdapter {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

export interface EmbeddingInput {
  text: string;
}

export interface EmbeddingResult {
  embedding: Uint8Array;
  sourceAdapter: string;
  sourceModel: string;
}

export interface EmbeddingAdapter {
  readonly name: string;
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export interface HvdCRecordFields {
  characters: unknown[];
  socialInteractions: unknown[];
  activities: unknown[];
  emotions: unknown[];
  settings: unknown[];
  objects: unknown[];
  outcomes: unknown[];
}

export function buildHvdCRecord(analysisId: string, hvdc: HvdCRecordFields): HvdCRecord {
  return {
    analysisId,
    characters: hvdc.characters,
    socialInteractions: hvdc.socialInteractions,
    activities: hvdc.activities,
    emotions: hvdc.emotions,
    settings: hvdc.settings,
    objects: hvdc.objects,
    outcomes: hvdc.outcomes,
  };
}

export function normalizeEntityName(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Canonical source text
// ---------------------------------------------------------------------------

/**
 * Builds the canonical source text for a Dream Analysis from a set of Recall Entries.
 *
 * Applies the full domain rule: exclude deleted, superseded, and text-empty entries;
 * sort by capture time ascending; join with double newline.
 *
 * Returns null when no qualifying text exists (Pending or all-deleted recall set).
 * The caller is responsible for deciding whether null is an error.
 */
export function buildCanonicalSourceText(entries: RecallEntry[]): string | null {
  const text = entries
    .filter(
      (e) =>
        e.deletedAt === null &&
        !e.isSuperseded &&
        e.text !== null &&
        e.text.trim().length > 0,
    )
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .map((e) => e.text as string)
    .join("\n\n");

  return text.length > 0 ? text : null;
}

// ---------------------------------------------------------------------------
// Submitted analysis normalization
// ---------------------------------------------------------------------------

export type NormalizedSubmittedAnalysisInput = SubmittedDreamAnalysisInput & {
  entities: NonNullable<SubmittedDreamAnalysisInput["entities"]>;
};

/**
 * Validates and normalizes a typed SubmittedDreamAnalysisInput before storage.
 * Trims and rejects empty canonicalText/sourceAgent/sourceModel, trims entity
 * names, rejects empty names, and deduplicates entities by type+normalized name.
 *
 * Call this at every surface (CLI, MCP) before createSubmittedDreamAnalysis.
 */
export function normalizeSubmittedAnalysisInput(
  input: SubmittedDreamAnalysisInput,
): NormalizedSubmittedAnalysisInput {
  const canonicalText = input.canonicalText.trim();
  if (!canonicalText) {
    throw new Error("Submitted analysis requires non-empty canonicalText.");
  }
  const sourceAgent = input.sourceAgent.trim();
  if (!sourceAgent) {
    throw new Error("Submitted analysis requires non-empty sourceAgent.");
  }
  const sourceModel = input.sourceModel.trim();
  if (!sourceModel) {
    throw new Error("Submitted analysis requires non-empty sourceModel.");
  }

  const byId = new Map<string, NonNullable<SubmittedDreamAnalysisInput["entities"]>[number]>();
  for (const entity of input.entities ?? []) {
    const name = entity.name.trim();
    if (!name) {
      throw new Error("Submitted entity name must not be empty.");
    }
    const key = `${entity.type}:${normalizeEntityName(name)}`;
    if (!byId.has(key)) {
      byId.set(key, { ...entity, name });
    }
  }

  return { ...input, canonicalText, sourceAgent, sourceModel, entities: [...byId.values()] };
}

// ---------------------------------------------------------------------------
// Dream Analysis creation
// ---------------------------------------------------------------------------

/**
 * Creates a Dream Analysis from the current set of Recall Entries for a Dream Record.
 * Marks any prior analyses as non-current (Reanalysis).
 */
export async function createDreamAnalysis(input: {
  dreamId: UUID;
  recalls: RecallEntryRepository;
  analyses: DreamAnalysisRepository;
  extraction: ExtractionAdapter;
  embedding: EmbeddingAdapter;
  now: ISODateTime;
}): Promise<DreamAnalysis> {
  const recallEntries = await input.recalls.listByDreamId(input.dreamId);
  const canonicalSourceText = buildCanonicalSourceText(recallEntries);
  if (!canonicalSourceText) {
    throw new Error("Dream Analysis requires at least one text Recall Entry.");
  }

  const extraction = await input.extraction.extract({ text: canonicalSourceText });
  const embedding = await input.embedding.embed({ text: extraction.canonicalText });
  const analysisId = randomUUID();
  const bundle: DreamAnalysisBundle = {
    analysis: {
      id: analysisId,
      dreamId: input.dreamId,
      createdAt: input.now,
      isCurrent: true,
      sourceAdapter: extraction.sourceAdapter,
      sourceModel: extraction.sourceModel,
      promptVersion: extraction.promptVersion,
      correctionSource: null,
      canonicalText: extraction.canonicalText,
      lucidityLevel: extraction.lucidityLevel,
      inductionTech: extraction.inductionTech,
      realityCheck: extraction.realityCheck,
      controlLevel: extraction.controlLevel,
      onsetType: extraction.onsetType,
      dreamSigns: extraction.dreamSigns,
      emotions: extraction.emotions,
      embedding: embedding.embedding,
      deletedAt: null,
      deleteReason: null,
    },
    hvdcRecord: buildHvdCRecord(analysisId, extraction.hvdc),
    entities: [],
  };

  return input.analyses.createCurrent(bundle);
}

/**
 * Creates a Dream Analysis from an agent-submitted analysis payload.
 * Used by the MCP server and agent capture flows.
 */
export async function createSubmittedDreamAnalysis(input: {
  submitted: SubmittedDreamAnalysisInput;
  dreams: DreamRepository;
  analyses: DreamAnalysisRepository;
  embedding: EmbeddingAdapter;
  now: ISODateTime;
}): Promise<DreamAnalysis> {
  const { submitted } = input;

  const dream = await input.dreams.findById(submitted.dreamId);
  if (!dream) {
    throw new Error(`Dream Record not found: ${submitted.dreamId}`);
  }

  const embedding = await input.embedding.embed({ text: submitted.canonicalText });
  const analysisId = randomUUID();
  const bundle: DreamAnalysisBundle = {
    analysis: {
      id: analysisId,
      dreamId: submitted.dreamId,
      createdAt: input.now,
      isCurrent: true,
      sourceAdapter: "agent-submitted",
      sourceModel: `${submitted.sourceAgent}/${submitted.sourceModel}`,
      promptVersion: submitted.promptVersion ?? "agent-analysis-v1",
      correctionSource: "agent",
      canonicalText: submitted.canonicalText,
      lucidityLevel: submitted.lucidityLevel ?? null,
      inductionTech: submitted.inductionTech ?? null,
      realityCheck: submitted.realityCheck ?? null,
      controlLevel: submitted.controlLevel ?? null,
      onsetType: submitted.onsetType ?? null,
      dreamSigns: submitted.dreamSigns ?? [],
      emotions: submitted.emotions ?? [],
      embedding: embedding.embedding,
      deletedAt: null,
      deleteReason: null,
    },
    hvdcRecord: buildHvdCRecord(analysisId, {
      characters: submitted.hvdc?.characters ?? [],
      socialInteractions: submitted.hvdc?.socialInteractions ?? [],
      activities: submitted.hvdc?.activities ?? [],
      emotions: submitted.hvdc?.emotions ?? [],
      settings: submitted.hvdc?.settings ?? [],
      objects: submitted.hvdc?.objects ?? [],
      outcomes: submitted.hvdc?.outcomes ?? [],
    }),
    entities: (submitted.entities ?? []).map((entity) => ({
      id: `${entity.type}:${normalizeEntityName(entity.name)}`,
      type: entity.type as EntityType,
      name: entity.name.trim(),
      context: entity.context ?? null,
      embedding: null,
    })) as Array<Entity & Pick<DreamEntity, "context">>,
  };

  return input.analyses.createCurrent(bundle);
}
