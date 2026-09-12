import { Module } from '@nestjs/common';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { GeminiTextGenerationProvider } from './gemini-text-generation.provider.js';
import { TEXT_GENERATION_PROVIDER } from './rag.constants.js';
import { RagService } from './rag.service.js';

@Module({
  imports: [RetrievalModule],
  providers: [{ provide: TEXT_GENERATION_PROVIDER, useClass: GeminiTextGenerationProvider }, RagService],
  exports: [RagService],
})
export class RagModule {}
