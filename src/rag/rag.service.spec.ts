import { describe, expect, it } from 'vitest';
import type { MetricsService } from '../metrics/metrics.service.js';
import type { RetrievedKnowledgeChunk, SearchOptions } from '../retrieval/retrieval.interface.js';
import type { RetrievalService } from '../retrieval/retrieval.service.js';
import { RagService } from './rag.service.js';
import type { TextGenerationProvider } from './text-generation-provider.interface.js';

class FakeMetricsService {
  ragRequestCount = 0;
  fallbackCount = 0;

  recordRagRequest(): void {
    this.ragRequestCount++;
  }

  recordFallback(): void {
    this.fallbackCount++;
  }
}

class FakeRetrievalService {
  searchCalls: Array<{ query: string; options?: SearchOptions }> = [];
  results: RetrievedKnowledgeChunk[] = [];

  async search(query: string, options?: SearchOptions): Promise<RetrievedKnowledgeChunk[]> {
    this.searchCalls.push({ query, options });
    return this.results;
  }
}

class FakeTextGenerationProvider implements TextGenerationProvider {
  prompts: string[] = [];
  response = 'A generated answer.';
  error: Error | null = null;

  async generate(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    if (this.error) {
      throw this.error;
    }
    return this.response;
  }
}

function makeChunk(
  overrides: Partial<RetrievedKnowledgeChunk['chunk']['metadata']> = {},
  text = 'Some chunk text.',
  score = 0.9,
): RetrievedKnowledgeChunk {
  return {
    score,
    chunk: {
      id: 'car-rental-policies-section-2',
      text,
      metadata: {
        source: 'car-rental-policies.pdf',
        section: 'Payment & Security Deposit',
        documentTitle: 'Terms & Rental Policies',
        page: 1,
        chunkIndex: 1,
        ...overrides,
      },
    },
  };
}

function makeService(retrieval: FakeRetrievalService, generation: FakeTextGenerationProvider = new FakeTextGenerationProvider()) {
  const metrics = new FakeMetricsService();
  return {
    service: new RagService(retrieval as unknown as RetrievalService, generation, metrics as unknown as MetricsService),
    retrieval,
    generation,
    metrics,
  };
}

