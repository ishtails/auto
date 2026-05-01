import type {
	CycleLogRecord,
	KeeperExecutionResult,
	RiskDecision,
	RouteBuildResult,
	TradeProposal,
} from "./trade-types";

export interface TradeCycleStateInput {
	amountIn: bigint;
	tokenIn: string;
	tokenOut: string;
}

export interface TradeCycleState {
	priceHint?: string;
	requestedAmountInWei: bigint;
	tokenIn: string;
	tokenOut: string;
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
		vaultConfig?: VaultConfig
	) => Promise<RouteBuildResult>;
	evaluateRisk: (
		proposal: TradeProposal,
		state: TradeCycleState,
		vaultConfig?: VaultConfig
	) => Promise<RiskDecision>;
	executeVaultTrade: (request: {
		route: RouteBuildResult;
		tokenOut: string;
		vaultConfig?: VaultConfig;
	}) => Promise<KeeperExecutionResult>;
	generateProposal: (
		state: TradeCycleState,
		vaultConfig?: VaultConfig
	) => Promise<TradeProposal>;
	getDiagnostics: () => Promise<DiagnosticsResult>;
	getState: (
		input: TradeCycleStateInput,
		vaultConfig?: VaultConfig
	) => Promise<TradeCycleState>;
	getVaultBalances: (
		vaultConfig?: VaultConfig
	) => Promise<{ usdcWei: bigint; wethWei: bigint }>;
	logCycle: (
		record: CycleLogRecord,
		vaultConfig?: VaultConfig
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
