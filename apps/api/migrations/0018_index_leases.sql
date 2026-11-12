CREATE TABLE "api"."index_leases" (
	"folder" text NOT NULL,
	"holder" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "index_leases_pkey" PRIMARY KEY("folder","holder")
);
