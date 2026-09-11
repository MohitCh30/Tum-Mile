// Open reports, read on the machine rather than in an email.
//
//   cd server && DOTENV_CONFIG_PATH="$PWD/.env.production" ./node_modules/.bin/tsx scripts/reports.ts
//
// Read-only. It prints the evidence captured when each report was filed:
// the reported person's own recent messages and scene lines, nothing the
// reporter wrote.
import { desc, inArray } from "drizzle-orm";
import { db, reports, profiles, closeDb } from "../src/storage/db.js";

const open = await db
  .select()
  .from(reports)
  .where(inArray(reports.status, ["submitted", "reviewing"]))
  .orderBy(desc(reports.createdAt));

if (open.length === 0) {
  console.log("No open reports.");
} else {
  const ids = [...new Set(open.map((r) => r.reportedId))];
  const people = await db
    .select({ id: profiles.id, name: profiles.displayName, status: profiles.moderationStatus })
    .from(profiles)
    .where(inArray(profiles.id, ids));
  const who = new Map(people.map((p) => [p.id, p]));

  for (const r of open) {
    const p = who.get(r.reportedId);
    console.log("─".repeat(72));
    console.log(`report   ${r.id}   ${r.createdAt.toISOString()}   [${r.status}]`);
    console.log(`about    ${p?.name ?? "?"} (profile ${r.reportedId}, ${p?.status ?? "?"})`);
    console.log(`reason   ${r.reason}`);
    if (r.details) console.log(`details  ${r.details}`);
    if (r.evidence.length === 0) {
      console.log("evidence none captured (no conversation was attached)");
    } else {
      console.log(`evidence ${r.evidence.length} line(s), newest first:`);
      for (const e of r.evidence) {
        console.log(`  ${e.at}  ${e.source ?? "message"}: ${e.body}`);
      }
    }
  }
  console.log("─".repeat(72));
  console.log(`${open.length} open report(s).`);
}

await closeDb();
