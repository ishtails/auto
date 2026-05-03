import { createWalletClient, custom } from "viem";
import { baseSepolia } from "viem/chains";

export interface PrivyWalletLike {
	address?: string;
	getEthereumProvider: () => Promise<unknown>;
	/** @see https://docs.privy.io/wallets/using-wallets/ethereum/web3-integrations */
	switchChain?: (chainId: number) => Promise<unknown>;
}

/**
 * Privy + viem: switch chain first, then build a client with `chain` set.
 * Skipping this can route wallet RPC through the wrong transport and surface
 * bogus errors (e.g. `wallet_sendTransaction` rejected by Alchemy-backed URLs).
 */
export async function getPrivyWalletClient(wallet: PrivyWalletLike) {
	if (typeof wallet.switchChain === "function") {
		await wallet.switchChain(baseSepolia.id);
	}
	const provider = await wallet.getEthereumProvider();
	return createWalletClient({
		account: wallet.address as `0x${string}`,
		chain: baseSepolia,
		transport: custom(provider as Parameters<typeof custom>[0]),
	});
}

/** Known flaky error when the tx still broadcasts — see Privy viem integration docs. */
export function isPrivyEmbeddedWalletRpcNoiseError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error);
	return (
		msg.includes("wallet_sendTransaction") ||
		msg.includes("Unsupported method: wallet_sendTransaction") ||
		(msg.includes("JSON is not a valid request object") &&
			msg.includes("privy.systems"))
	);
}
