import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, closeDb } from "./db.js";

await migrate(db, { migrationsFolder: "./src/storage/migrations" });
console.log("migrations applied");
await closeDb();
