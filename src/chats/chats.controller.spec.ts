import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { RagAnswer } from '../rag/rag.interface.js';
import type { RagService } from '../rag/rag.service.js';
import { ChatsController } from './chats.controller.js';

class FakeRagService {
  questions: string[] = [];
  response: RagAnswer = {
    answer: 'The security deposit is 5,000 THB.',
    sources: [{ source: 'car-rental-policies.pdf', section: 'Payment & Security Deposit' }],
  };
  error: Error | null = null;

  async answer(question: string): Promise<RagAnswer> {
    this.questions.push(question);
    if (this.error) {
      throw this.error;
    }
    return this.response;
  }
}

function makeController(ragService: FakeRagService = new FakeRagService()) {
  return { controller: new ChatsController(ragService as unknown as RagService), ragService };
}

describe('ChatsController', () => {
  it('calls RagService with the message and returns its answer', async () => {
    const { controller, ragService } = makeController();

    const result = await controller.create({ message: 'How much is the security deposit?' });

    expect(ragService.questions).toEqual(['How much is the security deposit?']);
    expect(result).toEqual(ragService.response);
  });

  it('rejects a missing message', async () => {
    const { controller } = makeController();

    await expect(controller.create({})).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-string message', async () => {
    const { controller } = makeController();

    await expect(controller.create({ message: 42 })).rejects.toThrow(BadRequestException);
  });

  it('rejects an empty message', async () => {
    const { controller } = makeController();

    await expect(controller.create({ message: '' })).rejects.toThrow(BadRequestException);
  });

  it('rejects a whitespace-only message', async () => {
    const { controller } = makeController();

    await expect(controller.create({ message: '   ' })).rejects.toThrow(BadRequestException);
  });

  it('does not call RagService when validation fails', async () => {
    const { controller, ragService } = makeController();

    await expect(controller.create({ message: '   ' })).rejects.toThrow(BadRequestException);

    expect(ragService.questions).toEqual([]);
  });

  it('propagates a RagService error instead of swallowing it', async () => {
    const ragService = new FakeRagService();
    ragService.error = new Error('Gemini is unavailable');
    const { controller } = makeController(ragService);

    await expect(controller.create({ message: 'How much is the security deposit?' })).rejects.toThrow(
      'Gemini is unavailable',
    );
  });
});
