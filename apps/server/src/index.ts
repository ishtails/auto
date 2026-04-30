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

// Handle RPC requests
app.all("/rpc/*", async (c) => {
	console.log("[DEBUG] RPC request:", {
		method: c.req.method,
		path: c.req.path,
		contentType: c.req.header("content-type"),
	});

	const context = await createContext({
		context: c,
		services: integrationServices,
	});

	// Read body and create a fresh readable stream for oRPC
	const bodyText = await c.req.text();
	console.log("[DEBUG] Body text:", bodyText);

	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(bodyText));
			controller.close();
		},
	});

	const requestForOrpc = new Request(c.req.url, {
		method: c.req.method,
		headers: c.req.raw.headers,
		body: stream,
		duplex: "half", // Required for Request with body stream
	} as RequestInit);

	console.log("[DEBUG] Calling oRPC with readable stream body");

	const result = await rpcHandler.handle(requestForOrpc, {
		prefix: "/rpc",
		context,
	});

	console.log("[DEBUG] oRPC result:", {
		matched: result.matched,
		status: result.response?.status,
	});

	if (result.matched) {
		return c.newResponse(result.response.body, result.response);
	}

	return c.notFound();
});

// Handle API reference requests
app.all("/api-reference/*", async (c) => {
	const context = await createContext({
		context: c,
		services: integrationServices,
	});

	const bodyText = await c.req.text();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(bodyText));
			controller.close();
		},
	});

	const result = await apiHandler.handle(
		new Request(c.req.url, {
			method: c.req.method,
			headers: c.req.raw.headers,
			body: stream,
			duplex: "half",
		} as RequestInit)
	, {
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
