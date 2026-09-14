import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { KNOWLEDGE_STORE } from '../qdrant/qdrant.constants.js';
import type { KnowledgeStore } from '../qdrant/knowledge-store.interface.js';

interface HealthStatus {
  status: 'ok' | 'error';
}

/**
 * Liveness/readiness check for Fly.io. Confirms the Nest process is up and
 * that Qdrant is reachable via a single read-only call — no Gemini call, no
 * embeddings, no RAG query, no Qdrant write. Kept separate from /chats so a
 * Gemini outage (already handled by RagService's own fallback) never
 * affects this endpoint's result.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(KNOWLEDGE_STORE) private readonly knowledgeStore: KnowledgeStore) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      // getCollectionInfo() is a plain read of the collection's config/point
      // count — no vectors touched, nothing written.
      await this.knowledgeStore.getCollectionInfo();
      return { status: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Health check failed: Qdrant is unreachable or misconfigured: ${message}`);
      // Fixed, generic body — never the raw error (which may name the
      // Qdrant URL) — kept out of the HTTP response.
      throw new ServiceUnavailableException({ status: 'error' } satisfies HealthStatus);
    }
  }
}
