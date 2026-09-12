/**
 * Integration check (not part of `npm test`): requires a real Qdrant instance
 * (e.g. `docker compose up -d`) and a valid GEMINI_API_KEY. Indexes both PDFs
 * twice and confirms the collection's point count is identical afterwards —
 * i.e. re-indexing replaces existing points instead of accumulating duplicates.
 */
import { resolve } from 'node:path';
import { ChunkingService } from '../src/chunking/chunking.service.js';
import { EmbeddingService } from '../src/embedding/embedding.service.js';
import { GeminiEmbeddingProvider } from '../src/embedding/gemini-embedding.provider.js';
import { PdfExtractionService } from '../src/pdf-extraction/pdf-extraction.service.js';
import { QdrantKnowledgeStoreService } from '../src/qdrant/qdrant-knowledge-store.service.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file present — fall back to whatever is already in the environment.
}

const PDFS = ['car-rental-services.pdf', 'car-rental-policies.pdf'];

async function indexOnce(
  chunkingService: ChunkingService,
  embeddingService: EmbeddingService,
  knowledgeStore: QdrantKnowledgeStoreService,
): Promise<void> {
  for (const fileName of PDFS) {
    const filePath = resolve(import.meta.dirname, '..', fileName);
    const chunks = await chunkingService.chunkPdf(filePath);
    const embedded = await embeddingService.embedChunks(chunks);
    await knowledgeStore.indexChunks(embedded);
  }
}

async function main() {
  const chunkingService = new ChunkingService(new PdfExtractionService());
  const embeddingService = new EmbeddingService(new GeminiEmbeddingProvider());
  const knowledgeStore = new QdrantKnowledgeStoreService(embeddingService);

  console.log('Indexing (run 1)...');
  await indexOnce(chunkingService, embeddingService, knowledgeStore);
  const afterFirstRun = await knowledgeStore.getCollectionInfo();

  console.log('Indexing (run 2, same documents)...');
  await indexOnce(chunkingService, embeddingService, knowledgeStore);
  const afterSecondRun = await knowledgeStore.getCollectionInfo();

  console.log(`\nPoints after run 1: ${afterFirstRun.pointsCount}`);
  console.log(`Points after run 2: ${afterSecondRun.pointsCount}`);

  if (afterFirstRun.pointsCount !== afterSecondRun.pointsCount) {
    console.error('\nFAIL: point count changed after re-indexing the same documents — indexing is not idempotent.');
    process.exitCode = 1;
    return;
  }

  console.log('\nPASS: re-indexing the same documents did not change the point count.');
}

main().catch((error) => {
  console.error('Idempotency check failed:', error);
  process.exitCode = 1;
});
