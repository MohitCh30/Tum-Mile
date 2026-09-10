ALTER TABLE "profiles" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_profiles_embedding" ON "profiles" USING hnsw ("embedding" vector_cosine_ops);