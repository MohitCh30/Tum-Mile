import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, sceneSessions, sceneTurns } from "../../storage/db.js";
import type { SceneSession, SceneTurn } from "../../storage/schema.js";
import { requireSession, requireProfile } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { logAudit } from "../../services/audit.js";
import { config } from "../../config.js";
import { requireParticipant } from "../../lib/conversation.js";
import {
  PREMISES,
  getPremise,
  MAX_TURN_LENGTH,
  MAX_LETTER_LENGTH,
  type Premise,
} from "../../content/scenes.js";

const writeLimit = {
  name: "scene-write",
  max: config.RATE_LIMIT_WRITE,
  windowMs: config.RATE_LIMIT_WRITE_WINDOW_MS,
};

const proposeSchema = z.object({
  matchId: z.string().min(1).max(40),
  premiseId: z.string().min(1).max(60),
});

const turnSchema = z.object({ body: z.string().trim().min(1).max(MAX_TURN_LENGTH) });
const letterSchema = z.object({ body: z.string().trim().min(1).max(MAX_LETTER_LENGTH) });

/**
 * Load a scene and prove this caller belongs in it.
 *
 * Authorization runs through the MATCH, not the scene: a scene is
 * something two matched people do, so it can never become a second route
 * to somebody who has unmatched or blocked. Everything refused answers
 * NOT_FOUND, like every other resource here.
 */
async function loadScene(
  sessionId: string,
  me: string
): Promise<{ scene: SceneSession; premise: Premise; turns: SceneTurn[] }> {
  const [scene] = await db
    .select()
    .from(sceneSessions)
    .where(eq(sceneSessions.id, sessionId))
    .limit(1);

  if (!scene) throw new Error("NOT_FOUND");

  // Re-checked on every call: the pair may have unmatched or blocked
  // between two requests, and the scene must close with everything else.
  await requireParticipant(scene.matchId, me);

  if (scene.castAId !== me && scene.castBId !== me) throw new Error("NOT_FOUND");

  const premise = getPremise(scene.premiseId);
  if (!premise) throw new Error("NOT_FOUND");

  const turns = await db
    .select()
    .from(sceneTurns)
    .where(eq(sceneTurns.sessionId, scene.id))
    .orderBy(asc(sceneTurns.kind), asc(sceneTurns.ordinal));

  return { scene, premise, turns };
}

/**
 * Whose turn it is.
 *
 * The premise speaks first as role A, so the first thing anyone writes is
 * a reply — from role B. After that it strictly alternates. Turn order is
 * derived from what is on the table rather than stored, so it cannot
 * drift out of step with the turns themselves.
 */
function nextSpeaker(scene: SceneSession, lines: SceneTurn[]): string {
  return lines.length % 2 === 0 ? scene.castBId : scene.castAId;
}

function shape(scene: SceneSession, premise: Premise, turns: SceneTurn[], me: string) {
  const lines = turns.filter((t) => t.kind === "line");
  const letters = turns.filter((t) => t.kind === "letter");
  const myRole = scene.castAId === me ? premise.roleA : premise.roleB;
  const theirRole = scene.castAId === me ? premise.roleB : premise.roleA;

  return {
    id: scene.id,
    matchId: scene.matchId,
    status: scene.status,
    premise: {
      id: premise.id,
      title: premise.title,
      blurb: premise.blurb,
      setting: premise.setting,
      opensWith: premise.opensWith,
      letterPrompt: premise.letterPrompt,
      turnsEach: premise.turnsEach,
    },
    you: { ...myRole, isRoleA: scene.castAId === me },
    them: theirRole,
    proposedByYou: scene.proposedById === me,
    turnsRemaining: Math.max(0, premise.turnsEach * 2 - lines.length),
    yourTurn: scene.status === "playing" && nextSpeaker(scene, lines) === me,
    lines: lines.map((line) => ({
      ordinal: line.ordinal,
      body: line.body,
      mine: line.profileId === me,
      speaker: line.profileId === scene.castAId ? premise.roleA.name : premise.roleB.name,
    })),
    letters: letters.map((letter) => ({
      body: letter.body,
      mine: letter.profileId === me,
      from: letter.profileId === scene.castAId ? premise.roleA.name : premise.roleB.name,
    })),
    youHaveWritten: letters.some((l) => l.profileId === me),
  };
}

