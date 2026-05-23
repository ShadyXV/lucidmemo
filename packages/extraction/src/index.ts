export type LucidmemoPackage = "extraction";

export const packageName: LucidmemoPackage = "extraction";

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
  hvdc: {
    characters: unknown[];
    socialInteractions: unknown[];
    activities: unknown[];
    emotions: unknown[];
    settings: unknown[];
    objects: unknown[];
    outcomes: unknown[];
  };
  sourceAdapter: string;
  sourceModel: string;
  promptVersion: string;
}

export interface ExtractionAdapter {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

export class HeuristicExtractionAdapter implements ExtractionAdapter {
  readonly name = "heuristic-extraction";

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const canonicalText = normalizeCanonicalText(input.text);
    const lower = canonicalText.toLowerCase();
    const emotions = unique(matchWords(lower, EMOTION_WORDS));
    const dreamSigns = unique(matchWords(lower, DREAM_SIGN_WORDS));

    return {
      canonicalText,
      lucidityLevel: inferLucidityLevel(lower),
      inductionTech: inferInductionTech(lower),
      realityCheck: inferRealityCheck(lower),
      controlLevel: inferControlLevel(lower),
      onsetType: inferOnsetType(lower),
      dreamSigns,
      emotions,
      hvdc: {
        characters: extractSimpleEntities(canonicalText, CHARACTER_HINTS),
        socialInteractions: extractPhraseMatches(lower, ["talked", "chased", "hugged", "argued"]),
        activities: extractPhraseMatches(lower, ["flying", "running", "driving", "swimming"]),
        emotions,
        settings: extractPhraseMatches(lower, ["house", "school", "street", "forest", "bedroom"]),
        objects: extractPhraseMatches(lower, ["phone", "mirror", "door", "car", "book"]),
        outcomes: [],
      },
      sourceAdapter: this.name,
      sourceModel: "heuristic-v1",
      promptVersion: "heuristic-v1",
    };
  }
}

const EMOTION_WORDS = ["afraid", "happy", "sad", "angry", "calm", "excited", "confused", "anxious"];
const DREAM_SIGN_WORDS = ["flying", "teeth", "mirror", "door", "school", "chased", "lucid"];
const CHARACTER_HINTS = ["mother", "father", "brother", "sister", "friend", "teacher", "stranger"];

function normalizeCanonicalText(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function inferLucidityLevel(text: string): number | null {
  if (text.includes("lucid") || text.includes("realized i was dreaming")) {
    return 4;
  }
  if (text.includes("dream") && text.includes("knew")) {
    return 3;
  }
  return null;
}

function inferInductionTech(text: string): string | null {
  if (text.includes("wild")) {
    return "WILD";
  }
  if (text.includes("mild")) {
    return "MILD";
  }
  if (text.includes("wake back to bed") || text.includes("wbtb")) {
    return "WBTB";
  }
  return null;
}

function inferRealityCheck(text: string): string | null {
  if (text.includes("checked my hands") || text.includes("looked at my hands")) {
    return "hands";
  }
  if (text.includes("pinched my nose")) {
    return "nose pinch";
  }
  if (text.includes("looked in the mirror")) {
    return "mirror";
  }
  return null;
}

function inferControlLevel(text: string): number | null {
  if (text.includes("controlled") || text.includes("decided to")) {
    return 3;
  }
  if (text.includes("could not control") || text.includes("couldn't control")) {
    return 1;
  }
  return null;
}

function inferOnsetType(text: string): string | null {
  if (text.includes("woke up into") || text.includes("false awakening")) {
    return "false awakening";
  }
  if (text.includes("became lucid")) {
    return "dream-initiated";
  }
  return null;
}

function matchWords(text: string, words: string[]): string[] {
  return words.filter((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(text));
}

function extractPhraseMatches(text: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

function extractSimpleEntities(text: string, hints: string[]): string[] {
  const lower = text.toLowerCase();
  return hints.filter((hint) => lower.includes(hint));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
