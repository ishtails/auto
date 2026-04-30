import type { IntegrationServices } from "@auto/api/context";
import type { RiskDecision, TradeProposal } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { AxlTransport } from "../integrations/axl-transport";
import { ChainStateClient } from "../integrations/chain-state";
import { KeeperHubClient } from "../integrations/keeperhub-client";
import { LlmAgent } from "../integrations/llm-agent";
import { OgLogger } from "../integrations/og-logger";
import { evaluateRisk } from "../integrations/risk-gate";
import { UniswapBuilder } from "../integrations/uniswap-builder";
import { encodeVaultExecuteTrade } from "../integrations/vault-executor";

const chainIdToKeeperNetwork = (chainId: number): string => {
	if (chainId === 8453) {
		return "base";
	}
	if (chainId === 84_532) {
		return "base-sepolia";
	}
	return String(chainId);
};

export const createIntegrationServices = (): IntegrationServices => {
	const llm = new LlmAgent(env.GEMINI_MODEL, env.GEMINI_API_KEY, env.MOCK_LLM);
	const axl = new AxlTransport(
		env.AXL_TRADING_API_URL,
		env.AXL_RISK_API_URL,
		env.AXL_RISK_PEER_ID
	);
	const uniswap = new UniswapBuilder({
		chainId: env.CHAIN_ID,
		recipientAddress: env.VAULT_ADDRESS,
		routerAddress: env.UNISWAP_ROUTER_ADDRESS,
		// Use ROUTER_RPC_URL for mainnet routing (required for local dev)
		// Falls back to CHAIN_RPC_URL if not set
		rpcUrl: env.ROUTER_RPC_URL ?? env.CHAIN_RPC_URL,
		tokenInDecimals: env.TOKEN_WETH_DECIMALS,
		tokenOutDecimals: env.TOKEN_USDC_DECIMALS,
	});
	const keeperhub = new KeeperHubClient(
		env.KEEPERHUB_BASE_URL,
		env.KEEPERHUB_API_KEY
	);
	const logger = new OgLogger(
		env.OG_INDEXER_RPC,
		env.OG_KV_ENDPOINT,
		env.OG_KV_STREAM_ID,
		env.OG_RPC_URL,
		env.OG_PRIVATE_KEY,
		env.OG_FLOW_CONTRACT
	);
	const chainState = new ChainStateClient(env.CHAIN_RPC_URL, env.VAULT_ADDRESS);

	const allowedTokens = new Set([
		env.TOKEN_WETH.toLowerCase(),
		env.TOKEN_USDC.toLowerCase(),
	]);

	return {
		getState: async ({ amountIn, tokenIn, tokenOut }) => {
			const tokenInAddress =
				tokenIn === "WETH" ? env.TOKEN_WETH : env.TOKEN_USDC;
			const tokenOutAddress =
				tokenOut === "WETH" ? env.TOKEN_WETH : env.TOKEN_USDC;
			const vaultBalanceWei = await chainState.getVaultBalance(tokenInAddress);
			return {
				vaultBalanceWei,
				priceHint: `${tokenIn}/${tokenOut}`,
				requestedAmountInWei: amountIn,
				tokenIn: tokenInAddress,
				tokenOut: tokenOutAddress,
			};
		},
		getVaultBalances: async () => {
			const [wethWei, usdcWei] = await Promise.all([
				chainState.getVaultBalance(env.TOKEN_WETH),
				chainState.getVaultBalance(env.TOKEN_USDC),
			]);
			return { wethWei, usdcWei };
		},
		generateProposal: async (state) => {
			// Query memory from 0G (last 5 trades for context)
			const recentLogs = await logger.readRecentLogs(5);
			const memory = recentLogs.map((log) => ({
				action: log.proposal.action,
				reasoning: log.proposal.reasoning,
				timestamp: log.timestamp,
				status: log.riskDecision.decision,
			}));

			return llm.generateProposal(
				{
					vaultBalanceWei: state.vaultBalanceWei,
					priceHint: state.priceHint,
					tokenIn: state.tokenIn,
					tokenOut: state.tokenOut,
					amountInWei: state.requestedAmountInWei,
				},
				memory
			);
		},
		sendToRiskAgent: async (proposal: TradeProposal) => {
			// Skip AXL if mock mode enabled (AXL P2P not working locally)
			if (env.MOCK_RISK_AGENT) {
				console.log("[RiskAgent] Mock mode enabled, skipping AXL P2P");
				// Return mock APPROVE response
				return {
					decision: "APPROVE",
					reason: "Mock risk agent approval",
				} as RiskDecision;
			}

			await axl.sendProposal(proposal);
			// Poll for response (risk agent polls every 2s, we poll for up to 10s)
			return axl.receiveDecision(10_000);
		},
		evaluateRisk: (proposal, state) =>
			Promise.resolve(
				evaluateRisk(proposal, {
					vaultBalanceWei: state.vaultBalanceWei,
					allowedTokens,
					maxDrawdownBps: 1_000n,
				})
			),
		buildRoute: (proposal, maxSlippageBps) =>
			uniswap.buildRoute(proposal, maxSlippageBps),
		executeVaultTrade: async ({ route }) => {
			const encoded = encodeVaultExecuteTrade(env.VAULT_ADDRESS, route);

			// Mock execution for local testing (KeeperHub needs real ETH on mainnet)
			if (env.MOCK_EXECUTION) {
				console.log(
					"[Execution] Mock mode enabled, simulating successful transaction"
				);
				await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate network delay
				return {
					executionId: `mock_${Date.now()}`,
					status: "completed",
					txHash: `0x${"0".repeat(64)}`, // Mock tx hash
					error: null,
				};
			}

			return keeperhub.executeContractCall({
				abi: encoded.abi,
				contractAddress: encoded.target,
				functionArgs: encoded.functionArgs,
				functionName: encoded.functionName,
				network: chainIdToKeeperNetwork(env.CHAIN_ID),
				value: encoded.value,
			});
		},
		logCycle: (record) => logger.write(record),
		getDiagnostics: async () => {
			const keeperhubReachable = await fetch(
				`${env.KEEPERHUB_BASE_URL}/api/health`
			)
				.then((response) => response.ok)
				.catch(() => false);
			const axlReachable = await fetch(`${env.AXL_TRADING_API_URL}/topology`)
				.then((response) => response.ok)
				.catch(() => false);
			const ogReachable = await logger.healthcheck();

			return {
				ok: keeperhubReachable && axlReachable && ogReachable,
				keeperhub: keeperhubReachable,
				axl: axlReachable,
				og: ogReachable,
			};
		},
	};
};
