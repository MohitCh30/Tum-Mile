import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

// Tests get their own database. Sharing the development one meant every
// run wiped local data and fought the dev server for row locks, which
// showed up as an intermittent timeout rather than an honest failure.
//
// The URL is derived from the development one rather than written here,
// because a literal carries the password into the repository. Same host,
// same credentials, different database. TEST_DATABASE_URL overrides it
// outright if the test database lives somewhere else.
//
// `.env` is PARSED, never loaded. `import "dotenv/config"` here would put
// every development value into this process, and Vitest hands its
// environment to the tests: the eleven keys `env` below does not pin —
// SESSION_COOKIE_NAME, the SMTP credentials, the session timeouts — would
// silently become whatever the developer's machine happens to use, and
// the suite would be testing that configuration rather than this one.
function devValue(key: string): string | undefined {
  try {
    return parse(readFileSync(new URL("./.env", import.meta.url)))[key];
  } catch {
    return undefined;
  }
}

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const dev = process.env.DATABASE_URL ?? devValue("DATABASE_URL");
  if (!dev) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to server/.env and fill it in, " +
        "or set TEST_DATABASE_URL to point at the test database directly.",
    );
  }
  const url = new URL(dev);
  url.pathname = "/tummile_test";
  return url.toString();
}

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
      SESSION_SECRET: "test_only_secret_at_least_32_characters_long",
      EMAIL_MAGIC_LINK_BASE_URL: "http://localhost:5173",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
      ADMIN_EMAIL: "admin@tummile.local",
      // The model is a 128MB download and a multi-second load; the score
      // is designed to be correct without it, and that is what is tested.
      EMBEDDINGS_ENABLED: "false",
    },
    // One file at a time: these share a database, and parallel suites
    // would race each other's cleanup rather than the code under test.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
