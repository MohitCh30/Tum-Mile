import { promises as fs } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export interface StoredObject {
  key: string;
  url?: string;
}

export async function storeObject(buffer: Buffer): Promise<StoredObject> {
  const mode = process.env.STORAGE_MODE || "local";

  if (mode === "s3") {
    return storeS3(buffer);
  }

  return storeLocal(buffer);
}

export async function deleteObject(key: string): Promise<void> {
  const mode = process.env.STORAGE_MODE || "local";

  if (mode === "s3") {
    return deleteS3(key);
  }

  return deleteLocal(key);
}

export async function getObjectUrl(key: string): Promise<string> {
  const mode = process.env.STORAGE_MODE || "local";

  if (mode === "s3") {
    return getS3Url(key);
  }

  return getLocalUrl(key);
}

// ─── Local filesystem backend ────────────────────────────────────

function storeLocal(buffer: Buffer): StoredObject {
  const dir = process.env.STORAGE_LOCAL_DIR || "./dev-media";
  const key = `${randomUUID()}`;
  const path = join(dir, key);
  require("fs").writeFileSync(path, buffer);
  return { key };
}

function deleteLocal(key: string): Promise<void> {
  const dir = process.env.STORAGE_LOCAL_DIR || "./dev-media";
  return fs.unlink(join(dir, key)).catch(() => {});
}

function getLocalUrl(key: string): string {
  return `http://localhost:3001/media/photos/${key}`;
}

// ─── S3 backend (placeholder for production) ─────────────────────
// Uses @aws-sdk/client-s3 or s3-Client when STORAGE_MODE=s3
// S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY from env

async function storeS3(_buffer: Buffer): Promise<StoredObject> {
  const endpoint = process.env.S3_ENDPOINT!;
  const region = process.env.S3_REGION || "us-east-1";
  const bucket = process.env.S3_BUCKET!;

  // S3 implementation deferred to production wiring
  // This is a stub — throws until S3 env vars are configured
  throw new Error(
    `S3 storage not yet wired. Set S3 env vars or use STORAGE_MODE=local for development.`
  );
}

async function deleteS3(_key: string): Promise<void> {
  throw new Error("S3 storage not wired.");
}

function getS3Url(key: string): string {
  const endpoint = process.env.S3_ENDPOINT!;
  const bucket = process.env.S3_BUCKET!;
  return `${endpoint}/${bucket}/${key}`;
}