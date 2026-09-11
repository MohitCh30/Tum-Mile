import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db, closeDb } from "./db.js";

// The vector column needs pgvector enabled first, and no migration does
// it: a fresh database would fail on the first embedding column.
await db.execute(sql`create extension if not exists vector`);
await migrate(db, { migrationsFolder: "./src/storage/migrations" });
console.log("migrations applied");
await closeDb();
