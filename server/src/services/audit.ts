import { db, auditEvents } from "../storage/db.js";

export type ActorType = "user" | "admin" | "system";

const REDACT = new Set([
  "password",
  "token",
  "secret",
  "tokenHash",
  "verificationTokenHash",
  "body",
  "message",
  "email",
]);

/**
 * Audit is a security record, not a second copy of the product's private
 * data. Message bodies, tokens and addresses never enter it.
 */
export async function logAudit(params: {
  actorType: ActorType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params.meta ?? {})) {
    if (!REDACT.has(k)) meta[k] = v;
  }

  await db.insert(auditEvents).values({
    actorType: params.actorType,
    actorId: params.actorId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    meta,
  });
}

export async function logAuth(
  actorId: string,
  action: string,
  meta?: Record<string, unknown>
): Promise<void> {
  await logAudit({ actorType: "user", actorId, action, resourceType: "auth", meta });
}