export const sceneRoutes: FastifyPluginAsync = async (app) => {
  /** The library. Fixed and authored — there is no custom premise. */
  app.get("/scenes/premises", { preHandler: [requireSession] }, async () => ({
    premises: PREMISES.filter((p) => !p.retired).map((p) => ({
      id: p.id,
      title: p.title,
      blurb: p.blurb,
      turnsEach: p.turnsEach,
    })),
  }));

  /** Every scene in one conversation, newest first. */
  app.get<{ Params: { id: string } }>(
    "/matches/:id/scenes",
    { preHandler: [requireSession, requireProfile] },
    async (request) => {
      const me = request.user!.profileId!;
      await requireParticipant(request.params.id, me);

      const rows = await db
        .select()
        .from(sceneSessions)
        .where(eq(sceneSessions.matchId, request.params.id))
        .orderBy(desc(sceneSessions.createdAt));

      if (rows.length === 0) return { scenes: [] };

      const turns = await db
        .select()
        .from(sceneTurns)
        .where(inArray(sceneTurns.sessionId, rows.map((r) => r.id)))
        .orderBy(asc(sceneTurns.ordinal));

      return {
        scenes: rows.flatMap((scene) => {
          const premise = getPremise(scene.premiseId);
          if (!premise) return [];
          return [shape(scene, premise, turns.filter((t) => t.sessionId === scene.id), me)];
        }),
      };
    }
  );

  /**
   * Propose one. The other person has to accept — a scene is a thing two
   * people agree to do, never something done at somebody.
   *
   * Casting is assigned here, and if this pair has played this premise
   * before the roles come out SWAPPED. Watching someone play the part you
   * just played is the most revealing thing in the whole feature.
   */
  app.post(
    "/scenes",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      const input = proposeSchema.parse(request.body);

      // Retired premises still render the scenes already played in them,
      // but nobody starts a new one.
      const premise = getPremise(input.premiseId);
      if (!premise || premise.retired) throw new Error("NOT_FOUND");

      const { otherProfileId } = await requireParticipant(input.matchId, me);

      const open = await db
        .select({ id: sceneSessions.id })
        .from(sceneSessions)
        .where(
          and(
            eq(sceneSessions.matchId, input.matchId),
            inArray(sceneSessions.status, ["proposed", "playing", "letters"])
          )
        )
        .limit(1);

      // One at a time. Two half-played scenes in one conversation is not
      // a feature, it is a mess.
      if (open.length > 0) throw new Error("SCENE_ALREADY_OPEN");

      const [previous] = await db
        .select({ castAId: sceneSessions.castAId })
        .from(sceneSessions)
        .where(
          and(
            eq(sceneSessions.matchId, input.matchId),
            eq(sceneSessions.premiseId, premise.id),
            eq(sceneSessions.status, "finished")
          )
        )
        .orderBy(desc(sceneSessions.createdAt))
        .limit(1);

      // Play it again and you get the other part. Otherwise the proposer
      // takes role B, so choosing the scene is not also choosing the
      // flattering half of it.
      const castAId = previous ? (previous.castAId === me ? otherProfileId : me) : otherProfileId;
      const castBId = castAId === me ? otherProfileId : me;

      const [created] = await db
        .insert(sceneSessions)
        .values({
          matchId: input.matchId,
          premiseId: premise.id,
          castAId,
          castBId,
          proposedById: me,
        })
        .returning();

      await logAudit({
        actorType: "user",
        actorId: request.user!.authUserId,
        action: "scene.proposed",
        resourceType: "match",
        resourceId: input.matchId,
        meta: { premiseId: premise.id },
      });

      return reply.status(201).send(shape(created, premise, [], me));
    }
  );

  app.get<{ Params: { id: string } }>(
    "/scenes/:id",
    { preHandler: [requireSession, requireProfile] },
    async (request) => {
      const me = request.user!.profileId!;
      const { scene, premise, turns } = await loadScene(request.params.id, me);
      return shape(scene, premise, turns, me);
    }
  );

  /** Accept or decline. Only the person who did not propose it may. */
  app.post<{ Params: { id: string }; Body: { accept: boolean } }>(
    "/scenes/:id/answer",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      const { accept } = z.object({ accept: z.boolean() }).parse(request.body);
      const { scene, premise, turns } = await loadScene(request.params.id, me);

      if (scene.status !== "proposed") throw new Error("VALIDATION_ERROR");
      if (scene.proposedById === me) throw new Error("VALIDATION_ERROR");

      const [updated] = await db
        .update(sceneSessions)
        .set({ status: accept ? "playing" : "declined", updatedAt: new Date() })
        .where(eq(sceneSessions.id, scene.id))
        .returning();

      return reply.status(200).send(shape(updated, premise, turns, me));
    }
  );

  /**
   * Say your line.
   *
   * Strict alternation, and a hard stop at the premise's turn budget:
   * open-ended scenes drift because there is nowhere else for them to go,
   * so this one has somewhere — the end.
   */
  app.post<{ Params: { id: string } }>(
    "/scenes/:id/turns",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      const { body } = turnSchema.parse(request.body);
      const { scene, premise, turns } = await loadScene(request.params.id, me);

      if (scene.status !== "playing") throw new Error("VALIDATION_ERROR");

      const lines = turns.filter((t) => t.kind === "line");
      if (nextSpeaker(scene, lines) !== me) throw new Error("NOT_YOUR_TURN");

      const budget = premise.turnsEach * 2;
      if (lines.length >= budget) throw new Error("VALIDATION_ERROR");

      await db.insert(sceneTurns).values({
        sessionId: scene.id,
        profileId: me,
        ordinal: lines.length,
        body,
        kind: "line",
      });

      const finished = lines.length + 1 >= budget;
      const [updated] = await db
        .update(sceneSessions)
        .set({ status: finished ? "letters" : "playing", updatedAt: new Date() })
        .where(eq(sceneSessions.id, scene.id))
        .returning();

      const after = await db
        .select()
        .from(sceneTurns)
        .where(eq(sceneTurns.sessionId, scene.id))
        .orderBy(asc(sceneTurns.ordinal));

      return reply.status(201).send(shape(updated, premise, after, me));
    }
  );

  /**
   * The last letter.
   *
   * The scene ends with each person writing one, in character. It is the
   * thing both of them keep — and the last thing that happens between two
   * strangers here is that they each wrote something to be read carefully
   * rather than replied to quickly.
   */
  app.post<{ Params: { id: string } }>(
    "/scenes/:id/letter",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      const { body } = letterSchema.parse(request.body);
      const { scene, premise, turns } = await loadScene(request.params.id, me);

      if (scene.status !== "letters") throw new Error("VALIDATION_ERROR");

      const letters = turns.filter((t) => t.kind === "letter");
      if (letters.some((l) => l.profileId === me)) throw new Error("VALIDATION_ERROR");

      await db.insert(sceneTurns).values({
        sessionId: scene.id,
        profileId: me,
        ordinal: letters.length,
        body,
        kind: "letter",
      });

      const both = letters.length + 1 >= 2;
      const [updated] = await db
        .update(sceneSessions)
        .set({ status: both ? "finished" : "letters", updatedAt: new Date() })
        .where(eq(sceneSessions.id, scene.id))
        .returning();

      const after = await db
        .select()
        .from(sceneTurns)
        .where(eq(sceneTurns.sessionId, scene.id))
        .orderBy(asc(sceneTurns.kind), asc(sceneTurns.ordinal));

      return reply.status(201).send(shape(updated, premise, after, me));
    }
  );

  /** Walk away. Either person, at any point before it is finished. */
  app.post<{ Params: { id: string } }>(
    "/scenes/:id/abandon",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      const { scene, premise, turns } = await loadScene(request.params.id, me);

      if (scene.status === "finished") throw new Error("VALIDATION_ERROR");

      const [updated] = await db
        .update(sceneSessions)
        .set({ status: "abandoned", updatedAt: new Date() })
        .where(eq(sceneSessions.id, scene.id))
        .returning();

      return reply.status(200).send(shape(updated, premise, turns, me));
    }
  );
};

