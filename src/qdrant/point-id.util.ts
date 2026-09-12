import { v5 as uuidv5 } from 'uuid';

// Arbitrary, fixed namespace (random UUID generated once) used to deterministically
// derive Qdrant point IDs from our own KnowledgeChunk.id strings. Qdrant only accepts
// unsigned integers or UUID strings as point IDs, so our human-readable chunk ids
// (e.g. "car-rental-policies-section-2") can't be used directly. Reusing the same
// namespace + input always yields the same UUID, so re-indexing the same chunk
// updates the same point instead of creating a duplicate.
const POINT_ID_NAMESPACE = '2f6b1e2a-7c34-4c3d-9d0a-8e6f7a2b9c11';

/** Deterministically maps a KnowledgeChunk.id to a Qdrant-compatible UUID point id. */
export function toQdrantPointId(chunkId: string): string {
  return uuidv5(chunkId, POINT_ID_NAMESPACE);
}
