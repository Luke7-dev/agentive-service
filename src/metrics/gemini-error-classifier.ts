/**
 * Low-cardinality classification of a Gemini API failure, suitable for use
 * as a metric label. Never derived from the raw error message/text — only a
 * fixed, small set of outcomes, so this can never explode metric cardinality.
 */
export type GeminiErrorType = 'quota' | 'server' | 'network' | 'timeout' | 'unknown';

interface StatusLike {
  status?: unknown;
}

interface CauseLike {
  cause?: { code?: unknown };
}

/**
 * Classifies a Gemini generation error into one of a fixed set of buckets.
 *
 * `@google/genai`'s `ApiError` carries an HTTP `status` (e.g. 429 for the
 * real `RESOURCE_EXHAUSTED` quota failure this project has observed); other
 * failures are plain `Error`s (e.g. Node's `TypeError: fetch failed` for
 * network issues). This never inspects or returns the raw error message —
 * only the fixed buckets below.
 */
export function classifyGeminiError(error: unknown): GeminiErrorType {
  const status = (error as StatusLike)?.status;

  if (status === 429) {
    return 'quota';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'server';
  }

  if (error instanceof Error) {
    const code = (error as CauseLike).cause?.code;

    if (error.name === 'AbortError' || code === 'ETIMEDOUT' || code === 'ETIME') {
      return 'timeout';
    }

    if (error.message === 'fetch failed' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
      return 'network';
    }
  }

  return 'unknown';
}
