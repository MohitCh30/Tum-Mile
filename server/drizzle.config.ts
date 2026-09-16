import { defineConfig } from "drizzle-kit";
import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to server/.env and fill it in.`);
  return value;
}

export default defineConfig({
  schema: "./src/storage/schema.ts",
  out: "./src/storage/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // No fallback with a password in it. A default that happens to work is
    // a credential in the repository, and one that silently points a
    // migration at the wrong database when DATABASE_URL is merely absent.
    // Compose publishes 5434 on the host; 5432 was already taken.
    url: required("DATABASE_URL"),
  },
});