"use client";

import { Button } from "@auto/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@auto/ui/components/card";
import { Input } from "@auto/ui/components/input";
import { Label } from "@auto/ui/components/label";
import { Slider } from "@auto/ui/components/slider";
import { Textarea } from "@auto/ui/components/textarea";
import { usePrivy, useSignTypedData, useWallets } from "@privy-io/react-auth";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, LoaderCircle, Rocket, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

export default function CreateVaultPage() {
	const router = useRouter();
	const { authenticated, login, ready } = usePrivy();
	const { wallets } = useWallets();
	const { signTypedData } = useSignTypedData();
	const [name, setName] = useState("Alpha Trading Agent");
	const [prompt, setPrompt] = useState(
		"Maintain a delta-neutral strategy while prioritizing capital preservation. Execute trades only when high-confidence signals are present."
	);
	const [riskScore, setRiskScore] = useState(15);
	const [maxSlippageBps, setMaxSlippageBps] = useState(100);

	const prepareDeployment = useMutation(
		orpc.prepareVaultDeployment.mutationOptions()
	);

	const createDeployment = useMutation(
		orpc.createVaultDeployment.mutationOptions({
			onSuccess: (_data) => {
				toast.success("Vault deployment initiated!");
				router.push("/vaults");
			},
		})
	);

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		const wallet = wallets[0];
		if (!wallet?.address) {
			toast.error("No wallet connected. Please login first.");
			return;
		}

		// Map UI risk score (0-100) -> maxTradeBps (1-10,000)
		const maxTradeBps = Math.max(1, Math.round((riskScore / 100) * 10_000));

		const prepared = await prepareDeployment.mutateAsync({
			maxTradeSizeBps: maxTradeBps,
		});

		const d = prepared.defaults;

		const { signature } = await signTypedData(
			{
				domain: prepared.typedData.domain,
				types: prepared.typedData.types,
				primaryType: prepared.typedData.primaryType,
				message: prepared.typedData.message,
			},
			{ address: wallet.address }
		);

		createDeployment.mutate({
			name,
			geminiSystemPrompt: prompt,
			maxTradeBps,
			maxSlippageBps,
			tokenIn: d.tokenIn,
			tokenOut: d.tokenOut,
			signedConfigHash: prepared.signedConfigHash,
			ownerSignature: signature,
			factoryAddress: d.factoryAddress,
		});
	};

	const isSubmitting =
		createDeployment.isPending || prepareDeployment.isPending;

	if (!ready) {
		return null;
	}

	if (!authenticated) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-[#131313] px-6 text-[#e2e2e2]">
				<ShieldCheck className="mb-6 h-16 w-16 text-[#d97757]" />
				<h1 className="mb-2 font-newsreader text-4xl text-[#f5f5f2] italic">
					Authentication Required
				</h1>
				<p className="mb-8 max-w-md text-center font-manrope text-[#dbc1b9]">
					Please log in to create and manage your User-Owned Vaults.
				</p>
				<Button
					className="h-11 rounded-md bg-[#d97757] px-8 font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
					onClick={login}
				>
					Login to auto.eth
				</Button>
			</div>
		);
	}

	return (
		<main className="min-h-screen bg-[#131313] text-[#e2e2e2]">
			<div className="mx-auto w-full max-w-[800px] px-6 py-12 md:px-10 md:py-16">
				<Link
					className="mb-8 flex items-center gap-2 font-manrope text-[#a38c85] text-sm transition-colors hover:text-[#f5f5f2]"
					href="/vaults"
				>
					<ChevronLeft className="h-4 w-4" />
					Back to Dashboard
				</Link>

				<header className="mb-10">
					<h1 className="font-newsreader text-5xl text-[#f5f5f2] italic">
						Initialize Agent Vault
					</h1>
					<p className="mt-2 font-manrope text-[#dbc1b9]">
						Configure your non-custodial trading infrastructure on Base Sepolia.
					</p>
				</header>

				<form onSubmit={onSubmit}>
					<Card className="border border-[#55433d] bg-[#1b1b1b] p-2">
						<CardHeader>
							<CardTitle className="font-newsreader font-normal text-2xl text-[#f5f5f2]">
								Agent Configuration
							</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-8">
							<div className="grid gap-3">
								<Label className="text-[#dbc1b9]" htmlFor="name">
									Agent Name
								</Label>
								<Input
									className="border-[#55433d] bg-[#131313] text-[#e2e2e2] focus:ring-[#d97757]"
									id="name"
									onChange={(e) => setName(e.target.value)}
									placeholder="My Pro Agent"
									value={name}
								/>
							</div>

							<div className="grid gap-3">
								<Label className="text-[#dbc1b9]" htmlFor="prompt">
									Gemini System Prompt
								</Label>
								<Textarea
									className="min-h-[120px] border-[#55433d] bg-[#131313] text-[#e2e2e2] focus:ring-[#d97757]"
									id="prompt"
									onChange={(e) => setPrompt(e.target.value)}
									placeholder="Describe your trading strategy..."
									value={prompt}
								/>
								<p className="text-[#a38c85] text-xs">
									This prompt guides the agent's decision-making process.
								</p>
							</div>

							<div className="grid gap-6">
								<div className="flex items-center justify-between">
									<Label className="text-[#dbc1b9]">Risk Tolerance</Label>
									<span className="font-bold text-[#d97757] text-sm">
										{riskScore}/100
									</span>
								</div>
								<Slider
									className="[&_[role=slider]]:bg-[#d97757]"
									max={100}
									onValueChange={(value) =>
										setRiskScore(Array.isArray(value) ? (value[0] ?? 0) : value)
									}
									step={1}
									value={[riskScore]}
								/>
							</div>

							<div className="grid gap-3">
								<Label className="text-[#dbc1b9]" htmlFor="slippage">
									Max Slippage (bps)
								</Label>
								<Input
									className="border-[#55433d] bg-[#131313] text-[#e2e2e2] focus:ring-[#d97757]"
									id="slippage"
									max={2000}
									min={1}
									onChange={(e) =>
										setMaxSlippageBps(Number(e.target.value || "100"))
									}
									type="number"
									value={maxSlippageBps}
								/>
							</div>

							<Button
								className="mt-4 h-12 gap-2 bg-[#d97757] font-manrope text-[#1b1b1b] hover:bg-[#ffb59e]"
								disabled={isSubmitting}
								type="submit"
							>
								{isSubmitting ? (
									<LoaderCircle className="h-4 w-4 animate-spin" />
								) : (
									<Rocket className="h-4 w-4" />
								)}
								Deploy to Base Sepolia
							</Button>
						</CardContent>
					</Card>
				</form>
			</div>
		</main>
	);
}
