import { ORPCError } from "@orpc/server";

// DO NOT REMOVE: This debug logger is intentionally always available behind
// `DEBUG=true` for investigating prod/testnet issues.
export const isDebugEnabled = (): boolean => process.env.DEBUG === "true";

/** Integration name shown as `[Label] message` when `DEBUG=true` (grep-friendly). */
export type IntegrationDebugLabel =
	| "Uniswap"
	| "Keeper Hub"
	| "0G"
	| "0G Compute";

export const debugLog = (cycleId: string, message: string, data?: unknown) => {
	if (!isDebugEnabled()) {
		return;
	}
	const prefix = `[runTradeCycle:${cycleId}]`;
	if (data) {
		console.log(prefix, message, data);
		return;
	}
	console.log(prefix, message);
};

/** Same as `debugLog`, but prefixes the message with `[integration]` for sponsor/integration filtering. */
export function integrationDebugLog(
	cycleId: string | undefined,
	integration: IntegrationDebugLabel,
	message: string,
	data?: unknown
): void {
	if (!(cycleId && isDebugEnabled())) {
		return;
	}
	const prefix = `[runTradeCycle:${cycleId}]`;
	const line = `[${integration}] ${message}`;
	if (data) {
		console.log(prefix, line, data);
		return;
	}
	console.log(prefix, line);
}

export const requireNumber = (
	value: number | undefined,
	label: string
): number => {
	if (value === undefined) {
		throw new ORPCError("BAD_REQUEST", { message: `${label} is required` });
	}
	return value;
};

export const requireString = (
	value: string | undefined,
	label: string
): string => {
	if (!value) {
		throw new ORPCError("BAD_REQUEST", { message: `${label} is required` });
	}
	return value;
};
