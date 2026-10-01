/**
 * In-memory sliding-window rate limiter for the auth endpoints (todo 1.2
 * "rate limits"): login, refresh, forgot/reset. Global per-tenant API abuse
 * controls are Phase 11 — this only protects the credential surfaces. The
 * window store is per-process; multi-replica deployments will replace it
 * with Redis (dev runs single-process on native PG, no Redis).
 */
interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// Bounded store: drop stale buckets opportunistically.
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): RateLimitResult {
  const windowMs = windowSeconds * 1000;
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, b] of buckets) {
        if (b.hits.every((t) => now - t > windowMs)) buckets.delete(k);
        if (buckets.size < MAX_BUCKETS) break;
      }
    }
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0]!;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }
  bucket.hits.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimits(): void {
  buckets.clear();
}
