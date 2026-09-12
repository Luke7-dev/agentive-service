import { EmbeddingService } from '../src/embedding/embedding.service.js';
import { GeminiEmbeddingProvider } from '../src/embedding/gemini-embedding.provider.js';
import { QdrantKnowledgeStoreService } from '../src/qdrant/qdrant-knowledge-store.service.js';
import { RetrievalService } from '../src/retrieval/retrieval.service.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file present — fall back to whatever is already in the environment.
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (const arg of argv) {
    const flagMatch = arg.match(/^--([^=]+)=(.*)$/);
    if (flagMatch) {
      flags[flagMatch[1]] = flagMatch[2];
    } else {
      positional.push(arg);
    }
  }

  return { query: positional[0], flags };
}

async function main() {
  const { query, flags } = parseArgs(process.argv.slice(2));

  if (!query || query.trim().length === 0) {
    console.error('Usage: npm run search:knowledge -- "your question" [--limit=3] [--source=car-rental-policies.pdf]');
    process.exitCode = 1;
    return;
  }

  const limit = flags.limit ? Number(flags.limit) : 3;
  const source = flags.source;

  const embeddingService = new EmbeddingService(new GeminiEmbeddingProvider());
  const knowledgeStore = new QdrantKnowledgeStoreService(embeddingService);
  const retrievalService = new RetrievalService(embeddingService, knowledgeStore);

  const results = await retrievalService.search(query, {
    limit,
    filter: source ? { source } : undefined,
  });

  console.log('QUERY:');
  console.log(query);

  if (results.length === 0) {
    console.log('\nNo results found.');
    return;
  }

  results.forEach((result, index) => {
    console.log(`\nRESULT ${index + 1}`);
    console.log(`Score: ${result.score.toFixed(4)}`);
    console.log(`Source: ${result.chunk.metadata.source}`);
    console.log(`Section: ${result.chunk.metadata.section ?? '(none)'}`);
    console.log('Text:');
    console.log(result.chunk.text);
  });
}

main().catch((error) => {
  console.error('Knowledge search failed:', error);
  process.exitCode = 1;
});
