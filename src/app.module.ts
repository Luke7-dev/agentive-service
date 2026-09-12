import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PdfExtractionModule } from './pdf-extraction/pdf-extraction.module.js';
import { ChunkingModule } from './chunking/chunking.module.js';
import { EmbeddingModule } from './embedding/embedding.module.js';
import { QdrantModule } from './qdrant/qdrant.module.js';
import { RetrievalModule } from './retrieval/retrieval.module.js';
import { RagModule } from './rag/rag.module.js';
import { ChatsModule } from './chats/chats.module.js';

@Module({
  imports: [PdfExtractionModule, ChunkingModule, EmbeddingModule, QdrantModule, RetrievalModule, RagModule, ChatsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
