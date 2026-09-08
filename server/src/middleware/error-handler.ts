import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

/**
 * Errors are thrown as bare Errors whose MESSAGE is the code. The client
 * only ever sees the mapping below — never a stack, a driver message, or
 * anything that distinguishes "no such row" from "not yours".
 */
const CODES: Record<string, { status: number; message: string }> = {
  MISSING_SESSION: { status: 401, message: "Sign in to continue." },
  INVALID_SESSION: { status: 401, message: "That session is no longer valid." },
  NOT_VERIFIED: { status: 403, message: "Confirm your email address first." },
  NO_PROFILE: { status: 403, message: "Finish your profile first." },
  FORBIDDEN: { status: 404, message: "Not found." },
  NOT_FOUND: { status: 404, message: "Not found." },
  VALIDATION_ERROR: { status: 400, message: "That request was not valid." },
  RATE_LIMITED: { status: 429, message: "Too many attempts. Try again later." },
  BUDGET_EXHAUSTED: { status: 429, message: "That is all six for today." },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong." },
};

// FORBIDDEN deliberately answers 404 with the same body as NOT_FOUND:
// a distinct 403 confirms the resource exists, which is how an attacker
// enumerates. The audit log records the difference; the client cannot see it.

export function setupErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send({ error: { code: "VALIDATION_ERROR", message: CODES.VALIDATION_ERROR.message } });
    }

    const known = CODES[error.message];
    if (known) {
      return reply
        .status(known.status)
        .send({ error: { code: error.message, message: known.message } });
    }

    // Unrecognised: log it server-side, tell the client nothing.
    request.log.error({ err: error }, "unhandled error");
    return reply
      .status(500)
      .send({ error: { code: "INTERNAL_ERROR", message: CODES.INTERNAL_ERROR.message } });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: "NOT_FOUND", message: CODES.NOT_FOUND.message } });
  });
}
