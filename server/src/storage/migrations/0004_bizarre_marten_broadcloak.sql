ALTER TABLE "auth_users" ADD COLUMN "email_canonical" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_auth_users_email_canonical" ON "auth_users" USING btree ("email_canonical");