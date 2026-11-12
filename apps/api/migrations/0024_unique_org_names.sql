ALTER TABLE "api"."orgs" DROP CONSTRAINT "orgs_name_key";--> statement-breakpoint
-- Names that differ only in case were allowed before. The oldest keeps its
-- name; each other gets its id added, which no other name can have.
UPDATE "api"."orgs" AS o SET "name" = o."name" || ' (' || o."id" || ')'
FROM (
  SELECT "id", row_number() OVER (PARTITION BY lower("name") ORDER BY "created", "id") AS n
  FROM "api"."orgs"
) AS d
WHERE d."id" = o."id" AND d.n > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_name_unique" ON "api"."orgs" USING btree (lower("name"));
