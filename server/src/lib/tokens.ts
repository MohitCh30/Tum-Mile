import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const TOKEN_BYTES = 32;

/** A high-entropy opaque token. This is the only thing the holder ever sees. */
export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * What we store. Keyed HMAC rather than a bare hash, so a database dump
 * alone is not enough to forge or verify a token — the key lives in the
 * environment, not the table.
 */
export function hashToken(token: string): string {
  return createHmac("sha256", config.SESSION_SECRET).update(token).digest("hex");
}

/** Constant-time compare, for the paths where we hold both sides. */
export function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
