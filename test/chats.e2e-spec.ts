import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { RagService } from './../src/rag/rag.service.js';
import type { RagAnswer } from './../src/rag/rag.interface.js';

describe('ChatsController (e2e)', () => {
  let app: INestApplication<App>;

  const fakeRagService = {
    answer: async (question: string): Promise<RagAnswer> => ({
      answer: `Answer to: ${question}`,
      sources: [{ source: 'car-rental-policies.pdf', section: 'Payment & Security Deposit' }],
    }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue(fakeRagService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/chats (POST) returns an answer for a valid message', () => {
    return request(app.getHttpServer())
      .post('/chats')
      .send({ message: 'How much is the security deposit?' })
      .expect(200)
      .expect((res) => {
        expect(res.body.answer).toBe('Answer to: How much is the security deposit?');
        expect(res.body.sources).toEqual([
          { source: 'car-rental-policies.pdf', section: 'Payment & Security Deposit' },
        ]);
      });
  });

  it('/chats (POST) rejects a missing message', () => {
    return request(app.getHttpServer()).post('/chats').send({}).expect(400);
  });

  it('/chats (POST) rejects an empty message', () => {
    return request(app.getHttpServer()).post('/chats').send({ message: '' }).expect(400);
  });

  it('/chats (POST) rejects a whitespace-only message', () => {
    return request(app.getHttpServer()).post('/chats').send({ message: '   ' }).expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
