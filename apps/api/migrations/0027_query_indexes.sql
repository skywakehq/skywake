CREATE INDEX "claims_by_session" ON "api"."claims" USING btree ("session");--> statement-breakpoint
CREATE INDEX "filesystem_sizes_by_org" ON "api"."filesystem_sizes" USING btree ("org");--> statement-breakpoint
CREATE INDEX "indexes_pinned" ON "api"."indexes" USING btree ("org") WHERE pinned_replicas IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_by_namespace" ON "api"."sessions" USING btree ("org","namespace","expires");--> statement-breakpoint
CREATE INDEX "sessions_by_expiry" ON "api"."sessions" USING btree ("expires");