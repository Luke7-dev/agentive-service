import { describe, expect, it } from 'vitest';
import { toQdrantPointId } from './point-id.util.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('toQdrantPointId', () => {
  it('returns a valid UUID string', () => {
    const id = toQdrantPointId('car-rental-policies-section-1');
    expect(id).toMatch(UUID_RE);
  });

  it('is deterministic: the same chunk id always maps to the same point id', () => {
    const first = toQdrantPointId('car-rental-services-section-2');
    const second = toQdrantPointId('car-rental-services-section-2');
    expect(first).toBe(second);
  });

  it('maps different chunk ids to different point ids', () => {
    const a = toQdrantPointId('car-rental-policies-section-1');
    const b = toQdrantPointId('car-rental-policies-section-2');
    expect(a).not.toBe(b);
  });
});
