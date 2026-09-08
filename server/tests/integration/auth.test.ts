import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerRoute, loginRoute, verifyRoute, logoutRoute } from "../../src/routes/auth";
import { getDb, authUsers, sessions, profiles, profilePhotos } from "../../src/storage/db";
import { securityHeaders, cspHeader } from "../../src/middleware/security-headers";
import { setupErrorHandler } from "../../src/middleware/error-handler";

let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  app = Fastify({ logger: false }).withTypeProvider<any>();
  // Register auth route group — plugins use /auth internally
  await app.register(async function (a) {
    await a.register(registerRoute, { prefix: "/api/v1/auth" });
    await a.register(loginRoute, { prefix: "/api/v1/auth" });
    await a.register(verifyRoute, { prefix: "/api/v1/auth" });
    await a.register(logoutRoute, { prefix: "/api/v1/auth" });
  });
  setupErrorHandler(app);
});

afterAll(async () => { await app.close(); });

beforeEach(async () => {
  // Clean auth data — cascade deletes the profile/session rows too
  await getDb().delete(authUsers).run();
});

describe("POST /api/v1/auth/register", () => {
  it("returns 200 for valid email", async () => {
    const res = await app.inject({
      url: "/api/v1/auth/register",
      method: "POST",
      headers: { "content-type": "application/json" },
      payload: { email: "alice@example.com" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 200 even if email already exists (no enumeration)", async () => {
    await app.inject({
      url: "/api/v1/auth/register",
      method: "POST",
      headers: { "content-type": "application/json" },
      payload: { email: "bob@example.com" },
    });
    const res2 = await app.inject({
      url: "/api/v1/auth/register",
      method: "POST",
      headers: { "content-type": "application/json" },
      payload: { email: "bob@example.com" },
    });
    expect(res2.statusCode).toBe(200);
  });

  it("rejects invalid email", async () => {
    const res = await app.inject({
      url: "/api/v1/auth/register",
      method: "POST",
      headers: { "content-type": "application/json" },
      payload: { email: "not-an-email" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

