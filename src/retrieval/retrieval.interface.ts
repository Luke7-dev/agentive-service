import type { KnowledgeChunk } from '../chunking/knowledge-chunk.interface.js';
import type { KnowledgeMetadataFilter } from '../qdrant/knowledge-store.interface.js';

export interface SearchOptions {
  /** Max number of chunks to return. Defaults to 5. */
  limit?: number;
  /** Only return chunks with a similarity score at least this high. */
  scoreThreshold?: number;
  /** Simple exact-match metadata filter, e.g. `{ source: 'car-rental-policies.pdf' }`. */
  filter?: KnowledgeMetadataFilter;
}

/** A KnowledgeChunk returned from a similarity search, with its relevance score. */
export interface RetrievedKnowledgeChunk {
  score: number;
  chunk: KnowledgeChunk;
}
