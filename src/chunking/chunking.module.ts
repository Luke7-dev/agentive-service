import { Module } from '@nestjs/common';
import { PdfExtractionModule } from '../pdf-extraction/pdf-extraction.module.js';
import { ChunkingService } from './chunking.service.js';

@Module({
  imports: [PdfExtractionModule],
  providers: [ChunkingService],
  exports: [ChunkingService],
})
export class ChunkingModule {}
