ALTER TABLE "likes" DROP CONSTRAINT "like_status_valid";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "like_status_valid" CHECK ("likes"."status" in ('pending', 'surfaced', 'expired', 'matched', 'declined', 'withdrawn'));