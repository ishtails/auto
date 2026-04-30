import { createContext } from "@auto/api/context";
import { appRouter } from "@auto/api/routers/index";
import { env } from "@auto/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createIntegrationServices } from "./services/trade-cycle-services";

const app = new Hono();
const integrationServices = createIntegrationServices();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
	})
);

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

// Handle RPC requests directly - preserves request body for oRPC
app.use("/rpc/*", async (c) => {
	const context = await createContext({
		context: c,
		services: integrationServices,
	});

	const result = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context,
	});

	if (result.matched) {
		return c.newResponse(result.response.body, result.response);
	}

	return c.notFound();
});

// Handle API reference requests
app.use("/api-reference/*", async (c) => {
	const context = await createContext({
		context: c,
		services: integrationServices,
	});

	const result = await apiHandler.handle(c.req.raw, {
		prefix: "/api-reference",
		context,
	});

	if (result.matched) {
		return c.newResponse(result.response.body, result.response);
	}

	return c.notFound();
});

app.get("/", (c) => c.text("OK"));
app.get("/diagnostics", async (c) => {
	const diagnostics = await integrationServices.getDiagnostics();
	return c.json(diagnostics, diagnostics.ok ? 200 : 503);
});

export default app;
