import { describe, expect, it } from 'vitest';
import { classifyGeminiError } from './gemini-error-classifier.js';

function apiError(status: number, message = 'API error'): Error {
  return Object.assign(new Error(message), { status });
}

function networkError(code: string): Error {
  const error = new TypeError('fetch failed');
  (error as { cause?: unknown }).cause = Object.assign(new Error(code), { code });
  return error;
}

describe('classifyGeminiError', () => {
  it('classifies a 429 status as quota', () => {
    // The real, observed failure: 429 RESOURCE_EXHAUSTED for generate_content_free_tier_requests.
    expect(classifyGeminiError(apiError(429, 'RESOURCE_EXHAUSTED'))).toBe('quota');
  });

  it('classifies a 5xx status as server', () => {
    expect(classifyGeminiError(apiError(500))).toBe('server');
    expect(classifyGeminiError(apiError(503))).toBe('server');
  });

  it('classifies other 4xx statuses as unknown, not quota or server', () => {
    expect(classifyGeminiError(apiError(400))).toBe('unknown');
    expect(classifyGeminiError(apiError(404))).toBe('unknown');
  });

  it('classifies a fetch-failed / ECONNREFUSED error as network', () => {
    expect(classifyGeminiError(networkError('ECONNREFUSED'))).toBe('network');
  });

  it('classifies ENOTFOUND and ECONNRESET as network', () => {
    expect(classifyGeminiError(networkError('ENOTFOUND'))).toBe('network');
    expect(classifyGeminiError(networkError('ECONNRESET'))).toBe('network');
  });

  it('classifies an AbortError as timeout', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    expect(classifyGeminiError(error)).toBe('timeout');
  });

  it('classifies an ETIMEDOUT cause as timeout', () => {
    const error = new Error('request failed');
    (error as { cause?: unknown }).cause = { code: 'ETIMEDOUT' };
    expect(classifyGeminiError(error)).toBe('timeout');
  });

  it('classifies a plain Error with no recognizable shape as unknown', () => {
    expect(classifyGeminiError(new Error('something went wrong'))).toBe('unknown');
  });

  it('classifies a non-Error thrown value as unknown', () => {
    expect(classifyGeminiError('a string error')).toBe('unknown');
    expect(classifyGeminiError(undefined)).toBe('unknown');
  });

  it('never returns the raw error message as the classification', () => {
    const result = classifyGeminiError(apiError(429, 'a very specific customer-identifying message'));
    expect(['quota', 'server', 'network', 'timeout', 'unknown']).toContain(result);
  });
});
