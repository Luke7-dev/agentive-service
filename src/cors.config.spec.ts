import { describe, expect, it } from 'vitest';
import { resolveAllowedOrigins } from './cors.config.js';

function env(vars: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe('resolveAllowedOrigins', () => {
  it('allows https://owel.life when configured via FRONTEND_URLS', () => {
    const origins = resolveAllowedOrigins(env({ FRONTEND_URLS: 'https://owel.life,https://www.owel.life' }));

    expect(origins).toContain('https://owel.life');
  });

  it('allows https://www.owel.life when configured via FRONTEND_URLS', () => {
    const origins = resolveAllowedOrigins(env({ FRONTEND_URLS: 'https://owel.life,https://www.owel.life' }));

    expect(origins).toContain('https://www.owel.life');
  });

  it('does not allow an unrelated origin (https://evil.example.com)', () => {
    const origins = resolveAllowedOrigins(env({ FRONTEND_URLS: 'https://owel.life,https://www.owel.life' }));

    expect(origins).not.toContain('https://evil.example.com');
  });

  it('does not allow the same host over a different protocol (http://owel.life)', () => {
    const origins = resolveAllowedOrigins(env({ FRONTEND_URLS: 'https://owel.life,https://www.owel.life' }));

    expect(origins).not.toContain('http://owel.life');
  });

  it('does not allow a look-alike subdomain (https://owel.life.evil.example.com)', () => {
    const origins = resolveAllowedOrigins(env({ FRONTEND_URLS: 'https://owel.life,https://www.owel.life' }));

    expect(origins).not.toContain('https://owel.life.evil.example.com');
  });

  it('does not allow the bare www host over http (http://www.owel.life)', () => {
    const origins = resolveAllowedOrigins(env({ FRONTEND_URLS: 'https://owel.life,https://www.owel.life' }));

    expect(origins).not.toContain('http://www.owel.life');
  });

  it('trims whitespace around each configured origin', () => {
    const origins = resolveAllowedOrigins(env({ FRONTEND_URLS: '  https://owel.life ,  https://www.owel.life  ' }));

    expect(origins).toEqual(['https://owel.life', 'https://www.owel.life']);
  });

  it('ignores empty entries from stray/trailing commas', () => {
    const origins = resolveAllowedOrigins(env({ FRONTEND_URLS: 'https://owel.life,,https://www.owel.life,' }));

    expect(origins).toEqual(['https://owel.life', 'https://www.owel.life']);
  });

  it('falls back to the localhost development default when nothing is configured', () => {
    const origins = resolveAllowedOrigins(env({}));

    expect(origins).toEqual(['http://localhost:8000']);
  });

  it('never returns a wildcard origin', () => {
    const configured = resolveAllowedOrigins(env({ FRONTEND_URLS: 'https://owel.life,https://www.owel.life' }));
    const fallback = resolveAllowedOrigins(env({}));

    expect(configured).not.toContain('*');
    expect(fallback).not.toContain('*');
  });

  describe('backward compatibility with FRONTEND_URL', () => {
    it('falls back to FRONTEND_URL when FRONTEND_URLS is not set', () => {
      const origins = resolveAllowedOrigins(env({ FRONTEND_URL: 'https://owel.life' }));

      expect(origins).toEqual(['https://owel.life']);
    });

    it('prefers FRONTEND_URLS over FRONTEND_URL when both are set', () => {
      const origins = resolveAllowedOrigins(
        env({ FRONTEND_URLS: 'https://owel.life,https://www.owel.life', FRONTEND_URL: 'https://old-single-origin.example.com' }),
      );

      expect(origins).toEqual(['https://owel.life', 'https://www.owel.life']);
    });

    it('falls back to the localhost default when FRONTEND_URLS is only whitespace/empty entries', () => {
      const origins = resolveAllowedOrigins(env({ FRONTEND_URLS: ' , , ' }));

      expect(origins).toEqual(['http://localhost:8000']);
    });
  });
});
