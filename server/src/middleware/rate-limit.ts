import type { FastifyRequest } from "fastify";

/**
 * In-memory fixed-window limiter. State is lost on restart and does not
 * span instances — acceptable for a single-instance experiment, and the
 * one thing that must change before this is ever deployed twice.
 */
interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitConfig {
  /** Distinguishes limiters so two rules cannot share a bucket. */
  name: string;
  max: number;
  windowMs: number;
}

/**
 * Keyed by the authenticated actor when there is one, else by IP.
 *
 * The August version read `ctx.user?.id` while requireSession set
 * `request.user.authUserId`, so every authenticated limit silently
 * degraded to a shared per-IP bucket.
 */
export function identify(request: FastifyRequest): string {
  return request.user ? `u:${request.user.authUserId}` : `ip:${request.ip}`;
}

export function enforceRateLimit(request: FastifyRequest, cfg: RateLimitConfig): void {
  const key = `${cfg.name}:${cfg.windowMs}:${identify(request)}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (bucket && now - bucket.windowStart < cfg.windowMs) {
    if (bucket.count >= cfg.max) throw new Error("RATE_LIMITED");
    bucket.count += 1;
    return;
  }

  buckets.set(key, { count: 1, windowStart: now });
}

/** preHandler form. */
export function rateLimit(cfg: RateLimitConfig) {
  return async (request: FastifyRequest): Promise<void> => {
    enforceRateLimit(request, cfg);
  };
}

export function pruneStaleBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    const windowMs = Number(key.split(":")[1]) || 3_600_000;
    if (now - bucket.windowStart > windowMs * 2) buckets.delete(key);
  }
}

/** Tests only. */
export function resetRateLimits(): void {
  buckets.clear();
}
