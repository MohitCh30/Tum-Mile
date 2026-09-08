CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"verification_token_hash" text,
	"verification_token_expires_at" timestamp with time zone,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "no_self_block" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"id" text PRIMARY KEY NOT NULL,
	"liker_profile_id" text NOT NULL,
	"liked_profile_id" text NOT NULL,
	"quoted_line" text NOT NULL,
	"opening_message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"surfaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "no_self_like" CHECK ("likes"."liker_profile_id" <> "likes"."liked_profile_id"),
	CONSTRAINT "like_status_valid" CHECK ("likes"."status" in ('pending', 'surfaced', 'expired', 'matched', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_a_id" text NOT NULL,
	"profile_b_id" text NOT NULL,
	"unmatched_at" timestamp with time zone,
	"unmatched_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_canonical_order" CHECK ("matches"."profile_a_id" < "matches"."profile_b_id")
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"sender_profile_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"reported_profile_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"strike_count" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strike_count_non_negative" CHECK ("moderation_cases"."strike_count" >= 0),
	CONSTRAINT "case_status_valid" CHECK ("moderation_cases"."status" in ('open', 'reviewing', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "passes" (
	"id" text PRIMARY KEY NOT NULL,
	"passer_profile_id" text NOT NULL,
	"passed_profile_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "no_self_pass" CHECK ("passes"."passer_profile_id" <> "passes"."passed_profile_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"birth_date" timestamp with time zone NOT NULL,
	"gender" text NOT NULL,
	"seeking" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"one_line" text,
	"form_type" text,
	"form_body" text,
	"currently" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currently_updated_at" timestamp with time zone,
	"prompt_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text,
	"wants_kids" text,
	"diet" text,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"religion" text,
	"preferences" jsonb DEFAULT '{"ageMin":18,"ageMax":45,"distanceRadiusKm":40,"openToLongDistance":false}'::jsonb NOT NULL,
	"privacy" jsonb DEFAULT '{"showDistance":true}'::jsonb NOT NULL,
	"moderation_status" text DEFAULT 'active' NOT NULL,
	"location_geohash" text,
	"last_location_update" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "one_line_length" CHECK (char_length("profiles"."one_line") <= 90),
	CONSTRAINT "form_type_valid" CHECK ("profiles"."form_type" in ('letter', 'memoir', 'poem', 'list')),
	CONSTRAINT "status_valid" CHECK ("profiles"."status" in ('single', 'newly_single', 'single_long', 'not_over_ex', 'situationship', 'complicated', 'not_in_a_hurry')),
	CONSTRAINT "wants_kids_valid" CHECK ("profiles"."wants_kids" in ('want', 'dont', 'unsure', 'have')),
	CONSTRAINT "diet_valid" CHECK ("profiles"."diet" in ('veg', 'non_veg', 'eggetarian', 'jain', 'vegan')),
	CONSTRAINT "moderation_status_valid" CHECK ("profiles"."moderation_status" in ('active', 'restricted', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "question_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"question_id" text NOT NULL,
	"answer" text NOT NULL,
	"acceptable" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_non_negotiable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_onboarding" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"reported_id" text NOT NULL,
	"match_id" text,
	"reason" text NOT NULL,
	"details" text DEFAULT '',
	"status" text DEFAULT 'submitted' NOT NULL,
	"resolution" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "no_self_report" CHECK ("reports"."reporter_id" <> "reports"."reported_id"),
	CONSTRAINT "report_reason_valid" CHECK ("reports"."reason" in ('spam', 'harassment', 'scam', 'deception', 'other')),
	CONSTRAINT "report_status_valid" CHECK ("reports"."status" in ('submitted', 'reviewing', 'actioned', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_profiles_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_profiles_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_liker_profile_id_profiles_id_fk" FOREIGN KEY ("liker_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_liked_profile_id_profiles_id_fk" FOREIGN KEY ("liked_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_profile_a_id_profiles_id_fk" FOREIGN KEY ("profile_a_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_profile_b_id_profiles_id_fk" FOREIGN KEY ("profile_b_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_unmatched_by_profiles_id_fk" FOREIGN KEY ("unmatched_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_profile_id_profiles_id_fk" FOREIGN KEY ("sender_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_reported_profile_id_profiles_id_fk" FOREIGN KEY ("reported_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_passer_profile_id_profiles_id_fk" FOREIGN KEY ("passer_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_passed_profile_id_profiles_id_fk" FOREIGN KEY ("passed_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_auth_user_id_auth_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_profiles_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_profiles_id_fk" FOREIGN KEY ("reported_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_auth_user_id_auth_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_actor_created" ON "audit_events" USING btree ("actor_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_resource" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_auth_users_email" ON "auth_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_blocks_pair" ON "blocks" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "idx_blocks_blocked" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_likes_pair" ON "likes" USING btree ("liker_profile_id","liked_profile_id");--> statement-breakpoint
CREATE INDEX "idx_likes_liked_status" ON "likes" USING btree ("liked_profile_id","status");--> statement-breakpoint
CREATE INDEX "idx_likes_liker_created" ON "likes" USING btree ("liker_profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_matches_pair" ON "matches" USING btree ("profile_a_id","profile_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reaction_message_profile" ON "message_reactions" USING btree ("message_id","profile_id");--> statement-breakpoint
CREATE INDEX "idx_messages_match_created" ON "messages" USING btree ("match_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_mod_profile" ON "moderation_cases" USING btree ("reported_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_passes_pair" ON "passes" USING btree ("passer_profile_id","passed_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_profiles_auth_user" ON "profiles" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "idx_profiles_geohash" ON "profiles" USING btree ("location_geohash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_answers_profile_question" ON "question_answers" USING btree ("profile_id","question_id");--> statement-breakpoint
CREATE INDEX "idx_answers_profile" ON "question_answers" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_questions_active" ON "questions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_reports_reported" ON "reports" USING btree ("reported_id");--> statement-breakpoint
CREATE INDEX "idx_reports_status" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sessions_token" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");