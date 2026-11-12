ALTER TABLE "api"."index_operations" ALTER COLUMN "branch" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."indexes" ADD COLUMN "retention_days" integer;