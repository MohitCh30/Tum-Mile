export async function securityHeaders(
  _request: { url: string },
  reply: { header: (k: string, v: string) => void }
): Promise<void> {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-XSS-Protection", "1; mode=block");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
}

/**
 * Content-Security-Policy — relaxed enough for Vite dev, strict for prod.
 */
export function cspHeader(isDev: boolean): Record<string, string> {
  if (isDev) {
    // Dev: allow Vite HMR and scripts
    return {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:* ws://localhost:*; frame-ancestors 'none';",
    };
  }
  // Production: no unsafe-eval/unsafe-inline
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self';",
  };
}