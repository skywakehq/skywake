CREATE TABLE "api"."upload_parts" (
	"org" text NOT NULL,
	"namespace" text NOT NULL,
	"part" text NOT NULL,
	"size" integer NOT NULL,
	"chunks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_parts_pkey" PRIMARY KEY("org","namespace","part")
);
--> statement-breakpoint
ALTER TABLE "api"."upload_parts" ADD CONSTRAINT "upload_parts_org_namespace_fkey" FOREIGN KEY ("org","namespace") REFERENCES "api"."namespaces"("org","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_parts_by_age" ON "api"."upload_parts" USING btree ("created_at");