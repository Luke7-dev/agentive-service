/**
 * A single, semantically coherent piece of knowledge-base text, ready to be
 * embedded into a vector database in a later step.
 */
export interface KnowledgeChunk {
  /** Deterministic identifier, stable across runs for the same input. */
  id: string;
  /** Verbatim excerpt of the source document — never summarized or rewritten. */
  text: string;
  metadata: {
    /** File name (or path) the chunk was extracted from. */
    source: string;
    /** Logical section heading the chunk belongs to, e.g. "Payment & Security Deposit". */
    section?: string;
    /** Top-level title of the source document, e.g. "Terms & Rental Policies". */
    documentTitle?: string;
    /** Page the chunk starts on (1-based), when known. */
    page?: number;
    /** 0-based position of this chunk among all chunks produced for the same source. */
    chunkIndex: number;
  };
}

export interface ChunkingOptions {
  /**
   * Soft upper bound (in characters) for a single chunk. A logical section is
   * only split further when it exceeds this size, and only along bullet/line
   * boundaries — never mid-sentence. Defaults to 1200.
   */
  maxChunkChars?: number;
}
