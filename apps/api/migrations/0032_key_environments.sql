ALTER TABLE "api"."keys" ADD COLUMN "environment" text;--> statement-breakpoint
ALTER TABLE "api"."keys" ADD COLUMN "only" text[] DEFAULT '{*}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "api"."keys" SET
  "environment" = CASE
    WHEN "namespaces" = '*' THEN NULL
    WHEN position('/' in "namespaces") > 0 THEN split_part("namespaces", '/', 1)
    ELSE 'default'
  END,
  "only" = CASE
    WHEN "namespaces" = '*' THEN '{*}'::text[]
    WHEN position('/' in "namespaces") > 0 THEN ARRAY[substr("namespaces", position('/' in "namespaces") + 1)]
    ELSE ARRAY["namespaces"]
  END;
