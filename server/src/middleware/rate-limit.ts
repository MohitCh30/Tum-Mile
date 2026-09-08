/**
 * In-memory sliding-window rate limiter.
 * Uses a Map keyed by (action, identifier) → count at window start.
 *
 * Trade-off: in-memory state is lost on restart and doesn't work
 * across multiple server instances. Acceptable for MVP single-instance deploy.
 */

type BucketKey = string;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<BucketKey, Bucket>();

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export function rateLimit(
  config: RateLimitConfig
): (request: { ip?: string; user?: { id: string } }) => Promise<void> {
  return async (ctx: { ip?: string; user?: { id: string } }) => {
    const identifier = ctx.user?.id || ctx.ip || "unknown";
    const key = `${config.maxRequests}:${config.windowMs}:${identifier}`;
    const now = Date.now();

    const bucket = buckets.get(key);

    if (bucket && now - bucket.windowStart < config.windowMs) {
      if (bucket.count >= config.maxRequests) {
        throw new Error("RATE_LIMITED");
      }
      bucket.count++;
    } else {
      buckets.set(key, { count: 1, windowStart: now });
    }
  };
}

/**
 * Periodic cleanup of stale buckets to prevent memory leak.
 * Call on a timer (e.g., every 5 minutes).
 */
export function pruneStaleBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    const windowMs = extractWindowMs(key);
    if (now - bucket.windowStart > windowMs * 10) {
      buckets.delete(key);
    }
  }
}

function extractWindowMs(key: string): number {
  // key format: "maxRequests:windowMs:identifier"
  const parts = key.split(":");
  return parseInt(parts[1], 10) || 3_600_000;
}