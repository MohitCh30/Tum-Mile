import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requestMagicLink, verifyMagicLink } from "../../auth/magic-link.js";
import { createSession, invalidateSession } from "../../auth/session.js";
import { requireSession } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { logAudit } from "../../services/audit.js";
import { config, isProd } from "../../config.js";

const requestSchema = z.object({ email: z.string().email().max(254) });
const verifySchema = z.object({ token: z.string().min(20).max(200) });

const linkLimit = {
  name: "magic-link",
  max: config.RATE_LIMIT_MAGIC_LINK,
  windowMs: config.RATE_LIMIT_MAGIC_LINK_WINDOW_MS,
};
const verifyLimit = {
  name: "verify",
  max: config.RATE_LIMIT_VERIFY,
  windowMs: config.RATE_LIMIT_VERIFY_WINDOW_MS,
};

const COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProd,
  path: "/",
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /auth/request — one endpoint for both signing up and signing in.
   * They are the same operation, and keeping them separate would let a
   * caller learn which addresses exist by comparing the two responses.
   */
  app.post("/auth/request", { preHandler: [rateLimit(linkLimit)] }, async (request, reply) => {
    const { email } = requestSchema.parse(request.body);
    const result = await requestMagicLink(email);

    const body: Record<string, unknown> = { ok: true };
    if (result.devUrl) body.devUrl = result.devUrl;

    // Same shape and same timing-insensitive path whether or not the
    // address is known.
    return reply.status(200).send(body);
  });

  /**
   * POST /auth/verify — the emailed link points at the frontend, which
   * posts the token here. A POST keeps the state change off a URL that
   * mail clients and link scanners will happily fetch on their own.
   */
  app.post("/auth/verify", { preHandler: [rateLimit(verifyLimit)] }, async (request, reply) => {
    const { token } = verifySchema.parse(request.body);
    const result = await verifyMagicLink(token);

    if (!result.ok || !result.authUserId) {
      throw new Error("INVALID_SESSION");
    }

    const sessionToken = await createSession(
      result.authUserId,
      request.headers["user-agent"]
    );

    await logAudit({
      actorType: "user",
      actorId: result.authUserId,
      action: "session.created",
      resourceType: "auth",
    });

    reply.setCookie(config.SESSION_COOKIE_NAME, sessionToken, {
      ...COOKIE,
      maxAge: Math.floor(config.SESSION_IDLE_TIMEOUT_MS / 1000),
    });

    return reply.status(200).send({ ok: true });
  });

  app.post("/auth/logout", { preHandler: [requireSession] }, async (request, reply) => {
    const token = request.cookies[config.SESSION_COOKIE_NAME];
    if (token) await invalidateSession(token);

    if (request.user) {
      await logAudit({
        actorType: "user",
        actorId: request.user.authUserId,
        action: "session.ended",
        resourceType: "auth",
      });
    }

    reply.clearCookie(config.SESSION_COOKIE_NAME, COOKIE);
    return reply.status(200).send({ ok: true });
  });

  /** Who am I. The frontend's only source of signed-in state. */
  app.get("/me", { preHandler: [requireSession] }, async (request) => {
    const user = request.user!;
    return {
      email: user.email,
      emailVerified: user.emailVerified,
      hasProfile: user.profileId !== undefined,
    };
  });
};
