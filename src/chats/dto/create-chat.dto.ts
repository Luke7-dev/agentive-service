import { BadRequestException } from '@nestjs/common';

/** Request body for POST /chats. */
export interface CreateChatDto {
  message: string;
}

/**
 * Validates a raw request body against the POST /chats contract and returns
 * only the fields that contract defines — any other fields the client sent
 * are ignored rather than accepted.
 */
export function parseCreateChatDto(body: unknown): CreateChatDto {
  const message = (body as Record<string, unknown> | null | undefined)?.message;

  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new BadRequestException('message is required and must be a non-empty string.');
  }

  return { message };
}
