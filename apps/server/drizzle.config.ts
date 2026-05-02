import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
	path: process.env.DRIZZLE_ENV_FILE,
});

/**
 * Drizzle Kit introspects CHECK constraints from the DB. With hosts like Supabase,
 * the transaction pooler (often :6543) can return incomplete metadata and kit crashes with:
 * `Cannot read properties of undefined (reading 'replace')`.
 * Use a direct Postgres URL (often :5432 / "session" mode) for push/pull only, e.g.
 * `DRIZZLE_DATABASE_URL`, while the app keeps `DATABASE_URL` on the pooler if you prefer.
 */
const databaseUrl =
	process.env.DRIZZLE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"Missing DATABASE_URL (or DRIZZLE_DATABASE_URL). Set DRIZZLE_ENV_FILE to an env file that defines one of them."
	);
}

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	/** Avoid introspecting auth/storage/etc.; reduces kit crashes on managed Postgres. */
	schemaFilter: ["public"],
	dbCredentials: {
		url: databaseUrl,
	},
});
