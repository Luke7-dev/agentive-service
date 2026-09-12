import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { QdrantModule } from '../qdrant/qdrant.module.js';
import { RetrievalService } from './retrieval.service.js';

@Module({
  imports: [EmbeddingModule, QdrantModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
