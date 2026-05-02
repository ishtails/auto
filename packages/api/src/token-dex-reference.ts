/**
 * Base mainnet addresses for DexScreener reference pricing (must match `TOKENS` keys on the server).
 */
export const TOKEN_MAINNET_REF_BY_KEY = {
	WETH: "0x4200000000000000000000000000000000000006",
	USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	RISE: "0xf25620f89d0e23a8ba7b11ab3235b66268794196",
} as const;

export type AllowlistTokenKey = keyof typeof TOKEN_MAINNET_REF_BY_KEY;

export const DEX_SCREENER_CHAIN_SLUG_BASE = "base";

export const isAllowlistTokenKey = (key: string): key is AllowlistTokenKey =>
	key in TOKEN_MAINNET_REF_BY_KEY;
