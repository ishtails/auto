import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("Missing DATABASE_URL");
}

const sql = postgres(databaseUrl, { max: 1 });

try {
	await sql.begin(async (tx) => {
		await tx`TRUNCATE TABLE
			"vault_deployments",
			"agent_profiles",
			"vaults",
			"users"
			RESTART IDENTITY CASCADE`;
	});

	console.log("✓ Wiped app data (kept tables)");
} finally {
	await sql.end({ timeout: 5 });
}
