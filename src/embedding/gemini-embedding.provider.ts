import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { assertEmbeddableTexts, type EmbeddingProvider, type EmbeddingTask } from './embedding-provider.interface.js';

const DEFAULT_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMENSIONS = 768;
// The Gemini embedContent endpoint accepts at most 100 texts per request.
const MAX_BATCH_SIZE = 100;

// Gemini produces measurably better retrieval ranking when documents and
// search queries are embedded with their matching task type, even though
// both stay 768-dimensional and directly comparable via cosine similarity.
const GEMINI_TASK_TYPE: Record<EmbeddingTask, string> = {
  document: 'RETRIEVAL_DOCUMENT',
  query: 'RETRIEVAL_QUERY',
};

/**
 * EmbeddingProvider backed by Google's Gemini embedding API. Chosen so the
 * knowledge-base embeddings share a provider with the Gemini-based agent
 * planned for a later step, avoiding a second API/credential to manage.
 */
@Injectable()
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  private client: GoogleGenAI | null = null;

  constructor() {
    this.model = process.env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL;
    const configuredDimensions = Number(process.env.EMBEDDING_OUTPUT_DIMENSIONS);
    this.dimensions = Number.isFinite(configuredDimensions) && configuredDimensions > 0 ? configuredDimensions : DEFAULT_DIMENSIONS;
  }

  async embedText(text: string, task: EmbeddingTask): Promise<number[]> {
    const [vector] = await this.embedTexts([text], task);
    return vector;
  }

  async embedTexts(texts: string[], task: EmbeddingTask): Promise<number[][]> {
    assertEmbeddableTexts(texts);

    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += MAX_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + MAX_BATCH_SIZE);
      vectors.push(...(await this.embedBatch(batch, task)));
    }

    return vectors;
  }

  private async embedBatch(batch: string[], task: EmbeddingTask): Promise<number[][]> {
    const response = await this.getClient().models.embedContent({
      model: this.model,
      contents: batch,
      config: {
        taskType: GEMINI_TASK_TYPE[task],
        outputDimensionality: this.dimensions,
      },
    });

    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Gemini returned ${embeddings.length} embedding(s) for a batch of ${batch.length} text(s).`);
    }

    return embeddings.map((embedding, index) => {
      if (!embedding.values) {
        throw new Error(`Gemini returned no vector values for text at batch index ${index}.`);
      }
      return embedding.values;
    });
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not set. Add it to your .env file (see .env.example).');
      }
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }
}
