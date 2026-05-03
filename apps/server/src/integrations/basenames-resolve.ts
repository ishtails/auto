import {
	type Address,
	type Chain,
	createPublicClient,
	getAddress,
	http,
	zeroAddress,
} from "viem";
import { readContract } from "viem/actions";
import { base, baseSepolia } from "viem/chains";
import { namehash, normalize } from "viem/ens";

/** @see https://github.com/base/basenames/blob/main/README.md — L2 Registry on Base */
const BASENAMES_REGISTRY: Record<number, Address> = {
	8453: "0xb94704422C2A1E396835A571837aa5Ae53285a95",
	84532: "0x1493B2567056C2181630115660963E13A8E32735",
};

const ensRegistryAbi = [
	{
		name: "resolver",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "node", type: "bytes32" }],
		outputs: [{ type: "address" }],
	},
] as const;

const addrResolverAbi = [
	{
		name: "addr",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "node", type: "bytes32" }],
		outputs: [{ type: "address" }],
	},
] as const;

function chainForBasenames(chainId: number): Chain | null {
	if (chainId === 8453) {
		return base;
	}
	if (chainId === 84_532) {
		return baseSepolia;
	}
	return null;
}

export function getBasenamesRegistryAddress(chainId: number): Address | null {
	return BASENAMES_REGISTRY[chainId] ?? null;
}

/**
 * Forward-resolve a `*.base.eth` name on Base L2 via Registry → resolver.addr(node).
 * Returns null if the name is invalid, missing, or has no ETH addr record.
 */
export async function resolveBasenameForwardAddress(params: {
	rpcUrl: string;
	chainId: number;
	basename: string;
}): Promise<Address | null> {
	const registry = getBasenamesRegistryAddress(params.chainId);
	const chainDefinition = chainForBasenames(params.chainId);
	if (!(registry && chainDefinition)) {
		return null;
	}

	let normalized: string;
	try {
		normalized = normalize(params.basename.trim());
	} catch {
		return null;
	}

	const client = createPublicClient({
		chain: {
			...chainDefinition,
			rpcUrls: { default: { http: [params.rpcUrl] } },
		},
		transport: http(params.rpcUrl),
	});

	const node = namehash(normalized);

	const resolver = await readContract(client, {
		address: registry,
		abi: ensRegistryAbi,
		functionName: "resolver",
		args: [node],
	});

	if (!resolver || resolver === zeroAddress) {
		return null;
	}

	const addr = await readContract(client, {
		address: resolver,
		abi: addrResolverAbi,
		functionName: "addr",
		args: [node],
	});

	if (!addr || addr === zeroAddress) {
		return null;
	}
	return getAddress(addr);
}

export function addressesEqual(a: string, b: string): boolean {
	try {
		return getAddress(a as Address) === getAddress(b as Address);
	} catch {
		return false;
	}
}
