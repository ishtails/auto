import type { IntegrationServices } from "@auto/api/context";
import type { RiskDecision, TradeProposal } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import {
	BASE_MAINNET_CHAIN_ID,
	buildTokenAllowlistPromptLines,
	getDecimalsForTokenAddress,
	getWhitelistedTradeAddresses,
	TOKENS,
} from "../config";
import { db } from "../db";
import { AxlTransport } from "../integrations/axl-transport";
import { ChainStateClient } from "../integrations/chain-state";
import { getDexScreenerMarketContext } from "../integrations/dexscreener";
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

const autoVaultIdPrefix = "auto-vault-";
const uuidLikeRegex =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const extractVaultIdFromMemoryPointer = (
	memoryPointer: string
): string | null => {
	if (!memoryPointer.startsWith(autoVaultIdPrefix)) {
		return null;
	}
	const id = memoryPointer.slice(autoVaultIdPrefix.length);
	// Basic shape check: uuid v4-ish
	if (!uuidLikeRegex.test(id)) {
		return null;
	}
	return id;
};

const getRecentMemoryFromDb = async (
	memoryPointer: string
): Promise<
	{
		action: string;
		reasoning: string;
		timestamp: string;
		status: string;
	}[]
> => {
	const vaultId = extractVaultIdFromMemoryPointer(memoryPointer);
	if (!vaultId) {
		return [];
	}

	const rows = await db.query.vaultCycleLogs.findMany({
		where: (table, { eq }) => eq(table.vaultId, vaultId),
		orderBy: (table, { desc }) => desc(table.occurredAt),
		limit: 5,
	});

	return rows.map((row) => {
		const record = row.record as {
			proposal?: { action?: string; reasoning?: string };
			riskDecision?: { decision?: string };
			timestamp?: string;
		};

		return {
			action: record.proposal?.action ?? "UNKNOWN",
			reasoning: record.proposal?.reasoning ?? "",
			timestamp: record.timestamp ?? row.occurredAt.toISOString(),
			status: record.riskDecision?.decision ?? row.decision,
		};
	});
};

const buildDexScreenerPromptContext = (
	market: Awaited<ReturnType<typeof getDexScreenerMarketContext>>
): string | undefined => {
	if (!market) {
		return;
	}
	return [
		`source=${market.source}`,
		`chain=${market.chain}`,
		market.dexId ? `dex=${market.dexId}` : null,
		market.pairAddress ? `pair=${market.pairAddress}` : null,
		market.url ? `url=${market.url}` : null,
		market.priceUsd ? `priceUsd=${market.priceUsd}` : null,
		market.priceNative ? `priceNative=${market.priceNative}` : null,
		market.priceChange1hPct === null
			? null
			: `priceChange1hPct=${market.priceChange1hPct}`,
		market.priceChange24hPct === null
			? null
			: `priceChange24hPct=${market.priceChange24hPct}`,
		market.buys1h !== null && market.sells1h !== null
			? `txns1h(buys=${market.buys1h}, sells=${market.sells1h}, ratio=${market.buySellRatio1h ?? "n/a"})`
			: null,
		market.buys24h !== null && market.sells24h !== null
			? `txns24h(buys=${market.buys24h}, sells=${market.sells24h}, ratio=${market.buySellRatio24h ?? "n/a"})`
			: null,
		market.volume24h === null ? null : `volume24h=${market.volume24h}`,
		market.liquidityUsd === null ? null : `liquidityUsd=${market.liquidityUsd}`,
	]
		.filter((line): line is string => typeof line === "string")
		.join("\n");
};

