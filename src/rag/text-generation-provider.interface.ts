/**
 * A swappable text-generation backend for RAG answer synthesis. Concrete
 * implementations (Gemini today, potentially others later) must reject
 * empty/whitespace-only prompts rather than sending a meaningless request to
 * the underlying model.
 */
export interface TextGenerationProvider {
  /** Generates a natural-language completion for the given prompt. */
  generate(prompt: string): Promise<string>;
}

/** Shared input validation used by every TextGenerationProvider implementation. */
export function assertNonEmptyPrompt(prompt: string): void {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('Cannot generate text from an empty or invalid prompt.');
  }
}
