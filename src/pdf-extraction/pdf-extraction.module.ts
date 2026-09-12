import { Module } from '@nestjs/common';
import { PdfExtractionService } from './pdf-extraction.service.js';

@Module({
  providers: [PdfExtractionService],
  exports: [PdfExtractionService],
})
export class PdfExtractionModule {}
