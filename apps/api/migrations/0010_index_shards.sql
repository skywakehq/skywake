ALTER TABLE "api"."indexes" ADD COLUMN "shards" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."indexes" ADD COLUMN "kms_key_id" text;