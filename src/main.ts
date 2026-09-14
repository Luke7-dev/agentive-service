import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { resolveAllowedOrigins } from './cors.config.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file present — fall back to whatever is already in the environment.
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allows the configured frontend origin(s) — e.g. the local Next.js dev
  // server, or the production domain(s) — to call this API.
  app.enableCors({ origin: resolveAllowedOrigins() });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
