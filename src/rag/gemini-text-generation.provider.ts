import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { assertNonEmptyPrompt, type TextGenerationProvider } from './text-generation-provider.interface.js';

const DEFAULT_MODEL = 'gemini-3.6-flash';

/**
 * TextGenerationProvider backed by Google's Gemini generative API. Reuses
 * the same GEMINI_API_KEY as GeminiEmbeddingProvider — no second credential
 * to configure.
 */
@Injectable()
export class GeminiTextGenerationProvider implements TextGenerationProvider {
  readonly model: string;

  private client: GoogleGenAI | null = null;

  constructor() {
    this.model = process.env.GEMINI_GENERATION_MODEL?.trim() || DEFAULT_MODEL;
  }

  async generate(prompt: string): Promise<string> {
    assertNonEmptyPrompt(prompt);

    const response = await this.getClient().models.generateContent({
      model: this.model,
      contents: prompt,
    });

    const text = response.text;
    if (!text || text.trim().length === 0) {
      throw new Error('Gemini returned an empty response for the generation request.');
    }

    return text;
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
