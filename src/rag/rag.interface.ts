/** Minimal citation info for an answer — no chunk ids, scores, or vectors. */
export interface RagSource {
  source: string;
  section?: string;
}

/** Result of RagService.answer(): the generated answer plus what it was grounded in. */
export interface RagAnswer {
  answer: string;
  sources: RagSource[];
}
