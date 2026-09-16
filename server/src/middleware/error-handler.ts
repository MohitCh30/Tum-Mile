import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { config } from "../config.js";

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
  // Not a 404: this is the caller's OWN state, not a guess about someone
  // else's existence, and it is undone by a switch they already control.
  PAUSED: { status: 403, message: "You have stepped away. Come back first." },
  FORBIDDEN: { status: 404, message: "Not found." },
  NOT_FOUND: { status: 404, message: "Not found." },
  VALIDATION_ERROR: { status: 400, message: "That request was not valid." },
  RATE_LIMITED: { status: 429, message: "Too many attempts. Try again later." },
  BUDGET_EXHAUSTED: { status: 429, message: "That is all six for today." },
  TOO_MANY_NON_NEGOTIABLE: { status: 400, message: "Three is the most you can insist on." },
  SCENE_ALREADY_OPEN: { status: 409, message: "You already have a scene going." },
  NOT_YOUR_TURN: { status: 409, message: "It is their turn." },
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

  app.setNotFoundHandler((request, reply) => {
    // A deep link into the single-page app — /you, /matches — is not a
    // missing resource: the router resolves it in the browser, and only
    // the browser knows that. Still narrow: outside /api/, a method that
    // asks for a page rather than changing one, and a path that is not
    // plainly a file. A mistyped API path, and any POST, still answer
    // with the same JSON 404 as a resource that exists and is not yours.
    //
    // `Accept: text/html` was the original test and was too narrow to
    // survive being shared. It is what a browser sends and what almost
    // nothing else does: `facebookexternalhit` (WhatsApp, Facebook,
    // Instagram) and `Twitterbot` send `*/*` and were handed a JSON 404
    // for the homepage, so a link to this app previewed as a bare URL.
    // HEAD was refused outright, which is how an uptime monitor decides
    // a site is down. Neither was a decision anybody made; both fell out
    // of a condition written for browsers only.
    const accept = request.headers.accept ?? "";
    const wantsPage = accept.includes("text/html") || accept === "" || accept.includes("*/*");
    // A request for /assets/index-abc.js that reached here is a missing
    // FILE, and answering it with the app shell would turn a broken
    // deploy into a blank page and a console error about unexpected
    // token '<'. SPA routes have no extension; files do.
    const looksLikeFile = /\.[a-z0-9]+$/i.test(request.url.split("?")[0] ?? "");
    if (
      config.FRONTEND_DIST !== "" &&
      (request.method === "GET" || request.method === "HEAD") &&
      !request.url.startsWith("/api/") &&
      !looksLikeFile &&
      wantsPage
    ) {
      return reply.type("text/html").sendFile("index.html");
    }
    reply.status(404).send({ error: { code: "NOT_FOUND", message: CODES.NOT_FOUND.message } });
  });
}
