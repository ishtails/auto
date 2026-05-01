import { env } from "@auto/env/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
	agentProfiles,
	agentProfilesRelations,
	users,
	usersRelations,
	vaultDeployments,
	vaultDeploymentsRelations,
	vaults,
	vaultsRelations,
} from "./schema";

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle({
	client: queryClient,
	schema: {
		users,
		usersRelations,
		vaults,
		vaultsRelations,
		agentProfiles,
		agentProfilesRelations,
		vaultDeployments,
		vaultDeploymentsRelations,
	},
});
