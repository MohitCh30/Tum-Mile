import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

// A single pool for the process. Every module imports `db` from here —
// the August code imported table objects from this file that it never
// exported, which is why nothing compiled.
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

// An idle pooled connection that Postgres terminates — a restart, a
// `pg_terminate_backend`, a network drop — makes pg-pool emit `error` on
// the pool itself. With nothing listening that is an unhandled 'error'
// event, and Node ends the process: production died this way on
// 2026-09-16 06:17 UTC when Postgres closed an idle connection (57P01),
// and would have died again at every postgresql security update, since
// unattended-upgrades restarts the service. The pool discards the broken
// client and carries on; the next query opens a fresh connection. There
// is nothing to do here but refuse to take the process down.
pool.on("error", (err) => {
  console.error({ err: { message: err.message, name: err.name } }, "idle postgres client error");
});

export const db = drizzle(pool, { schema });

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { schema };
export {
  authUsers,
  sessions,
  profiles,
  questions,
  questionAnswers,
  likes,
  passes,
  matches,
  messages,
  messageReactions,
  sceneSessions,
  sceneTurns,
  blocks,
  reports,
  moderationCases,
  auditEvents,
} from "./schema.js";
