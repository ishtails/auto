/** External 0G KV / UI pointer: `{memoryStreamId}:{cycleId}` */
export const deriveOgLogPointer = (
	memoryPointer: string,
	cycleId: string
): string => `${memoryPointer}:${cycleId}`;
