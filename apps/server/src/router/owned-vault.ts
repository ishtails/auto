import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { isAddress } from "viem";
import { db } from "../db";
import { users, vaults } from "../db/schema";

export async function getOwnedActiveVault(
	privyUserId: string,
	vaultId: string
) {
	const user = await db.query.users.findFirst({
		where: eq(users.privyUserId, privyUserId),
	});

	if (!user) {
		throw new ORPCError("NOT_FOUND", { message: "User not found" });
	}

	const vault = await db.query.vaults.findFirst({
		where: and(
			eq(vaults.id, vaultId),
			eq(vaults.userId, user.id),
			eq(vaults.status, "active")
		),
		with: {
			agentProfile: true,
		},
	});

	if (!vault?.vaultAddress) {
		throw new ORPCError("NOT_FOUND", { message: "Active vault not found" });
	}
	const profile = vault.agentProfile;
	if (!profile) {
		throw new ORPCError("NOT_FOUND", { message: "Vault profile not found" });
	}
	if (!isAddress(vault.vaultAddress)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Vault address is invalid. Deployment may be incomplete.",
			data: { vaultAddress: vault.vaultAddress },
		});
	}

	const vaultAddress = vault.vaultAddress as `0x${string}`;
	return { vaultAddress, profile, vaultDbId: vault.id };
}
