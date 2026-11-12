// The API's types come from its OpenAPI document; `scripts/openapi.sh`
// rebuilds `generated/schema.ts`, so a change in the API shows up here as a
// type error.

import type createClient from "openapi-fetch";

import type { components, paths } from "../generated/schema.js";

export type Schemas = components["schemas"];
export type Client = ReturnType<typeof createClient<paths>>;
