/**
 * Retrieval quality check (not part of `npm test`): requires a running Qdrant
 * with the knowledge base already indexed (`npm run index:knowledge`) and a
 * valid GEMINI_API_KEY. Runs the representative test questions from Step 2,
 * prints the top 3 results for each, and reports whether the expected
 * section ranked #1 — instead of just asserting Qdrant returned *something*.
 */
import { EmbeddingService } from '../src/embedding/embedding.service.js';
import { GeminiEmbeddingProvider } from '../src/embedding/gemini-embedding.provider.js';
import { QdrantKnowledgeStoreService } from '../src/qdrant/qdrant-knowledge-store.service.js';
import { RetrievalService } from '../src/retrieval/retrieval.service.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file present — fall back to whatever is already in the environment.
}

const CASES: Array<{ query: string; expectedSection: string }> = [
  { query: 'How much is the security deposit?', expectedSection: 'Payment & Security Deposit' },
  { query: 'Can a 20 year old rent a car?', expectedSection: 'Driver Eligibility & Required Documents' },
  { query: 'What services do you offer at the airport?', expectedSection: 'Special Mobility Services' },
  { query: 'Can I cancel my booking and get a refund?', expectedSection: 'Cancellation & Modification Policy' },
  { query: 'Can I bring my pet in the rental car?', expectedSection: 'Vehicle Use Rules & Conditions' },
  { query: 'What payment methods do you accept?', expectedSection: 'Payment & Security Deposit' },
];

async function main() {
  const embeddingService = new EmbeddingService(new GeminiEmbeddingProvider());
  const knowledgeStore = new QdrantKnowledgeStoreService(embeddingService);
  const retrievalService = new RetrievalService(embeddingService, knowledgeStore);

  let passCount = 0;

  for (const [index, testCase] of CASES.entries()) {
    const results = await retrievalService.search(testCase.query, { limit: 3 });
    const topSection = results[0]?.chunk.metadata.section;
    const passed = topSection === testCase.expectedSection;
    passCount += passed ? 1 : 0;

    console.log(`\n==================== Question ${index + 1} ====================`);
    console.log(`QUERY:            ${testCase.query}`);
    console.log(`EXPECTED SECTION: ${testCase.expectedSection}`);

    results.forEach((result, resultIndex) => {
      console.log(`\n  RESULT ${resultIndex + 1}`);
      console.log(`  Score:   ${result.score.toFixed(4)}`);
      console.log(`  Source:  ${result.chunk.metadata.source}`);
      console.log(`  Section: ${result.chunk.metadata.section ?? '(none)'}`);
    });

    console.log(`\n${passed ? 'PASS' : 'FAIL'}: expected section ${passed ? 'ranked #1' : `did NOT rank #1 (got "${topSection ?? '(none)'}")`}`);
  }

  console.log(`\n==================== Summary ====================`);
  console.log(`${passCount} / ${CASES.length} expected sections ranked #1`);

  if (passCount !== CASES.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Retrieval evaluation failed:', error);
  process.exitCode = 1;
});
