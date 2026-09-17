ALTER TABLE "profiles" ALTER COLUMN "preferences" SET DEFAULT '{"ageMin":18,"ageMax":45,"distanceRadiusKm":70,"openToLongDistance":false}'::jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "drinking" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "smoking" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "sleep_rhythm" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "drinking_valid" CHECK ("profiles"."drinking" in ('none', 'social', 'regular'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "smoking_valid" CHECK ("profiles"."smoking" in ('none', 'social', 'regular'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "sleep_rhythm_valid" CHECK ("profiles"."sleep_rhythm" in ('early_riser', 'night_owl', 'depends'));