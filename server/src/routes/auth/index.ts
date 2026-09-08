import { FastifyPluginAsync } from "fastify";
import { eq, and, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { db, authUsers, sessions } from "../storage/db";
import { requestMagicLink, verifyMagicLink } from "../auth/magic-link";
import { createSession, invalidateSession } from "../auth/session";
import { requireSession } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { logAuth } from "../services/audit";
import { config } from "../config";

// Shared rate limit configs (imported from env)
const magicLinkLimit = {
  maxRequests: config.RATE_LIMIT_MAGIC_LINK,
  windowMs: config.RATE_LIMIT_MAGIC_LINK_WINDOW_MS,
} as const;
const verifyLimit = {
  maxRequests: config.RATE_LIMIT_VERIFY,
  windowMs: config.RATE_LIMIT_VERIFY_WINDOW_MS,
} as const;

const registerSchema = z.object({ email: z.string().email() });
const verifySchema = z.object({ token: z.string().min(1) });

// ─── POST /api/v1/auth/register ─────────────────────────────────
export const registerRoute: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: z.infer<typeof registerSchema>;
  }>(
    "/register",
    {
      preHandler: [
        async (req, _reply) => {
          await rateLimit(magicLinkLimit)(req);
        },
      ],
    },
    async (request, reply) => {
      const { email } = registerSchema.parse(request.body);

      const result = await requestMagicLink(email);

      const body: Record<string, unknown> = { ok: result.ok };
      if (result.devUrl) body.devUrl = result.devUrl;

      return reply.status(200).send(body);
    }
  );
};

// ─── POST /api/v1/auth/login ────────────────────────────────────
export const loginRoute: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: z.infer<typeof registerSchema>;
  }>(
    "/login",
    {
      preHandler: [
        async (req, _reply) => {
          await rateLimit(magicLinkLimit)(req);
        },
      ],
    },
    async (request, reply) => {
      const { email } = registerSchema.parse(request.body);

      // Same flow as register — find user and send token
      const result = await requestMagicLink(email);

      const body: Record<string, unknown> = { ok: result.ok };
      if (result.devUrl) body.devUrl = result.devUrl;

      return reply.status(200).send(body);
    }
  );
};

// ─── GET /api/v1/auth/verify ────────────────────────────────────
export const verifyRoute: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { token?: string };
  }>(
    "/verify",
    {
      preHandler: [
        async (req, _reply) => {
          const ip = req.ip;
          // We use a shared rate limit keyed on IP broadly during verification
          await rateLimit({
            maxRequests: verifyLimit.maxRequests,
            windowMs: verifyLimit.windowMs,
          })({ ip });
        },
      ],
    },
    async (request, reply) => {
      const token = request.query.token;
      if (!token) {
        return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Missing token." } });
      }

      const result = await verifyMagicLink(token);

      if (!result.ok || !result.userId) {
        return reply.status(400).send({ error: { code: "INVALID_TOKEN", message: "Invalid or expired verification token." } });
      }

      // Create session
      const sessionToken = await createSession(
        result.userId,
        request.headers["user-agent"] as string | undefined
      );

      reply.setCookie(config.SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: Math.floor(config.SESSION_IDLE_TIMEOUT_MS / 1000),
      });

      await logAuth(result.userId, "session:created", {
        action: "verify",
      });

      return reply.status(200).send({ ok: true });
    }
  );
};

// ─── POST /api/v1/auth/logout ────────────────────────────────────
export const logoutRoute: FastifyPluginAsync = async (app) => {
  app.post(
    "/logout",
    {
      preHandler: [requireSession],
    },
    async (request, reply) => {
      if (request.user) {
        const rawToken = request.cookies[config.SESSION_COOKIE_NAME];
        if (rawToken) {
          await invalidateSession(rawToken);
        }
        await logAuth(request.user.authUserId, "session:destroyed", {});
      }

      reply.clearCookie(config.SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      });

      return reply.status(200).send({ ok: true });
    }
  );
};