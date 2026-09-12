import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { KNOWLEDGE_STORE } from './qdrant.constants.js';
import { QdrantKnowledgeStoreService } from './qdrant-knowledge-store.service.js';

@Module({
  imports: [EmbeddingModule],
  providers: [{ provide: KNOWLEDGE_STORE, useClass: QdrantKnowledgeStoreService }],
  exports: [KNOWLEDGE_STORE],
})
export class QdrantModule {}
