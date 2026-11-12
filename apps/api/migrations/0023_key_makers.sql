ALTER TABLE "api"."keys" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "api"."keys" ADD COLUMN "created_by_email" text;--> statement-breakpoint
CREATE INDEX "keys_created_by" ON "api"."keys" USING btree ("org","created_by");