import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Applied to every response. The study rated these "secondary" because it
 * assumed a mobile-only client; this is responsive web, so they are P0.
 */
export async function securityHeaders(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  reply.header("Cross-Origin-Resource-Policy", "same-origin");
  // The API serves JSON only; nothing it returns should ever be rendered.
  reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}
