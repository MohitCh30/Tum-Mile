ALTER TABLE "auth_users" ADD COLUMN "pending_email" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "pending_email_canonical" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "pending_email_code_hash" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "pending_email_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "pending_email_attempts" integer DEFAULT 0 NOT NULL;