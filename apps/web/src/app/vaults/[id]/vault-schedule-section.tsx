"use client";

import {
	isScheduleCadenceSeconds,
	SCHEDULE_CADENCE_LABEL,
	SCHEDULE_CADENCE_SECONDS,
} from "@auto/api/schedule-cadence";
import { Button } from "@auto/ui/components/button";
import { Calendar } from "@auto/ui/components/calendar";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@auto/ui/components/dialog";
import { Input } from "@auto/ui/components/input";
import { Label } from "@auto/ui/components/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@auto/ui/components/popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfToday } from "date-fns";
import { CalendarClock, CalendarDays, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

export interface VaultScheduleVault {
	executorEnabled: boolean;
	scheduleCadenceSeconds: number;
	scheduleNextRunAt: string | null;
}

/** ISO UTC from the server → formatted in the browser’s local timezone. */
function formatNextRunLocal(iso: string): string {
	const d = parseISO(iso);
	return format(d, "PPpp · xxx");
}

function cadenceHuman(seconds: number): string | null {
	if (seconds === 0) {
		return null;
	}
	if (isScheduleCadenceSeconds(seconds)) {
		return SCHEDULE_CADENCE_LABEL[seconds];
	}
	return `${seconds}s`;
}

function autopilotStatusPresentation(vault: VaultScheduleVault): {
	dotClass: string;
	pulse: boolean;
	statusSub: string;
	statusTitle: string;
} {
	const cadenceSaved = cadenceHuman(vault.scheduleCadenceSeconds);
	const active = vault.executorEnabled && vault.scheduleCadenceSeconds > 0;
	const waitingExecutor =
		!vault.executorEnabled && vault.scheduleCadenceSeconds > 0;

	if (active) {
		return {
			dotClass: "bg-[#5cb88a] shadow-[0_0_10px_rgba(92,184,138,0.55)]",
			pulse: true,
			statusSub: cadenceSaved ? `Every ${cadenceSaved}` : "",
			statusTitle: "Autopilot on",
		};
	}
	if (waitingExecutor) {
		return {
			dotClass: "bg-[#d97757]",
			pulse: false,
			statusSub: cadenceSaved
				? `Every ${cadenceSaved} — turn executor on to run`
				: "",
			statusTitle: "Schedule saved · executor off",
		};
	}
	return {
		dotClass: "bg-[#55433d]",
		pulse: false,
		statusSub: "Open configure to set cadence",
		statusTitle: "Autopilot off",
	};
}

function combineLocalDateAndTime(date: Date, timeHm: string): Date {
	const [hStr, mStr] = timeHm.split(":");
	const h = Number.parseInt(hStr ?? "0", 10);
	const m = Number.parseInt(mStr ?? "0", 10);
	const out = new Date(date);
	out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
	return out;
}

export function VaultScheduleSection({
	vaultId,
	vault,
}: {
	vaultId: string;
	vault: VaultScheduleVault | null;
}) {
	const queryClient = useQueryClient();
	const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
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
				setScheduleDialogOpen(false);
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

	// When the dialog opens, load server state into the form (cadence changes only affect layout inside the modal).
	useEffect(() => {
		if (!(scheduleDialogOpen && vault)) {
			return;
		}
		setScheduleDraftSeconds(String(vault.scheduleCadenceSeconds));
		setFirstRunDate(undefined);
		setFirstRunTime("12:00");
		setFirstRunPickerOpen(false);
	}, [scheduleDialogOpen, vault]);

	// When vault data refreshes while the dialog is closed, keep drafts aligned (not while editing).
	useEffect(() => {
		if (!vault || scheduleDialogOpen) {
			return;
		}
		setScheduleDraftSeconds(String(vault.scheduleCadenceSeconds));
		setFirstRunDate(undefined);
		setFirstRunTime("12:00");
		setFirstRunPickerOpen(false);
	}, [vault, scheduleDialogOpen]);

	if (!vault) {
		return null;
	}

	const showFirstRun = scheduleDraftSeconds !== "0";
	const statusVis = autopilotStatusPresentation(vault);
	const cadenceSummary =
		vault.scheduleCadenceSeconds === 0
			? "Off"
			: (cadenceHuman(vault.scheduleCadenceSeconds) ?? "—");

	const nextRunPrimary = vault.scheduleNextRunAt
		? formatNextRunLocal(vault.scheduleNextRunAt)
		: null;

	return (
		<section className="flex h-full min-h-0 flex-col rounded-lg border bg-[#1b1b1b] p-4 lg:p-5">
			<div className="shrink-0">
				<div className="flex items-start gap-3 rounded-md border border-[#3d352f] bg-[#151515] px-3 py-2.5">
					<span
						aria-hidden
						className={`mt-1.5 size-2 shrink-0 rounded-full ${statusVis.dotClass} ${statusVis.pulse ? "motion-safe:animate-pulse" : ""}`}
					/>
					<div className="min-w-0">
						<p className="font-manrope text-[#f5f5f2] text-sm leading-snug">
							{statusVis.statusTitle}
						</p>
						{statusVis.statusSub ? (
							<p className="mt-0.5 font-manrope text-[#a38c85] text-xs leading-snug">
								{statusVis.statusSub}
							</p>
						) : null}
					</div>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-4 pt-4">
				<div className="rounded-lg border border-[#3d352f] bg-[#151515] p-4">
					<div className="flex gap-3">
						<Repeat
							aria-hidden
							className="mt-0.5 size-4 shrink-0 text-[#a38c85]"
						/>
						<div className="min-w-0 flex-1">
							<p className="font-manrope text-[#a38c85] text-xs leading-snug">
								Cadence
							</p>
							<p
								className={`mt-1 font-newsreader text-xl leading-tight tracking-tight ${vault.scheduleCadenceSeconds === 0 ? "text-[#6b5d58]" : "text-[#f5f5f2]"}`}
							>
								{cadenceSummary}
							</p>
						</div>
					</div>

					<div aria-hidden className="my-4 h-px bg-[#2a2a2a]" />

					<div className="flex gap-3">
						<CalendarClock
							aria-hidden
							className="mt-0.5 size-4 shrink-0 text-[#a38c85]"
						/>
						<div className="min-w-0 flex-1">
							<p className="font-manrope text-[#a38c85] text-xs leading-snug">
								Next run
							</p>
							{nextRunPrimary ? (
								<p className="mt-1 font-manrope text-[#dbc1b9] text-sm leading-snug">
									{nextRunPrimary}
								</p>
							) : (
								<p className="mt-1 font-manrope text-[#6b5d58] text-sm leading-snug">
									Not scheduled yet
								</p>
							)}
						</div>
					</div>
				</div>

				<div aria-hidden className="min-h-0 flex-1" />

				<div className="flex shrink-0 flex-col gap-3">
					<Button
						className="w-full border-[#55433d] font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
						onClick={() => setScheduleDialogOpen(true)}
						type="button"
						variant="outline"
					>
						Configure schedule
					</Button>

					<Dialog>
						<DialogTrigger
							render={
								<Button
									className="h-auto w-full justify-center p-0 font-manrope text-[#6b5d58] text-xs underline-offset-2 hover:text-[#a38c85] hover:underline"
									type="button"
									variant="link"
								/>
							}
						>
							About autopilot &amp; timezones
						</DialogTrigger>
						<DialogContent
							className="max-h-[min(85vh,28rem)] overflow-y-auto border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2] sm:max-w-md"
							showCloseButton
						>
							<DialogHeader>
								<DialogTitle className="font-newsreader text-[#f5f5f2] text-lg">
									About autopilot &amp; timezones
								</DialogTitle>
								<DialogDescription className="text-pretty font-manrope text-[#dbc1b9] text-sm leading-relaxed">
									Runs trade cycles automatically while the server is up.
									Requires executor on. Times are stored in UTC on the server;
									this page shows them in your local timezone. Optional first
									run uses your device time and is sent to the server as UTC
									when you save.
								</DialogDescription>
							</DialogHeader>
						</DialogContent>
					</Dialog>

					{vault.executorEnabled ? null : (
						<p className="font-manrope text-[#d97757] text-xs leading-relaxed">
							Executor must be on for the schedule to fire.
						</p>
					)}
				</div>
			</div>

			<Dialog onOpenChange={setScheduleDialogOpen} open={scheduleDialogOpen}>
				<DialogContent
					className="max-h-[min(90vh,40rem)] overflow-y-auto border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2] sm:max-w-lg"
					showCloseButton
				>
					<DialogHeader>
						<DialogTitle className="font-newsreader text-[#f5f5f2] text-lg">
							Schedule
						</DialogTitle>
						<DialogDescription className="text-pretty font-manrope text-[#dbc1b9] text-sm">
							Choose cadence and optional first run. Saving applies immediately.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-4">
						<div className="flex min-w-0 flex-col gap-2">
							<Label
								className="font-manrope text-[#dbc1b9] text-sm"
								htmlFor="schedule-cadence-dialog"
							>
								Cadence
							</Label>
							<select
								className="h-10 rounded-md border border-[#55433d] bg-[#131313] px-3 font-manrope text-[#f5f5f2] text-sm disabled:opacity-50"
								disabled={!vault.executorEnabled || setVaultSchedule.isPending}
								id="schedule-cadence-dialog"
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
								<div className="flex min-w-0 flex-1 flex-col gap-2">
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
													className="h-10 w-full min-w-0 justify-start border-[#55433d] bg-[#131313] font-manrope text-[#f5f5f2] hover:bg-[#2a2a2a]"
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
								<div className="flex min-w-[140px] flex-col gap-2 sm:w-[160px]">
									<Label
										className="font-manrope text-[#dbc1b9] text-sm"
										htmlFor="schedule-first-run-time-dialog"
									>
										Time (local)
									</Label>
									<Input
										className="h-10 border-[#55433d] bg-[#131313] font-manrope text-[#f5f5f2]"
										disabled={
											setVaultSchedule.isPending || firstRunDate === undefined
										}
										id="schedule-first-run-time-dialog"
										onChange={(e) => {
											setFirstRunTime(e.target.value);
										}}
										type="time"
										value={firstRunTime}
									/>
								</div>
							</div>
						) : null}

						<div className="flex flex-wrap gap-2 pt-1">
							<Button
								className="bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
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
							<Button
								className="font-manrope text-[#dbc1b9]"
								onClick={() => setScheduleDialogOpen(false)}
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</section>
	);
}
