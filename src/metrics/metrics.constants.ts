/** DI token for the shared OpenTelemetry MeterProvider. */
export const METER_PROVIDER = Symbol('METER_PROVIDER');

/** DI token for the shared PrometheusExporter (used by MetricsController to serve /metrics). */
export const PROMETHEUS_EXPORTER = Symbol('PROMETHEUS_EXPORTER');
