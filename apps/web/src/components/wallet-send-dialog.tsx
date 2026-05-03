"use client";

import { Button } from "@auto/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@auto/ui/components/dialog";
import { Input } from "@auto/ui/components/input";
import { Label } from "@auto/ui/components/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	createPublicClient,
	custom,
	formatEther,
	formatUnits,
	getAddress,
	isAddress,
	parseEther,
	parseUnits,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
	getPrivyWalletClient,
	isPrivyEmbeddedWalletRpcNoiseError,
	type PrivyWalletLike,
} from "@/lib/privy-wallet-client";

/** Canonical Base Sepolia assets (same as server `config.ts`). */
const BASE_SEPOLIA_TOKENS = {
	weth: {
		address: "0x4200000000000000000000000000000000000006" as const,
		decimals: 18,
		label: "WETH",
	},
	usdc: {
		address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const,
		decimals: 6,
		label: "USDC",
	},
} as const;

const erc20Abi = [
	{
		type: "function",
		name: "balanceOf",
		stateMutability: "view",
		inputs: [{ name: "account", type: "address" }],
		outputs: [{ type: "uint256" }],
	},
	{
		type: "function",
		name: "transfer",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "to", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ type: "bool" }],
	},
] as const;

export type WalletSendTokenId = "eth" | "weth" | "usdc";

export interface WalletSendDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	wallet: (PrivyWalletLike & { address: string }) | null;
}

function parseSendAmount(
	tokenId: WalletSendTokenId,
	raw: string
): { ok: true; wei: bigint } | { ok: false; message: string } {
	const trimmed = raw.trim();
	if (trimmed === "") {
		return { ok: false, message: "Enter an amount." };
	}
	try {
		if (tokenId === "usdc") {
			const wei = parseUnits(trimmed, BASE_SEPOLIA_TOKENS.usdc.decimals);
			if (wei <= BigInt(0)) {
				return { ok: false, message: "Amount must be greater than zero." };
			}
			return { ok: true, wei };
		}
		const wei = parseEther(trimmed);
		if (wei <= BigInt(0)) {
			return { ok: false, message: "Amount must be greater than zero." };
		}
		return { ok: true, wei };
	} catch {
		return { ok: false, message: "Invalid amount." };
	}
}

