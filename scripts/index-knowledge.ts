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

async function main() {
  const chunkingService = new ChunkingService(new PdfExtractionService());
  const embeddingService = new EmbeddingService(new GeminiEmbeddingProvider());
  const knowledgeStore = new QdrantKnowledgeStoreService(embeddingService);

  let totalIndexed = 0;

  for (const fileName of PDFS) {
    const filePath = resolve(import.meta.dirname, '..', fileName);
    console.log(`\nProcessing ${fileName}...`);

    const chunks = await chunkingService.chunkPdf(filePath);
    console.log(`  extracted + chunked -> ${chunks.length} chunk(s)`);

    const embedded = await embeddingService.embedChunks(chunks);
    console.log(`  embedded -> ${embedded.length} vector(s)`);

    await knowledgeStore.indexChunks(embedded);
    console.log(`  indexed into Qdrant`);
    totalIndexed += embedded.length;
  }

  const info = await knowledgeStore.getCollectionInfo();

  console.log('\n================ Qdrant collection summary ================');
  console.log(`Collection:     ${info.name}`);
  console.log(`Vector size:    ${info.vectorSize}`);
  console.log(`Distance:       ${info.distance}`);
  console.log(`Indexed chunks: ${totalIndexed} (this run)`);
  console.log(`Points in collection: ${info.pointsCount}`);
}

main().catch((error) => {
  console.error('Knowledge indexing failed:', error);
  process.exitCode = 1;
});
