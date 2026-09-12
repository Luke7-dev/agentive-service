import { resolve } from 'node:path';
import { ChunkingService } from '../src/chunking/chunking.service.js';
import { EmbeddingService } from '../src/embedding/embedding.service.js';
import { GeminiEmbeddingProvider } from '../src/embedding/gemini-embedding.provider.js';
import { PdfExtractionService } from '../src/pdf-extraction/pdf-extraction.service.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file present — fall back to whatever is already in the environment.
}

const PDFS = ['car-rental-services.pdf', 'car-rental-policies.pdf'];
const PREVIEW_VALUES = 8;

async function main() {
  const chunkingService = new ChunkingService(new PdfExtractionService());
  const embeddingService = new EmbeddingService(new GeminiEmbeddingProvider());

  for (const fileName of PDFS) {
    const filePath = resolve(import.meta.dirname, '..', fileName);
    const chunks = await chunkingService.chunkPdf(filePath);
    const embedded = await embeddingService.embedChunks(chunks);

    console.log(`\n################ ${fileName} — ${embedded.length} embedded chunk(s) ################`);

    for (const { chunk, vector } of embedded) {
      const preview = vector
        .slice(0, PREVIEW_VALUES)
        .map((value) => value.toFixed(6))
        .join(', ');

      console.log('\n----------------------------------------');
      console.log(`SOURCE:           ${chunk.metadata.source}`);
      console.log(`CHUNK ID:         ${chunk.id}`);
      console.log(`VECTOR DIMENSION: ${vector.length}`);
      console.log(`FIRST ${PREVIEW_VALUES} VALUES: [${preview}, ...]`);
    }
  }
}

main().catch((error) => {
  console.error('Embedding generation failed:', error);
  process.exitCode = 1;
});
