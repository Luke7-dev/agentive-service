/**
 * What an embedding will be used for. Some providers (Gemini included)
 * produce measurably better retrieval quality when documents and search
 * queries are embedded differently, even though the resulting vectors have
 * the same dimension and remain directly comparable. Callers must say which
 * one they mean rather than a provider silently picking one for everything.
 */
export type EmbeddingTask = 'document' | 'query';

/**
 * A swappable text-embedding backend. Concrete implementations (Gemini today,
 * potentially others later) must reject empty/whitespace-only input rather
 * than silently returning a zero vector, so callers can trust that every
 * returned vector corresponds to real embedded content.
 */
export interface EmbeddingProvider {
  /** Dimensionality of every vector this provider returns. */
  readonly dimensions: number;

  /** Embeds a single piece of text for the given task. */
  embedText(text: string, task: EmbeddingTask): Promise<number[]>;

  /** Embeds multiple texts for the given task, preserving input order in the returned array. */
  embedTexts(texts: string[], task: EmbeddingTask): Promise<number[][]>;
}

/** Shared input validation used by every EmbeddingProvider implementation. */
export function assertEmbeddableTexts(texts: string[]): void {
  if (texts.length === 0) {
    throw new Error('At least one text is required to generate embeddings.');
  }

  texts.forEach((text, index) => {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error(`Cannot embed empty or invalid text at index ${index}.`);
    }
  });
}
