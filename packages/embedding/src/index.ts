export type LucidmemoPackage = "embedding";

export const packageName: LucidmemoPackage = "embedding";

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

export class HashEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = "hash-embedding";

  constructor(private readonly dimensions = 64) {}

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const vector = new Float32Array(this.dimensions);
    const tokens = input.text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

    for (const token of tokens) {
      const index = hashToken(token) % this.dimensions;
      vector[index] += 1;
    }

    normalize(vector);

    return {
      embedding: new Uint8Array(vector.buffer.slice(0)),
      sourceAdapter: this.name,
      sourceModel: `hash-${this.dimensions}`,
    };
  }
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (const char of token) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalize(vector: Float32Array): void {
  const magnitude = Math.hypot(...vector);
  if (magnitude === 0) {
    return;
  }

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= magnitude;
  }
}