const isDebugEnabled = (): boolean => process.env.DEBUG === "true";

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

	const allowedTokens = getWhitelistedTradeAddresses();

	return {
		getState: async ({ amountIn, maxTradeBps }, vaultConfig) => {
			const chainStateDynamic = new ChainStateClient(
				env.CHAIN_RPC_URL,
				vaultConfig.vaultAddress
			);

			const portfolioBalancesWei: Record<string, string> = {};
			for (const t of Object.values(TOKENS)) {
				const bal = await chainStateDynamic.getVaultBalance(t.address);
				portfolioBalancesWei[t.address.toLowerCase()] = bal.toString();
			}

			const hub = TOKENS.WETH.address;
			const hubBal = BigInt(portfolioBalancesWei[hub.toLowerCase()] ?? "0");

			return {
				hubTokenAddress: hub,
				maxTradeBps,
				portfolioBalancesWei,
				priceHint:
					"multi-asset WETH hub on Base Sepolia; DexScreener panels are Base mainnet reference only",
				requestedAmountInWei: amountIn,
				tokenIn: hub,
				tokenOut: TOKENS.USDC.address,
				vaultBalanceWei: hubBal,
			};
		},
		getVaultBalances: async (vaultConfig) => {
			const chainStateDynamic = new ChainStateClient(
				env.CHAIN_RPC_URL,
				vaultConfig.vaultAddress
			);

			const [wethWei, usdcWei] = await Promise.all([
				chainStateDynamic.getVaultBalance(vaultConfig.tokenIn),
				chainStateDynamic.getVaultBalance(vaultConfig.tokenOut),
			]);
			return { wethWei, usdcWei };
		},
		generateProposal: async (state, vaultConfig) => {
			const streamId = vaultConfig.memoryPointer;
			const dynamicLogger = new OgLogger(
				env.OG_INDEXER_RPC,
				env.OG_KV_ENDPOINT,
				streamId,
				env.OG_RPC_URL,
				env.OG_PRIVATE_KEY,
				env.OG_FLOW_CONTRACT
			);

			// Prefer Postgres cache (reliable). Fall back to 0G read (best-effort).
			const memoryFromDb = await getRecentMemoryFromDb(streamId).catch(
				() => []
			);
			const memory =
				memoryFromDb.length > 0
					? memoryFromDb
					: await Promise.race([
							dynamicLogger.readRecentLogs(5).catch(() => []),
							new Promise<[]>((resolve) =>
								setTimeout(() => resolve([]), MEMORY_READ_TIMEOUT_MS)
							),
						]).then((recentLogs) =>
							recentLogs.map((log) => ({
								action: log.proposal.action,
								reasoning: log.proposal.reasoning,
								timestamp: log.timestamp,
								status: log.riskDecision.decision,
							}))
						);

			const wethMain = TOKENS.WETH.BASE_MAINNET_ADDRESS;
			const sections: string[] = [
				"=== MARKET CONTEXT: Base MAINNET — REFERENCE ONLY (execution is Base Sepolia testnet) ===",
			];
			for (const [key, t] of Object.entries(TOKENS)) {
				if (key === "WETH") {
					continue;
				}
				const mainOut = t.BASE_MAINNET_ADDRESS;
				if (!mainOut) {
					continue;
				}
				const m = await getDexScreenerMarketContext({
					chainId: BASE_MAINNET_CHAIN_ID,
					tokenIn: wethMain,
					tokenOut: mainOut,
				});
				sections.push(
					`--- ${key} vs WETH (mainnet reference) ---`,
					buildDexScreenerPromptContext(m) ?? "unavailable"
				);
			}
			const marketContext = sections.join("\n\n");
			if (isDebugEnabled()) {
				console.log("[DexScreener] batched mainnet reference context", {
					chars: marketContext.length,
				});
			}

			const portfolioSummary = Object.entries(TOKENS)
				.map(([key, t]) => {
					const bal =
						state.portfolioBalancesWei[t.address.toLowerCase()] ?? "0";
					return `${key}(${t.symbol}) testnet=${t.address} wei=${bal}`;
				})
				.join("\n");

			return llm.generateProposal(
				{
					allowlistLines: buildTokenAllowlistPromptLines(),
					amountInWei: state.requestedAmountInWei,
					hubTokenAddress: state.hubTokenAddress,
					mockTokenOut: TOKENS.USDC.address,
					portfolioSummary,
					priceHint: state.priceHint,
				},
				memory,
				marketContext,
				vaultConfig.geminiSystemPrompt,
				allowedTokens
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
					allowedTokens,
					maxDrawdownBps: BigInt(state.maxTradeBps),
					portfolioBalancesWei: state.portfolioBalancesWei,
				})
			),
		buildRoute: (proposal, maxSlippageBps, vaultConfig) => {
			const dynamicUniswap = new UniswapBuilder({
				chainId: env.CHAIN_ID,
				recipientAddress: vaultConfig.vaultAddress,
				routerAddress: env.UNISWAP_ROUTER_ADDRESS,
				rpcUrl: env.ROUTER_RPC_URL ?? env.CHAIN_RPC_URL,
				tradeApi: env.UNISWAP_TRADE_API_KEY
					? {
							apiKey: env.UNISWAP_TRADE_API_KEY,
							baseUrl: env.UNISWAP_TRADE_API_URL,
							permit2Disabled: env.UNISWAP_API_PERMIT2_DISABLED,
							universalRouterVersion: env.UNISWAP_UNIVERSAL_ROUTER_VERSION,
						}
					: undefined,
			});
			return dynamicUniswap.buildRoute(proposal, maxSlippageBps, {
				tokenInDecimals: getDecimalsForTokenAddress(proposal.tokenIn),
				tokenOutDecimals: getDecimalsForTokenAddress(proposal.tokenOut),
			});
		},
		executeVaultTrade: async ({ route, tokenOut: _tokenOut, vaultConfig }) => {
			const encoded = encodeVaultExecuteTrade(vaultConfig.vaultAddress, route);

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
			const streamId = vaultConfig.memoryPointer;
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
