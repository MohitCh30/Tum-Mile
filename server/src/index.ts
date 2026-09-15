import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { config, isProd } from "./config.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { setupErrorHandler } from "./middleware/error-handler.js";
import { pruneStaleBuckets } from "./middleware/rate-limit.js";
import { authRoutes } from "./routes/auth/index.js";
import { profileRoutes } from "./routes/profile/index.js";
import { discoveryRoutes } from "./routes/discovery/index.js";
import { questionRoutes } from "./routes/questions/index.js";
import { messageRoutes } from "./routes/messages/index.js";
import { sceneRoutes } from "./routes/scenes/index.js";
import { safetyRoutes } from "./routes/safety/index.js";
import { accountRoutes } from "./routes/account/index.js";
import { adminRoutes } from "./routes/admin/index.js";
import { pruneExpiredSessions } from "./auth/session.js";
import { closeDb } from "./storage/db.js";
import { seedQuestions } from "./storage/seed-questions.js";
import { backfillCanonicalEmails } from "./storage/backfill-emails.js";
import { warmEmbeddings } from "./services/embeddings.js";
import { notifyModerator, sendDigests } from "./services/notifier.js";

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

  // The built frontend, from this same process. One origin for the app and
  // the API means the session cookie stays first-party and CORS never
  // applies to a real visitor. Empty in dev and test, where vite serves it.
  if (config.FRONTEND_DIST !== "") {
    app.register(fastifyStatic, { root: config.FRONTEND_DIST, index: false, wildcard: false });
  }

  app.get("/health", async () => ({ status: "ok" }));
  app.register(authRoutes, { prefix: "/api/v1" });
  app.register(profileRoutes, { prefix: "/api/v1" });
  app.register(discoveryRoutes, { prefix: "/api/v1" });
  app.register(questionRoutes, { prefix: "/api/v1" });
  app.register(messageRoutes, { prefix: "/api/v1" });
  app.register(sceneRoutes, { prefix: "/api/v1" });
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

  const emails = await backfillCanonicalEmails();
  if (emails.filled > 0 || emails.collisions.length > 0) {
    // A collision means two existing accounts share one inbox. Reported,
    // never merged — that is not a decision a backfill should take.
    app.log.info(emails, "canonical email keys backfilled");
  }

  // Loads in the background; the first profile save should not wait on it.
  warmEmbeddings();

  const maintenance = setInterval(() => {
    pruneStaleBuckets();
    void pruneExpiredSessions();
  }, 5 * 60_000);

  // Reports to the moderator, and the opt-in notes. Hourly is plenty for
  // both; each is idempotent, so a missed or doubled run changes nothing.
  const tellPeople = async () => {
    try {
      await notifyModerator();
      await sendDigests();
    } catch (err) {
      app.log.error(err, "notifier run failed");
    }
  };
  const firstNotify = setTimeout(() => void tellPeople(), 60_000);
  const notifier = setInterval(() => void tellPeople(), 60 * 60_000);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal}: shutting down`);
    clearInterval(maintenance);
    clearTimeout(firstNotify);
    clearInterval(notifier);
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
