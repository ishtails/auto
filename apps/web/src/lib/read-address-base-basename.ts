import { env } from "@auto/env/web";
import {
	type Address,
	createPublicClient,
	http,
	isAddress,
	type PublicClient,
	toCoinType,
} from "viem";
import { baseSepolia, mainnet } from "viem/chains";
import { getEnsName, normalize } from "viem/ens";

const defaultMainnetHttp = mainnet.rpcUrls.default.http[0];

/** ENSIP-9 EIP-155 coin type for the vault chain (Basenames / ENSIP-19). */
const baseBasenameCoinType = toCoinType(baseSepolia.id);

const isBasenameDebug =
	typeof process !== "undefined" && process.env.NODE_ENV === "development";

function debugBasename(message: string, payload?: Record<string, unknown>) {
	if (!isBasenameDebug) {
		return;
	}
	if (payload) {
		console.log(`[basename-debug] ${message}`, payload);
	} else {
		console.log(`[basename-debug] ${message}`);
	}
}

let mainnetEnsClient: PublicClient | null = null;

function getMainnetEnsClient(): PublicClient {
	if (!mainnetEnsClient) {
		mainnetEnsClient = createPublicClient({
			chain: mainnet,
			transport: http(
				env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL ?? defaultMainnetHttp
			),
		});
	}
	return mainnetEnsClient;
}

/**
 * Reverse-resolve a Basename / ENSIP-19 primary name for an address on Base
 * Sepolia via Ethereum mainnet's universal resolver (CCIP-read). Returns null
 * when unset, invalid address, or RPC/resolution fails.
 */
export async function readAddressBaseBasename(
	address: string
): Promise<string | null> {
	if (!isAddress(address)) {
		debugBasename("skip: not a valid address", { address });
		return null;
	}
	debugBasename("getEnsName (ENSIP-19 reverse / primary name)", {
		address,
		chainIdForCoinType: baseSepolia.id,
		coinType: baseBasenameCoinType.toString(),
		hint: "Null here usually means no primary name set for this address on Base Sepolia — forward addr record alone is not enough.",
	});
	try {
		const client = getMainnetEnsClient();
		const raw = await getEnsName(client, {
			address: address as Address,
			coinType: baseBasenameCoinType,
		});
		if (!raw) {
			debugBasename("getEnsName returned null/empty", {
				address,
				raw,
			});
			return null;
		}
		const normalized = normalize(raw);
		debugBasename("resolved", { address, raw, normalized });
		return normalized;
	} catch (error) {
		debugBasename("getEnsName threw (RPC/CCIP/universal resolver)", {
			address,
			error:
				error instanceof Error
					? { message: error.message, name: error.name }
					: String(error),
		});
		return null;
	}
}
