import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type {
  KnowledgeCollectionInfo,
  KnowledgeSearchResult,
  KnowledgeStore,
} from '../qdrant/knowledge-store.interface.js';
import { HealthController } from './health.controller.js';

class FakeKnowledgeStore implements KnowledgeStore {
  getCollectionInfoCalls = 0;
  ensureCollectionCalls = 0;
  indexChunksCalls = 0;
  searchCalls = 0;
  error: Error | null = null;
  info: KnowledgeCollectionInfo = { name: 'car_rental_knowledge', vectorSize: 768, distance: 'Cosine', pointsCount: 8 };

  async ensureCollection(): Promise<void> {
    this.ensureCollectionCalls++;
  }

  async indexChunks(): Promise<void> {
    this.indexChunksCalls++;
  }

  async getCollectionInfo(): Promise<KnowledgeCollectionInfo> {
    this.getCollectionInfoCalls++;
    if (this.error) {
      throw this.error;
    }
    return this.info;
  }

  async search(): Promise<KnowledgeSearchResult[]> {
    this.searchCalls++;
    return [];
  }
}

function makeController(knowledgeStore: FakeKnowledgeStore = new FakeKnowledgeStore()) {
  return { controller: new HealthController(knowledgeStore), knowledgeStore };
}

describe('HealthController', () => {
  it('returns { status: "ok" } when the Qdrant read check succeeds', async () => {
    const { controller } = makeController();

    const result = await controller.check();

    expect(result).toEqual({ status: 'ok' });
  });

  it('performs exactly one read-only Qdrant call and no writes/indexing/search', async () => {
    const { controller, knowledgeStore } = makeController();

    await controller.check();

    expect(knowledgeStore.getCollectionInfoCalls).toBe(1);
    expect(knowledgeStore.ensureCollectionCalls).toBe(0);
    expect(knowledgeStore.indexChunksCalls).toBe(0);
    expect(knowledgeStore.searchCalls).toBe(0);
  });

  it('throws a 503 ServiceUnavailableException when the Qdrant check fails', async () => {
    const knowledgeStore = new FakeKnowledgeStore();
    knowledgeStore.error = new Error('Could not reach Qdrant at https://example.qdrant.io: ECONNREFUSED');
    const { controller } = makeController(knowledgeStore);

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it('does not perform any write/index/search calls when the Qdrant check fails', async () => {
    const knowledgeStore = new FakeKnowledgeStore();
    knowledgeStore.error = new Error('Could not reach Qdrant at https://example.qdrant.io: ECONNREFUSED');
    const { controller } = makeController(knowledgeStore);

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);

    expect(knowledgeStore.ensureCollectionCalls).toBe(0);
    expect(knowledgeStore.indexChunksCalls).toBe(0);
    expect(knowledgeStore.searchCalls).toBe(0);
  });

  it('never exposes the raw Qdrant error (URL/details) in the thrown response body', async () => {
    const knowledgeStore = new FakeKnowledgeStore();
    knowledgeStore.error = new Error('Could not reach Qdrant at https://example.qdrant.io: ECONNREFUSED');
    const { controller } = makeController(knowledgeStore);

    let caught: unknown;
    try {
      await controller.check();
    } catch (thrown) {
      caught = thrown;
    }

    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    const exception = caught as ServiceUnavailableException;
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toEqual({ status: 'error' });
    expect(JSON.stringify(exception.getResponse())).not.toContain('example.qdrant.io');
    expect(JSON.stringify(exception.getResponse())).not.toContain('ECONNREFUSED');
  });

  it('never depends on Gemini/embedding/RAG providers — only the KnowledgeStore token', async () => {
    // HealthController's constructor takes only a KnowledgeStore. Constructing
    // it with nothing else and getting a correct result proves Gemini/RAG
    // code paths are structurally unreachable from this endpoint.
    const { controller } = makeController();

    await expect(controller.check()).resolves.toEqual({ status: 'ok' });
  });
});
