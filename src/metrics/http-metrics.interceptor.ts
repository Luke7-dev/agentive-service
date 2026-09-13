import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { MetricsService } from './metrics.service.js';

/**
 * Records http_requests_total / http_request_duration_seconds for every
 * HTTP request, with no changes to any controller. Registered globally
 * (APP_INTERCEPTOR in AppModule) so it wraps the existing API surface
 * instead of being coupled into ChatsController or any business logic.
 *
 * Listens for the response's `finish` event rather than reading
 * `response.statusCode` from an RxJS tap/catchError callback: NestJS's
 * exception filters (which set the final status code for thrown errors,
 * e.g. BadRequestException) run *after* interceptors, so status_code would
 * be wrong on error paths otherwise. `finish` fires once the response is
 * fully sent, on both success and error paths, with the true status code.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = request.method;
    const route = request.route?.path ?? request.path ?? request.url;
    const start = process.hrtime.bigint();

    response.once('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metricsService.recordHttpRequest({
        method,
        route,
        statusCode: response.statusCode,
        durationSeconds,
      });
    });

    return next.handle();
  }
}
