import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeChunk } from '../chunking/knowledge-chunk.interface.js';
import type { EmbeddedChunk, EmbeddingService } from '../embedding/embedding.service.js';
import { toQdrantPointId } from './point-id.util.js';

const collectionExistsMock = vi.fn();
const createCollectionMock = vi.fn();
const getCollectionMock = vi.fn();
const upsertMock = vi.fn();
const queryMock = vi.fn();
const qdrantClientConstructorMock = vi.fn();

vi.mock('@qdrant/js-client-rest', () => {
  class FakeQdrantClient {
    constructor(options: unknown) {
      qdrantClientConstructorMock(options);
    }
    collectionExists = collectionExistsMock;
    createCollection = createCollectionMock;
    getCollection = getCollectionMock;
    upsert = upsertMock;
    query = queryMock;
  }
  return { QdrantClient: FakeQdrantClient };
});

const { QdrantKnowledgeStoreService } = await import('./qdrant-knowledge-store.service.js');

class FakeEmbeddingService {
  dimensions = 768;
}

function makeService(): InstanceType<typeof QdrantKnowledgeStoreService> {
  return new QdrantKnowledgeStoreService(new FakeEmbeddingService() as unknown as EmbeddingService);
}

function makeChunk(id: string, text: string, overrides: Partial<KnowledgeChunk['metadata']> = {}): KnowledgeChunk {
  return {
    id,
    text,
    metadata: {
      source: 'car-rental-policies.pdf',
      section: 'Payment & Security Deposit',
      documentTitle: 'Terms & Rental Policies',
      page: 1,
      chunkIndex: 0,
      ...overrides,
    },
  };
}

function makeEmbedded(chunk: KnowledgeChunk, vector: number[] = [0.1, 0.2, 0.3]): EmbeddedChunk {
  return { chunk, vector };
}

function matchingCollectionInfo(size = 768, pointsCount = 0) {
  return { config: { params: { vectors: { size, distance: 'Cosine' } } }, points_count: pointsCount };
}

