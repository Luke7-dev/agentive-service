import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { HttpMetricsInterceptor } from './http-metrics.interceptor.js';
import type { MetricsService } from './metrics.service.js';

class FakeMetricsService {
  calls: Array<{ method: string; route: string; statusCode: number; durationSeconds: number }> = [];

  recordHttpRequest(params: { method: string; route: string; statusCode: number; durationSeconds: number }): void {
    this.calls.push(params);
  }
}

interface FakeResponse {
  statusCode: number;
  once(event: 'finish', callback: () => void): void;
  emitFinish(): void;
}

function makeFakeResponse(statusCode: number): FakeResponse {
  let finishListener: (() => void) | undefined;
  return {
    statusCode,
    once(event, callback) {
      if (event === 'finish') {
        finishListener = callback;
      }
    },
    emitFinish() {
      finishListener?.();
    },
  };
}

function makeContext(params: { method: string; routePath?: string; path?: string; statusCode: number }) {
  const response = makeFakeResponse(params.statusCode);
  const request = {
    method: params.method,
    route: params.routePath ? { path: params.routePath } : undefined,
    path: params.path,
    url: params.path ?? params.routePath ?? '/',
  };

  const context = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, response };
}

const passthroughHandler: CallHandler = { handle: () => of('ok') };

describe('HttpMetricsInterceptor', () => {
  it('records method, route, status code, and duration once the response finishes', () => {
    const metrics = new FakeMetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics as unknown as MetricsService);
    const { context, response } = makeContext({ method: 'POST', routePath: '/chats', statusCode: 200 });

    interceptor.intercept(context, passthroughHandler).subscribe();
    response.emitFinish();

    expect(metrics.calls).toHaveLength(1);
    expect(metrics.calls[0]).toMatchObject({ method: 'POST', route: '/chats', statusCode: 200 });
    expect(metrics.calls[0].durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('falls back to request.path when no route was matched', () => {
    const metrics = new FakeMetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics as unknown as MetricsService);
    const { context, response } = makeContext({ method: 'GET', path: '/unknown', statusCode: 404 });

    interceptor.intercept(context, passthroughHandler).subscribe();
    response.emitFinish();

    expect(metrics.calls[0].route).toBe('/unknown');
  });

  it('records the true status code for an error response (e.g. 400 from a BadRequestException)', () => {
    const metrics = new FakeMetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics as unknown as MetricsService);
    const { context, response } = makeContext({ method: 'POST', routePath: '/chats', statusCode: 400 });

    interceptor.intercept(context, passthroughHandler).subscribe();
    response.emitFinish();

    expect(metrics.calls[0].statusCode).toBe(400);
  });

  it('does not record anything until the response actually finishes', () => {
    const metrics = new FakeMetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics as unknown as MetricsService);
    const { context } = makeContext({ method: 'GET', routePath: '/', statusCode: 200 });

    interceptor.intercept(context, passthroughHandler).subscribe();

    expect(metrics.calls).toHaveLength(0);
  });

  it('ignores non-HTTP execution contexts (e.g. RPC) without recording anything', () => {
    const metrics = new FakeMetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics as unknown as MetricsService);
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;

    interceptor.intercept(context, passthroughHandler).subscribe();

    expect(metrics.calls).toHaveLength(0);
  });
});
