export const BASE_MAINNET_CHAIN_ID = 8453;

export const TOKENS = {
	WETH: {
		symbol: "WETH",
		address: "0x4200000000000000000000000000000000000006",
		decimals: 18,
		BASE_MAINNET_ADDRESS: "0x4200000000000000000000000000000000000006",
	},
	USDC: {
		symbol: "USDC",
		address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
		decimals: 6,
		BASE_MAINNET_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		BASE_SEPOLIA_POOL: {
			address: "0x46880b404cd35c165eddeff7421019f8dd25f4ad",
			feeTier: 3000,
		},
	},
	MEDIA: {
		symbol: "MEDIA",
		address: "0xc7f3ec6e0259ce1e2beabac42e2f0478ca8d74e1",
		decimals: 18,
		BASE_MAINNET_ADDRESS: "0x6E51B3a19F114013E5Dc09D0477a536c7E4e0207",
		BASE_SEPOLIA_POOL: {
			address: "0xb37e6617c69c18ed1f6b2a9cd728da74d66e9490",
			feeTier: 500,
		},
	},
	RISE: {
		symbol: "RISE",
		address: "0x8c640a745a3e00e9aac62eb9d90885844f070a01",
		decimals: 18,
		BASE_MAINNET_ADDRESS: "0xf25620f89d0e23a8ba7b11ab3235b66268794196",
		BASE_SEPOLIA_POOL: {
			address: "0xe5610e7c06a2d86635820f95a3f7c23f8658ace1",
			feeTier: 3000,
		},
	},
} as const satisfies Record<
	string,
	{
		symbol: string;
		address: `0x${string}`;
		decimals: number;
		BASE_MAINNET_ADDRESS: `0x${string}`;
		BASE_SEPOLIA_POOL?: { address: `0x${string}`; feeTier: 500 | 3000 | 10000 };
	}
>;

export type TokenKey = keyof typeof TOKENS;
export type TokenConfig = (typeof TOKENS)[TokenKey];

/** Testnet addresses the agent may trade (execution). */
export const getWhitelistedTradeAddresses = (): Set<string> =>
	new Set(Object.values(TOKENS).map((t) => t.address.toLowerCase() as string));

export const getDecimalsForTokenAddress = (address: string): number => {
	const lower = address.toLowerCase();
	for (const t of Object.values(TOKENS)) {
		if (t.address.toLowerCase() === lower) {
			return t.decimals;
		}
	}
	return 18;
};

export const getTokenRowByTestnetAddress = (
	address: string
): TokenConfig | undefined => {
	const lower = address.toLowerCase();
	for (const t of Object.values(TOKENS)) {
		if (t.address.toLowerCase() === lower) {
			return t;
		}
	}
	return;
};

/** Single-hop WETH↔X or double-hop X↔Y via WETH using configured Sepolia pools only. */
export type ConfiguredSepoliaV3Route =
	| { kind: "single"; fee: number; poolAddress: `0x${string}` }
	| {
			kind: "double";
			firstFee: number;
			firstPool: `0x${string}`;
			secondFee: number;
			secondPool: `0x${string}`;
	  };

const wethLower = (): string => TOKENS.WETH.address.toLowerCase();

const poolMetaForNonWeth = (
	addr: string
): {
	poolAddress: `0x${string}`;
	fee: number;
} => {
	const lower = addr.toLowerCase();
	if (lower === wethLower()) {
		throw new Error(
			"internal: WETH has no BASE_SEPOLIA_POOL entry; use the other token"
		);
	}
	const row = getTokenRowByTestnetAddress(addr);
	const p =
		row && "BASE_SEPOLIA_POOL" in row ? row.BASE_SEPOLIA_POOL : undefined;
	if (!p) {
		throw new Error(
			`No BASE_SEPOLIA_POOL in TOKENS for ${addr} — add pool address and feeTier for Base Sepolia`
		);
	}
	return { poolAddress: p.address as `0x${string}`, fee: p.feeTier };
};

export const getConfiguredSepoliaV3Route = (
	tokenIn: string,
	tokenOut: string
): ConfiguredSepoliaV3Route => {
	const w = wethLower();
	const a = tokenIn.toLowerCase();
	const b = tokenOut.toLowerCase();
	if (a === b) {
		throw new Error("tokenIn and tokenOut must differ");
	}

	if (a === w) {
		const m = poolMetaForNonWeth(b);
		return { kind: "single", fee: m.fee, poolAddress: m.poolAddress };
	}
	if (b === w) {
		const m = poolMetaForNonWeth(a);
		return { kind: "single", fee: m.fee, poolAddress: m.poolAddress };
	}

	const mA = poolMetaForNonWeth(a);
	const mB = poolMetaForNonWeth(b);
	return {
		kind: "double",
		firstFee: mA.fee,
		firstPool: mA.poolAddress,
		secondFee: mB.fee,
		secondPool: mB.poolAddress,
	};
};

/** JSON line per token for LLM allowlist (testnet execution + mainnet DexScreener reference). */
export const buildTokenAllowlistPromptLines = (): string[] => {
	const lines: string[] = [];
	for (const [key, t] of Object.entries(TOKENS) as [TokenKey, TokenConfig][]) {
		const main = t.BASE_MAINNET_ADDRESS;
		const pool = "BASE_SEPOLIA_POOL" in t ? t.BASE_SEPOLIA_POOL : undefined;
		const poolSuffix = pool
			? ` sepoliaPool=${pool.address} feeTier=${pool.feeTier}`
			: "";
		lines.push(
			`- ${key}: symbol=${t.symbol} testnet=${t.address} mainnetRef=${main} decimals=${t.decimals}${poolSuffix}`
		);
	}
	return lines;
};
