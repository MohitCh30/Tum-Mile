import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { config } from "./config";
import { securityHeaders, cspHeader } from "./middleware/security-headers";
import { setupErrorHandler } from "./middleware/error-handler";
import { registerRoute, loginRoute, verifyRoute, logoutRoute } from "./routes/auth";
import { profileRoutes } from "./routes/profile";
import { mediaRoutes } from "./routes/media";
import { adminRoutes } from "./routes/admin";
import { getDb } from "./storage/db";
import { logAudit } from "./services/audit";
import { pruneStaleBuckets } from "./middleware/rate-limit";

const app = Fastify({
  logger: {
    level: config.NODE_ENV === "development" ? "info" : "warn",
    transport:
      config.NODE_ENV === "development"
        ? { target: "pino-pretty" }
        : undefined,
  },
}).withTypeProvider<TypeBoxTypeProvider>();

// ─── Plugins ─────────────────────────────────────────────────────
app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      ...(config.NODE_ENV === "development"
        ? {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "http://localhost:*", "ws://localhost:*"],
            frameAncestors: ["'none'"],
          }
        : {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
          }),
    },
  },
});

app.register(cors, {
  origin: config.CORS_ORIGIN,
  credentials: true,
});

app.register(cookie, {
  secret: process.env.SESSION_SECRET,
});

// ─── Middleware ──────────────────────────────────────────────────
app.addHook("onRequest", async (request, reply) => {
  securityHeaders(request as any, reply);
});

// ─── Error handler ───────────────────────────────────────────────
setupErrorHandler(app);

// ─── Health ──────────────────────────────────────────────────────
app.get("/health", async () => {
  return { status: "ok" };
});

// ─── Auth routes (unauthenticated) ───────────────────────────────
app.register(async function authRoutes(app) {
  app.register(registerRoute, { prefix: "/api/v1/auth" });
  app.register(loginRoute, { prefix: "/api/v1/auth" });
  app.register(verifyRoute, { prefix: "/api/v1/auth" });
  app.register(logoutRoute, { prefix: "/api/v1/auth" });
});

// ─── Profile routes (Phase 1) ────────────────────────────────────
app.register(profileRoutes, { prefix: "/api/v1" });

// ─── Media (serves local dev photos) ─────────────────────────────
app.register(mediaRoutes, { prefix: "/api/v1" });

// ─── Admin routes (Phase 1 — photo moderation) ──────────────────
app.register(adminRoutes, { prefix: "/api/v1" });

// ─── Periodic maintenance ────────────────────────────────────────
setInterval(() => {
  pruneStaleBuckets();
}, 5 * 60_000);

// ─── Start ───────────────────────────────────────────────────────
const start = async () => {
  try {
    // DB warmup
    getDb();

    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Server running on http://localhost:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

// ─── Graceful shutdown ───────────────────────────────────────────
process.on("SIGINT", async () => {
  await app.close();
  process.exit(0);
});