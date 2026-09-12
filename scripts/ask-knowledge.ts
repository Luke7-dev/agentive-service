import { EmbeddingService } from '../src/embedding/embedding.service.js';
import { GeminiEmbeddingProvider } from '../src/embedding/gemini-embedding.provider.js';
import { GeminiTextGenerationProvider } from '../src/rag/gemini-text-generation.provider.js';
import { RagService } from '../src/rag/rag.service.js';
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

  return { question: positional[0], flags };
}

async function main() {
  const { question, flags } = parseArgs(process.argv.slice(2));

  if (!question || question.trim().length === 0) {
    console.error('Usage: npm run ask:knowledge -- "your question" [--limit=3]');
    process.exitCode = 1;
    return;
  }

  const limit = flags.limit ? Number(flags.limit) : undefined;

  const embeddingService = new EmbeddingService(new GeminiEmbeddingProvider());
  const knowledgeStore = new QdrantKnowledgeStoreService(embeddingService);
  const retrievalService = new RetrievalService(embeddingService, knowledgeStore);
  const ragService = new RagService(retrievalService, new GeminiTextGenerationProvider());

  const result = await ragService.answer(question, { limit });

  console.log('Question:');
  console.log(question);

  console.log('\nAnswer:');
  console.log(result.answer);

  if (result.sources.length > 0) {
    console.log('\nSources:');
    for (const source of result.sources) {
      console.log(`- ${source.source}${source.section ? ` — ${source.section}` : ''}`);
    }
  }
}

main().catch((error) => {
  console.error('RAG answer generation failed:', error);
  process.exitCode = 1;
});
