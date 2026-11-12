import { Pool } from "pg";

const url = process.env.DATABASE_URL;

// Better Auth keeps its tables in their own schema, apart from the API's.
export const authPool = new Pool({ connectionString: url, options: "-c search_path=auth" });

// Zero records which mutations it has applied here.
export const pool = new Pool({ connectionString: url });
