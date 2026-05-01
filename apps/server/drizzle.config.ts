import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
	path: process.env.DRIZZLE_ENV_FILE,
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"Missing DATABASE_URL. Provide it via environment variables or set DRIZZLE_ENV_FILE to an env file containing DATABASE_URL."
	);
}

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url: databaseUrl,
	},
});
