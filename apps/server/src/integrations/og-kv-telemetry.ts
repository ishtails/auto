/** In-process last successful (or attempted) 0G KV batch — for demos & `/diagnostics`. */

export interface OgKvTelemetry {
	isoTime: string;
	pointer: string;
	rootHash?: string;
	txHash?: string;
}

let lastKvWrite: OgKvTelemetry | null = null;

export function recordOgKvTelemetry(payload: {
	pointer: string;
	rootHash?: string;
	txHash?: string;
}): void {
	lastKvWrite = {
		isoTime: new Date().toISOString(),
		pointer: payload.pointer,
		rootHash: payload.rootHash,
		txHash: payload.txHash,
	};
}

export function getLastOgKvTelemetry(): OgKvTelemetry | null {
	return lastKvWrite;
}
