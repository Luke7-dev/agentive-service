import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import type { MetricData, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetricsService } from './metrics.service.js';

/**
 * These tests exercise the real OpenTelemetry MeterProvider + PrometheusExporter
 * (no live HTTP server — `preventServerStart: true`, and we read the collected
 * state directly via `exporter.collect()`), so they verify the actual metrics
 * wiring works, not just that MetricsService's methods can be called.
 */
describe('MetricsService', () => {
  let exporter: PrometheusExporter;
  let meterProvider: MeterProvider;
  let service: MetricsService;

  beforeEach(() => {
    exporter = new PrometheusExporter({ preventServerStart: true });
    meterProvider = new MeterProvider({ readers: [exporter] });
    service = new MetricsService(meterProvider);
  });

  afterEach(async () => {
    await meterProvider.shutdown();
  });

  async function collect(): Promise<ResourceMetrics> {
    const { resourceMetrics } = await exporter.collect();
    return resourceMetrics;
  }

  function findMetric(resourceMetrics: ResourceMetrics, name: string): MetricData {
    for (const scope of resourceMetrics.scopeMetrics) {
      const metric = scope.metrics.find((m) => m.descriptor.name === name);
      if (metric) {
        return metric;
      }
    }
    throw new Error(`Metric "${name}" was not collected. Did the recording method actually run?`);
  }

  it('records an HTTP request as a counter increment and a duration observation', async () => {
    service.recordHttpRequest({ method: 'POST', route: '/chats', statusCode: 200, durationSeconds: 0.42 });

    const metrics = await collect();

    const counter = findMetric(metrics, 'http_requests_total');
    expect(counter.dataPoints).toHaveLength(1);
    expect(counter.dataPoints[0].value).toBe(1);
    expect(counter.dataPoints[0].attributes).toEqual({ method: 'POST', route: '/chats', status_code: '200' });

    const duration = findMetric(metrics, 'http_request_duration_seconds');
    expect(duration.dataPoints[0].value).toMatchObject({ count: 1, sum: 0.42 });
  });

  it('records a RAG request', async () => {
    service.recordRagRequest();
    service.recordRagRequest();

    const metrics = await collect();

    const counter = findMetric(metrics, 'rag_requests_total');
    expect(counter.dataPoints[0].value).toBe(2);
  });

  it('records retrieval duration and result count, without marking it empty', async () => {
    service.recordRetrieval({ durationSeconds: 0.05, resultCount: 3 });

    const metrics = await collect();

    const duration = findMetric(metrics, 'rag_retrieval_duration_seconds');
    expect(duration.dataPoints[0].value).toMatchObject({ count: 1, sum: 0.05 });

    const results = findMetric(metrics, 'rag_retrieval_results');
    expect(results.dataPoints[0].value).toMatchObject({ count: 1, sum: 3 });

    expect(() => findMetric(metrics, 'rag_retrieval_empty_total')).toThrow();
  });

  it('increments rag_retrieval_empty_total when a retrieval returns zero chunks', async () => {
    service.recordRetrieval({ durationSeconds: 0.02, resultCount: 0 });

    const metrics = await collect();

    const empty = findMetric(metrics, 'rag_retrieval_empty_total');
    expect(empty.dataPoints[0].value).toBe(1);
  });

  it('increments rag_fallback_total on fallback', async () => {
    service.recordFallback();

    const metrics = await collect();

    const fallback = findMetric(metrics, 'rag_fallback_total');
    expect(fallback.dataPoints[0].value).toBe(1);
  });

  it('records a successful Gemini generation: requests + success, not failure', async () => {
    service.recordGeminiGeneration({ provider: 'gemini', model: 'gemini-3.6-flash', outcome: 'success', durationSeconds: 1.2 });

    const metrics = await collect();

    expect(findMetric(metrics, 'gemini_generation_requests_total').dataPoints[0].value).toBe(1);
    expect(findMetric(metrics, 'gemini_generation_success_total').dataPoints[0].value).toBe(1);
    expect(() => findMetric(metrics, 'gemini_generation_failure_total')).toThrow();
    expect(() => findMetric(metrics, 'gemini_generation_429_total')).toThrow();

    const duration = findMetric(metrics, 'gemini_generation_duration_seconds');
    expect(duration.dataPoints[0].attributes).toMatchObject({ provider: 'gemini', model: 'gemini-3.6-flash', outcome: 'success' });
  });

  it('records a quota (429) Gemini failure: failure + the dedicated 429 counter both increment', async () => {
    service.recordGeminiGeneration({
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      outcome: 'failure',
      durationSeconds: 0.3,
      errorType: 'quota',
    });

    const metrics = await collect();

    expect(findMetric(metrics, 'gemini_generation_requests_total').dataPoints[0].value).toBe(1);
    expect(() => findMetric(metrics, 'gemini_generation_success_total')).toThrow();

    const failure = findMetric(metrics, 'gemini_generation_failure_total');
    expect(failure.dataPoints[0].value).toBe(1);
    expect(failure.dataPoints[0].attributes).toMatchObject({ error_type: 'quota' });

    const quota = findMetric(metrics, 'gemini_generation_429_total');
    expect(quota.dataPoints[0].value).toBe(1);
  });

  it('records a non-quota Gemini failure without incrementing the 429 counter', async () => {
    service.recordGeminiGeneration({
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      outcome: 'failure',
      durationSeconds: 0.1,
      errorType: 'network',
    });

    const metrics = await collect();

    const failure = findMetric(metrics, 'gemini_generation_failure_total');
    expect(failure.dataPoints[0].attributes).toMatchObject({ error_type: 'network' });
    expect(() => findMetric(metrics, 'gemini_generation_429_total')).toThrow();
  });

  it('defaults a failure with no errorType to "unknown"', async () => {
    service.recordGeminiGeneration({ provider: 'gemini', model: 'gemini-3.6-flash', outcome: 'failure', durationSeconds: 0.1 });

    const metrics = await collect();

    const failure = findMetric(metrics, 'gemini_generation_failure_total');
    expect(failure.dataPoints[0].attributes).toMatchObject({ error_type: 'unknown' });
  });
});
