import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { classifyGeminiError } from '../metrics/gemini-error-classifier.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { assertNonEmptyPrompt, type TextGenerationProvider } from './text-generation-provider.interface.js';

const DEFAULT_MODEL = 'gemini-3.6-flash';
const PROVIDER = 'gemini';

/**
 * TextGenerationProvider backed by Google's Gemini generative API. Reuses
 * the same GEMINI_API_KEY as GeminiEmbeddingProvider — no second credential
 * to configure.
 */
@Injectable()
export class GeminiTextGenerationProvider implements TextGenerationProvider {
  readonly model: string;

  private client: GoogleGenAI | null = null;

  constructor(private readonly metricsService: MetricsService) {
    this.model = process.env.GEMINI_GENERATION_MODEL?.trim() || DEFAULT_MODEL;
  }

  async generate(prompt: string): Promise<string> {
    assertNonEmptyPrompt(prompt);

    const start = process.hrtime.bigint();
    try {
      const response = await this.getClient().models.generateContent({
        model: this.model,
        contents: prompt,
      });

      const text = response.text;
      if (!text || text.trim().length === 0) {
        throw new Error('Gemini returned an empty response for the generation request.');
      }

      this.metricsService.recordGeminiGeneration({
        provider: PROVIDER,
        model: this.model,
        outcome: 'success',
        durationSeconds: this.elapsedSeconds(start),
      });
      return text;
    } catch (error) {
      // Recorded and rethrown unchanged — this provider never alters or
      // swallows the error; RagService's fallback behavior is untouched.
      this.metricsService.recordGeminiGeneration({
        provider: PROVIDER,
        model: this.model,
        outcome: 'failure',
        durationSeconds: this.elapsedSeconds(start),
        errorType: classifyGeminiError(error),
      });
      throw error;
    }
  }

  private elapsedSeconds(start: bigint): number {
    return Number(process.hrtime.bigint() - start) / 1e9;
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
