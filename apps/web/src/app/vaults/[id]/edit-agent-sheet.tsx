"use client";

import { USER_VAULT_ABI } from "@auto/contracts/factory-definitions";
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
import { useWallets } from "@privy-io/react-auth";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { type Address, createPublicClient, http, isAddress } from "viem";
import { baseSepolia } from "viem/chains";
import {
	getPrivyWalletClient,
	isPrivyEmbeddedWalletRpcNoiseError,
	type PrivyWalletLike,
} from "@/lib/privy-wallet-client";
import {
	readVaultMaxTradeSizeBps,
	vaultMaxTradeBpsQueryKey,
} from "@/lib/read-vault-max-trade-bps";
import { client, orpc } from "@/utils/orpc";

export interface EditAgentSheetProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	vaultAddress: string | null;
	vaultId: string;
}

function maxTradeBpsToRiskScore(maxTradeBps: number): number {
	return Math.min(100, Math.max(0, Math.round((maxTradeBps / 10_000) * 100)));
}

function resolveEditAgentRiskBaselineBps(args: {
	chainBps: number | undefined;
	chainError: boolean;
	chainPending: boolean;
	profileMaxTradeBps: number | undefined;
	vaultAddress: string | null;
}): { baseline: number; ok: true } | { message: string; ok: false } {
	if (args.vaultAddress && isAddress(args.vaultAddress)) {
		if (args.chainPending) {
			return {
				message: "Reading max trade size from chain… try again in a moment.",
				ok: false,
			};
		}
		if (args.chainError || args.chainBps === undefined) {
			return {
				message:
					"Could not read max trade size from your vault contract. Check RPC and try again.",
				ok: false,
			};
		}
		return { baseline: args.chainBps, ok: true };
	}
	const b = args.profileMaxTradeBps;
	if (b === undefined) {
		return { message: "Agent profile is still loading. Try again.", ok: false };
	}
	return { baseline: b, ok: true };
}

async function sendVaultSetRiskParamsTx(args: {
	maxTradeBps: number;
	vaultAddress: Address;
	wallet: PrivyWalletLike & { address: string };
}): Promise<void> {
	const walletClient = await getPrivyWalletClient(args.wallet);
	const hash = await walletClient.writeContract({
		abi: USER_VAULT_ABI,
		account: args.wallet.address as Address,
		address: args.vaultAddress,
		args: [args.maxTradeBps],
		chain: baseSepolia,
		functionName: "setRiskParams",
	});
	const publicClient = createPublicClient({
		chain: baseSepolia,
		transport: http(),
	});
	await publicClient.waitForTransactionReceipt({ hash });
}

interface PersistVaultAgentProfileArgs {
	agentBasenameTrimmed: string;
	geminiSystemPrompt: string;
	maxSlippageBps: number;
	nameTrimmed: string;
	queryClient: QueryClient;
	tokenIn: string;
	tokenOut: string;
	vaultAddressForInvalidation: string | null;
	vaultId: string;
}

async function persistVaultAgentProfile(
	args: PersistVaultAgentProfileArgs
): Promise<void> {
	await client.updateVaultAgentSettings({
		geminiSystemPrompt: args.geminiSystemPrompt,
		maxSlippageBps: args.maxSlippageBps,
		name: args.nameTrimmed,
		tokenIn: args.tokenIn,
		tokenOut: args.tokenOut,
		vaultId: args.vaultId,
	});
	await client.setVaultAgentBasename({
		agentBasename:
			args.agentBasenameTrimmed === "" ? null : args.agentBasenameTrimmed,
		vaultId: args.vaultId,
	});
	await args.queryClient.invalidateQueries({
		queryKey: orpc.listVaults.queryOptions().queryKey,
	});
	await args.queryClient.invalidateQueries({
		queryKey: orpc.getVaultAgentProfile.queryOptions({
			input: { vaultId: args.vaultId },
		}).queryKey,
	});
	if (args.vaultAddressForInvalidation) {
		await args.queryClient.invalidateQueries({
			queryKey: vaultMaxTradeBpsQueryKey(args.vaultAddressForInvalidation),
		});
	}
}

async function runEditAgentSaveFlow(args: {
	maxTradeBpsForChainTx: number;
	onOpenChange: (open: boolean) => void;
	persistArgs: PersistVaultAgentProfileArgs;
	riskChanged: boolean;
	setIsSaving: (saving: boolean) => void;
	vaultAddress: string | null;
	wallet: PrivyWalletLike | undefined;
}): Promise<void> {
	args.setIsSaving(true);
	try {
		if (args.riskChanged) {
			const w = args.wallet as PrivyWalletLike & { address: string };
			await sendVaultSetRiskParamsTx({
				maxTradeBps: args.maxTradeBpsForChainTx,
				vaultAddress: args.vaultAddress as Address,
				wallet: w,
			});
		}

		await persistVaultAgentProfile(args.persistArgs);
		toast.success(
			args.riskChanged
				? "Max trade size updated on-chain; profile saved."
				: "Agent settings updated."
		);
		args.onOpenChange(false);
	} catch (error: unknown) {
		if (args.riskChanged && isPrivyEmbeddedWalletRpcNoiseError(error)) {
			try {
				await persistVaultAgentProfile(args.persistArgs);
				toast.success(
					"Update may have submitted. Confirm setRiskParams in your wallet; refresh if other fields look stale."
				);
				args.onOpenChange(false);
			} catch (persistErr: unknown) {
				const message =
					persistErr instanceof Error ? persistErr.message : String(persistErr);
				toast.error(message);
			}
		} else {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(message);
		}
	} finally {
		args.setIsSaving(false);
	}
}

