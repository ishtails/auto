/**
 * **Cold / DA trace** — one JSON blob per cycle via `MemData` + `Indexer.upload`.
 * Complements **KV** (`Batcher` + stream keys) per 0G Storage SDK: two persistence patterns, one indexer + RPC + key.
 *
 * @see https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk
 */

import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import type { CycleLogRecord } from "@auto/api/trade-types";
import { env } from "@auto/env/server";
import { ethers } from "ethers";
import { integrationDebugLog } from "../router/debug";

const TRACE_KIND = "auto.cycle_trace" as const;

export interface CycleTraceEnvelope {
	cycleId: string;
	kind: typeof TRACE_KIND;
	record: CycleLogRecord;
	v: 1;
}

export async function uploadCycleTraceBlob(args: {
	cycleId: string;
	record: CycleLogRecord;
}): Promise<{ daRootHash: string; daTxHash: string } | null> {
	if (!env.OG_DA_CYCLE_TRACE) {
		return null;
	}

	const { cycleId, record } = args;
	const indexer = new Indexer(env.OG_INDEXER_RPC);
	const provider = new ethers.JsonRpcProvider(env.OG_RPC_URL);
	const signer = new ethers.Wallet(env.OG_PRIVATE_KEY, provider);

	const envelope: CycleTraceEnvelope = {
		cycleId,
		kind: TRACE_KIND,
		record,
		v: 1,
	};

	const bytes = new TextEncoder().encode(JSON.stringify(envelope));
	const mem = new MemData(Array.from(bytes));

	const [tree, treeErr] = await mem.merkleTree();
	if (treeErr || !tree) {
		integrationDebugLog(cycleId, "0G", "DA trace merkleTree failed", {
			err: treeErr?.message ?? String(treeErr),
		});
		return null;
	}

	const [uploaded, upErr] = await indexer.upload(mem, env.OG_RPC_URL, signer);

	if (upErr) {
		integrationDebugLog(cycleId, "0G", "DA trace upload failed", {
			message: upErr.message,
		});
		return null;
	}

	if (uploaded && "rootHash" in uploaded) {
		const daRootHash = uploaded.rootHash?.trim();
		const daTxHash = uploaded.txHash?.trim();
		if (daRootHash && daTxHash) {
			integrationDebugLog(cycleId, "0G", "DA trace uploaded", {
				daRootHash: `${daRootHash.slice(0, 18)}…`,
			});
			return { daRootHash, daTxHash };
		}
	}

	return null;
}
