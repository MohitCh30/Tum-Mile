import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/storage/schema.ts",
  out: "./src/storage/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // compose publishes 5434 on the host (5432 was already taken)
    url:
      process.env.DATABASE_URL ||
      "postgres://tummile:REPLACE_ME@localhost:5434/tummile",
  },
});