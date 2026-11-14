ALTER TABLE "api"."environments" ADD COLUMN "store" text;--> statement-breakpoint
ALTER TABLE "api"."environments" ADD COLUMN "store_access" jsonb;--> statement-breakpoint
ALTER TABLE "api"."environments" ADD COLUMN "store_verified" timestamp with time zone;