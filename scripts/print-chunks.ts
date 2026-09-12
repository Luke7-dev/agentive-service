import { resolve } from 'node:path';
import { ChunkingService } from '../src/chunking/chunking.service.js';
import { PdfExtractionService } from '../src/pdf-extraction/pdf-extraction.service.js';

const PDFS = ['car-rental-services.pdf', 'car-rental-policies.pdf'];

async function main() {
  const chunkingService = new ChunkingService(new PdfExtractionService());

  for (const fileName of PDFS) {
    const filePath = resolve(import.meta.dirname, '..', fileName);
    const chunks = await chunkingService.chunkPdf(filePath);
    console.log(`\n\n################ ${fileName} — ${chunks.length} chunk(s) ################`);

    for (const chunk of chunks) {
      console.log('\n----------------------------------------');
      console.log(`SOURCE:    ${chunk.metadata.source}`);
      console.log(`SECTION:   ${chunk.metadata.section ?? '(none)'}`);
      console.log(`CHUNK ID:  ${chunk.id}`);
      console.log(`TEXT:\n${chunk.text}`);
    }
  }
}

main().catch((error) => {
  console.error('Chunking demo failed:', error);
  process.exitCode = 1;
});
