import { eq } from "drizzle-orm";
import { db, auditEvents } from "../storage/db";
import { hashToken as sha256 } from "crypto";

export interface AuditMeta {
  [key: string]: unknown;
}

export async function logAudit(params: {
  actorType: "user" | "admin" | "system";
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  meta?: AuditMeta;
}): Promise<void> {
  // Never log secrets — strip known sensitive keys
  const meta = { ...params.meta };
  delete meta.password;
  delete meta.token;
  delete meta.secret;

  await db.insert(auditEvents).values({
    actorType: params.actorType,
    actorId: params.actorId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    meta,
  });
}

// Alias for auth events specifically
export async function logAuth(
  actorId: string,
  action: string,
  meta?: AuditMeta
) {
  await logAudit({
    actorType: "user",
    actorId,
    action,
    resourceType: "auth",
    meta,
  });
}