import type {
	CycleLogRecord,
	KeeperExecutionResult,
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
	axl: boolean;
	keeperhub: boolean;
	og: boolean;
	ok: boolean;
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
		vaultConfig: VaultConfig
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
	) => Promise<string>;
	sendToRiskAgent: (proposal: TradeProposal) => Promise<RiskDecision>;
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
