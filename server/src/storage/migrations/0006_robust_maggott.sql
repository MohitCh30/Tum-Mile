ALTER TABLE "profiles" ADD COLUMN "notify_by_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "notified_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "admin_notified_at" timestamp with time zone;