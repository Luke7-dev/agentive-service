import { Inject, Injectable } from '@nestjs/common';
import type { KnowledgeChunk } from '../chunking/knowledge-chunk.interface.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { KNOWLEDGE_STORE } from '../qdrant/qdrant.constants.js';
import type { KnowledgeChunkPayload, KnowledgeStore } from '../qdrant/knowledge-store.interface.js';
import type { RetrievedKnowledgeChunk, SearchOptions } from './retrieval.interface.js';

const DEFAULT_LIMIT = 5;

/**
 * Semantic search over the knowledge base: embeds a natural-language query
 * with the same EmbeddingService used at indexing time, then asks the
 * KnowledgeStore for the most similar stored chunks.
 */
@Injectable()
export class RetrievalService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    @Inject(KNOWLEDGE_STORE) private readonly knowledgeStore: KnowledgeStore,
    private readonly metricsService: MetricsService,
  ) {}

  async search(query: string, options: SearchOptions = {}): Promise<RetrievedKnowledgeChunk[]> {
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Cannot search with empty or invalid query text.');
    }

    // Same EmbeddingService (same model, same dimension) used to index the
    // documents, so the query vector is directly comparable to stored ones.
    // Uses the 'query' task (Gemini: RETRIEVAL_QUERY) — asymmetric from the
    // 'document' task used at indexing time, which improves ranking quality.
    const vector = await this.embeddingService.embedText(query, 'query');

    // Timed and counted here (not inside QdrantKnowledgeStoreService) so the
    // Qdrant retrieval implementation itself stays untouched by observability
    // concerns; if this call throws, it propagates unchanged and nothing is
    // recorded for it.
    const start = process.hrtime.bigint();
    const results = await this.knowledgeStore.search(vector, {
      limit: options.limit ?? DEFAULT_LIMIT,
      scoreThreshold: options.scoreThreshold,
      filter: options.filter,
    });
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    this.metricsService.recordRetrieval({ durationSeconds, resultCount: results.length });

    return results.map((result) => ({
      score: result.score,
      chunk: this.toKnowledgeChunk(result.payload),
    }));
  }

  private toKnowledgeChunk(payload: KnowledgeChunkPayload): KnowledgeChunk {
    return {
      id: payload.chunkId,
      text: payload.text,
      metadata: {
        source: payload.source,
        section: payload.section,
        documentTitle: payload.documentTitle,
        page: payload.page,
        chunkIndex: payload.chunkIndex,
      },
    };
  }
}
