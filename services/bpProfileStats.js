'use strict';

function summarizeLatency(values) {
  if (!Array.isArray(values) || !values.length ||
      values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
    throw new Error('Latency samples must be a nonempty array of finite, nonnegative milliseconds.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return {
    count: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: rank(0.50), p95: rank(0.95), min: sorted[0], max: sorted[sorted.length - 1],
    percentileMethod: 'nearest_rank',
  };
}

module.exports = { summarizeLatency };
