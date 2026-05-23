export type LucidmemoPackage = "transcription";

export const packageName: LucidmemoPackage = "transcription";

export interface TranscriptionInput {
  audioBytes: Uint8Array;
  mimeType: string | null;
  extension: string | null;
  originalName: string | null;
}

export interface TranscriptionResult {
  text: string;
  sourceAdapter: string;
  sourceModel: string;
}

export interface TranscriptionAdapter {
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

export class MissingTranscriptionAdapter implements TranscriptionAdapter {
  readonly name = "missing-transcription";

  async transcribe(_input: TranscriptionInput): Promise<TranscriptionResult> {
    throw new Error("No transcription adapter is configured.");
  }
}
