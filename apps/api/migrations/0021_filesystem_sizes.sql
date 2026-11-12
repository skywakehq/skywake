CREATE TABLE "api"."filesystem_sizes" (
	"folder" text PRIMARY KEY NOT NULL,
	"org" text NOT NULL,
	"bytes" bigint NOT NULL,
	"objects" bigint NOT NULL,
	"measured" timestamp with time zone NOT NULL,
	"stale" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."filesystem_sizes" ADD CONSTRAINT "filesystem_sizes_folder_namespaces_folder_fk" FOREIGN KEY ("folder") REFERENCES "api"."namespaces"("folder") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."filesystem_sizes" ADD CONSTRAINT "filesystem_sizes_org_orgs_id_fk" FOREIGN KEY ("org") REFERENCES "api"."orgs"("id") ON DELETE cascade ON UPDATE no action;