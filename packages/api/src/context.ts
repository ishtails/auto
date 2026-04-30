import type { Context as HonoContext } from "hono";

export interface CreateContextOptions {
	context: HonoContext;
}

export function createContext({ context: _context }: CreateContextOptions) {
	return {
		auth: null,
		session: null,
	};
}

export type Context = ReturnType<typeof createContext>;
