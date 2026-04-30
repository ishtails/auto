import type { FixedPriceFlow } from "@0gfoundation/0g-ts-sdk";
import {
	Batcher,
	FixedPriceFlow__factory,
	Indexer,
	KvClient,
	MAX_QUERY_SIZE,
} from "@0gfoundation/0g-ts-sdk";
import type { CycleLogRecord } from "@auto/api/trade-types";
import { ethers } from "ethers";

export class OgLogger {
	private readonly indexer: Indexer;
	private readonly kvClient: KvClient;
	private readonly streamId: string;
	private readonly rpcUrl: string;
	private readonly signer: ethers.Wallet;
	private readonly flowContract: FixedPriceFlow;

	constructor(
		indexerRpc: string,
		kvRpc: string,
		streamId: string,
		rpcUrl: string,
		privateKey: string,
		flowContractAddress: string
	) {
		this.indexer = new Indexer(indexerRpc);
		this.kvClient = new KvClient(kvRpc);
		this.streamId = streamId;
		this.rpcUrl = rpcUrl;
		const provider = new ethers.JsonRpcProvider(rpcUrl);
		this.signer = new ethers.Wallet(privateKey, provider);
		// Normalize address to ensure proper checksum
		const normalizedAddress = ethers.getAddress(
			flowContractAddress.toLowerCase()
		);
		this.flowContract = FixedPriceFlow__factory.connect(
			normalizedAddress,
			this.signer
		);
	}

	async write(record: CycleLogRecord): Promise<string> {
		const pointer = `${this.streamId}:${record.cycleId}`;
		const indexKey = `idx:${Date.now().toString().padStart(13, "0")}:${record.cycleId}`;
		const streamIdHex = ethers.hexlify(ethers.toUtf8Bytes(this.streamId));

		try {
			const [nodes, selectErr] = await this.indexer.selectNodes(1);
			if (selectErr || !nodes || nodes.length === 0) {
				console.log(
					`[0G] Node selection failed: ${selectErr ?? "no nodes"}, skipping log`
				);
				return pointer;
			}

			const batcher = new Batcher(1, nodes, this.flowContract, this.rpcUrl);
			const keyBytes = ethers.toUtf8Bytes(pointer);
			const valueBytes = ethers.toUtf8Bytes(JSON.stringify(record));
			const latestKey = ethers.toUtf8Bytes("latest");
			const latestValue = ethers.toUtf8Bytes(pointer);
			const indexKeyBytes = ethers.toUtf8Bytes(indexKey);
			const indexValueBytes = ethers.toUtf8Bytes(pointer);

			batcher.streamDataBuilder.set(streamIdHex, latestKey, latestValue);
			batcher.streamDataBuilder.set(
				streamIdHex,
				indexKeyBytes,
				indexValueBytes
			);
			batcher.streamDataBuilder.set(streamIdHex, keyBytes, valueBytes);

			const [, batchErr] = await batcher.exec();
			if (batchErr) {
				console.log(`[0G] Batch execution failed: ${batchErr}, skipping log`);
				return pointer;
			}

			console.log(`[0G] Logged cycle to ${pointer}`);
		} catch (error) {
			console.log(`[0G] Logging failed: ${error}`);
		}

		return pointer;
	}

	async healthcheck(): Promise<boolean> {
		try {
			const [nodes, err] = await this.indexer.selectNodes(1);
			return err === null && nodes !== null && nodes.length > 0;
		} catch {
			return false;
		}
	}

	/**
	 * Read recent trade logs from 0G storage for agent memory
	 * @param limit Maximum number of recent logs to retrieve
	 * @returns Array of recent cycle log records
	 */
	readRecentLogs(limit = 5): Promise<CycleLogRecord[]> {
		if (limit <= 0) {
			return Promise.resolve([]);
		}

		const streamIdHex = ethers.hexlify(ethers.toUtf8Bytes(this.streamId));

		return (async () => {
			const logs: CycleLogRecord[] = [];
			let cursor = await this.kvClient.getLast(streamIdHex, 0, MAX_QUERY_SIZE);

			while (cursor && logs.length < limit) {
				const key = Buffer.from(cursor.key).toString("utf8");

				if (key.startsWith("idx:")) {
					const pointer = Buffer.from(cursor.data, "base64").toString("utf8");
					const value = await this.kvClient.getValue(
						streamIdHex,
						ethers.toUtf8Bytes(pointer)
					);

					if (value) {
						const recordJson = Buffer.from(value.data, "base64").toString(
							"utf8"
						);
						const parsed = JSON.parse(recordJson) as CycleLogRecord;
						logs.push(parsed);
					}
				}

				cursor = await this.kvClient.getPrev(
					streamIdHex,
					cursor.key,
					0,
					MAX_QUERY_SIZE,
					false
				);
			}

			return logs;
		})().catch((error) => {
			console.log(`[0G] Memory query failed: ${error}`);
			return [];
		});
	}
}
