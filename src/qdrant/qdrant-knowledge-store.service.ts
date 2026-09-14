import { Injectable } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { KnowledgeChunk } from '../chunking/knowledge-chunk.interface.js';
import { EmbeddingService, type EmbeddedChunk } from '../embedding/embedding.service.js';
import type {
  KnowledgeChunkPayload,
  KnowledgeCollectionInfo,
  KnowledgeMetadataFilter,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  KnowledgeStore,
} from './knowledge-store.interface.js';
import { toQdrantPointId } from './point-id.util.js';

const DEFAULT_URL = 'http://localhost:6333';
const DEFAULT_COLLECTION = 'car_rental_knowledge';
const DISTANCE = 'Cosine';
const DEFAULT_SEARCH_LIMIT = 5;

/** KnowledgeStore implementation backed by a local/self-hosted Qdrant instance. */
@Injectable()
export class QdrantKnowledgeStoreService implements KnowledgeStore {
  readonly collectionName: string;

  private readonly url: string;
  private readonly client: QdrantClient;

  constructor(private readonly embeddingService: EmbeddingService) {
    this.url = process.env.QDRANT_URL?.trim() || DEFAULT_URL;
    this.collectionName = process.env.QDRANT_COLLECTION?.trim() || DEFAULT_COLLECTION;
    const apiKey = process.env.QDRANT_API_KEY?.trim() || undefined;
    // checkCompatibility fires a background version-check request on construction;
    // disabled so building this service never depends on Qdrant already being up.
    // apiKey is only included when set, so local unauthenticated Qdrant (no
    // QDRANT_API_KEY) is passed the exact same config object as before.
    this.client = new QdrantClient({ url: this.url, checkCompatibility: false, ...(apiKey ? { apiKey } : {}) });
  }

  private get vectorSize(): number {
    return this.embeddingService.dimensions;
  }

  async ensureCollection(): Promise<void> {
    try {
      const { exists } = await this.client.collectionExists(this.collectionName);

      if (!exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: { size: this.vectorSize, distance: DISTANCE },
        });
        return;
      }

      await this.verifyCollectionConfig();
    } catch (error) {
      this.rethrowWithContext(error);
    }
  }

  async indexChunks(embeddedChunks: EmbeddedChunk[]): Promise<void> {
    if (embeddedChunks.length === 0) {
      return;
    }

    await this.ensureCollection();

    const points = embeddedChunks.map(({ chunk, vector }) => ({
      id: toQdrantPointId(chunk.id),
      vector,
      payload: this.toPayload(chunk) as unknown as Record<string, unknown>,
    }));

    try {
      // Same deterministic ids in => upsert replaces the existing points instead
      // of adding new ones, so repeated indexing stays idempotent.
      await this.client.upsert(this.collectionName, { wait: true, points });
    } catch (error) {
      this.rethrowWithContext(error);
    }
  }

  async getCollectionInfo(): Promise<KnowledgeCollectionInfo> {
    try {
      const info = await this.client.getCollection(this.collectionName);
      const { size, distance } = this.readVectorParams(info.config.params.vectors);

      return {
        name: this.collectionName,
        vectorSize: size,
        distance,
        pointsCount: info.points_count ?? 0,
      };
    } catch (error) {
      this.rethrowWithContext(error);
    }
  }

  async search(vector: number[], options: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchResult[]> {
    const { limit = DEFAULT_SEARCH_LIMIT, scoreThreshold, filter } = options;

    try {
      const response = await this.client.query(this.collectionName, {
        query: vector,
        limit,
        score_threshold: scoreThreshold,
        filter: this.buildFilter(filter),
        with_payload: true,
        with_vector: false,
      });

      return response.points.map((point) => ({
        score: point.score,
        payload: point.payload as unknown as KnowledgeChunkPayload,
      }));
    } catch (error) {
      this.rethrowWithContext(error);
    }
  }

  /**
   * Qdrant client connection failures surface as a bare `TypeError: fetch
   * failed` with no mention of Qdrant, which is unhelpful. Detect that case
   * and rethrow a message that names the URL and how to fix it locally;
   * anything else (like our own config-mismatch errors) passes through as-is.
   */
  private rethrowWithContext(error: unknown): never {
    if (error instanceof TypeError && error.message === 'fetch failed') {
      const cause = error.cause as { code?: string } | undefined;
      const detail = cause?.code ? ` (${cause.code})` : '';
      throw new Error(
        `Could not reach Qdrant at ${this.url}${detail}. Is it running? Start it with \`docker compose up -d\` ` +
          '(see docker-compose.yml), then check `docker ps` and `curl ' +
          `${this.url}/collections\`.`,
      );
    }
    throw error;
  }

  private buildFilter(filter?: KnowledgeMetadataFilter) {
    if (!filter) {
      return undefined;
    }

    const must = Object.entries(filter)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => ({ key, match: { value } }));

    return must.length > 0 ? { must } : undefined;
  }

  private toPayload(chunk: KnowledgeChunk): KnowledgeChunkPayload {
    return {
      text: chunk.text,
      source: chunk.metadata.source,
      section: chunk.metadata.section,
      documentTitle: chunk.metadata.documentTitle,
      page: chunk.metadata.page,
      chunkIndex: chunk.metadata.chunkIndex,
      chunkId: chunk.id,
    };
  }

  private async verifyCollectionConfig(): Promise<void> {
    const info = await this.client.getCollection(this.collectionName);
    const { size, distance } = this.readVectorParams(info.config.params.vectors);

    if (size !== this.vectorSize || distance !== DISTANCE) {
      throw new Error(
        `Qdrant collection "${this.collectionName}" already exists with vector size=${size}, distance=${distance}, ` +
          `but this app expects size=${this.vectorSize}, distance=${DISTANCE}. ` +
          'Point QDRANT_COLLECTION at a different name, or delete the existing collection, and try again.',
      );
    }
  }

  private readVectorParams(vectors: unknown): { size: number; distance: string } {
    if (vectors && typeof vectors === 'object' && 'size' in vectors && 'distance' in vectors) {
      const params = vectors as { size: number; distance: string };
      return { size: Number(params.size), distance: String(params.distance) };
    }

    throw new Error(
      `Qdrant collection "${this.collectionName}" uses a named/multi-vector configuration, which this app does not support.`,
    );
  }
}
