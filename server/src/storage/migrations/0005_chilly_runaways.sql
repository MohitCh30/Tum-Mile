ALTER TABLE "auth_users" ADD COLUMN "verification_code_hash" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "verification_code_attempts" integer DEFAULT 0 NOT NULL;