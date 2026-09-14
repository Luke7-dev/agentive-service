import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { KNOWLEDGE_STORE } from './../src/qdrant/qdrant.constants.js';
import type { KnowledgeCollectionInfo } from './../src/qdrant/knowledge-store.interface.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  const fakeCollectionInfo: KnowledgeCollectionInfo = {
    name: 'car_rental_knowledge',
    vectorSize: 768,
    distance: 'Cosine',
    pointsCount: 8,
  };

  const fakeKnowledgeStore = {
    getCollectionInfo: async (): Promise<KnowledgeCollectionInfo> => fakeCollectionInfo,
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KNOWLEDGE_STORE)
      .useValue(fakeKnowledgeStore)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) returns 200 and { status: "ok" } when Qdrant is reachable', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  afterEach(async () => {
    await app.close();
  });
});
