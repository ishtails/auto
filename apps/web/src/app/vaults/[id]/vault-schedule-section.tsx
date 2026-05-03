"use client";

import {
	SCHEDULE_CADENCE_LABEL,
	SCHEDULE_CADENCE_SECONDS,
} from "@auto/api/schedule-cadence";
import { Button } from "@auto/ui/components/button";
import { Calendar } from "@auto/ui/components/calendar";
import { Input } from "@auto/ui/components/input";
import { Label } from "@auto/ui/components/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@auto/ui/components/popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfToday } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

/** ISO UTC from the server → formatted in the browser’s local timezone. */
function formatNextRunLocal(iso: string): string {
	const d = parseISO(iso);
	return format(d, "PPpp · xxx");
}

function combineLocalDateAndTime(date: Date, timeHm: string): Date {
	const [hStr, mStr] = timeHm.split(":");
	const h = Number.parseInt(hStr ?? "0", 10);
	const m = Number.parseInt(mStr ?? "0", 10);
	const out = new Date(date);
	out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
	return out;
}

export interface VaultScheduleVault {
	executorEnabled: boolean;
	scheduleCadenceSeconds: number;
	scheduleNextRunAt: string | null;
}

export function VaultScheduleSection({
	vaultId,
	vault,
}: {
	vaultId: string;
	vault: VaultScheduleVault | null;
}) {
	const queryClient = useQueryClient();
	const [scheduleDraftSeconds, setScheduleDraftSeconds] = useState("0");
	const [firstRunDate, setFirstRunDate] = useState<Date | undefined>(undefined);
	const [firstRunTime, setFirstRunTime] = useState("12:00");
	const [firstRunPickerOpen, setFirstRunPickerOpen] = useState(false);
	const [calendarTimeZone, setCalendarTimeZone] = useState<string | undefined>(
		undefined
	);

	const setVaultSchedule = useMutation(
		orpc.setVaultSchedule.mutationOptions({
			onSuccess: async () => {
				toast.success("Schedule updated");
				await queryClient.invalidateQueries({
					queryKey: orpc.listVaults.queryOptions().queryKey,
				});
			},
			onError: (e: unknown) => {
				const msg =
					e &&
					typeof e === "object" &&
					"message" in e &&
					typeof (e as { message: unknown }).message === "string"
						? (e as { message: string }).message
						: "Could not update schedule";
				toast.error(msg);
			},
		})
	);

	useEffect(() => {
		setCalendarTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
	}, []);

	useEffect(() => {
		if (!vault) {
			return;
		}
		setScheduleDraftSeconds(String(vault.scheduleCadenceSeconds));
		setFirstRunDate(undefined);
		setFirstRunTime("12:00");
		setFirstRunPickerOpen(false);
	}, [vault]);

	if (!vault) {
		return null;
	}

	const showFirstRun = scheduleDraftSeconds !== "0";

	return (
		<section className="mb-10 rounded-lg border border-[#55433d] bg-[#1b1b1b] p-5">
			<p className="font-manrope text-[#a38c85] text-md uppercase tracking-[0.12em]">
				Autopilot
			</p>
			<p className="mt-1 font-manrope text-[#dbc1b9] text-sm">
				Runs trade cycles automatically while the server is up. Requires
				executor on. Times are stored in UTC on the server; this page shows them
				in your local timezone. Optional first run uses your device time and is
				sent to the server as UTC when you save.
			</p>
			<div className="mt-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
				<div className="flex min-w-[200px] flex-col gap-2">
					<Label
						className="font-manrope text-[#dbc1b9] text-sm"
						htmlFor="schedule-cadence"
					>
						Cadence
					</Label>
					<select
						className="h-10 rounded-md border border-[#55433d] bg-[#131313] px-3 font-manrope text-[#f5f5f2] text-sm disabled:opacity-50"
						disabled={!vault.executorEnabled || setVaultSchedule.isPending}
						id="schedule-cadence"
						onChange={(e) => {
							setScheduleDraftSeconds(e.target.value);
						}}
						value={scheduleDraftSeconds}
					>
						<option value="0">Off</option>
						{SCHEDULE_CADENCE_SECONDS.map((s) => (
							<option key={s} value={String(s)}>
								{SCHEDULE_CADENCE_LABEL[s]}
							</option>
						))}
					</select>
				</div>
				{showFirstRun ? (
					<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
						<div className="flex flex-col gap-2">
							<Label className="font-manrope text-[#dbc1b9] text-sm">
								First run date (optional)
							</Label>
							<Popover
								onOpenChange={setFirstRunPickerOpen}
								open={firstRunPickerOpen}
							>
								<PopoverTrigger
									disabled={setVaultSchedule.isPending}
									render={
										<Button
											className="h-10 w-[min(100%,240px)] justify-start border-[#55433d] bg-[#131313] font-manrope text-[#f5f5f2] hover:bg-[#2a2a2a]"
											type="button"
											variant="outline"
										/>
									}
								>
									<CalendarDays className="mr-2 size-4 shrink-0 text-[#a38c85]" />
									<span className="truncate">
										{firstRunDate
											? format(firstRunDate, "PPP")
											: "Pick first run date"}
									</span>
								</PopoverTrigger>
								<PopoverContent
									align="start"
									className="w-auto border-[#55433d] bg-[#131313] p-0 text-[#f5f5f2]"
									sideOffset={8}
								>
									<Calendar
										className="rounded-lg p-2"
										classNames={{
											weekday:
												"flex-1 rounded-md text-[0.8rem] font-normal text-[#a38c85]",
											outside: "text-[#55433d] opacity-80",
											disabled: "text-[#55433d] opacity-40",
										}}
										disabled={{ before: startOfToday() }}
										mode="single"
										onSelect={(d) => {
											setFirstRunDate(d);
											setFirstRunPickerOpen(false);
										}}
										selected={firstRunDate}
										{...(calendarTimeZone
											? { timeZone: calendarTimeZone }
											: {})}
									/>
								</PopoverContent>
							</Popover>
						</div>
						<div className="flex min-w-[140px] flex-col gap-2">
							<Label
								className="font-manrope text-[#dbc1b9] text-sm"
								htmlFor="schedule-first-run-time"
							>
								Time (local)
							</Label>
							<Input
								className="h-10 border-[#55433d] bg-[#131313] font-manrope text-[#f5f5f2]"
								disabled={
									setVaultSchedule.isPending || firstRunDate === undefined
								}
								id="schedule-first-run-time"
								onChange={(e) => {
									setFirstRunTime(e.target.value);
								}}
								type="time"
								value={firstRunTime}
							/>
						</div>
					</div>
				) : null}
				<Button
					className="h-10 bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
					disabled={
						setVaultSchedule.isPending ||
						(scheduleDraftSeconds !== "0" && !vault.executorEnabled)
					}
					onClick={() => {
						const cadence = Number(scheduleDraftSeconds);
						let first: string | undefined;
						if (cadence > 0 && firstRunDate !== undefined) {
							first = combineLocalDateAndTime(
								firstRunDate,
								firstRunTime
							).toISOString();
						}
						setVaultSchedule.mutate({
							vaultId,
							scheduleCadenceSeconds: cadence,
							firstRunAtUtc: first,
						});
					}}
					type="button"
				>
					Save schedule
				</Button>
			</div>
			<p className="mt-3 font-manrope text-[#a38c85] text-sm">
				Next run (local):{" "}
				<span className="text-[#f5f5f2]">
					{vault.scheduleNextRunAt
						? formatNextRunLocal(vault.scheduleNextRunAt)
						: "—"}
				</span>
			</p>
			{vault.executorEnabled ? null : (
				<p className="mt-2 font-manrope text-[#d97757] text-sm">
					Turn executor on to enable a schedule.
				</p>
			)}
		</section>
	);
}
