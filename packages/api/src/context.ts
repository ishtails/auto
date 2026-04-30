import type { Context as HonoContext } from "hono";
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

export interface IntegrationServices {
	buildRoute: (
		proposal: TradeProposal,
		maxSlippageBps: number
	) => Promise<RouteBuildResult>;
	evaluateRisk: (
		proposal: TradeProposal,
		state: TradeCycleState
	) => Promise<RiskDecision>;
	executeVaultTrade: (request: {
		route: RouteBuildResult;
		tokenOut: string;
	}) => Promise<KeeperExecutionResult>;
	generateProposal: (state: TradeCycleState) => Promise<TradeProposal>;
	getDiagnostics: () => Promise<DiagnosticsResult>;
	getState: (input: TradeCycleStateInput) => Promise<TradeCycleState>;
	getVaultBalances: () => Promise<{ usdcWei: bigint; wethWei: bigint }>;
	logCycle: (record: CycleLogRecord) => Promise<string>;
	sendToRiskAgent: (proposal: TradeProposal) => Promise<RiskDecision>;
}

export interface CreateContextOptions {
	context: HonoContext;
	services: IntegrationServices;
}

export function createContext({
	context: _context,
	services,
}: CreateContextOptions) {
	return {
		auth: null,
		session: null,
		services,
	};
}

export type Context = ReturnType<typeof createContext>;
