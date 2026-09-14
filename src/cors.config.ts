const DEFAULT_ORIGIN = 'http://localhost:8000';

/** Splits a comma-separated origin list, trims whitespace, and drops empty entries. */
function parseOriginList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Resolves the list of origins allowed to call this API via CORS.
 *
 * Precedence: FRONTEND_URLS (comma-separated allowlist, preferred) >
 * FRONTEND_URL (single-origin, kept for backward compatibility) > a
 * localhost default for local development. Matching is always exact-origin
 * (no wildcards, no subdomain/protocol equivalence) — the resulting array is
 * passed straight to the `cors` package, which allow-lists by exact string
 * match.
 */
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromList = parseOriginList(env.FRONTEND_URLS);
  if (fromList.length > 0) {
    return fromList;
  }

  const fromSingle = parseOriginList(env.FRONTEND_URL);
  if (fromSingle.length > 0) {
    return fromSingle;
  }

  return [DEFAULT_ORIGIN];
}
