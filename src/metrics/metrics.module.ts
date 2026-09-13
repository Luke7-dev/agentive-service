import { Global, Module } from '@nestjs/common';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { METER_PROVIDER, PROMETHEUS_EXPORTER } from './metrics.constants.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

/**
 * Observability infrastructure, isolated from business logic. Wires a
 * PrometheusExporter (never started as its own server — `preventServerStart`
 * — its request handler is instead exposed at GET /metrics by
 * MetricsController, on the same NestJS port) as an OpenTelemetry
 * MetricReader, and a MeterProvider built on top of it.
 *
 * @Global so any service (RagService, RetrievalService,
 * GeminiTextGenerationProvider, the HTTP interceptor) can inject
 * MetricsService without every feature module needing to import this one.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    {
      provide: PROMETHEUS_EXPORTER,
      useFactory: (): PrometheusExporter => new PrometheusExporter({ preventServerStart: true }),
    },
    {
      provide: METER_PROVIDER,
      useFactory: (exporter: PrometheusExporter): MeterProvider => new MeterProvider({ readers: [exporter] }),
      inject: [PROMETHEUS_EXPORTER],
    },
    MetricsService,
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
