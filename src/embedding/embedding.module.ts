import { Module } from '@nestjs/common';
import { EMBEDDING_PROVIDER } from './embedding.constants.js';
import { EmbeddingService } from './embedding.service.js';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider.js';

@Module({
  providers: [{ provide: EMBEDDING_PROVIDER, useClass: GeminiEmbeddingProvider }, EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
