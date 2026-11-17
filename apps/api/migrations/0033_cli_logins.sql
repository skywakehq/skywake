CREATE TABLE "api"."logins" (
	"code" text PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"device" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logins_key_id_key" UNIQUE("key_id")
);
--> statement-breakpoint
CREATE INDEX "logins_expires" ON "api"."logins" USING btree ("expires");