import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PdfExtractionModule } from './pdf-extraction/pdf-extraction.module.js';
import { ChunkingModule } from './chunking/chunking.module.js';
import { EmbeddingModule } from './embedding/embedding.module.js';
import { QdrantModule } from './qdrant/qdrant.module.js';
import { RetrievalModule } from './retrieval/retrieval.module.js';
import { RagModule } from './rag/rag.module.js';
import { ChatsModule } from './chats/chats.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { HttpMetricsInterceptor } from './metrics/http-metrics.interceptor.js';

@Module({
  imports: [
    MetricsModule,
    PdfExtractionModule,
    ChunkingModule,
    EmbeddingModule,
    QdrantModule,
    RetrievalModule,
    RagModule,
    ChatsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }],
})
export class AppModule {}
