import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function validateGoogleGenAiEnv(e: {
	GOOGLE_GENAI_USE_VERTEXAI: boolean;
	GEMINI_API_KEY?: string | undefined;
	GCP_SERVICE_ACCOUNT_JSON?: string | undefined;
	GOOGLE_CLOUD_PROJECT?: string | undefined;
	GOOGLE_CLOUD_LOCATION?: string | undefined;
	GOOGLE_VERTEX_BASE_URL?: string | undefined;
}): void {
	if (e.GOOGLE_GENAI_USE_VERTEXAI) {
		if (!e.GOOGLE_CLOUD_PROJECT?.trim()) {
			throw new Error(
				"Invalid environment variables: GOOGLE_CLOUD_PROJECT is required when GOOGLE_GENAI_USE_VERTEXAI=true"
			);
		}
		if (!e.GOOGLE_CLOUD_LOCATION?.trim()) {
			throw new Error(
				"Invalid environment variables: GOOGLE_CLOUD_LOCATION is required when GOOGLE_GENAI_USE_VERTEXAI=true"
			);
		}
		if (e.GEMINI_API_KEY?.trim()) {
			throw new Error(
				"Invalid environment variables: GEMINI_API_KEY cannot be set together with GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION (Vertex AI mode)"
			);
		}
		if (!e.GCP_SERVICE_ACCOUNT_JSON?.trim()) {
			throw new Error(
				"Invalid environment variables: GCP_SERVICE_ACCOUNT_JSON is required when GOOGLE_GENAI_USE_VERTEXAI=true"
			);
		}
		const vertexBaseUrl = e.GOOGLE_VERTEX_BASE_URL?.trim();
		if (vertexBaseUrl) {
			const normalized = vertexBaseUrl.endsWith("/")
				? vertexBaseUrl
				: `${vertexBaseUrl}/`;
			const isAllowedHost =
				normalized === "https://aiplatform.googleapis.com/" ||
				normalized.endsWith("-aiplatform.googleapis.com/");
			if (!isAllowedHost) {
				throw new Error(
					"Invalid environment variables: GOOGLE_VERTEX_BASE_URL must be https://aiplatform.googleapis.com/ or https://{region}-aiplatform.googleapis.com/"
				);
			}
		}
	} else if (!e.GEMINI_API_KEY?.trim()) {
		throw new Error(
			"Invalid environment variables: GEMINI_API_KEY is required when GOOGLE_GENAI_USE_VERTEXAI is false"
		);
	}
}

export const env = createEnv({
	server: {
		CORS_ORIGIN: z.url(),
		/**
		 * Gemini Developer API key. Required when GOOGLE_GENAI_USE_VERTEXAI is false.
		 * Must be unset when GOOGLE_GENAI_USE_VERTEXAI is true (Vertex client uses project/location + ADC).
		 */
		GEMINI_API_KEY: z.string().min(1).optional(),
		GEMINI_MODEL: z.string().min(1),
		/**
		 * When true, use Vertex AI (GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION, and typically GCP ADC).
		 * When false, use the Gemini API with GEMINI_API_KEY.
		 */
		GOOGLE_GENAI_USE_VERTEXAI: z
			.enum(["true", "false"])
			.default("false")
			.transform((val) => val === "true"),
		/**
		 * Raw Service Account JSON (single-line). Used to authenticate Vertex AI via ADC.
		 * Required when GOOGLE_GENAI_USE_VERTEXAI is true.
		 */
		GCP_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
		/**
		 * Optional override for the Vertex REST base URL used by `@google/genai`.
		 * If set, must be `https://aiplatform.googleapis.com/` or `https://{region}-aiplatform.googleapis.com/`.
		 */
		GOOGLE_VERTEX_BASE_URL: z.string().min(1).optional(),
		/** Google Cloud project ID (string), required when GOOGLE_GENAI_USE_VERTEXAI=true. */
		GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
		/** Vertex region (e.g. us-central1), required when GOOGLE_GENAI_USE_VERTEXAI=true. */
		GOOGLE_CLOUD_LOCATION: z.string().min(1).optional(),
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
		/**
		 * Optional Ethereum L1 RPC for ENS reads (`getEnsName` / `getEnsAvatar`).
		 * Defaults to viem mainnet public RPC when unset.
		 */
		ETH_MAINNET_RPC_URL: z.string().url().optional(),
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
		/**
		 * 0G Compute **Router** (OpenAI-compatible) — secondary risk pass that audits the Gemini proposal.
		 * @see https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview
		 */
		OG_COMPUTE_ROUTER_URL: z
			.string()
			.url()
			.default("https://router-api-testnet.integratenetwork.work/v1"),
		/** Router API key from https://pc.testnet.0g.ai/ (testnet) or mainnet PC. */
		OG_COMPUTE_ROUTER_API_KEY: z.string().min(1).optional(),
		/** Model id on 0G Compute Router (catalog). Default: Qwen 7B instruct on 0G testnet. */
		OG_COMPUTE_ROUTER_MODEL: z
			.string()
			.min(1)
			.default("qwen/qwen-2.5-7b-instruct"),
		/**
		 * When true, send `response_format: json_object` (disable if your model rejects it).
		 */
		OG_COMPUTE_ROUTER_JSON_MODE: z
			.enum(["true", "false"])
			.default("true")
			.transform((v) => v === "true"),
		OG_RPC_URL: z.url(),
		OG_INDEXER_RPC: z.url(),
		OG_KV_ENDPOINT: z.url(),
		OG_PRIVATE_KEY: z.string().min(1),
		OG_KV_STREAM_ID: z.string().min(1),
		OG_FLOW_CONTRACT: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
		/**
		 * When true, each cycle also uploads a **DA / blob** trace (`MemData` + `Indexer.upload`)
		 * per [Storage SDK](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk) — dual pattern with **KV** hot keys.
		 * Uses the same `OG_INDEXER_RPC`, `OG_RPC_URL`, and `OG_PRIVATE_KEY` as KV (no extra env).
		 */
		OG_DA_CYCLE_TRACE: z
			.enum(["true", "false"])
			.default("true")
			.transform((v) => v === "true"),
		/** Shown in `/diagnostics` — link to 0G Storage explorer (Galileo). */
		OG_STORAGE_EXPLORER_BASE: z
			.string()
			.url()
			.default("https://storagescan-galileo.0g.ai"),
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

		/**
		 * In-process vault scheduler: poll DB and run due trade cycles.
		 * Set false if you run a separate worker or want cycles manual-only.
		 */
		SCHEDULER_ENABLED: z
			.enum(["true", "false"])
			.default("true")
			.transform((v) => v === "true"),
		/** Minimum allowed schedule interval (seconds). Demo video: 60; prod: 900+. */
		SCHEDULER_MIN_CADENCE_SECONDS: z.coerce.number().int().min(1).default(900),
		/** How often the scheduler wakes to scan for due vaults (ms). */
		SCHEDULER_TICK_MS: z.coerce.number().int().min(5000).default(60_000),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

validateGoogleGenAiEnv(env);
