import { describe, expect, it } from 'vitest';
import type { KnowledgeChunk } from '../chunking/knowledge-chunk.interface.js';
import { assertEmbeddableTexts, type EmbeddingProvider, type EmbeddingTask } from './embedding-provider.interface.js';
import { EmbeddingService } from './embedding.service.js';

/**
 * Deterministic, network-free stand-in for a real EmbeddingProvider. Lets the
 * service's behaviour (batching, validation, chunk pairing) be tested without
 * depending on a live embedding API.
 */
class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 8;
  public calls: string[][] = [];
  public taskCalls: EmbeddingTask[] = [];

  async embedText(text: string, task: EmbeddingTask): Promise<number[]> {
    const [vector] = await this.embedTexts([text], task);
    return vector;
  }

  async embedTexts(texts: string[], task: EmbeddingTask): Promise<number[][]> {
    assertEmbeddableTexts(texts);
    this.calls.push(texts);
    this.taskCalls.push(task);
    return texts.map((text) => this.hashToVector(text));
  }

  private hashToVector(text: string): number[] {
    const vector = Array.from<number>({ length: this.dimensions }).fill(0);
    for (let i = 0; i < text.length; i++) {
      vector[i % this.dimensions] += text.charCodeAt(i);
    }
    return vector;
  }
}

function makeChunk(id: string, text: string): KnowledgeChunk {
  return { id, text, metadata: { source: 'test.pdf', chunkIndex: 0 } };
}

describe('EmbeddingService', () => {
  it('embeds a non-empty text into a vector of numbers', async () => {
    const service = new EmbeddingService(new FakeEmbeddingProvider());

    const vector = await service.embedText('Minimum age is 21 years old.', 'query');

    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBe(8);
    for (const value of vector) {
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('embedTexts returns the same number of vectors as input texts', async () => {
    const service = new EmbeddingService(new FakeEmbeddingProvider());
    const texts = ['first chunk', 'second chunk', 'third chunk'];

    const vectors = await service.embedTexts(texts, 'document');

    expect(vectors).toHaveLength(texts.length);
  });

  it('produces vectors with a consistent dimension across different inputs', async () => {
    const service = new EmbeddingService(new FakeEmbeddingProvider());

    const vectors = await service.embedTexts(['short', 'a much longer piece of chunk text than the first one'], 'document');

    const [firstLength, ...rest] = vectors.map((v) => v.length);
    expect(rest.every((length) => length === firstLength)).toBe(true);
  });

  it('passes the requested task straight through to the provider', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new EmbeddingService(provider);

    await service.embedText('a query', 'query');
    await service.embedTexts(['a document'], 'document');

    expect(provider.taskCalls).toEqual(['query', 'document']);
  });

  it('always embeds chunks with the "document" task, regardless of content', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new EmbeddingService(provider);

    await service.embedChunks([makeChunk('a', 'one'), makeChunk('b', 'two')]);

    expect(provider.taskCalls).toEqual(['document']);
  });

  it('embedChunks pairs each vector with its originating chunk, preserving order', async () => {
    const service = new EmbeddingService(new FakeEmbeddingProvider());
    const chunks = [makeChunk('a', 'Payment methods include credit card.'), makeChunk('b', 'Security deposit is refundable.')];

    const embedded = await service.embedChunks(chunks);

    expect(embedded).toHaveLength(2);
    expect(embedded[0].chunk).toBe(chunks[0]);
    expect(embedded[1].chunk).toBe(chunks[1]);
    expect(embedded[0].vector).toHaveLength(8);
    expect(embedded[1].vector).toHaveLength(8);
  });

  it('embeds all chunk texts in a single batched provider call', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new EmbeddingService(provider);
    const chunks = [makeChunk('a', 'one'), makeChunk('b', 'two'), makeChunk('c', 'three')];

    await service.embedChunks(chunks);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual(['one', 'two', 'three']);
  });

  it('returns an empty array for an empty chunk list without calling the provider', async () => {
    const provider = new FakeEmbeddingProvider();
    const service = new EmbeddingService(provider);

    const embedded = await service.embedChunks([]);

    expect(embedded).toEqual([]);
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects empty text', async () => {
    const service = new EmbeddingService(new FakeEmbeddingProvider());
    await expect(service.embedText('', 'query')).rejects.toThrow();
  });

  it('rejects whitespace-only text', async () => {
    const service = new EmbeddingService(new FakeEmbeddingProvider());
    await expect(service.embedText('   \n\t ', 'query')).rejects.toThrow();
  });

  it('rejects an empty texts array', async () => {
    const service = new EmbeddingService(new FakeEmbeddingProvider());
    await expect(service.embedTexts([], 'document')).rejects.toThrow();
  });

  it('rejects a texts array containing any empty/invalid entry', async () => {
    const service = new EmbeddingService(new FakeEmbeddingProvider());
    await expect(service.embedTexts(['valid text', '   '], 'document')).rejects.toThrow();
  });
});
