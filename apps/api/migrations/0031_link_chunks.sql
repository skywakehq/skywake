ALTER TABLE "api"."index_link_branches" ADD COLUMN "cursor" text;--> statement-breakpoint
ALTER TABLE "api"."index_link_branches" ADD COLUMN "cursor_at" text;--> statement-breakpoint
ALTER TABLE "api"."index_link_branches" ADD COLUMN "files" integer;--> statement-breakpoint
ALTER TABLE "api"."index_link_branches" ADD COLUMN "chunks" integer;--> statement-breakpoint
ALTER TABLE "api"."index_link_branches" ADD COLUMN "skipped" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."index_links" ADD COLUMN "made" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "api"."index_links" AS l SET "made" = true FROM "api"."indexes" AS i WHERE i."org" = l."org" AND i."name" = l."index" AND i."schema"->'attributes' @> '[{"name": "grams"}]'::jsonb;
