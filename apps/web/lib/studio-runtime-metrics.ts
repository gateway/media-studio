"use client";

type MetricEntry = {
  count: number;
  lastAt: number;
};

type MetricStore = Record<string, MetricEntry>;

declare global {
  interface Window {
    __mediaStudioRuntimeMetrics?: MetricStore;
  }
}

function runtimeMetricStore(): MetricStore | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!window.__mediaStudioRuntimeMetrics) {
    window.__mediaStudioRuntimeMetrics = {};
  }
  return window.__mediaStudioRuntimeMetrics;
}

export function recordStudioRuntimeMetric(metricKey: string) {
  const store = runtimeMetricStore();
  if (!store) {
    return;
  }
  const current = store[metricKey];
  store[metricKey] = {
    count: (current?.count ?? 0) + 1,
    lastAt: Date.now(),
  };
}

export function resetStudioRuntimeMetricsForTests() {
  if (typeof window === "undefined") {
    return;
  }
  window.__mediaStudioRuntimeMetrics = {};
}

export function readStudioRuntimeMetrics() {
  return runtimeMetricStore() ?? {};
}
