ALTER TABLE "api"."index_usage" ADD COLUMN "embeddings" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."index_usage" ADD COLUMN "reranks" bigint DEFAULT 0 NOT NULL;