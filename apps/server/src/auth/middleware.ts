import type { AuthResult } from "@auto/api/context";
import { env } from "@auto/env/server";
import { ORPCError } from "@orpc/server";
import type { VerifyAccessTokenResponse } from "@privy-io/node";
import { privy } from "./privy";

// Privy linked account type with address
interface LinkedAccountWithAddress {
	address: string;
	chain_type: string;
	type: "wallet";
}

/**
 * Verify a Privy access token and return the verified claims.
 * This follows the official Privy pattern:
 * https://docs.privy.io/guide/server/authorization/verification
 */
export async function verifyPrivyToken(
	token: string
): Promise<VerifyAccessTokenResponse | null> {
	try {
		// verifyAccessToken verifies the JWT signature and returns the claims
		// If jwtVerificationKey is set in the client, this is done locally
		// Otherwise, it fetches the key from Privy's API (cached)
		const claims = await privy.utils().auth().verifyAccessToken(token);
		return claims;
	} catch (error) {
		console.error("Privy token verification failed:", error);
		return null;
	}
}

/**
 * Type guard for linked accounts with addresses
 */
function hasAddress(acct: unknown): acct is LinkedAccountWithAddress {
	return (
		typeof acct === "object" &&
		acct !== null &&
		"type" in acct &&
		(acct as LinkedAccountWithAddress).type === "wallet" &&
		"address" in acct &&
		typeof (acct as LinkedAccountWithAddress).address === "string"
	);
}

/**
 * Get the wallet address for a Privy user.
 * This makes an additional API call to fetch user details.
 * Cache this result in production to avoid rate limits.
 */
export async function getUserWalletAddress(
	userId: string
): Promise<string | null> {
	try {
		const user = await privy.users()._get(userId);

		// Find the first wallet with an address
		const accounts = user.linked_accounts as unknown[];
		const wallet = accounts?.find(hasAddress);

		return wallet?.address?.toLowerCase() ?? null;
	} catch (error) {
		console.error("Failed to fetch user wallet:", error);
		return null;
	}
}

/**
 * Resolve authentication from an Authorization header.
 * Supports both Privy tokens (Bearer) and service secrets.
 * For user auth, walletAddress is fetched lazily or can be null.
 */
export async function resolveAuth(
	authHeader: string | undefined
): Promise<AuthResult> {
	if (!authHeader) {
		return null;
	}

	const token = authHeader.replace("Bearer ", "").trim();

	// Check if it's the internal service secret
	if (token === `srv_${env.SERVER_DEPLOY_SECRET}`) {
		return { type: "service" };
	}

	// Otherwise, verify as Privy token
	const claims = await verifyPrivyToken(token);

	if (!claims?.user_id) {
		return null;
	}

	// For performance, we don't fetch the wallet address here.
	// The wallet address can be fetched lazily when needed using getUserWalletAddress()
	// or retrieved from our database if already cached.
	return {
		type: "user",
		privyUserId: claims.user_id,
		walletAddress: null, // Fetched lazily when needed
	};
}

/**
 * Require authentication for oRPC procedures.
 * Throws UNAUTHORIZED error if no valid auth.
 */
export async function requireAuth(
	authHeader: string | undefined
): Promise<Exclude<AuthResult, null>> {
	const auth = await resolveAuth(authHeader);

	if (!auth) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Invalid or missing authentication token",
		});
	}

	return auth;
}
