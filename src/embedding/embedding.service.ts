import { Inject, Injectable } from '@nestjs/common';
import type { KnowledgeChunk } from '../chunking/knowledge-chunk.interface.js';
import { EMBEDDING_PROVIDER } from './embedding.constants.js';
import type { EmbeddingProvider, EmbeddingTask } from './embedding-provider.interface.js';

/** A KnowledgeChunk paired with its generated embedding vector. */
export interface EmbeddedChunk {
  chunk: KnowledgeChunk;
  vector: number[];
}

/**
 * Thin, provider-agnostic entry point for embedding text and KnowledgeChunks.
 * Depends on the EmbeddingProvider interface (not a concrete implementation),
 * so the underlying model/vendor can be swapped via EmbeddingModule alone.
 */
@Injectable()
export class EmbeddingService {
  constructor(@Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider) {}

  /** Dimensionality of the vectors this service produces, e.g. for sizing a vector-DB collection. */
  get dimensions(): number {
    return this.provider.dimensions;
  }

  embedText(text: string, task: EmbeddingTask): Promise<number[]> {
    return this.provider.embedText(text, task);
  }

  embedTexts(texts: string[], task: EmbeddingTask): Promise<number[][]> {
    return this.provider.embedTexts(texts, task);
  }

  /** Embeds every chunk's text as documents, pairing each resulting vector with its source chunk. */
  async embedChunks(chunks: KnowledgeChunk[]): Promise<EmbeddedChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const vectors = await this.provider.embedTexts(
      chunks.map((chunk) => chunk.text),
      'document',
    );
    return chunks.map((chunk, index) => ({ chunk, vector: vectors[index] }));
  }
}
