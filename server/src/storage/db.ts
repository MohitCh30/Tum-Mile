import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    if (!pool) {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
    }
    db = drizzle(pool, { schema });
  }
  return db;
}

export { schema };