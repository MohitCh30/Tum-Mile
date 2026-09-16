import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { config } from "../../src/config.js";
import { db, closeDb } from "../../src/storage/db.js";

/**
 * Production exited 1 on 2026-09-16 06:17 UTC because Postgres terminated
 * an idle pooled connection and pg-pool emitted `error` on a pool nobody
 * was listening to. systemd restarted it; an unhandled 'error' event is
 * still the process dying on an event it should survive, and Postgres
 * restarts on every security update.
 *
 * This reproduces it the way it happened — the database closes the
 * connection from its own side — rather than by emitting a fake event,
 * so it would still fail if the listener were attached to the wrong
 * object.
 */

afterAll(async () => {
  await closeDb();
});

describe("a connection Postgres closes underneath us", () => {
  it("does not take the process down, and the next query still works", async () => {
    // Open a connection and learn its backend pid, then let it go back to
    // the pool idle — which is the state the crash needed.
    const [{ pid }] = (await db.execute(sql`SELECT pg_backend_pid() AS pid`))
      .rows as Array<{ pid: number }>;

    let unhandled: Error | undefined;
    const capture = (err: Error): void => {
      unhandled = err;
    };
    process.on("uncaughtException", capture);

    try {
      // Kill it from a connection OUTSIDE the pool, exactly as a service
      // restart or an administrator would. It has to be outside: asking
      // the pool to do it hands the job back to the same idle client,
      // which then terminates itself and rejects that query instead —
      // the error arrives with a caller to reject, which is the case that
      // never crashed anything.
      const outsider = new pg.Client({ connectionString: config.DATABASE_URL });
      await outsider.connect();
      await outsider.query("SELECT pg_terminate_backend($1)", [pid]);
      await outsider.end();
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(unhandled).toBeUndefined();

      const [{ ok }] = (await db.execute(sql`SELECT 1 AS ok`)).rows as Array<{ ok: number }>;
      expect(ok).toBe(1);
    } finally {
      process.off("uncaughtException", capture);
    }
  });
});
