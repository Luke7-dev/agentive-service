import { Inject, Injectable } from '@nestjs/common';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import type { MeterProvider } from '@opentelemetry/sdk-metrics';
import { METER_PROVIDER } from './metrics.constants.js';
import type { GeminiErrorType } from './gemini-error-classifier.js';

const METER_NAME = 'agentive-service';

export type GeminiOutcome = 'success' | 'failure';

/**
 * The only place in the codebase that knows about OpenTelemetry/Prometheus
 * instrument names, units, and label shapes. Business services (RagService,
 * RetrievalService, GeminiTextGenerationProvider, the HTTP interceptor) call
 * these small, semantic methods instead — they have no idea a metrics
 * backend exists, let alone which one.
 *
 * Every label here is a small, fixed set of values (method/route/status
 * code, provider/model, outcome, a 5-value error_type). Never a user
 * question, raw error message, or request id — see gemini-error-classifier.ts.
 */
@Injectable()
export class MetricsService {
  private readonly meter: Meter;

  private readonly httpRequestsTotal: Counter;
  private readonly httpRequestDuration: Histogram;

  private readonly ragRequestsTotal: Counter;
  private readonly ragRetrievalDuration: Histogram;
  private readonly ragRetrievalResults: Histogram;
  private readonly ragRetrievalEmptyTotal: Counter;
  private readonly ragFallbackTotal: Counter;

  private readonly geminiGenerationRequestsTotal: Counter;
  private readonly geminiGenerationSuccessTotal: Counter;
  private readonly geminiGenerationFailureTotal: Counter;
  private readonly geminiGeneration429Total: Counter;
  private readonly geminiGenerationDuration: Histogram;

  constructor(@Inject(METER_PROVIDER) meterProvider: MeterProvider) {
    this.meter = meterProvider.getMeter(METER_NAME);

    this.httpRequestsTotal = this.meter.createCounter('http_requests_total', {
      description: 'Total number of HTTP requests received.',
    });
    this.httpRequestDuration = this.meter.createHistogram('http_request_duration_seconds', {
      description: 'HTTP request duration in seconds.',
      unit: 's',
      advice: { explicitBucketBoundaries: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] },
    });

    this.ragRequestsTotal = this.meter.createCounter('rag_requests_total', {
      description: 'Total number of RAG answer requests handled by RagService.',
    });
    this.ragRetrievalDuration = this.meter.createHistogram('rag_retrieval_duration_seconds', {
      description: 'Duration of the Qdrant knowledge retrieval step in seconds.',
      unit: 's',
      advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2] },
    });
    this.ragRetrievalResults = this.meter.createHistogram('rag_retrieval_results', {
      description: 'Number of knowledge chunks returned per retrieval.',
      advice: { explicitBucketBoundaries: [0, 1, 2, 3, 4, 5, 10] },
    });
    this.ragRetrievalEmptyTotal = this.meter.createCounter('rag_retrieval_empty_total', {
      description: 'Total number of retrievals that returned zero knowledge chunks.',
    });
    this.ragFallbackTotal = this.meter.createCounter('rag_fallback_total', {
      description: 'Total number of RAG answers served as the retrieval-only fallback because Gemini generation failed.',
    });

    this.geminiGenerationRequestsTotal = this.meter.createCounter('gemini_generation_requests_total', {
      description: 'Total number of Gemini text-generation requests attempted.',
    });
    this.geminiGenerationSuccessTotal = this.meter.createCounter('gemini_generation_success_total', {
      description: 'Total number of successful Gemini text-generation requests.',
    });
    this.geminiGenerationFailureTotal = this.meter.createCounter('gemini_generation_failure_total', {
      description: 'Total number of failed Gemini text-generation requests.',
    });
    this.geminiGeneration429Total = this.meter.createCounter('gemini_generation_429_total', {
      description: 'Total number of Gemini text-generation requests that failed due to rate limiting/quota exhaustion (HTTP 429).',
    });
    this.geminiGenerationDuration = this.meter.createHistogram('gemini_generation_duration_seconds', {
      description: 'Duration of Gemini text-generation requests in seconds.',
      unit: 's',
      advice: { explicitBucketBoundaries: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30] },
    });
  }

  recordHttpRequest(params: { method: string; route: string; statusCode: number; durationSeconds: number }): void {
    const attributes = { method: params.method, route: params.route, status_code: String(params.statusCode) };
    this.httpRequestsTotal.add(1, attributes);
    this.httpRequestDuration.record(params.durationSeconds, attributes);
  }

  recordRagRequest(): void {
    this.ragRequestsTotal.add(1);
  }

  recordRetrieval(params: { durationSeconds: number; resultCount: number }): void {
    this.ragRetrievalDuration.record(params.durationSeconds);
    this.ragRetrievalResults.record(params.resultCount);
    if (params.resultCount === 0) {
      this.ragRetrievalEmptyTotal.add(1);
    }
  }

  recordFallback(): void {
    this.ragFallbackTotal.add(1);
  }

  recordGeminiGeneration(params: {
    provider: string;
    model: string;
    outcome: GeminiOutcome;
    durationSeconds: number;
    errorType?: GeminiErrorType;
  }): void {
    const baseAttributes = { provider: params.provider, model: params.model };
    this.geminiGenerationRequestsTotal.add(1, baseAttributes);
    this.geminiGenerationDuration.record(params.durationSeconds, { ...baseAttributes, outcome: params.outcome });

    if (params.outcome === 'success') {
      this.geminiGenerationSuccessTotal.add(1, baseAttributes);
      return;
    }

    const errorType = params.errorType ?? 'unknown';
    this.geminiGenerationFailureTotal.add(1, { ...baseAttributes, error_type: errorType });
    if (errorType === 'quota') {
      this.geminiGeneration429Total.add(1, baseAttributes);
    }
  }
}
