import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

// A single pool for the process. Every module imports `db` from here —
// the August code imported table objects from this file that it never
// exported, which is why nothing compiled.
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

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
  blocks,
  reports,
  moderationCases,
  auditEvents,
} from "./schema.js";
