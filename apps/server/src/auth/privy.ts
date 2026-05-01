import { env } from "@auto/env/server";
import { PrivyClient } from "@privy-io/node";

// Initialize Privy client with optional JWT verification key for performance
// https://docs.privy.io/recipes/dashboard/optimizing
export const privy = new PrivyClient({
	appId: env.PRIVY_APP_ID,
	appSecret: env.PRIVY_APP_SECRET,
	// Optional: Set verification key to avoid extra API call on each verification
	...(env.PRIVY_JWT_VERIFICATION_KEY && {
		jwtVerificationKey: env.PRIVY_JWT_VERIFICATION_KEY,
	}),
});

// Re-export type for use in middleware
export type { VerifyAccessTokenResponse } from "@privy-io/node";
