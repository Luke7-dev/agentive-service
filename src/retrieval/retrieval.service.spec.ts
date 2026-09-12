import { describe, expect, it } from 'vitest';
import type { EmbeddingService } from '../embedding/embedding.service.js';
import type {
  KnowledgeCollectionInfo,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  KnowledgeStore,
} from '../qdrant/knowledge-store.interface.js';
import { RetrievalService } from './retrieval.service.js';

class FakeEmbeddingService {
  dimensions = 768;
  embedTextCalls: string[] = [];
  embedTaskCalls: string[] = [];
  private readonly vector: number[];

  constructor(vector: number[] = [0.1, 0.2, 0.3]) {
    this.vector = vector;
  }

  async embedText(text: string, task: string): Promise<number[]> {
    this.embedTextCalls.push(text);
    this.embedTaskCalls.push(task);
    return this.vector;
  }
}

class FakeKnowledgeStore implements KnowledgeStore {
  searchCalls: Array<{ vector: number[]; options?: KnowledgeSearchOptions }> = [];
  searchResults: KnowledgeSearchResult[] = [];

  async ensureCollection(): Promise<void> {}
  async indexChunks(): Promise<void> {}
  async getCollectionInfo(): Promise<KnowledgeCollectionInfo> {
    return { name: 'car_rental_knowledge', vectorSize: 768, distance: 'Cosine', pointsCount: 0 };
  }

  async search(vector: number[], options?: KnowledgeSearchOptions): Promise<KnowledgeSearchResult[]> {
    this.searchCalls.push({ vector, options });
    return this.searchResults;
  }
}

function makeResult(overrides: Partial<KnowledgeSearchResult['payload']> = {}, score = 0.9): KnowledgeSearchResult {
  return {
    score,
    payload: {
      text: 'Accepted Payment Methods: Credit Card, Bank Transfer, or PromptPay.',
      source: 'car-rental-policies.pdf',
      section: 'Payment & Security Deposit',
      documentTitle: 'Terms & Rental Policies',
      page: 1,
      chunkIndex: 1,
      chunkId: 'car-rental-policies-section-2',
      ...overrides,
    },
  };
}

describe('RetrievalService', () => {
  function makeService(store: FakeKnowledgeStore, embedding: FakeEmbeddingService = new FakeEmbeddingService()) {
    return {
      service: new RetrievalService(embedding as unknown as EmbeddingService, store),
      embedding,
      store,
    };
  }

  it('rejects an empty query without calling the embedding service or the store', async () => {
    const { service, embedding, store } = makeService(new FakeKnowledgeStore());

    await expect(service.search('')).rejects.toThrow();
    await expect(service.search('   ')).rejects.toThrow();

    expect(embedding.embedTextCalls).toHaveLength(0);
    expect(store.searchCalls).toHaveLength(0);
  });

  it('embeds the query exactly once, using the shared EmbeddingService', async () => {
    const store = new FakeKnowledgeStore();
    const { service, embedding } = makeService(store);

    await service.search('How much is the security deposit?');

    expect(embedding.embedTextCalls).toEqual(['How much is the security deposit?']);
  });

  it('embeds the query using the "query" task, not "document"', async () => {
    const store = new FakeKnowledgeStore();
    const { service, embedding } = makeService(store);

    await service.search('How much is the security deposit?');

    expect(embedding.embedTaskCalls).toEqual(['query']);
  });

  it('searches the knowledge store with the embedded query vector', async () => {
    const store = new FakeKnowledgeStore();
    const vector = [0.4, 0.5, 0.6];
    const { service } = makeService(store, new FakeEmbeddingService(vector));

    await service.search('Can I bring my pet?');

    expect(store.searchCalls).toHaveLength(1);
    expect(store.searchCalls[0].vector).toEqual(vector);
  });

  it('defaults to a limit of 5 when none is given', async () => {
    const store = new FakeKnowledgeStore();
    const { service } = makeService(store);

    await service.search('What payment methods do you accept?');

    expect(store.searchCalls[0].options?.limit).toBe(5);
  });

  it('passes a custom limit through to the knowledge store', async () => {
    const store = new FakeKnowledgeStore();
    const { service } = makeService(store);

    await service.search('What payment methods do you accept?', { limit: 3 });

    expect(store.searchCalls[0].options?.limit).toBe(3);
  });

  it('passes a score threshold through to the knowledge store', async () => {
    const store = new FakeKnowledgeStore();
    const { service } = makeService(store);

    await service.search('What payment methods do you accept?', { scoreThreshold: 0.7 });

    expect(store.searchCalls[0].options?.scoreThreshold).toBe(0.7);
  });

  it('passes a metadata filter through to the knowledge store', async () => {
    const store = new FakeKnowledgeStore();
    const { service } = makeService(store);

    await service.search('deposit', { filter: { source: 'car-rental-policies.pdf' } });

    expect(store.searchCalls[0].options?.filter).toEqual({ source: 'car-rental-policies.pdf' });
  });

  it('maps Qdrant search results into RetrievedKnowledgeChunk, preserving score and all metadata', async () => {
    const store = new FakeKnowledgeStore();
    store.searchResults = [makeResult({}, 0.87)];
    const { service } = makeService(store);

    const results = await service.search('How much is the security deposit?');

    expect(results).toEqual([
      {
        score: 0.87,
        chunk: {
          id: 'car-rental-policies-section-2',
          text: 'Accepted Payment Methods: Credit Card, Bank Transfer, or PromptPay.',
          metadata: {
            source: 'car-rental-policies.pdf',
            section: 'Payment & Security Deposit',
            documentTitle: 'Terms & Rental Policies',
            page: 1,
            chunkIndex: 1,
          },
        },
      },
    ]);
  });

  it('preserves the order and count of multiple results', async () => {
    const store = new FakeKnowledgeStore();
    store.searchResults = [
      makeResult({ chunkId: 'a', section: 'Section A' }, 0.95),
      makeResult({ chunkId: 'b', section: 'Section B' }, 0.8),
      makeResult({ chunkId: 'c', section: 'Section C' }, 0.6),
    ];
    const { service } = makeService(store);

    const results = await service.search('some question');

    expect(results.map((r) => r.chunk.id)).toEqual(['a', 'b', 'c']);
    expect(results.map((r) => r.score)).toEqual([0.95, 0.8, 0.6]);
  });

  it('handles chunks with no optional metadata fields', async () => {
    const store = new FakeKnowledgeStore();
    store.searchResults = [
      {
        score: 0.5,
        payload: {
          text: 'Some text with no section/title/page.',
          source: 'car-rental-services.pdf',
          chunkIndex: 0,
          chunkId: 'car-rental-services-section-1',
        },
      },
    ];
    const { service } = makeService(store);

    const [result] = await service.search('anything');

    expect(result.chunk.metadata.section).toBeUndefined();
    expect(result.chunk.metadata.documentTitle).toBeUndefined();
    expect(result.chunk.metadata.page).toBeUndefined();
  });

  it('returns an empty array when the knowledge store finds nothing', async () => {
    const store = new FakeKnowledgeStore();
    store.searchResults = [];
    const { service } = makeService(store);

    const results = await service.search('completely unrelated query');

    expect(results).toEqual([]);
  });
});
