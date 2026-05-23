import type { ISODate, UUID } from "./types.js";

export interface DreamQueryFilters {
  text?: string;
  date?: ISODate;
  from?: ISODate;
  to?: ISODate;
  symbol?: string;
  person?: string;
  setting?: string;
  emotion?: string;
  object?: string;
  interaction?: string;
  lucidity?: number;
  lucidityMin?: number;
  technique?: string;
}

export interface DreamQueryResult {
  dreamId: UUID;
  analysisId: UUID;
  dreamDate: ISODate;
  title: string | null;
  canonicalText: string;
  lucidityLevel: number | null;
  inductionTech: string | null;
  dreamSigns: string[];
  emotions: string[];
  score: number | null;
}

export interface DreamGraphNode {
  id: string;
  label: string;
  type: string;
  count: number;
}

export interface DreamGraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface DreamGraph {
  nodes: DreamGraphNode[];
  edges: DreamGraphEdge[];
}