describe('QdrantKnowledgeStoreService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    collectionExistsMock.mockReset();
    createCollectionMock.mockReset();
    getCollectionMock.mockReset();
    upsertMock.mockReset();
    queryMock.mockReset();
    qdrantClientConstructorMock.mockReset();
    process.env = { ...originalEnv, QDRANT_URL: 'http://localhost:6333', QDRANT_COLLECTION: 'car_rental_knowledge' };
    delete process.env.QDRANT_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('QDRANT_API_KEY configuration', () => {
    it('constructs the client without an apiKey when QDRANT_API_KEY is absent (local unauthenticated Qdrant)', () => {
      makeService();

      expect(qdrantClientConstructorMock).toHaveBeenCalledWith({
        url: 'http://localhost:6333',
        checkCompatibility: false,
      });
      const options = qdrantClientConstructorMock.mock.calls[0][0];
      expect(options).not.toHaveProperty('apiKey');
    });

    it('constructs the client without an apiKey when QDRANT_API_KEY is an empty/whitespace string', () => {
      process.env.QDRANT_API_KEY = '   ';

      makeService();

      const options = qdrantClientConstructorMock.mock.calls[0][0];
      expect(options).not.toHaveProperty('apiKey');
    });

    it('passes QDRANT_API_KEY to the Qdrant client when set', () => {
      process.env.QDRANT_API_KEY = 'test-qdrant-api-key';

      makeService();

      expect(qdrantClientConstructorMock).toHaveBeenCalledWith({
        url: 'http://localhost:6333',
        checkCompatibility: false,
        apiKey: 'test-qdrant-api-key',
      });
    });

    it('never includes the API key in a connection-failure error message', async () => {
      process.env.QDRANT_API_KEY = 'test-qdrant-api-key';
      const error = new TypeError('fetch failed');
      (error as { cause?: unknown }).cause = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
      collectionExistsMock.mockRejectedValue(error);

      let thrownMessage = '';
      try {
        await makeService().ensureCollection();
      } catch (thrown) {
        thrownMessage = thrown instanceof Error ? thrown.message : String(thrown);
      }

      expect(thrownMessage).not.toBe('');
      expect(thrownMessage).not.toContain('test-qdrant-api-key');
    });
  });

  describe('ensureCollection', () => {
    it('creates the collection with the embedding dimension and cosine distance when missing', async () => {
      collectionExistsMock.mockResolvedValue({ exists: false });
      createCollectionMock.mockResolvedValue(true);

      await makeService().ensureCollection();

      expect(createCollectionMock).toHaveBeenCalledWith('car_rental_knowledge', {
        vectors: { size: 768, distance: 'Cosine' },
      });
    });

    it('does not recreate the collection when it already exists with a matching config', async () => {
      collectionExistsMock.mockResolvedValue({ exists: true });
      getCollectionMock.mockResolvedValue(matchingCollectionInfo());

      await makeService().ensureCollection();

      expect(createCollectionMock).not.toHaveBeenCalled();
    });

    it('throws a clear error when the existing collection config does not match', async () => {
      collectionExistsMock.mockResolvedValue({ exists: true });
      getCollectionMock.mockResolvedValue(matchingCollectionInfo(1536));

      await expect(makeService().ensureCollection()).rejects.toThrow(/vector size=1536/);
    });
  });

  describe('indexChunks', () => {
    it('upserts one point per embedded chunk with verbatim text and full metadata as payload', async () => {
      collectionExistsMock.mockResolvedValue({ exists: true });
      getCollectionMock.mockResolvedValue(matchingCollectionInfo());
      upsertMock.mockResolvedValue({ status: 'completed' });

      const chunk = makeChunk('car-rental-policies-section-2', 'Accepted Payment Methods: ...verbatim text...');

      await makeService().indexChunks([makeEmbedded(chunk, [0.1, 0.2, 0.3])]);

      expect(upsertMock).toHaveBeenCalledTimes(1);
      const [collectionName, args] = upsertMock.mock.calls[0];
      expect(collectionName).toBe('car_rental_knowledge');
      expect(args.wait).toBe(true);
      expect(args.points).toEqual([
        {
          id: toQdrantPointId('car-rental-policies-section-2'),
          vector: [0.1, 0.2, 0.3],
          payload: {
            text: 'Accepted Payment Methods: ...verbatim text...',
            source: 'car-rental-policies.pdf',
            section: 'Payment & Security Deposit',
            documentTitle: 'Terms & Rental Policies',
            page: 1,
            chunkIndex: 0,
            chunkId: 'car-rental-policies-section-2',
          },
        },
      ]);
    });

    it('ensures the collection exists before upserting', async () => {
      collectionExistsMock.mockResolvedValue({ exists: false });
      createCollectionMock.mockResolvedValue(true);
      upsertMock.mockResolvedValue({ status: 'completed' });

      await makeService().indexChunks([makeEmbedded(makeChunk('a', 'text'))]);

      expect(createCollectionMock).toHaveBeenCalled();
      expect(upsertMock).toHaveBeenCalled();
    });

    it('does nothing for an empty list of embedded chunks', async () => {
      await makeService().indexChunks([]);

      expect(collectionExistsMock).not.toHaveBeenCalled();
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it('maps the same chunk id to the same point id across separate indexing runs', async () => {
      collectionExistsMock.mockResolvedValue({ exists: true });
      getCollectionMock.mockResolvedValue(matchingCollectionInfo());
      upsertMock.mockResolvedValue({ status: 'completed' });

      const chunk = makeChunk('car-rental-services-section-1', 'Daily & Short-Term Rentals content');
      const service = makeService();

      await service.indexChunks([makeEmbedded(chunk)]);
      await service.indexChunks([makeEmbedded(chunk)]);

      const firstId = upsertMock.mock.calls[0][1].points[0].id;
      const secondId = upsertMock.mock.calls[1][1].points[0].id;
      expect(firstId).toBe(secondId);
    });

    it('is idempotent at the application level: identical input produces identical points on every call', async () => {
      collectionExistsMock.mockResolvedValue({ exists: true });
      getCollectionMock.mockResolvedValue(matchingCollectionInfo(768, 8));
      upsertMock.mockResolvedValue({ status: 'completed' });

      const chunks = [makeEmbedded(makeChunk('a', 'one')), makeEmbedded(makeChunk('b', 'two'))];
      const service = makeService();

      await service.indexChunks(chunks);
      await service.indexChunks(chunks);

      expect(upsertMock).toHaveBeenCalledTimes(2);
      // Same ids + same payload + same vectors both times => a real Qdrant
      // server would upsert (replace) the same two points, not accumulate more.
      expect(upsertMock.mock.calls[0][1].points).toEqual(upsertMock.mock.calls[1][1].points);
    });
  });

  describe('search', () => {
    const samplePoint = {
      id: toQdrantPointId('car-rental-policies-section-2'),
      score: 0.87,
      payload: {
        text: 'Accepted Payment Methods: ...',
        source: 'car-rental-policies.pdf',
        section: 'Payment & Security Deposit',
        documentTitle: 'Terms & Rental Policies',
        page: 1,
        chunkIndex: 1,
        chunkId: 'car-rental-policies-section-2',
      },
    };

    it('queries with the given vector using cosine-compatible defaults', async () => {
      queryMock.mockResolvedValue({ points: [samplePoint] });

      await makeService().search([0.1, 0.2, 0.3]);

      expect(queryMock).toHaveBeenCalledWith('car_rental_knowledge', {
        query: [0.1, 0.2, 0.3],
        limit: 5,
        score_threshold: undefined,
        filter: undefined,
        with_payload: true,
        with_vector: false,
      });
    });

    it('respects a custom limit and score threshold', async () => {
      queryMock.mockResolvedValue({ points: [] });

      await makeService().search([0.1, 0.2, 0.3], { limit: 3, scoreThreshold: 0.75 });

      expect(queryMock).toHaveBeenCalledWith(
        'car_rental_knowledge',
        expect.objectContaining({ limit: 3, score_threshold: 0.75 }),
      );
    });

    it('translates a simple metadata filter into a Qdrant must-filter', async () => {
      queryMock.mockResolvedValue({ points: [] });

      await makeService().search([0.1, 0.2, 0.3], { filter: { source: 'car-rental-policies.pdf' } });

      expect(queryMock).toHaveBeenCalledWith(
        'car_rental_knowledge',
        expect.objectContaining({
          filter: { must: [{ key: 'source', match: { value: 'car-rental-policies.pdf' } }] },
        }),
      );
    });

    it('maps Qdrant scored points into score + payload results', async () => {
      queryMock.mockResolvedValue({ points: [samplePoint] });

      const results = await makeService().search([0.1, 0.2, 0.3]);

      expect(results).toEqual([{ score: 0.87, payload: samplePoint.payload }]);
    });

    it('returns an empty array when Qdrant finds no matching points', async () => {
      queryMock.mockResolvedValue({ points: [] });

      const results = await makeService().search([0.1, 0.2, 0.3]);

      expect(results).toEqual([]);
    });
  });

  describe('getCollectionInfo', () => {
    it('reports the live collection configuration and point count, without exposing raw vectors', async () => {
      getCollectionMock.mockResolvedValue(matchingCollectionInfo(768, 8));

      const info = await makeService().getCollectionInfo();

      expect(info).toEqual({ name: 'car_rental_knowledge', vectorSize: 768, distance: 'Cosine', pointsCount: 8 });
    });
  });

  describe('connection error handling', () => {
    function fetchFailedError(code = 'ECONNREFUSED'): TypeError {
      const error = new TypeError('fetch failed');
      (error as { cause?: unknown }).cause = Object.assign(new Error(code), { code });
      return error;
    }

    it('ensureCollection: turns a raw fetch failure into a message naming the Qdrant URL', async () => {
      collectionExistsMock.mockRejectedValue(fetchFailedError());

      await expect(makeService().ensureCollection()).rejects.toThrow(/Could not reach Qdrant at http:\/\/localhost:6333.*ECONNREFUSED/s);
    });

    it('indexChunks: turns a raw fetch failure from upsert into a clear message', async () => {
      collectionExistsMock.mockResolvedValue({ exists: true });
      getCollectionMock.mockResolvedValue(matchingCollectionInfo());
      upsertMock.mockRejectedValue(fetchFailedError());

      await expect(makeService().indexChunks([makeEmbedded(makeChunk('a', 'text'))])).rejects.toThrow(/Could not reach Qdrant/);
    });

    it('search: turns a raw fetch failure into a clear message', async () => {
      queryMock.mockRejectedValue(fetchFailedError());

      await expect(makeService().search([0.1, 0.2, 0.3])).rejects.toThrow(/Could not reach Qdrant/);
    });

    it('getCollectionInfo: turns a raw fetch failure into a clear message', async () => {
      getCollectionMock.mockRejectedValue(fetchFailedError());

      await expect(makeService().getCollectionInfo()).rejects.toThrow(/Could not reach Qdrant/);
    });

    it('does not mask non-connection errors, e.g. the collection-mismatch error', async () => {
      collectionExistsMock.mockResolvedValue({ exists: true });
      getCollectionMock.mockResolvedValue(matchingCollectionInfo(1536));

      await expect(makeService().ensureCollection()).rejects.toThrow(/vector size=1536/);
    });
  });
});
