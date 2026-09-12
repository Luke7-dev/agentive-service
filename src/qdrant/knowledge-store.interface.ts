import type { EmbeddedChunk } from '../embedding/embedding.service.js';

/** Payload stored alongside each vector in the knowledge-base collection. */
export interface KnowledgeChunkPayload {
  text: string;
  source: string;
  section?: string;
  documentTitle?: string;
  page?: number;
  chunkIndex: number;
  /** Original, human-readable KnowledgeChunk.id — kept for traceability back from Qdrant. */
  chunkId: string;
}

export interface KnowledgeCollectionInfo {
  name: string;
  vectorSize: number;
  distance: string;
  pointsCount: number;
}

/** A single similarity-search hit: a raw score plus the stored payload. */
export interface KnowledgeSearchResult {
  score: number;
  payload: KnowledgeChunkPayload;
}

/**
 * Simple, flat exact-match filter on payload fields — intentionally not a
 * general filter DSL. Add more fields here only as real needs come up.
 */
export interface KnowledgeMetadataFilter {
  source?: string;
  section?: string;
}

export interface KnowledgeSearchOptions {
  /** Max number of results to return. */
  limit?: number;
  /** Only return results with a similarity score at least this high. */
  scoreThreshold?: number;
  filter?: KnowledgeMetadataFilter;
}

/**
 * Vector-store boundary for the knowledge base. Qdrant is today's
 * implementation; swapping to a different vector DB later means writing a
 * new class against this interface, not touching chunking/embedding code.
 */
export interface KnowledgeStore {
  /** Creates the collection if missing; verifies its config if it already exists. */
  ensureCollection(): Promise<void>;

  /**
   * Upserts every embedded chunk as a point. Safe to call repeatedly: points
   * are keyed by a deterministic id derived from KnowledgeChunk.id, so
   * re-indexing the same chunks replaces them in place instead of
   * accumulating duplicates.
   */
  indexChunks(embeddedChunks: EmbeddedChunk[]): Promise<void>;

  /** Reads back the live collection configuration and point count. */
  getCollectionInfo(): Promise<KnowledgeCollectionInfo>;

  /** Finds the points whose vectors are most similar to `vector` (cosine distance). */
  search(vector: number[], options?: KnowledgeSearchOptions): Promise<KnowledgeSearchResult[]>;
}
