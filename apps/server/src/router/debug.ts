import { ORPCError } from "@orpc/server";

// DO NOT REMOVE: This debug logger is intentionally always available behind
// `DEBUG=true` for investigating prod/testnet issues.
export const isDebugEnabled = (): boolean => process.env.DEBUG === "true";

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
