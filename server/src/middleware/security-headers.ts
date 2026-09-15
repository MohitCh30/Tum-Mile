import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

/** The API serves JSON only; nothing it returns should ever be rendered. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * The app shell, for deployments where this process also serves the built
 * frontend (`FRONTEND_DIST`). Until that existed the blanket `default-src
 * 'none'` above was simply true — the only thing this server could return
 * was JSON.
 *
 * `script-src` stays strict: 'self' plus Turnstile, the one third-party
 * script the sign-in form loads. `style-src` needs 'unsafe-inline' because
 * React writes `style=""` attributes and CSP counts those as inline styles
 * — a far smaller concession than the same word in `script-src`, which is
 * where script injection would actually pay off. Google Fonts serves its
 * stylesheet from googleapis and the font files themselves from gstatic.
 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * Applied to every response. The study rated these "secondary" because it
 * assumed a mobile-only client; this is responsive web, so they are P0.
 */
export async function securityHeaders(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  // `geolocation=(self)`, not `()`. This header only reaches a DOCUMENT
  // once this process serves the shell, and `()` denies the feature to our
  // own page — the browser then rejects the distance prompt before it is
  // ever shown, which is exactly the silently-dead control the location
  // work exists to avoid. Nobody else may ask; we may.
  reply.header("Permissions-Policy", "camera=(), microphone=(), payment=(), geolocation=(self)");
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  reply.header("Cross-Origin-Resource-Policy", "same-origin");

  // Only the app shell gets the permissive policy, and only where a shell
  // is actually being served. Anything under /api/ keeps `'none'`.
  const shell = config.FRONTEND_DIST !== "" && !request.url.startsWith("/api/");
  reply.header("Content-Security-Policy", shell ? APP_CSP : API_CSP);
}
