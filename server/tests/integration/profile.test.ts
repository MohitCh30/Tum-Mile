import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { createHmac } from "crypto";
import Fastify from "fastify";
import { getDb, authUsers, sessions, profiles } from "../../src/storage/db";
import { profileRoutes } from "../../src/routes/profile";
import { setupErrorHandler } from "../../src/middleware/error-handler";

let app: ReturnType<typeof Fastify>;
let userId: string;
let sessionCookie: string;

beforeAll(async () => {
  app = Fastify({ logger: false }).withTypeProvider<any>();
  await app.register(profileRoutes, { prefix: "/api/v1" });
  setupErrorHandler(app);

  // Create a verified user + session in the DB
  const [user] = await getDb()
    .insert(authUsers)
    .values({
      email: "alice@test.example",
      emailVerified: true,
    })
    .returning();

  userId = user.id;

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", process.env.SESSION_SECRET || "test-secret").update(rawToken).digest("hex");

  await getDb().insert(sessions).values({
    authUserId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  sessionCookie = `tum_mile_session=${rawToken}`;
});

afterAll(async () => { await app.close(); });

beforeEach(async () => {
  await getDb().delete(profiles).run();
});

describe("GET /api/v1/profile (own profile)", () => {
  it("returns 404 if no profile exists", async () => {
    const res = await app.inject({
      url: "/api/v1/profile",
      method: "GET",
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 once profile exists", async () => {
    const [profile] = await getDb()
      .insert(profiles)
      .values({
        authUserId: userId,
        displayName: "Alice",
        birthDate: new Date("1995-06-15"),
        gender: "woman",
        seeking: ["man"],
        preferences: { distanceRadiusKm: 40, ageMin: 24, ageMax: 40 },
        privacy: { showDistance: true },
      })
      .returning();

    const res = await app.inject({
      url: "/api/v1/profile",
      method: "GET",
      headers: { cookie: sessionCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.displayName).toBe("Alice");
  });

  it("is inaccessible without a session", async () => {
    const res = await app.inject({
      url: "/api/v1/profile",
      method: "GET",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /api/v1/profile", () => {
  it("creates a profile for a user with none", async () => {
    const res = await app.inject({
      url: "/api/v1/profile",
      method: "PATCH",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
      },
      payload: {
        displayName: "New Alice",
        bio: "Hello world",
        birthDate: new Date("1996-01-01").toISOString(),
        gender: "woman",
        seeking: ["man", "non-binary"],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.displayName).toBe("New Alice");
  });

  it("updates an existing profile without touching other fields", async () => {
    await getDb()
      .insert(profiles)
      .values({
        authUserId: userId,
        displayName: "Alice",
        birthDate: new Date("1995-06-15"),
        gender: "woman",
        seeking: ["man"],
      })
      .run();

    const res = await app.inject({
      url: "/api/v1/profile",
      method: "PATCH",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
      },
      payload: { bio: "Updated bio" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.profile.bio).toBe("Updated bio");
    expect(body.profile.displayName).toBe("Alice"); // unchanged
  });

  it("is inaccessible by another user (IDOR)", async () => {
    // User B registers
    const [userB] = await getDb()
      .insert(authUsers)
      .values({ email: "bob@example.com", emailVerified: true })
      .returning();

    const rawB = randomBytes(32).toString("base64url");
    const hashB = createHmac("sha256", process.env.SESSION_SECRET || "test").update(rawB).digest("hex");
    await getDb().insert(sessions).values({
      authUserId: userB.id,
      tokenHash: hashB,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const cookieB = `tum_mile_session=${rawB}`;

    // User B tries to update User A's profile by ID
    const res = await app.inject({
      url: "/api/v1/profile",
      method: "PATCH",
      headers: {
        cookie: cookieB,
        "content-type": "application/json",
      },
      payload: { displayName: "Hacked" },
    });

    // PATCH /api/v1/profile is own-profile only — User B has no profile
    expect(res.statusCode).toBe(404);
  });
});