describe('RagService', () => {
  it('A: retrieves relevant chunks, sends the question + retrieved context to the generation provider, and returns the answer', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [makeChunk({}, 'A refundable deposit of 5,000 THB is required.')];
    const { service, generation } = makeService(retrieval);

    const result = await service.answer('How much is the security deposit?');

    expect(result.answer).toBe('A generated answer.');
    expect(retrieval.searchCalls[0].query).toBe('How much is the security deposit?');
    expect(generation.prompts).toHaveLength(1);

    const prompt = generation.prompts[0];
    expect(prompt).toContain('How much is the security deposit?');
    expect(prompt).toContain('A refundable deposit of 5,000 THB is required.');
    expect(prompt).toContain('car-rental-policies.pdf');
    expect(prompt).toContain('Payment & Security Deposit');
    // Structure required by the RAG prompt spec: clear separation of sections.
    expect(prompt).toContain('SYSTEM / INSTRUCTIONS:');
    expect(prompt).toContain('KNOWLEDGE CONTEXT:');
    expect(prompt).toContain('USER QUESTION:');
  });

  it('uses a small top-K default (3) when the caller does not specify a limit', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [makeChunk()];
    const { service } = makeService(retrieval);

    await service.answer('How much is the security deposit?');

    expect(retrieval.searchCalls[0].options?.limit).toBe(3);
  });

  it('passes a custom limit/scoreThreshold/filter through to retrieval', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [makeChunk()];
    const { service } = makeService(retrieval);

    await service.answer('How much is the security deposit?', {
      limit: 5,
      scoreThreshold: 0.7,
      filter: { source: 'car-rental-policies.pdf' },
    });

    expect(retrieval.searchCalls[0].options).toEqual({
      limit: 5,
      scoreThreshold: 0.7,
      filter: { source: 'car-rental-policies.pdf' },
    });
  });

  it('B: includes multiple retrieved chunks in the generated context, each labeled with its own source', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [
      makeChunk({ section: 'Payment & Security Deposit' }, 'Deposit is 5,000 THB.'),
      makeChunk(
        {
          source: 'car-rental-services.pdf',
          section: 'Special Mobility Services',
          documentTitle: 'Services Breakdown & Offerings',
        },
        'Airport pickup is available.',
      ),
    ];
    const { service, generation } = makeService(retrieval);

    await service.answer('Tell me about deposits and airport pickup.');

    const prompt = generation.prompts[0];
    expect(prompt).toContain('Deposit is 5,000 THB.');
    expect(prompt).toContain('Airport pickup is available.');
    expect(prompt).toContain('car-rental-policies.pdf');
    expect(prompt).toContain('car-rental-services.pdf');
    expect(prompt).toContain('Payment & Security Deposit');
    expect(prompt).toContain('Special Mobility Services');
  });

  it('returns minimal, de-duplicated sources derived from the retrieved chunks', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [
      makeChunk({ section: 'Payment & Security Deposit' }, 'text one'),
      makeChunk({ section: 'Payment & Security Deposit' }, 'text two'), // duplicate source+section
      makeChunk({ source: 'car-rental-services.pdf', section: 'Special Mobility Services' }, 'text three'),
    ];
    const { service } = makeService(retrieval);

    const result = await service.answer('deposit and airport pickup?');

    expect(result.sources).toEqual([
      { source: 'car-rental-policies.pdf', section: 'Payment & Security Deposit' },
      { source: 'car-rental-services.pdf', section: 'Special Mobility Services' },
    ]);
  });

  it('C: returns a fixed, deterministic answer without calling the generation provider when nothing is retrieved', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [];
    const { service, generation } = makeService(retrieval);

    const result = await service.answer('Do you rent spaceships?');

    expect(result.answer).toMatch(/don't have enough information/i);
    expect(result.sources).toEqual([]);
    expect(generation.prompts).toHaveLength(0);
  });

  it('D: falls back to the retrieved chunks (does not throw) when generation fails', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [makeChunk({}, 'A refundable deposit of 5,000 THB is required.')];
    const generation = new FakeTextGenerationProvider();
    generation.error = new Error('Gemini is unavailable');
    const { service } = makeService(retrieval, generation);

    const result = await service.answer('How much is the security deposit?');

    expect(result.answer).toContain('A refundable deposit of 5,000 THB is required.');
    expect(result.answer).toContain('Payment & Security Deposit');
  });

  it('D: still returns the normal sources when falling back after a generation failure', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [makeChunk({ section: 'Payment & Security Deposit' })];
    const generation = new FakeTextGenerationProvider();
    generation.error = new Error('Gemini is unavailable');
    const { service } = makeService(retrieval, generation);

    const result = await service.answer('How much is the security deposit?');

    expect(result.sources).toEqual([{ source: 'car-rental-policies.pdf', section: 'Payment & Security Deposit' }]);
  });

  it('D: fallback lists every retrieved chunk, each labeled, when there are multiple', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [
      makeChunk({ section: 'Payment & Security Deposit' }, 'Deposit is 5,000 THB.'),
      makeChunk(
        { source: 'car-rental-services.pdf', section: 'Special Mobility Services' },
        'Airport pickup is available.',
      ),
    ];
    const generation = new FakeTextGenerationProvider();
    generation.error = new Error('503 Service Unavailable');
    const { service } = makeService(retrieval, generation);

    const result = await service.answer('Tell me about deposits and airport pickup.');

    expect(result.answer).toContain('[1] Payment & Security Deposit');
    expect(result.answer).toContain('Deposit is 5,000 THB.');
    expect(result.answer).toContain('[2] Special Mobility Services');
    expect(result.answer).toContain('Airport pickup is available.');
  });

  it('D: does not call generate() again or throw for a non-Error rejection', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [makeChunk({}, 'A refundable deposit of 5,000 THB is required.')];
    class RejectsNonError implements TextGenerationProvider {
      async generate(): Promise<string> {
        return Promise.reject('quota exceeded');
      }
    }
    const metrics = new FakeMetricsService();
    const service = new RagService(
      retrieval as unknown as RetrievalService,
      new RejectsNonError(),
      metrics as unknown as MetricsService,
    );

    const result = await service.answer('How much is the security deposit?');

    expect(result.answer).toContain('A refundable deposit of 5,000 THB is required.');
  });

  it('propagates retrieval errors (e.g. invalid query) unchanged, consistent with RetrievalService', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.search = async () => {
      throw new Error('Cannot search with empty or invalid query text.');
    };
    const { service } = makeService(retrieval);

    await expect(service.answer('')).rejects.toThrow(/empty or invalid query/);
  });

  it('records a RAG request for every call to answer(), regardless of outcome', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [makeChunk()];
    const { service, metrics } = makeService(retrieval);

    await service.answer('How much is the security deposit?');

    expect(metrics.ragRequestCount).toBe(1);
    expect(metrics.fallbackCount).toBe(0);
  });

  it('records a RAG request but no fallback for the empty-retrieval "not enough information" path', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [];
    const { service, metrics } = makeService(retrieval);

    await service.answer('Do you rent spaceships?');

    expect(metrics.ragRequestCount).toBe(1);
    expect(metrics.fallbackCount).toBe(0);
  });

  it('records a fallback when generation fails', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [makeChunk()];
    const generation = new FakeTextGenerationProvider();
    generation.error = new Error('Gemini is unavailable');
    const { service, metrics } = makeService(retrieval, generation);

    await service.answer('How much is the security deposit?');

    expect(metrics.ragRequestCount).toBe(1);
    expect(metrics.fallbackCount).toBe(1);
  });

  it('does not record a fallback when generation succeeds', async () => {
    const retrieval = new FakeRetrievalService();
    retrieval.results = [makeChunk()];
    const { service, metrics } = makeService(retrieval);

    await service.answer('How much is the security deposit?');

    expect(metrics.fallbackCount).toBe(0);
  });
});
