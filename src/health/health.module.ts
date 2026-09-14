import { Module } from '@nestjs/common';
import { QdrantModule } from '../qdrant/qdrant.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [QdrantModule],
  controllers: [HealthController],
})
export class HealthModule {}
