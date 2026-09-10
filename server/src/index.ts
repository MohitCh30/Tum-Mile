import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { config, isProd } from "./config.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { setupErrorHandler } from "./middleware/error-handler.js";
import { pruneStaleBuckets } from "./middleware/rate-limit.js";
import { authRoutes } from "./routes/auth/index.js";
import { profileRoutes } from "./routes/profile/index.js";
import { discoveryRoutes } from "./routes/discovery/index.js";
import { questionRoutes } from "./routes/questions/index.js";
import { messageRoutes } from "./routes/messages/index.js";
import { safetyRoutes } from "./routes/safety/index.js";
import { accountRoutes } from "./routes/account/index.js";
import { adminRoutes } from "./routes/admin/index.js";
import { pruneExpiredSessions } from "./auth/session.js";
import { closeDb } from "./storage/db.js";
import { seedQuestions } from "./storage/seed-questions.js";
import { warmEmbeddings } from "./services/embeddings.js";

export function buildApp() {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : {
      level: isProd ? "warn" : "info",
      transport: isProd ? undefined : { target: "pino-pretty" },
      // Never let a request log carry the session cookie or a sign-in link.
      redact: {
        paths: ["req.headers.cookie", "req.headers.authorization", "req.body.token"],
        remove: true,
      },
    },
  });

  app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
  app.register(cookie, { secret: config.SESSION_SECRET });

  app.addHook("onSend", securityHeaders);
  setupErrorHandler(app);

  app.get("/health", async () => ({ status: "ok" }));
  app.register(authRoutes, { prefix: "/api/v1" });
  app.register(profileRoutes, { prefix: "/api/v1" });
  app.register(discoveryRoutes, { prefix: "/api/v1" });
  app.register(questionRoutes, { prefix: "/api/v1" });
  app.register(messageRoutes, { prefix: "/api/v1" });
  app.register(safetyRoutes, { prefix: "/api/v1" });
  app.register(accountRoutes, { prefix: "/api/v1" });
  app.register(adminRoutes, { prefix: "/api/v1" });

  return app;
}

async function start(): Promise<void> {
  const app = buildApp();

  // The bank lives in code; this makes the table agree with it.
  const seeded = await seedQuestions();
  app.log.info(seeded, "question bank synced");

  // Loads in the background; the first profile save should not wait on it.
  warmEmbeddings();

  const maintenance = setInterval(() => {
    pruneStaleBuckets();
    void pruneExpiredSessions();
  }, 5 * 60_000);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} — shutting down`);
    clearInterval(maintenance);
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: config.PORT, host: "127.0.0.1" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only listen when run directly; tests import buildApp().
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  void start();
}
