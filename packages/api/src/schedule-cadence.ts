/** Fixed cadences (seconds). Maps to common candle periods. */
export const SCHEDULE_CADENCE_SECONDS = [
	60, 300, 900, 1800, 3600, 86_400,
] as const;

export type ScheduleCadenceSeconds = (typeof SCHEDULE_CADENCE_SECONDS)[number];

export const SCHEDULE_CADENCE_LABEL: Record<ScheduleCadenceSeconds, string> = {
	60: "1 minute",
	300: "5 minutes",
	900: "15 minutes",
	1800: "30 minutes",
	3600: "1 hour",
	86400: "1 day",
};

export function isScheduleCadenceSeconds(
	value: number
): value is ScheduleCadenceSeconds {
	return (SCHEDULE_CADENCE_SECONDS as readonly number[]).includes(value);
}

/** @param minSecondsFromEnv — floor from `SCHEDULER_MIN_CADENCE_SECONDS` */
export function assertScheduleCadenceAllowed(
	cadenceSeconds: number,
	minSecondsFromEnv: number
): void {
	if (cadenceSeconds === 0) {
		return;
	}
	if (!isScheduleCadenceSeconds(cadenceSeconds)) {
		throw new Error(
			`Invalid schedule cadence: ${cadenceSeconds}s (not an allowed preset)`
		);
	}
	if (cadenceSeconds < minSecondsFromEnv) {
		throw new Error(
			`Cadence ${cadenceSeconds}s is below deployment minimum (${minSecondsFromEnv}s). Raise SCHEDULER_MIN_CADENCE_SECONDS or pick a longer interval.`
		);
	}
}
