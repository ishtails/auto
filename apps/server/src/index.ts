import { createContext } from "@auto/api";
import { env } from "@auto/env/server";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { resolveAuth } from "./auth/middleware";
import { appRouter } from "./router";
import { registerCycleStreamRoutes } from "./router/cycle-stream";
import { createIntegrationServices } from "./services/trade-cycle-services";
import "./services/deploy-queue";
import { startupSync } from "./services/startup-sync";

// Start background services
startupSync().catch(console.error);

const app = new Hono();
const integrationServices = createIntegrationServices();
const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

app.use(logger());
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
	})
);

const BODY_PARSER_METHODS = new Set([
	"arrayBuffer",
	"blob",
	"formData",
	"json",
	"text",
] as const);
type BodyParserMethod =
	typeof BODY_PARSER_METHODS extends Set<infer T> ? T : never;

app.use("/rpc/*", async (c, next) => {
	// Resolve auth header
	const authHeader = c.req.header("Authorization");
	const auth = await resolveAuth(authHeader);

	// Avoid "Body Already Used" by delegating body reads to Hono's parsers.
	const request = new Proxy(c.req.raw, {
		get(target, prop) {
			if (BODY_PARSER_METHODS.has(prop as BodyParserMethod)) {
				return () => c.req[prop as BodyParserMethod]();
			}
			return Reflect.get(target, prop, target);
		},
	});

	const { matched, response } = await rpcHandler.handle(request, {
		prefix: "/rpc",
		context: createContext({ context: c, services: integrationServices, auth }),
	});

	if (matched) {
		return c.newResponse(response.body, response);
	}

	await next();
});

// Health check
app.get("/", (c) =>
	c.text("OK", 200, {
		"content-type": "text/plain; charset=utf-8",
	})
);

// Diagnostics endpoint
app.get("/diagnostics", async (c) => {
	const diagnostics = await integrationServices.getDiagnostics();
	return c.json(diagnostics, diagnostics.ok ? 200 : 503);
});

// NOTE: `/rpc/*` is handled by oRPC above. Keep non-RPC routes below.
registerCycleStreamRoutes(app);

console.log("environment:", env.ENVIRONMENT);

export default app;
