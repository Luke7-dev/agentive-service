import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { RagAnswer } from '../rag/rag.interface.js';
import { RagService } from '../rag/rag.service.js';
import { parseCreateChatDto } from './dto/create-chat.dto.js';

/**
 * Thin HTTP entry point for the existing RAG pipeline: validates the
 * request, delegates to RagService, and returns its result as-is. No
 * conversation state, no agent logic — a single stateless question-answer
 * call per request.
 */
@Controller('chats')
export class ChatsController {
  constructor(private readonly ragService: RagService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(@Body() body: unknown): Promise<RagAnswer> {
    const { message } = parseCreateChatDto(body);
    return this.ragService.answer(message);
  }
}
