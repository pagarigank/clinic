/**
 * Observability skeleton (todo 0.5): Prometheus text exposition at /metrics,
 * tenant-labelled, never PHI (ground rule 5). Phase 1+ swaps in OpenTelemetry.
 */
const counters = new Map<string, number>();
const histograms = new Map<string, number[]>();

export function incCounter(name: string, labels: Record<string, string> = {}): void {
  const key = `${name}|${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(",")}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

export function observeDuration(name: string, seconds: number, labels: Record<string, string> = {}): void {
  const key = `${name}|${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(",")}`;
  const arr = histograms.get(key) ?? [];
  arr.push(seconds);
  histograms.set(key, arr);
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  for (const [key, value] of counters) {
    const [name, labels] = key.split("|");
    lines.push(`${name}{${labels}} ${value}`);
  }
  for (const [key, values] of histograms) {
    const [name, labels] = key.split("|");
    const sorted = [...values].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    lines.push(`${name}_p50{${labels}} ${p50}`);
    lines.push(`${name}_p95{${labels}} ${p95}`);
  }
  return `${lines.join("\n")}\n`;
}
