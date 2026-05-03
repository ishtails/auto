"use client";

import { Button } from "@auto/ui/components/button";
import { Input } from "@auto/ui/components/input";
import { Label } from "@auto/ui/components/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@auto/ui/components/sheet";
import { Slider } from "@auto/ui/components/slider";
import { Textarea } from "@auto/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isAddress } from "viem";
import { orpc } from "@/utils/orpc";

export interface EditAgentSheetProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	vaultId: string;
}

function maxTradeBpsToRiskScore(maxTradeBps: number): number {
	return Math.min(100, Math.max(0, Math.round((maxTradeBps / 10_000) * 100)));
}

export function EditAgentSheet({
	onOpenChange,
	open,
	vaultId,
}: EditAgentSheetProps) {
	const queryClient = useQueryClient();
	const profileQuery = useQuery(
		orpc.getVaultAgentProfile.queryOptions({
			input: { vaultId },
			query: { enabled: open && Boolean(vaultId) },
		})
	);

	const [name, setName] = useState("");
	const [prompt, setPrompt] = useState("");
	const [riskScore, setRiskScore] = useState(15);
	const [maxSlippageBps, setMaxSlippageBps] = useState(100);
	const [tokenIn, setTokenIn] = useState("");
	const [tokenOut, setTokenOut] = useState("");

	useEffect(() => {
		const d = profileQuery.data;
		if (!(open && d)) {
			return;
		}
		setName(d.name);
		setPrompt(d.geminiSystemPrompt);
		setRiskScore(maxTradeBpsToRiskScore(d.maxTradeBps));
		setMaxSlippageBps(d.maxSlippageBps);
		setTokenIn(d.tokenIn);
		setTokenOut(d.tokenOut);
	}, [open, profileQuery.data]);

	const updateMutation = useMutation(
		orpc.updateVaultAgentSettings.mutationOptions({
			onError: (error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				toast.error(message);
			},
			onSuccess: async () => {
				toast.success("Agent settings updated");
				await queryClient.invalidateQueries({
					queryKey: orpc.listVaults.queryOptions().queryKey,
				});
				await queryClient.invalidateQueries({
					queryKey: orpc.getVaultAgentProfile.queryOptions({
						input: { vaultId },
					}).queryKey,
				});
				onOpenChange(false);
			},
		})
	);

	const onSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const maxTradeBps = Math.max(1, Math.round((riskScore / 100) * 10_000));
		const ti = tokenIn.trim();
		const to = tokenOut.trim();
		if (!(isAddress(ti) && isAddress(to))) {
			toast.error("Token in and token out must be valid hex addresses.");
			return;
		}
		updateMutation.mutate({
			geminiSystemPrompt: prompt,
			maxSlippageBps,
			maxTradeBps,
			name: name.trim(),
			tokenIn: ti,
			tokenOut: to,
			vaultId,
		});
	};

	const isLoadingProfile = open && profileQuery.isPending;
	const showForm = open && profileQuery.data;

	return (
		<Sheet onOpenChange={onOpenChange} open={open}>
			<SheetContent
				className="flex h-full max-h-screen w-full flex-col gap-0 overflow-hidden border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2] sm:max-w-lg"
				showCloseButton
				side="right"
			>
				<SheetHeader className="border-[#2a2a2a] border-b pb-4 text-left">
					<SheetTitle className="font-newsreader text-[#f5f5f2] text-xl">
						Edit agent
					</SheetTitle>
					<SheetDescription className="font-manrope text-[#a38c85] text-sm">
						Update the agent name, model prompt, risk sizing, slippage, and
						token pair. On-chain config is unchanged; this updates off-chain
						profile used for cycles and UI.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col">
					<div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
						{isLoadingProfile ? (
							<div className="flex justify-center py-12">
								<LoaderCircle
									aria-hidden
									className="size-8 animate-spin text-[#d97757]"
								/>
							</div>
						) : null}

						{profileQuery.isError ? (
							<p className="font-manrope text-[#d97757] text-sm">
								Could not load agent settings. Try again.
							</p>
						) : null}

						{showForm ? (
							<form
								className="flex flex-col gap-5"
								id="edit-agent-form"
								onSubmit={onSubmit}
							>
								<div className="grid gap-2">
									<Label
										className="font-manrope text-[#dbc1b9] text-sm"
										htmlFor="edit-agent-name"
									>
										Agent name
									</Label>
									<Input
										className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
										id="edit-agent-name"
										onChange={(e) => setName(e.target.value)}
										value={name}
									/>
								</div>

								<div className="grid gap-2">
									<Label
										className="font-manrope text-[#dbc1b9] text-sm"
										htmlFor="edit-agent-prompt"
									>
										Gemini system prompt
									</Label>
									<Textarea
										className="min-h-[120px] rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
										id="edit-agent-prompt"
										onChange={(e) => setPrompt(e.target.value)}
										value={prompt}
									/>
								</div>

								<div className="grid gap-3">
									<div className="flex items-center justify-between">
										<Label className="font-manrope text-[#dbc1b9] text-sm">
											Max trade size (risk)
										</Label>
										<span className="font-manrope text-[#d97757] text-sm">
											{riskScore}/100
										</span>
									</div>
									<Slider
										className="[&_[role=slider]]:bg-[#d97757]"
										max={100}
										onValueChange={(value) =>
											setRiskScore(
												Array.isArray(value) ? (value[0] ?? 0) : value
											)
										}
										step={1}
										value={[riskScore]}
									/>
								</div>

								<div className="grid gap-2">
									<Label
										className="font-manrope text-[#dbc1b9] text-sm"
										htmlFor="edit-agent-slippage"
									>
										Max slippage (bps)
									</Label>
									<Input
										className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
										id="edit-agent-slippage"
										max={2000}
										min={1}
										onChange={(e) =>
											setMaxSlippageBps(Number(e.target.value || "1"))
										}
										type="number"
										value={maxSlippageBps}
									/>
								</div>

								<div className="grid gap-2">
									<Label
										className="font-manrope text-[#dbc1b9] text-sm"
										htmlFor="edit-agent-token-in"
									>
										Token in (address)
									</Label>
									<Input
										className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
										id="edit-agent-token-in"
										onChange={(e) => setTokenIn(e.target.value)}
										spellCheck={false}
										value={tokenIn}
									/>
								</div>

								<div className="grid gap-2">
									<Label
										className="font-manrope text-[#dbc1b9] text-sm"
										htmlFor="edit-agent-token-out"
									>
										Token out (address)
									</Label>
									<Input
										className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
										id="edit-agent-token-out"
										onChange={(e) => setTokenOut(e.target.value)}
										spellCheck={false}
										value={tokenOut}
									/>
								</div>
							</form>
						) : null}
					</div>

					{showForm ? (
						<SheetFooter className="border-[#2a2a2a] border-t bg-[#1b1b1b] sm:flex-row sm:justify-end">
							<Button
								className="border-[#55433d] font-manrope text-[#dbc1b9] hover:bg-[#2a2a2a]"
								onClick={() => onOpenChange(false)}
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								className="bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
								disabled={updateMutation.isPending}
								form="edit-agent-form"
								type="submit"
							>
								{updateMutation.isPending ? (
									<LoaderCircle className="size-4 animate-spin" />
								) : null}
								Save changes
							</Button>
						</SheetFooter>
					) : null}
				</div>
			</SheetContent>
		</Sheet>
	);
}