export function WalletSendDialog({
	open,
	onOpenChange,
	wallet,
}: WalletSendDialogProps) {
	const queryClient = useQueryClient();
	const [recipient, setRecipient] = useState("");
	const [amount, setAmount] = useState("");
	const [tokenId, setTokenId] = useState<WalletSendTokenId>("eth");
	const [isSending, setIsSending] = useState(false);

	useEffect(() => {
		if (!open) {
			return;
		}
		setRecipient("");
		setAmount("");
		setTokenId("eth");
	}, [open]);

	const nativeBalance = useQuery({
		queryKey: ["wallet-native-balance", wallet?.address ?? ""],
		enabled: Boolean(open && wallet?.address),
		queryFn: async () => {
			const w = wallet as PrivyWalletLike & { address: string };
			const provider = (await w.getEthereumProvider()) as {
				request: (args: {
					method: string;
					params?: unknown[];
				}) => Promise<string>;
			};
			const hex = await provider.request({
				method: "eth_getBalance",
				params: [w.address, "latest"],
			});
			return BigInt(hex);
		},
	});

	const erc20Balance = useQuery({
		queryKey: ["wallet-erc20-balance", wallet?.address ?? "", tokenId] as const,
		enabled: Boolean(
			open && wallet?.address && (tokenId === "weth" || tokenId === "usdc")
		),
		queryFn: async () => {
			const w = wallet as PrivyWalletLike & { address: string };
			const meta =
				tokenId === "weth"
					? BASE_SEPOLIA_TOKENS.weth
					: BASE_SEPOLIA_TOKENS.usdc;
			const provider = await w.getEthereumProvider();
			const client = createPublicClient({
				chain: baseSepolia,
				transport: custom(provider as Parameters<typeof custom>[0]),
			});
			return client.readContract({
				address: meta.address,
				abi: erc20Abi,
				functionName: "balanceOf",
				args: [w.address as `0x${string}`],
			});
		},
	});

	const balanceLabel = (() => {
		if (!wallet?.address) {
			return "—";
		}
		if (tokenId === "eth") {
			if (nativeBalance.isLoading) {
				return "…";
			}
			return `${formatEther(nativeBalance.data ?? BigInt(0))} ETH`;
		}
		if (erc20Balance.isLoading) {
			return "…";
		}
		const meta =
			tokenId === "weth" ? BASE_SEPOLIA_TOKENS.weth : BASE_SEPOLIA_TOKENS.usdc;
		return `${formatUnits(erc20Balance.data ?? BigInt(0), meta.decimals)} ${meta.label}`;
	})();

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!wallet?.address) {
			toast.error("No wallet connected.");
			return;
		}
		const to = recipient.trim();
		if (!isAddress(to)) {
			toast.error("Recipient must be a valid address.");
			return;
		}
		const recipientAddr = getAddress(to);
		const parsed = parseSendAmount(tokenId, amount);
		if (!parsed.ok) {
			toast.error(parsed.message);
			return;
		}

		setIsSending(true);
		try {
			const walletClient = await getPrivyWalletClient(wallet);
			const account = wallet.address as `0x${string}`;

			if (tokenId === "eth") {
				await walletClient.sendTransaction({
					chain: baseSepolia,
					account,
					to: recipientAddr,
					value: parsed.wei,
				});
			} else {
				const tokenAddress =
					tokenId === "weth"
						? BASE_SEPOLIA_TOKENS.weth.address
						: BASE_SEPOLIA_TOKENS.usdc.address;
				await walletClient.writeContract({
					chain: baseSepolia,
					account,
					address: tokenAddress,
					abi: erc20Abi,
					functionName: "transfer",
					args: [recipientAddr, parsed.wei],
				});
			}

			toast.success("Transfer submitted.");
			await queryClient.invalidateQueries({
				queryKey: ["wallet-native-balance", wallet.address],
			});
			await queryClient.invalidateQueries({
				predicate: (q) =>
					Array.isArray(q.queryKey) &&
					q.queryKey[0] === "wallet-erc20-balance" &&
					q.queryKey[1] === wallet.address,
			});
			onOpenChange(false);
		} catch (error: unknown) {
			if (isPrivyEmbeddedWalletRpcNoiseError(error)) {
				toast.success("Transfer submitted.");
				await queryClient.invalidateQueries({
					queryKey: ["wallet-native-balance", wallet.address],
				});
				await queryClient.invalidateQueries({
					predicate: (q) =>
						Array.isArray(q.queryKey) &&
						q.queryKey[0] === "wallet-erc20-balance" &&
						q.queryKey[1] === wallet.address,
				});
				onOpenChange(false);
			} else {
				const message = error instanceof Error ? error.message : String(error);
				toast.error(message);
			}
		} finally {
			setIsSending(false);
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className="max-h-[min(90vh,32rem)] overflow-y-auto border-[#55433d] bg-[#1b1b1b] text-[#e2e2e2] sm:max-w-md"
				showCloseButton
			>
				<DialogHeader>
					<DialogTitle className="font-newsreader text-[#f5f5f2] text-lg">
						Send from wallet
					</DialogTitle>
					<DialogDescription className="font-manrope text-[#dbc1b9] text-sm leading-relaxed">
						Send native ETH or ERC-20 on Base Sepolia from your connected
						account. Double-check the recipient — transfers are irreversible.
					</DialogDescription>
				</DialogHeader>

				<form className="flex flex-col gap-4" onSubmit={onSubmit}>
					<div className="grid gap-2">
						<Label
							className="font-manrope text-[#dbc1b9] text-sm"
							htmlFor="send-recipient"
						>
							Recipient address
						</Label>
						<Input
							className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
							id="send-recipient"
							onChange={(e) => setRecipient(e.target.value)}
							placeholder="0x…"
							spellCheck={false}
							value={recipient}
						/>
					</div>

					<div className="grid gap-2">
						<Label
							className="font-manrope text-[#dbc1b9] text-sm"
							htmlFor="send-token"
						>
							Token
						</Label>
						<select
							className="h-11 w-full rounded-md border border-[#55433d] bg-[#131313] px-3 font-manrope text-[#e2e2e2] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]"
							id="send-token"
							onChange={(e) => setTokenId(e.target.value as WalletSendTokenId)}
							value={tokenId}
						>
							<option value="eth">ETH (native)</option>
							<option value="weth">WETH</option>
							<option value="usdc">USDC</option>
						</select>
						<p className="font-manrope text-[#a38c85] text-xs">
							Available: {balanceLabel}
						</p>
					</div>

					<div className="grid gap-2">
						<Label
							className="font-manrope text-[#dbc1b9] text-sm"
							htmlFor="send-amount"
						>
							Amount
						</Label>
						<Input
							className="h-11 rounded-md border-[#55433d] bg-[#131313] font-manrope text-[#e2e2e2] text-sm"
							id="send-amount"
							onChange={(e) => setAmount(e.target.value)}
							placeholder={tokenId === "usdc" ? "0.00" : "0.0"}
							spellCheck={false}
							type="text"
							value={amount}
						/>
						<p className="font-manrope text-[#6b5d58] text-[10px] leading-snug">
							{tokenId === "usdc"
								? "USDC uses 6 decimals on Base Sepolia."
								: "ETH / WETH amounts in whole units (e.g. 0.01)."}
						</p>
					</div>

					<DialogFooter className="border-[#2a2a2a] bg-transparent p-0 sm:justify-end">
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
							disabled={isSending || !wallet}
							type="submit"
						>
							{isSending ? (
								<LoaderCircle className="size-4 animate-spin" />
							) : (
								<Send className="size-4" />
							)}
							Send
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
