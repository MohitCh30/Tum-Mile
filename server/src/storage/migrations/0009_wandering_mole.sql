ALTER TABLE "profiles" ALTER COLUMN "preferences" SET DEFAULT '{"ageMin":18,"ageMax":45,"distanceRadiusKm":70,"openToLongDistance":false}'::jsonb;--> statement-breakpoint
-- Only rows still carrying the untouched 40. Anybody who ever chose a
-- radius keeps the one they chose — nobody has, since the form has never
-- asked, but the guard is what makes this safe to re-read later.
UPDATE "profiles" SET "preferences" = jsonb_set("preferences", '{distanceRadiusKm}', '70')
  WHERE "preferences"->>'distanceRadiusKm' = '40';
