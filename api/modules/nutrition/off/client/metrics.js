export function emitMetric(name, labels = {}) {
  console.log(`[METRIC] ${name}`, labels);
}
