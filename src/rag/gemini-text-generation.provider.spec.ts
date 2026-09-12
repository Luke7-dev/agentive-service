import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContentMock = vi.fn();

vi.mock('@google/genai', () => {
  class FakeGoogleGenAI {
    models = { generateContent: generateContentMock };
  }
  return { GoogleGenAI: FakeGoogleGenAI };
});

const { GeminiTextGenerationProvider } = await import('./gemini-text-generation.provider.js');

describe('GeminiTextGenerationProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    generateContentMock.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws a clear error when GEMINI_API_KEY is missing, without a network call', async () => {
    delete process.env.GEMINI_API_KEY;
    const provider = new GeminiTextGenerationProvider();

    await expect(provider.generate('hello')).rejects.toThrow(/GEMINI_API_KEY/);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('rejects an empty prompt before calling the API', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const provider = new GeminiTextGenerationProvider();

    await expect(provider.generate('   ')).rejects.toThrow();
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('returns the generated text from Gemini', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentMock.mockResolvedValue({ text: 'The security deposit is 5,000 THB.' });

    const provider = new GeminiTextGenerationProvider();
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

    const provider = new GeminiTextGenerationProvider();

    expect(provider.model).toBe('custom-model');
  });

  it('throws if Gemini returns an empty response', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentMock.mockResolvedValue({ text: '' });

    const provider = new GeminiTextGenerationProvider();
    await expect(provider.generate('a prompt')).rejects.toThrow(/empty response/i);
  });

  it('throws if Gemini returns no text field at all', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentMock.mockResolvedValue({});

    const provider = new GeminiTextGenerationProvider();
    await expect(provider.generate('a prompt')).rejects.toThrow(/empty response/i);
  });
});
