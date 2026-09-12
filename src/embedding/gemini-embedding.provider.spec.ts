import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const embedContentMock = vi.fn();

vi.mock('@google/genai', () => {
  class FakeGoogleGenAI {
    models = { embedContent: embedContentMock };
  }
  return { GoogleGenAI: FakeGoogleGenAI };
});

const { GeminiEmbeddingProvider } = await import('./gemini-embedding.provider.js');

describe('GeminiEmbeddingProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    embedContentMock.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws a clear error when GEMINI_API_KEY is missing, without a network call', async () => {
    delete process.env.GEMINI_API_KEY;
    const provider = new GeminiEmbeddingProvider();

    await expect(provider.embedText('hello', 'query')).rejects.toThrow(/GEMINI_API_KEY/);
    expect(embedContentMock).not.toHaveBeenCalled();
  });

  it('rejects empty text before calling the API', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const provider = new GeminiEmbeddingProvider();

    await expect(provider.embedText('   ', 'query')).rejects.toThrow();
    expect(embedContentMock).not.toHaveBeenCalled();
  });

  it('maps the Gemini response into plain vectors, in order', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    embedContentMock.mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2, 0.3] }, { values: [0.4, 0.5, 0.6] }],
    });

    const provider = new GeminiEmbeddingProvider();
    const vectors = await provider.embedTexts(['first', 'second'], 'document');

    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(embedContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: provider.model,
        contents: ['first', 'second'],
        config: expect.objectContaining({ taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: provider.dimensions }),
      }),
    );
  });

  it('uses taskType RETRIEVAL_DOCUMENT when embedding with the "document" task', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    embedContentMock.mockResolvedValue({ embeddings: [{ values: [0.1, 0.2, 0.3] }] });

    const provider = new GeminiEmbeddingProvider();
    await provider.embedText('Payment methods include credit card.', 'document');

    expect(embedContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ taskType: 'RETRIEVAL_DOCUMENT' }) }),
    );
  });

  it('uses taskType RETRIEVAL_QUERY when embedding with the "query" task', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    embedContentMock.mockResolvedValue({ embeddings: [{ values: [0.1, 0.2, 0.3] }] });

    const provider = new GeminiEmbeddingProvider();
    await provider.embedText('How much is the security deposit?', 'query');

    expect(embedContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ taskType: 'RETRIEVAL_QUERY' }) }),
    );
  });

  it('still requests the configured output dimension for both task types', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.EMBEDDING_OUTPUT_DIMENSIONS = '768';
    embedContentMock.mockResolvedValue({ embeddings: [{ values: Array.from<number>({ length: 768 }).fill(0.01) }] });

    const provider = new GeminiEmbeddingProvider();
    await provider.embedText('a document chunk', 'document');
    await provider.embedText('a search query', 'query');

    for (const call of embedContentMock.mock.calls) {
      expect(call[0].config).toEqual(expect.objectContaining({ outputDimensionality: 768 }));
    }
  });

  it('uses GEMINI_EMBEDDING_MODEL and EMBEDDING_OUTPUT_DIMENSIONS overrides when set', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_EMBEDDING_MODEL = 'custom-model';
    process.env.EMBEDDING_OUTPUT_DIMENSIONS = '256';

    const provider = new GeminiEmbeddingProvider();

    expect(provider.model).toBe('custom-model');
    expect(provider.dimensions).toBe(256);
  });

  it('throws if Gemini returns a different number of embeddings than requested', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    embedContentMock.mockResolvedValue({ embeddings: [{ values: [0.1] }] });

    const provider = new GeminiEmbeddingProvider();
    await expect(provider.embedTexts(['a', 'b'], 'document')).rejects.toThrow(/embedding/i);
  });

  it('throws if Gemini returns an embedding with no values', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    embedContentMock.mockResolvedValue({ embeddings: [{}] });

    const provider = new GeminiEmbeddingProvider();
    await expect(provider.embedTexts(['a'], 'document')).rejects.toThrow(/vector values/i);
  });
});
