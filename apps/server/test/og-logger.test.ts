import { describe, expect, it } from "bun:test";
import { OgLogger } from "../src/integrations/og-logger";

describe("OgLogger", () => {
	it("instantiates with correct constructor params", () => {
		const logger = new OgLogger(
			"https://indexer.0g.example",
			"stream-1",
			"https://rpc.0g.example",
			"0x0000000000000000000000000000000000000000000000000000000000000001",
			"0x0000000000000000000000000000000000000000"
		);

		expect(logger).toBeDefined();
	});
});
