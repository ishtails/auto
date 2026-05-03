import type {
	CycleLogRecord,
	KeeperExecutionResult,
	LlmTradingMemoryEntry,
	RiskDecision,
	RouteBuildResult,
	TradeProposal,
} from "./trade-types";

export interface TradeCycleStateInput {
	amountIn: bigint;
	/** Vault policy cap (basis points); used for deterministic risk sizing. */
	maxTradeBps: number;
}

export interface TradeCycleState {
	hubTokenAddress: string;
	maxTradeBps: number;
	/** Lowercase testnet token address → vault balance wei (all whitelisted assets). */
	portfolioBalancesWei: Record<string, string>;
	priceHint?: string;
	requestedAmountInWei: bigint;
	/** Default routing hints for fallbacks (WETH/USDC on testnet). */
	tokenIn: string;
	tokenOut: string;
	/** WETH (hub) balance on testnet; sizing cap reference. */
	vaultBalanceWei: bigint;
}

export interface DiagnosticsResult {
	/** One-liner for demos: Postgres vs 0G. */
	architecture: string;
	dataPlane: {
		postgres: string;
		zeroG: string;
	};
	keeperhub: boolean;
	links: { storageExplorer: string };
	/** @deprecated use `zeroGStorage.kvReachable` */
	og?: boolean;
	/** 0G Compute Router (`/v1/models`) reachable with `OG_COMPUTE_ROUTER_API_KEY`, or not required when `MOCK_RISK_AGENT`. */
	ogComputeRouter: boolean;
	ok: boolean;
	zeroGStorage: {
		kvReachable: boolean;
		lastWrite: null | {
			isoTime: string;
			pointer: string;
			rootHash?: string;
			txHash?: string;
		};
	};
}

export interface VaultConfig {
	geminiSystemPrompt: string;
	memoryPointer: string;
	tokenIn: string;
	tokenOut: string;
	vaultAddress: string;
}

export interface IntegrationServices {
	buildRoute: (
		proposal: TradeProposal,
		maxSlippageBps: number,
		vaultConfig: VaultConfig,
		options?: { cycleId?: string }
	) => Promise<RouteBuildResult>;
	evaluateRisk: (
		proposal: TradeProposal,
		state: TradeCycleState,
		vaultConfig: VaultConfig
	) => Promise<RiskDecision>;
	executeVaultTrade: (request: {
		route: RouteBuildResult;
		tokenOut: string;
		vaultConfig: VaultConfig;
		/** When set, Keeper Hub steps log under DEBUG run-trade-cycle. */
		cycleId?: string;
	}) => Promise<KeeperExecutionResult>;
	generateProposal: (
		state: TradeCycleState,
		vaultConfig: VaultConfig
	) => Promise<TradeProposal>;
	getDiagnostics: () => Promise<DiagnosticsResult>;
	getState: (
		input: TradeCycleStateInput,
		vaultConfig: VaultConfig
	) => Promise<TradeCycleState>;
	getVaultBalances: (vaultConfig: VaultConfig) => Promise<{
		hubTokenKey: string;
		tokens: Array<{
			address: string;
			decimals: number;
			isHub: boolean;
			key: string;
			symbol: string;
			wei: bigint;
		}>;
		usdcWei: bigint;
		wethWei: bigint;
	}>;
	logCycle: (
		record: CycleLogRecord,
		vaultConfig: VaultConfig
	) => Promise<{
		logPointer: string;
	}>;
	sendToRiskAgent: (
		proposal: TradeProposal,
		context: {
			cycleId: string;
			deterministicRisk: RiskDecision;
			/** Same structured memory as Gemini; fed explicitly into 0G Compute verifier. */
			tradingMemory: LlmTradingMemoryEntry[];
		}
	) => Promise<RiskDecision>;
}

export type AuthResult =
	| { type: "user"; privyUserId: string; walletAddress: string | null }
	| { type: "service" }
	| null;

export interface Context {
	auth: AuthResult;
	services: IntegrationServices;
	session: null;
}
