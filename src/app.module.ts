import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PdfExtractionModule } from './pdf-extraction/pdf-extraction.module.js';
import { ChunkingModule } from './chunking/chunking.module.js';
import { EmbeddingModule } from './embedding/embedding.module.js';
import { QdrantModule } from './qdrant/qdrant.module.js';
import { RetrievalModule } from './retrieval/retrieval.module.js';

@Module({
  imports: [PdfExtractionModule, ChunkingModule, EmbeddingModule, QdrantModule, RetrievalModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
