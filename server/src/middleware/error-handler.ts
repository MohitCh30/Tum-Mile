import type { FastifyRequest, FastifyReply } from "fastify";
import type { HttpError } from "fastify";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// Map internal error codes to safe, generic messages.
// Never expose internal details to the client.
const SAFE_MESSAGES: Record<string, string> = {
  MISSING_SESSION: "Authentication required.",
  INVALID_SESSION: "Invalid or expired session.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  NOT_VERIFIED: "Email verification required.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NOT_FOUND: "Resource not found.",
  VALIDATION_ERROR: "Invalid request data.",
  INTERNAL_ERROR: "An unexpected error occurred.",
};

export function setupErrorHandler(app: { setErrorHandler: (h: (err: Error, req: FastifyRequest, reply: FastifyReply) => void | Promise<void>) => void }) {
  app.setErrorHandler(
    async (
      error: Error | HttpError,
      _request: FastifyRequest,
      reply: FastifyReply
    ): Promise<void> => {
      const code = error.message || "INTERNAL_ERROR";
      const message = SAFE_MESSAGES[code] || SAFE_MESSAGES.INTERNAL_ERROR;
      const statusCode = error.statusCode || 500;

      reply.status(statusCode).send({
          error: { code, message },
        } satisfies ErrorResponse);
    }
  );
}