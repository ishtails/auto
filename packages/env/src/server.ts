import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		CORS_ORIGIN: z.url(),
		GEMINI_API_KEY: z.string().min(1),
		GEMINI_MODEL: z.string().min(1),
		MOCK_LLM: z
			.enum(["true", "false"])
			.default("false")
			.transform((val) => val === "true"),
		MOCK_RISK_AGENT: z
			.enum(["true", "false"])
			.default("false")
			.transform((val) => val === "true"),
		MOCK_EXECUTION: z
			.enum(["true", "false"])
			.default("false")
			.transform((val) => val === "true"),
		CHAIN_ID: z.coerce.number().int().positive(),
		CHAIN_RPC_URL: z.url(),
		ROUTER_RPC_URL: z.url().optional(),
		UNISWAP_ROUTER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		/** Uniswap Developer Platform. On Base mainnet, routes via Universal Router when set. */
		UNISWAP_TRADE_API_KEY: z.string().min(1).optional(),
		/**
		 * When true on Base Sepolia (84532), use the Trading API (Universal Router calldata).
		 * Leave false when `UNISWAP_ROUTER_ADDRESS` is SwapRouter02 — the API targets Universal Router.
		 */
		UNISWAP_TRADE_API_ON_SEPOLIA: z
			.enum(["true", "false"])
			.default("false")
			.transform((v) => v === "true"),
		UNISWAP_TRADE_API_URL: z
			.string()
			.url()
			.default("https://trade-api.gateway.uniswap.org/v1"),
		UNISWAP_UNIVERSAL_ROUTER_VERSION: z.string().default("2.0"),
		UNISWAP_API_PERMIT2_DISABLED: z
			.enum(["true", "false"])
			.default("true")
			.transform((v) => v === "true"),
		TOKEN_WETH: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		TOKEN_WETH_DECIMALS: z.coerce.number().int().min(0).max(36).default(18),
		TOKEN_USDC: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		TOKEN_USDC_DECIMALS: z.coerce.number().int().min(0).max(36).default(6),
		KEEPERHUB_API_KEY: z.string().min(1),
		KEEPERHUB_BASE_URL: z.url(),
		KEEPERHUB_RELAYER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		AXL_TRADING_API_URL: z.url(),
		AXL_RISK_API_URL: z.url(),
		AXL_RISK_PEER_ID: z.string().min(1),
		OG_RPC_URL: z.url(),
		OG_INDEXER_RPC: z.url(),
		OG_KV_ENDPOINT: z.url(),
		OG_PRIVATE_KEY: z.string().min(1),
		OG_KV_STREAM_ID: z.string().min(1),
		OG_FLOW_CONTRACT: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		ENVIRONMENT: z.enum(["local", "testnet", "mainnet"]).default("local"),

		DATABASE_URL: z.url(),
		PRIVY_APP_ID: z.string().min(1),
		PRIVY_APP_SECRET: z.string().min(1),
		PRIVY_JWT_VERIFICATION_KEY: z.string().optional(),
		SERVER_DEPLOY_SECRET: z.string().min(1),
		DEPLOYER_PRIVATE_KEY: z.string().min(1),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
