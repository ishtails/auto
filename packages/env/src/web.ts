import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	client: {
		NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1),
		/** Optional L1 RPC for in-browser ENS resolution; defaults to viem mainnet default when unset. */
		NEXT_PUBLIC_ETH_MAINNET_RPC_URL: z.string().url().optional(),
		NEXT_PUBLIC_SERVER_URL: z.url(),
		/** Optional — Storage Scan Galileo base URL for “open in explorer” links on cycle rows. */
		NEXT_PUBLIC_OG_STORAGE_EXPLORER_URL: z.string().url().optional(),
		/** Optional — prefix for 0G chain tx links, e.g. `https://chainscan-galileo.0g.ai/tx` */
		NEXT_PUBLIC_OG_CHAIN_TX_URL_PREFIX: z.string().url().optional(),
	},
	runtimeEnv: {
		NEXT_PUBLIC_ETH_MAINNET_RPC_URL:
			process.env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL,
		NEXT_PUBLIC_OG_CHAIN_TX_URL_PREFIX:
			process.env.NEXT_PUBLIC_OG_CHAIN_TX_URL_PREFIX,
		NEXT_PUBLIC_OG_STORAGE_EXPLORER_URL:
			process.env.NEXT_PUBLIC_OG_STORAGE_EXPLORER_URL,
		NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
		NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
	},
	emptyStringAsUndefined: true,
});
