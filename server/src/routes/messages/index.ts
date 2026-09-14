import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, messages, messageReactions, profiles } from "../../storage/db.js";
import { requireSession, requireProfile } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { logAudit } from "../../services/audit.js";
import { config } from "../../config.js";
import { requireParticipant, isReaction, REACTIONS, offPlatformHosts } from "../../lib/conversation.js";

const sendLimit = {
  name: "message-send",
  max: config.RATE_LIMIT_WRITE,
  windowMs: config.RATE_LIMIT_WRITE_WINDOW_MS,
};
const readLimit = {
  name: "message-read",
  max: config.RATE_LIMIT_DISCOVERY,
  windowMs: config.RATE_LIMIT_DISCOVERY_WINDOW_MS,
};

const sendSchema = z.object({ body: z.string().trim().min(1).max(2000) });
const reactSchema = z.object({ reaction: z.string().refine(isReaction, "unknown reaction") });
// The cursor is the id of the last message the client holds, not its
// timestamp. A timestamp cursor loses the row it came from: Postgres
// keeps timestamptz to microseconds, a JS Date only to milliseconds, so
// the value that comes back is fractionally EARLIER than the message it
// identifies and that message is handed over a second time.
const cursorSchema = z.object({ after: z.string().min(1).max(40).optional() });

export const messageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/reactions", { preHandler: [requireSession] }, async () => ({ reactions: REACTIONS }));

  /**
   * Polled, not pushed. `after` is the id of the newest message the
   * client already holds, so a poll returns only what is new.
   *
   * Reading does not mark anything, tell anyone, or update a timestamp.
   * There is nothing here that could become a read receipt or a
   * last-seen, because nothing is written on a read.
   */
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    "/matches/:id/messages",
    { preHandler: [requireSession, requireProfile, rateLimit(readLimit)] },
    async (request) => {
      const me = request.user!.profileId!;
      const { otherProfileId } = await requireParticipant(request.params.id, me);
      const { after } = cursorSchema.parse(request.query);

      // (created_at, id) as an ordered pair: exact, and stable when two
      // messages share a timestamp.
      // The NEWEST two hundred, not the oldest.
      //
      // An ascending order with a limit returned the first two hundred
      // messages a pair ever exchanged, and the screen refetches the whole
      // thread on every poll rather than paging — so once a conversation
      // passed two hundred it froze on its own beginning while sending
      // carried on working. Both people write into a thread neither can
      // see, and nothing anywhere says so.
      //
      // Newest-first then reversed keeps the window on the end people are
      // actually in. Anything older than the last two hundred is out of
      // reach, which is a known ceiling rather than a silent stall, and
      // the cost of having no pagination.
      const rows = after
        ? await db
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.matchId, request.params.id),
                sql`(${messages.createdAt}, ${messages.id}) > (
                  select m.created_at, m.id from messages m where m.id = ${after}
                )`
              )
            )
            .orderBy(asc(messages.createdAt), asc(messages.id))
            .limit(200)
        : (
            await db
              .select()
              .from(messages)
              .where(eq(messages.matchId, request.params.id))
              .orderBy(desc(messages.createdAt), desc(messages.id))
              .limit(200)
          ).reverse();

      const reactions =
        rows.length > 0
          ? await db
              .select()
              .from(messageReactions)
              .where(inArray(messageReactions.messageId, rows.map((r) => r.id)))
          : [];

      const [other] = await db
        .select({ id: profiles.id, displayName: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.id, otherProfileId))
        .limit(1);

      return {
        with: other ?? null,
        messages: rows.map((row) => ({
          id: row.id,
          body: row.body,
          at: row.createdAt,
          mine: row.senderProfileId === me,
          reactions: reactions
            .filter((r) => r.messageId === row.id)
            .map((r) => ({ reaction: r.reaction, mine: r.profileId === me })),
        })),
        // The cursor to poll with next.
        latest: rows.length > 0 ? rows[rows.length - 1].id : (after ?? null),
      };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/matches/:id/messages",
    { preHandler: [requireSession, requireProfile, rateLimit(sendLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      // Re-established here, not inherited from the read that preceded it.
      await requireParticipant(request.params.id, me);

      const { body } = sendSchema.parse(request.body);

      const [created] = await db
        .insert(messages)
        .values({ matchId: request.params.id, senderProfileId: me, body })
        .returning();

      const hosts = offPlatformHosts(body);
      if (hosts.length > 0) {
        // The fact of the handoff, never the message it appeared in.
        await logAudit({
          actorType: "user",
          actorId: request.user!.authUserId,
          action: "message.offPlatformLink",
          resourceType: "match",
          resourceId: request.params.id,
          meta: { hosts },
        });
      }

      return reply.status(201).send({
        id: created.id,
        body: created.body,
        at: created.createdAt,
        mine: true,
        reactions: [],
      });
    }
  );

  /** One reaction per person per message; sending another replaces it. */
  app.put<{ Params: { id: string } }>(
    "/messages/:id/reaction",
    { preHandler: [requireSession, requireProfile, rateLimit(sendLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      const { reaction } = reactSchema.parse(request.body);

      const [message] = await db
        .select({ id: messages.id, matchId: messages.matchId })
        .from(messages)
        .where(eq(messages.id, request.params.id))
        .limit(1);
      if (!message) throw new Error("NOT_FOUND");

      await requireParticipant(message.matchId, me);

      await db
        .insert(messageReactions)
        .values({ messageId: message.id, profileId: me, reaction })
        .onConflictDoUpdate({
          target: [messageReactions.messageId, messageReactions.profileId],
          set: { reaction },
        });

      return reply.status(204).send();
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/messages/:id/reaction",
    { preHandler: [requireSession, requireProfile, rateLimit(sendLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;

      const [message] = await db
        .select({ id: messages.id, matchId: messages.matchId })
        .from(messages)
        .where(eq(messages.id, request.params.id))
        .limit(1);
      if (!message) throw new Error("NOT_FOUND");

      await requireParticipant(message.matchId, me);

      await db
        .delete(messageReactions)
        .where(
          and(eq(messageReactions.messageId, message.id), eq(messageReactions.profileId, me))
        );

      return reply.status(204).send();
    }
  );
};
