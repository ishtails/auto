import { ORPCError, os } from "@orpc/server";

export type {
	AuthResult,
	Context,
	DiagnosticsResult,
	IntegrationServices,
	TradeCycleState,
	TradeCycleStateInput,
	VaultConfig,
} from "./context";

import type { Context as HonoContext } from "hono";
import type { AuthResult, IntegrationServices } from "./context";

export interface CreateContextOptions {
	auth: AuthResult;
	context: HonoContext;
	services: IntegrationServices;
}

export function createContext({
	context: _context,
	services,
	auth,
}: CreateContextOptions) {
	return {
		auth,
		session: null,
		services,
	};
}

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

export const authedProcedure = o.use(({ context, next }) => {
	if (!context.auth) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Not authenticated",
		});
	}
	return next({ context: { ...context, auth: context.auth } });
});
