import type { FixedPriceFlow } from "@0gfoundation/0g-ts-sdk";
import {
	Batcher,
	FixedPriceFlow__factory,
	Indexer,
} from "@0gfoundation/0g-ts-sdk";
import type { CycleLogRecord } from "@auto/api/trade-types";
import { ethers } from "ethers";

export class OgLogger {
	private readonly indexer: Indexer;
	private readonly streamId: string;
	private readonly rpcUrl: string;
	private readonly signer: ethers.Wallet;
	private readonly flowContract: FixedPriceFlow;

	constructor(
		indexerRpc: string,
		streamId: string,
		rpcUrl: string,
		privateKey: string,
		flowContractAddress: string
	) {
		this.indexer = new Indexer(indexerRpc);
		this.streamId = streamId;
		this.rpcUrl = rpcUrl;
		const provider = new ethers.JsonRpcProvider(rpcUrl);
		this.signer = new ethers.Wallet(privateKey, provider);
		this.flowContract = FixedPriceFlow__factory.connect(
			flowContractAddress,
			this.signer
		);
	}

	async write(record: CycleLogRecord): Promise<string> {
		const pointer = `${this.streamId}:${record.cycleId}`;

		const [nodes, selectErr] = await this.indexer.selectNodes(1);
		if (selectErr || !nodes || nodes.length === 0) {
			throw new Error(
				`0G node selection failed: ${selectErr ?? "no nodes available"}`
			);
		}

		const batcher = new Batcher(1, nodes, this.flowContract, this.rpcUrl);

		// Use hex string format for streamId that 0G SDK expects
		const streamIdHex = ethers.hexlify(ethers.toUtf8Bytes(this.streamId));
		const keyBytes = ethers.toUtf8Bytes(pointer);
		const valueBytes = ethers.toUtf8Bytes(JSON.stringify(record));
		batcher.streamDataBuilder.set(streamIdHex, keyBytes, valueBytes);

		const [, batchErr] = await batcher.exec();
		if (batchErr) {
			throw new Error(`0G batch execution failed: ${batchErr}`);
		}

		const latestKey = ethers.toUtf8Bytes("latest");
		const latestValue = ethers.toUtf8Bytes(pointer);
		batcher.streamDataBuilder.set(streamIdHex, latestKey, latestValue);

		const [, latestErr] = await batcher.exec();
		if (latestErr) {
			throw new Error(`0G latest pointer write failed: ${latestErr}`);
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
}
