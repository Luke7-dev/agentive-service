import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module.js';
import { ChatsController } from './chats.controller.js';

@Module({
  imports: [RagModule],
  controllers: [ChatsController],
})
export class ChatsModule {}
