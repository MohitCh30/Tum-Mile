CREATE TABLE "scene_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"premise_id" text NOT NULL,
	"cast_a_id" text NOT NULL,
	"cast_b_id" text NOT NULL,
	"proposed_by_id" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_cast_differs" CHECK ("scene_sessions"."cast_a_id" <> "scene_sessions"."cast_b_id"),
	CONSTRAINT "scene_status_valid" CHECK ("scene_sessions"."status" in ('proposed', 'declined', 'playing', 'letters', 'finished', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "scene_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'line' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_turn_kind_valid" CHECK ("scene_turns"."kind" in ('line', 'letter')),
	CONSTRAINT "scene_turn_ordinal_positive" CHECK ("scene_turns"."ordinal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "scene_sessions" ADD CONSTRAINT "scene_sessions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_sessions" ADD CONSTRAINT "scene_sessions_cast_a_id_profiles_id_fk" FOREIGN KEY ("cast_a_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_sessions" ADD CONSTRAINT "scene_sessions_cast_b_id_profiles_id_fk" FOREIGN KEY ("cast_b_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_sessions" ADD CONSTRAINT "scene_sessions_proposed_by_id_profiles_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_turns" ADD CONSTRAINT "scene_turns_session_id_scene_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."scene_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_turns" ADD CONSTRAINT "scene_turns_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scenes_match" ON "scene_sessions" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "idx_scene_turns_session" ON "scene_turns" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_scene_turn_position" ON "scene_turns" USING btree ("session_id","kind","ordinal");