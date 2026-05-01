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

const MEMORY_READ_TIMEOUT_MS = 2500;
const LOG_WRITE_TIMEOUT_MS = 8000;

export const createIntegrationServices = (): IntegrationServices => {
	const llm = new LlmAgent(env.GEMINI_MODEL, env.GEMINI_API_KEY, env.MOCK_LLM);
	const axl = new AxlTransport(
		env.AXL_TRADING_API_URL,
		env.AXL_RISK_API_URL,
		env.AXL_RISK_PEER_ID
	);
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

	const allowedTokens = new Set([
		env.TOKEN_WETH.toLowerCase(),
		env.TOKEN_USDC.toLowerCase(),
	]);

	return {
		getState: async ({ amountIn, tokenIn, tokenOut }, vaultConfig) => {
			const tokenInAddress =
				vaultConfig?.tokenIn ??
				(tokenIn === "WETH" ? env.TOKEN_WETH : env.TOKEN_USDC);
			const tokenOutAddress =
				vaultConfig?.tokenOut ??
				(tokenOut === "WETH" ? env.TOKEN_WETH : env.TOKEN_USDC);
			const vaultAddress = vaultConfig?.vaultAddress ?? env.VAULT_ADDRESS;
			const chainStateDynamic = new ChainStateClient(
				env.CHAIN_RPC_URL,
				vaultAddress
			);

			const vaultBalanceWei =
				await chainStateDynamic.getVaultBalance(tokenInAddress);
			return {
				vaultBalanceWei,
				priceHint: `${tokenIn}/${tokenOut}`,
				requestedAmountInWei: amountIn,
				tokenIn: tokenInAddress,
				tokenOut: tokenOutAddress,
			};
		},
		getVaultBalances: async (vaultConfig) => {
			const vaultAddress = vaultConfig?.vaultAddress ?? env.VAULT_ADDRESS;
			const chainStateDynamic = new ChainStateClient(
				env.CHAIN_RPC_URL,
				vaultAddress
			);
			const tokenWeth = vaultConfig ? vaultConfig.tokenIn : env.TOKEN_WETH;
			const tokenUsdc = vaultConfig ? vaultConfig.tokenOut : env.TOKEN_USDC;

			const [wethWei, usdcWei] = await Promise.all([
				chainStateDynamic.getVaultBalance(tokenWeth),
				chainStateDynamic.getVaultBalance(tokenUsdc),
			]);
			return { wethWei, usdcWei };
		},
		generateProposal: async (state, vaultConfig) => {
			const streamId = vaultConfig?.memoryPointer ?? env.OG_KV_STREAM_ID;
			const dynamicLogger = new OgLogger(
				env.OG_INDEXER_RPC,
				env.OG_KV_ENDPOINT,
				streamId,
				env.OG_RPC_URL,
				env.OG_PRIVATE_KEY,
				env.OG_FLOW_CONTRACT
			);

			const recentLogs = await Promise.race([
				dynamicLogger.readRecentLogs(5).catch(() => []),
				new Promise<[]>((resolve) =>
					setTimeout(() => resolve([]), MEMORY_READ_TIMEOUT_MS)
				),
			]);
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
			if (env.MOCK_RISK_AGENT) {
				console.log("[RiskAgent] Mock mode enabled, skipping AXL P2P");
				return {
					decision: "APPROVE",
					reason: "Mock risk agent approval",
				} as RiskDecision;
			}

			await axl.sendProposal(proposal);
			return axl.receiveDecision(10_000);
		},
		evaluateRisk: (proposal, state, _vaultConfig) =>
			Promise.resolve(
				evaluateRisk(proposal, {
					vaultBalanceWei: state.vaultBalanceWei,
					allowedTokens,
					maxDrawdownBps: 1_000n,
				})
			),
		buildRoute: (proposal, maxSlippageBps, vaultConfig) => {
			const recipientAddress = vaultConfig?.vaultAddress ?? env.VAULT_ADDRESS;
			const dynamicUniswap = new UniswapBuilder({
				chainId: env.CHAIN_ID,
				recipientAddress,
				routerAddress: env.UNISWAP_ROUTER_ADDRESS,
				rpcUrl: env.ROUTER_RPC_URL ?? env.CHAIN_RPC_URL,
				tokenInDecimals: env.TOKEN_WETH_DECIMALS,
				tokenOutDecimals: env.TOKEN_USDC_DECIMALS,
			});
			return dynamicUniswap.buildRoute(proposal, maxSlippageBps);
		},
		executeVaultTrade: async ({ route, tokenOut: _tokenOut, vaultConfig }) => {
			const vaultAddress = vaultConfig?.vaultAddress ?? env.VAULT_ADDRESS;
			const encoded = encodeVaultExecuteTrade(vaultAddress, route);

			if (env.MOCK_EXECUTION) {
				console.log(
					"[Execution] Mock mode enabled, simulating successful transaction"
				);
				await new Promise((resolve) => setTimeout(resolve, 1000));
				return {
					executionId: `mock_${Date.now()}`,
					status: "completed",
					txHash: `0x${"0".repeat(64)}`,
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
		logCycle: (record, vaultConfig) => {
			const streamId = vaultConfig?.memoryPointer ?? env.OG_KV_STREAM_ID;
			const dynamicLogger = new OgLogger(
				env.OG_INDEXER_RPC,
				env.OG_KV_ENDPOINT,
				streamId,
				env.OG_RPC_URL,
				env.OG_PRIVATE_KEY,
				env.OG_FLOW_CONTRACT
			);
			return Promise.race([
				dynamicLogger.write(record),
				new Promise<string>((resolve) => {
					setTimeout(() => {
						resolve(`${streamId}:${record.cycleId}`);
					}, LOG_WRITE_TIMEOUT_MS);
				}),
			]);
		},
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
