import type { FastifyPluginAsync } from "fastify";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  authUsers,
  profiles,
  likes,
  passes,
  matches,
  messages,
  messageReactions,
  blocks,
  reports,
  questionAnswers,
  sceneSessions,
  sceneTurns,
} from "../../storage/db.js";
import { requireSession, requireVerified } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { invalidateAllSessions } from "../../auth/session.js";
import { sendEmail } from "../../services/email.js";
import { logAudit } from "../../services/audit.js";
import { config } from "../../config.js";

const writeLimit = {
  name: "account-write",
  max: config.RATE_LIMIT_WRITE,
  windowMs: config.RATE_LIMIT_WRITE_WINDOW_MS,
};

// Typing it out is the confirmation. There is no undo after this.
const deleteSchema = z.object({ confirm: z.literal("delete my account") });

export const accountRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Everything this product holds about you, as JSON.
   *
   * Your own writing, your own choices, your own messages. Not the other
   * half of your conversations: those are someone else's words, and a
   * data-export right is not a way to obtain a transcript of another
   * person. Not the audit log either — it is a security record about
   * actions, and handing it over would turn it into a second copy of the
   * thing it exists to protect.
   */
  app.get(
    "/account/export",
    { preHandler: [requireSession, requireVerified, rateLimit(writeLimit)] },
    async (request, reply) => {
      const user = request.user!;

      const [account] = await db
        .select({
          email: authUsers.email,
          emailVerified: authUsers.emailVerified,
          joined: authUsers.createdAt,
        })
        .from(authUsers)
        .where(eq(authUsers.id, user.authUserId))
        .limit(1);

      const payload: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        account,
        note: "Your own writing and choices. Messages other people sent you are their words, not yours, so they are not included.",
      };

      if (user.profileId) {
        const me = user.profileId;

        const [profile] = await db.select().from(profiles).where(eq(profiles.id, me));
        const [sentLikes, myPasses, myMatches, myMessages, myAnswers, myBlocks, myReports] =
          await Promise.all([
            db.select().from(likes).where(eq(likes.likerProfileId, me)),
            db.select().from(passes).where(eq(passes.passerProfileId, me)),
            db
              .select()
              .from(matches)
              .where(or(eq(matches.profileAId, me), eq(matches.profileBId, me))),
            db.select().from(messages).where(eq(messages.senderProfileId, me)),
            db.select().from(questionAnswers).where(eq(questionAnswers.profileId, me)),
            db.select().from(blocks).where(eq(blocks.blockerId, me)),
            db
              .select({
                id: reports.id,
                reason: reports.reason,
                status: reports.status,
                at: reports.createdAt,
              })
              .from(reports)
              .where(eq(reports.reporterId, me)),
          ]);

        payload.profile = profile ? { ...profile, locationGeohash: undefined } : null;
        payload.approximateLocationStored = profile?.locationGeohash !== null;
        payload.likesSent = sentLikes.map((l) => ({
          to: l.likedProfileId,
          quotedLine: l.quotedLine,
          message: l.openingMessage,
          at: l.createdAt,
        }));
        payload.passes = myPasses.length;
        payload.matches = myMatches.map((m) => ({ id: m.id, at: m.createdAt }));
        payload.messagesSent = myMessages.map((m) => ({
          matchId: m.matchId,
          body: m.body,
          at: m.createdAt,
        }));
        // Your own lines and letters. The other player's are their words.
        const myScenes = await db
          .select({
            sceneId: sceneTurns.sessionId,
            premiseId: sceneSessions.premiseId,
            kind: sceneTurns.kind,
            body: sceneTurns.body,
            at: sceneTurns.createdAt,
          })
          .from(sceneTurns)
          .innerJoin(sceneSessions, eq(sceneSessions.id, sceneTurns.sessionId))
          .where(eq(sceneTurns.profileId, me));
        payload.scenesWritten = myScenes;
        payload.questionAnswers = myAnswers;
        payload.blocked = myBlocks.map((b) => ({ profileId: b.blockedId, at: b.createdAt }));
        payload.reportsFiled = myReports;
      }

      await logAudit({
        actorType: "user",
        actorId: user.authUserId,
        action: "account.exported",
        resourceType: "account",
      });

      reply.header("content-type", "application/json; charset=utf-8");
      reply.header("content-disposition", 'attachment; filename="tum-mile-export.json"');
      return reply.send(payload);
    }
  );

  /**
   * Delete the account.
   *
   * Erased: the address, every session, everything written on the profile,
   * every like and pass, and every message this person sent — including
   * the ones sitting in other people's conversations. Their words are
   * theirs, so they go with them.
   *
   * Kept: reports filed ABOUT this account, and the audit log. Erasing
   * those would make deletion a way to clear a moderation record, which
   * is the ban-evasion route the research warns about. Neither contains
   * the account's writing.
   *
   * The profile row survives as a blank tombstone rather than being
   * dropped, because reports reference it — deleting it would cascade
   * them away, which is the same hole by another route.
   */
  app.delete(
    "/account",
    { preHandler: [requireSession, requireVerified, rateLimit(writeLimit)] },
    async (request, reply) => {
      const user = request.user!;
      deleteSchema.parse(request.body);

      const [account] = await db
        .select({ email: authUsers.email })
        .from(authUsers)
        .where(eq(authUsers.id, user.authUserId))
        .limit(1);

      await db.transaction(async (tx) => {
        if (user.profileId) {
          const me = user.profileId;

          await tx.delete(messageReactions).where(eq(messageReactions.profileId, me));
          await tx.delete(messages).where(eq(messages.senderProfileId, me));
          // Scene lines and letters are their writing too, and go the same way.
          await tx.delete(sceneTurns).where(eq(sceneTurns.profileId, me));
          await tx.delete(likes).where(or(eq(likes.likerProfileId, me), eq(likes.likedProfileId, me)));
          await tx.delete(passes).where(eq(passes.passerProfileId, me));
          await tx.delete(blocks).where(or(eq(blocks.blockerId, me), eq(blocks.blockedId, me)));

          await tx
            .update(matches)
            .set({ unmatchedAt: new Date(), unmatchedBy: me })
            .where(or(eq(matches.profileAId, me), eq(matches.profileBId, me)));

          await tx
            .update(profiles)
            .set({
              displayName: "Someone who left",
              oneLine: null,
              formType: null,
              formBody: null,
              currently: {},
              currentlyUpdatedAt: null,
              promptAnswers: [],
              interests: [],
              languages: [],
              status: null,
              wantsKids: null,
              diet: null,
              religion: null,
              locationGeohash: null,
              lastLocationUpdate: null,
              // Filtered out of discovery, likes and every profile read.
              moderationStatus: "suspended",
              updatedAt: new Date(),
            })
            .where(eq(profiles.id, me));

          await tx.delete(questionAnswers).where(eq(questionAnswers.profileId, me));
        }

        await tx
          .update(authUsers)
          .set({
            // A tombstone rather than the address: the row must stay for
            // the foreign keys, but nothing in it should identify anyone.
            email: `deleted-${user.authUserId}@deleted.invalid`,
            // Freed with the address, so a person who leaves can come back.
            emailCanonical: null,
            emailVerified: false,
            verificationTokenHash: null,
            verificationTokenExpiresAt: null,
            isDeleted: true,
            updatedAt: new Date(),
          })
          .where(eq(authUsers.id, user.authUserId));
      });

      await invalidateAllSessions(user.authUserId);

      await logAudit({
        actorType: "user",
        actorId: user.authUserId,
        action: "account.deleted",
        resourceType: "account",
      });

      if (account) {
        await sendEmail({
          to: account.email,
          subject: "Your Tum Mile account has been deleted",
          text: [
            "Your account is gone.",
            "",
            "Erased: your address, your sessions, everything you wrote on your page,",
            "every like and pass, and every message you sent — including the ones in",
            "other people's conversations.",
            "",
            "Kept: reports other people filed about this account, and the security log",
            "of actions taken. Neither contains anything you wrote. They are kept so",
            "that deleting an account cannot be used to clear a moderation record.",
            "",
            "Nothing further is needed from you, and nobody will write to you again.",
          ].join("\n"),
        });
      }

      reply.clearCookie(config.SESSION_COOKIE_NAME, { path: "/" });
      return reply.status(204).send();
    }
  );
};
