import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allows the local Next.js dev server (different port) to call this API.
  app.enableCors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:8000' });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
