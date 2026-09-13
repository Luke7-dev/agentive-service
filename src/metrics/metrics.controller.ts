import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import type { Request, Response } from 'express';
import { PROMETHEUS_EXPORTER } from './metrics.constants.js';

/**
 * Exposes the current OpenTelemetry metric state in Prometheus text format,
 * on this same NestJS process/port, so Prometheus can scrape it with an
 * ordinary HTTP job — no separate exporter port to run or configure.
 */
@Controller()
export class MetricsController {
  constructor(@Inject(PROMETHEUS_EXPORTER) private readonly exporter: PrometheusExporter) {}

  @Get('metrics')
  getMetrics(@Req() request: Request, @Res() response: Response): void {
    this.exporter.getMetricsRequestHandler(request, response);
  }
}