export function EditAgentSheet({
	onOpenChange,
	open,
	vaultAddress,
	vaultId,
}: EditAgentSheetProps) {
	const queryClient = useQueryClient();
	const { wallets } = useWallets();
	const profileQuery = useQuery(
		orpc.getVaultAgentProfile.queryOptions({
			input: { vaultId },
			query: { enabled: open && Boolean(vaultId) },
		})
	);

	const onChainRiskQuery = useQuery({
		enabled:
			open && Boolean(vaultAddress && isAddress(vaultAddress) && vaultId),
		queryFn: () => readVaultMaxTradeSizeBps(vaultAddress as Address),
		queryKey: vaultAddress
			? vaultMaxTradeBpsQueryKey(vaultAddress)
			: ["vault-max-trade-bps", "none"],
	});

	const [name, setName] = useState("");
	const [prompt, setPrompt] = useState("");
	const [riskScore, setRiskScore] = useState(15);
	const [maxSlippageBps, setMaxSlippageBps] = useState(100);
	const [tokenIn, setTokenIn] = useState("");
	const [tokenOut, setTokenOut] = useState("");
	const [agentBasename, setAgentBasename] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		const d = profileQuery.data;
		if (!(open && d)) {
			return;
		}
		setName(d.name);
		setPrompt(d.geminiSystemPrompt);
		const chainBps = onChainRiskQuery.data;
		setRiskScore(
			maxTradeBpsToRiskScore(
				typeof chainBps === "number" ? chainBps : d.maxTradeBps
			)
		);
		setMaxSlippageBps(d.maxSlippageBps);
		setTokenIn(d.tokenIn);
		setTokenOut(d.tokenOut);
		setAgentBasename(d.agentBasename ?? "");
	}, [open, onChainRiskQuery.data, profileQuery.data]);

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const maxTradeBps = Math.max(1, Math.round((riskScore / 100) * 10_000));
		const ti = tokenIn.trim();
		const to = tokenOut.trim();
		if (!(isAddress(ti) && isAddress(to))) {
			toast.error("Token in and token out must be valid hex addresses.");
			return;
		}

		const baselineRes = resolveEditAgentRiskBaselineBps({
			chainBps: onChainRiskQuery.data,
			chainError: onChainRiskQuery.isError,
			chainPending: onChainRiskQuery.isPending,
			profileMaxTradeBps: profileQuery.data?.maxTradeBps,
			vaultAddress,
		});
		if (!baselineRes.ok) {
			toast.error(baselineRes.message);
			return;
		}
		const baselineBps = baselineRes.baseline;
		const riskChanged = maxTradeBps !== baselineBps;

		if (riskChanged) {
			if (!(vaultAddress && isAddress(vaultAddress))) {
				toast.error(
					"Deploy the vault on-chain before changing max trade size — your wallet must call setRiskParams on the vault contract."
				);
				return;
			}
			const w = wallets[0] as PrivyWalletLike | undefined;
			if (!w?.address) {
				toast.error(
					"Connect your wallet — only the vault owner can update max trade size on-chain."
				);
				return;
			}
		}

		await runEditAgentSaveFlow({
			maxTradeBpsForChainTx: maxTradeBps,
			onOpenChange,
			persistArgs: {
				agentBasenameTrimmed: agentBasename.trim(),
				geminiSystemPrompt: prompt,
				maxSlippageBps,
				nameTrimmed: name.trim(),
				queryClient,
				tokenIn: ti,
				tokenOut: to,
				vaultId,
				vaultAddressForInvalidation: vaultAddress,
			},
			riskChanged,
			setIsSaving,
			vaultAddress,
			wallet: wallets[0] as PrivyWalletLike | undefined,
		});
	};

	const isLoadingProfile = open && profileQuery.isPending;
	const chainRiskLoading =
		open &&
		Boolean(vaultAddress && isAddress(vaultAddress)) &&
		onChainRiskQuery.isPending;
	const showForm = open && profileQuery.data && !chainRiskLoading;

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
						Update the agent name, model prompt, slippage, token pair, and
						optional Basename. Changing{" "}
						<strong className="text-[#dbc1b9]">max trade size</strong> sends a
						wallet transaction (
						<code className="text-[#dbc1b9]">setRiskParams</code> on your vault)
						— you pay gas. Other fields still sync to the server for cycles and
						UI. Link a <code className="text-[#dbc1b9]">*.base.eth</code> name
						that resolves to this vault; clearing removes the link.
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
										htmlFor="edit-agent-basename"
									>
										Basename (optional)
									</Label>
									<Input
										className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
										id="edit-agent-basename"
										onChange={(e) => setAgentBasename(e.target.value)}
										placeholder="agent.example.base.eth"
										spellCheck={false}
										value={agentBasename}
									/>
								</div>

								<div className="grid gap-2">
									<Label
										className="font-manrope text-[#dbc1b9] text-sm"
										htmlFor="edit-agent-prompt"
									>
										Agent Strategy
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
									<p className="font-manrope text-[#a38c85] text-xs leading-snug">
										On-chain max drawdown cap per swap.
									</p>
									<Slider
										className="**:[[role=slider]]:bg-[#d97757]"
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
								disabled={isSaving}
								form="edit-agent-form"
								type="submit"
							>
								{isSaving ? (
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
