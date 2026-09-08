import { defineConfig } from "vitest/config";

// Tests get their own database. Sharing the development one meant every
// run wiped local data and fought the dev server for row locks, which
// showed up as an intermittent timeout rather than an honest failure.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://tummile:REPLACE_ME@localhost:5434/tummile_test",
      SESSION_SECRET: "test_only_secret_at_least_32_characters_long",
      EMAIL_MAGIC_LINK_BASE_URL: "http://localhost:5173",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
      ADMIN_EMAIL: "admin@tummile.local",
    },
    // One file at a time: these share a database, and parallel suites
    // would race each other's cleanup rather than the code under test.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
