-- Unlogged: counts are written on every request and are fine to lose in a crash.
CREATE UNLOGGED TABLE "api"."rate_limits" (
	"client" text PRIMARY KEY NOT NULL,
	"window" bigint NOT NULL,
	"count" integer NOT NULL
);
