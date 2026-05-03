import type { RouterClient } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { authedProcedure, publicProcedure } from "../index";
import {
	getVaultCycleLogsInputSchema,
	getVaultCycleLogsOutputSchema,
	runTradeCycleInputSchema,
	runTradeCycleOutputSchema,
} from "../trade-types";
import {
	createVaultDeploymentSchema,
	getVaultAgentProfileInputSchema,
	getVaultBalancesOutputSchema,
	getVaultBalancesSchema,
	getVaultDeploymentOutputSchema,
	getVaultDeploymentSchema,
	listVaultsOutputSchema,
	prepareVaultDeploymentOutputSchema,
	prepareVaultDeploymentSchema,
	setVaultAgentBasenameOutputSchema,
	setVaultAgentBasenameSchema,
	setVaultExecutorEnabledSchema,
	setVaultScheduleOutputSchema,
	setVaultScheduleSchema,
	updateVaultAgentSettingsOutputSchema,
	updateVaultAgentSettingsSchema,
	vaultAgentProfileOutputSchema,
} from "../vault-types";

// NOTE: This router is a template that gets extended by the server.
// The server implementation provides the actual handlers with DB access.
// This pattern allows the API package to define the contract while
// the server provides the implementation.

export const appRouterTemplate = {
	healthCheck: publicProcedure.handler(() => "OK"),

	integrationDiagnostics: publicProcedure.handler(async ({ context }) =>
		context.services.getDiagnostics()
	),

	prepareVaultDeployment: authedProcedure
		.input(prepareVaultDeploymentSchema)
		.output(prepareVaultDeploymentOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),

	runTradeCycle: authedProcedure
		.input(runTradeCycleInputSchema)
		.output(runTradeCycleOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement runTradeCycle",
			});
		}),

	getVaultCycleLogs: authedProcedure
		.input(getVaultCycleLogsInputSchema)
		.output(getVaultCycleLogsOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement getVaultCycleLogs",
			});
		}),

	// ─── Vault Procedures (Server implements these with DB) ───────────

	me: authedProcedure.handler(() => {
		throw new ORPCError("NOT_IMPLEMENTED", {
			message: "Server must implement this procedure",
		});
	}),

	listVaults: authedProcedure.output(listVaultsOutputSchema).handler(() => {
		throw new ORPCError("NOT_IMPLEMENTED", {
			message: "Server must implement this procedure",
		});
	}),

	createVaultDeployment: authedProcedure
		.input(createVaultDeploymentSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),

	getVaultDeployment: authedProcedure
		.input(getVaultDeploymentSchema)
		.output(getVaultDeploymentOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),

	getVaultBalancesByVaultId: authedProcedure
		.input(getVaultBalancesSchema)
		.output(getVaultBalancesOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),

	setVaultExecutorEnabled: authedProcedure
		.input(setVaultExecutorEnabledSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),

	setVaultSchedule: authedProcedure
		.input(setVaultScheduleSchema)
		.output(setVaultScheduleOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement this procedure",
			});
		}),

	getVaultAgentProfile: authedProcedure
		.input(getVaultAgentProfileInputSchema)
		.output(vaultAgentProfileOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement getVaultAgentProfile",
			});
		}),

	updateVaultAgentSettings: authedProcedure
		.input(updateVaultAgentSettingsSchema)
		.output(updateVaultAgentSettingsOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement updateVaultAgentSettings",
			});
		}),

	setVaultAgentBasename: authedProcedure
		.input(setVaultAgentBasenameSchema)
		.output(setVaultAgentBasenameOutputSchema)
		.handler(() => {
			throw new ORPCError("NOT_IMPLEMENTED", {
				message: "Server must implement setVaultAgentBasename",
			});
		}),
};

// Server will override these with actual implementations
export const appRouter = appRouterTemplate;
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
