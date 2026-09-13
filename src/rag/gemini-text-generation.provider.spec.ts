import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricsService } from '../metrics/metrics.service.js';

const generateContentMock = vi.fn();

vi.mock('@google/genai', () => {
  class FakeGoogleGenAI {
    models = { generateContent: generateContentMock };
  }
  return { GoogleGenAI: FakeGoogleGenAI };
});

const { GeminiTextGenerationProvider } = await import('./gemini-text-generation.provider.js');

class FakeMetricsService {
  calls: Array<{ provider: string; model: string; outcome: string; durationSeconds: number; errorType?: string }> = [];

  recordGeminiGeneration(params: {
    provider: string;
    model: string;
    outcome: string;
    durationSeconds: number;
    errorType?: string;
  }): void {
    this.calls.push(params);
  }
}

describe('GeminiTextGenerationProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    generateContentMock.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function makeProvider() {
    const metrics = new FakeMetricsService();
    return { provider: new GeminiTextGenerationProvider(metrics as unknown as MetricsService), metrics };
  }

  it('throws a clear error when GEMINI_API_KEY is missing, without a network call', async () => {
    delete process.env.GEMINI_API_KEY;
    const { provider } = makeProvider();

    await expect(provider.generate('hello')).rejects.toThrow(/GEMINI_API_KEY/);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('rejects an empty prompt before calling the API', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const { provider } = makeProvider();

    await expect(provider.generate('   ')).rejects.toThrow();
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('returns the generated text from Gemini', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentMock.mockResolvedValue({ text: 'The security deposit is 5,000 THB.' });

    const { provider } = makeProvider();
    const answer = await provider.generate('USER QUESTION:\nHow much is the deposit?');

    expect(answer).toBe('The security deposit is 5,000 THB.');
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: provider.model,
        contents: expect.stringContaining('How much is the deposit?'),
      }),
    );
  });

  it('uses GEMINI_GENERATION_MODEL override when set', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_GENERATION_MODEL = 'custom-model';

    const { provider } = makeProvider();

    expect(provider.model).toBe('custom-model');
  });

  it('throws if Gemini returns an empty response', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentMock.mockResolvedValue({ text: '' });

    const { provider } = makeProvider();
    await expect(provider.generate('a prompt')).rejects.toThrow(/empty response/i);
  });

  it('throws if Gemini returns no text field at all', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentMock.mockResolvedValue({});

    const { provider } = makeProvider();
    await expect(provider.generate('a prompt')).rejects.toThrow(/empty response/i);
  });

  it('records a successful generation metric with provider/model and outcome=success', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentMock.mockResolvedValue({ text: 'answer' });

    const { provider, metrics } = makeProvider();
    await provider.generate('a prompt');

    expect(metrics.calls).toHaveLength(1);
    expect(metrics.calls[0]).toMatchObject({ provider: 'gemini', model: provider.model, outcome: 'success' });
    expect(metrics.calls[0].durationSeconds).toBeGreaterThanOrEqual(0);
    expect(metrics.calls[0].errorType).toBeUndefined();
  });

  it('records a failure metric classified as quota for a 429 error, and rethrows it unchanged', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const quotaError = Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });
    generateContentMock.mockRejectedValue(quotaError);

    const { provider, metrics } = makeProvider();

    await expect(provider.generate('a prompt')).rejects.toBe(quotaError);
    expect(metrics.calls).toHaveLength(1);
    expect(metrics.calls[0]).toMatchObject({ provider: 'gemini', outcome: 'failure', errorType: 'quota' });
  });

  it('records a failure metric classified as network for a fetch failure', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const networkError = new TypeError('fetch failed');
    (networkError as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    generateContentMock.mockRejectedValue(networkError);

    const { provider, metrics } = makeProvider();

    await expect(provider.generate('a prompt')).rejects.toThrow('fetch failed');
    expect(metrics.calls[0]).toMatchObject({ outcome: 'failure', errorType: 'network' });
  });

  it('records a failure metric for the "empty response" case (classified as unknown)', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentMock.mockResolvedValue({ text: '' });

    const { provider, metrics } = makeProvider();
    await expect(provider.generate('a prompt')).rejects.toThrow(/empty response/i);

    expect(metrics.calls[0]).toMatchObject({ outcome: 'failure', errorType: 'unknown' });
  });

  it('does not record a generation metric when the prompt is rejected before calling Gemini', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const { provider, metrics } = makeProvider();

    await expect(provider.generate('')).rejects.toThrow();
    expect(metrics.calls).toHaveLength(0);
  });
});
