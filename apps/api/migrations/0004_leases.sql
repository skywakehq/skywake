CREATE TABLE "api"."leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
