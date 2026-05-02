import {
	VAULT_FACTORY_ABI,
	VAULT_FACTORY_ADDRESS,
} from "@auto/contracts/factory-definitions";
import { env } from "@auto/env/server";
import { Queue, Worker } from "bunqueue/client";
import { eq } from "drizzle-orm";
import {
	createPublicClient,
	createWalletClient,
	decodeEventLog,
	http,
	isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../db";
import { vaultDeployments, vaults } from "../db/schema";

export const deployQueue = new Queue("vault-deploys", { embedded: true });

function getDeployedVaultAddress(args: unknown): `0x${string}` | null {
	if (!args || typeof args !== "object") {
		return null;
	}
	if (!("vault" in args)) {
		return null;
	}
	const vault = (args as Record<string, unknown>).vault;
	if (typeof vault !== "string") {
		return null;
	}
	if (!isAddress(vault)) {
		return null;
	}
	return vault;
}

export const deployWorker = new Worker(
	"vault-deploys",
	async (job) => {
		const {
			deploymentId,
			vaultId,
			ownerAddress,
			ownerSignature,
			maxTradeSizeBps,
		} = job.data as {
			deploymentId: string;
			vaultId: string;
			ownerAddress: string;
			ownerSignature: string;
			maxTradeSizeBps: number;
		};

		console.log(`[DeployWorker] Processing job for deployment ${deploymentId}`);

		if (!isAddress(env.UNISWAP_ROUTER_ADDRESS)) {
			throw new Error(
				`Invalid UNISWAP_ROUTER_ADDRESS: ${env.UNISWAP_ROUTER_ADDRESS}`
			);
		}
		if (!isAddress(env.TOKEN_WETH)) {
			throw new Error(`Invalid TOKEN_WETH: ${env.TOKEN_WETH}`);
		}
		if (!isAddress(env.KEEPERHUB_RELAYER_ADDRESS)) {
			throw new Error(
				`Invalid KEEPERHUB_RELAYER_ADDRESS: ${env.KEEPERHUB_RELAYER_ADDRESS}`
			);
		}
		if (!isAddress(ownerAddress)) {
			throw new Error(`Invalid ownerAddress: ${ownerAddress}`);
		}

		const account = privateKeyToAccount(
			env.DEPLOYER_PRIVATE_KEY as `0x${string}`
		);
		const walletClient = createWalletClient({
			account,
			chain: undefined,
			transport: http(env.CHAIN_RPC_URL),
		});
		const publicClient = createPublicClient({
			chain: undefined,
			transport: http(env.CHAIN_RPC_URL),
		});

		// 1) Send deploy tx
		const txHash = await walletClient.writeContract({
			chain: null,
			address: VAULT_FACTORY_ADDRESS,
			abi: VAULT_FACTORY_ABI,
			functionName: "deployVault",
			args: [
				ownerAddress as `0x${string}`,
				env.KEEPERHUB_RELAYER_ADDRESS as `0x${string}`,
				env.UNISWAP_ROUTER_ADDRESS as `0x${string}`,
				env.TOKEN_WETH as `0x${string}`,
				maxTradeSizeBps,
				ownerSignature as `0x${string}`,
			],
		});

		await db
			.update(vaultDeployments)
			.set({ status: "submitted", txHash })
			.where(eq(vaultDeployments.id, deploymentId));

		await db
			.update(vaults)
			.set({ status: "submitted" })
			.where(eq(vaults.id, vaultId));

		// 2) Wait for receipt
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: txHash,
			timeout: 60_000,
		});

		// 3) Parse VaultDeployed event
		let deployedVault: `0x${string}` | null = null;
		for (const log of receipt.logs) {
			try {
				const decoded = decodeEventLog({
					abi: VAULT_FACTORY_ABI,
					data: log.data,
					topics: log.topics,
				});
				if (decoded.eventName === "VaultDeployed") {
					deployedVault = getDeployedVaultAddress(decoded.args);
					break;
				}
			} catch {
				// ignore non-matching logs
			}
		}

		if (!deployedVault) {
			throw new Error("VaultDeployed event not found in receipt logs");
		}

		// 4) Persist real vault address
		await db
			.update(vaultDeployments)
			.set({ status: "active" })
			.where(eq(vaultDeployments.id, deploymentId));

		await db
			.update(vaults)
			.set({ status: "active", vaultAddress: deployedVault })
			.where(eq(vaults.id, vaultId));

		console.log(
			`[DeployWorker] Deployment ${deploymentId} active at ${deployedVault}`
		);
	},
	{
		embedded: true,
		concurrency: 1, // serialize deploys to avoid nonce conflicts
	}
);
