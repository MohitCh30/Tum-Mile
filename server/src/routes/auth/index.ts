import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requestMagicLink, verifyMagicLink } from "../../auth/magic-link.js";
import { createSession, invalidateSession } from "../../auth/session.js";
import { requireSession } from "../../middleware/auth.js";
import { rateLimit, enforceSubjectLimit } from "../../middleware/rate-limit.js";
import { logAudit } from "../../services/audit.js";
import { config, isProd } from "../../config.js";
import { canonicalEmail } from "../../lib/email.js";
import { verifyTurnstile, turnstileEnabled } from "../../services/turnstile.js";
import { clientIp } from "../../lib/client-ip.js";

const requestSchema = z.object({
  email: z.string().email().max(254),
  // Present only when Turnstile is configured on the client.
  turnstileToken: z.string().max(4096).optional(),
});
const verifySchema = z.object({ token: z.string().min(20).max(200) });

/** Loose: one address can sit behind a whole campus. */
const linkLimitPerIp = {
  name: "magic-link-ip",
  max: config.RATE_LIMIT_MAGIC_LINK_PER_IP,
  windowMs: config.RATE_LIMIT_MAGIC_LINK_WINDOW_MS,
};

/** Strict: keyed on the inbox, so rotating aliases buys nothing. */
const linkLimitPerAddress = {
  name: "magic-link-address",
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
  app.post("/auth/request", { preHandler: [rateLimit(linkLimitPerIp)] }, async (request, reply) => {
    const { email, turnstileToken } = requestSchema.parse(request.body);

    // Checked before anything is written or sent, and answered with the
    // same body as everything else — a distinct error would tell a script
    // exactly which of its requests was refused and why.
    const human = await verifyTurnstile(turnstileToken, clientIp(request));
    if (!human) return reply.status(200).send({ ok: true });

    // Keyed on the canonical inbox, so `you+1@`, `you+2@` and `y.o.u@`
    // all draw from one allowance. Applied after the loose per-IP tier.
    const canonical = canonicalEmail(email);
    if (canonical) enforceSubjectLimit(canonical, linkLimitPerAddress);

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

  /** What the sign-in form needs to render. No secrets. */
  app.get("/auth/config", async () => ({
    turnstileSiteKey: turnstileEnabled() ? config.TURNSTILE_SITE_KEY : null,
  }));

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
