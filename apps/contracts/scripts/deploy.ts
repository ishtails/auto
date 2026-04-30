import hre from "hardhat";

const parseAddressList = (raw: string | undefined): string[] => {
	if (!raw) {
		return [];
	}
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
};

const defaultTokenSymbols = [
	"VAULT_TOKEN_WETH",
	"VAULT_TOKEN_USDC",
	"VAULT_TOKEN_UNI",
	"VAULT_TOKEN_LINK",
	"VAULT_TOKEN_0G",
];

async function main() {
	const [deployer] = await hre.ethers.getSigners();
	const admin = process.env.VAULT_ADMIN_ADDRESS ?? deployer.address;
	const executor = process.env.KEEPERHUB_RELAYER_ADDRESS;
	const maxTradeSizeBps = Number(process.env.VAULT_MAX_TRADE_SIZE_BPS ?? "5000");

	if (!executor) {
		throw new Error("KEEPERHUB_RELAYER_ADDRESS is required.");
	}

	const envTokens = parseAddressList(process.env.VAULT_ALLOWED_TOKENS);
	const namedTokens = defaultTokenSymbols
		.map((key) => process.env[key])
		.filter((value): value is string => Boolean(value));
	const tokenAddresses = envTokens.length > 0 ? envTokens : namedTokens;
	const routerAddresses = parseAddressList(process.env.VAULT_ALLOWED_ROUTERS);

	if (tokenAddresses.length === 0) {
		throw new Error(
			"Set VAULT_ALLOWED_TOKENS or named token env vars (VAULT_TOKEN_WETH, VAULT_TOKEN_USDC, VAULT_TOKEN_UNI, VAULT_TOKEN_LINK, VAULT_TOKEN_0G)."
		);
	}
	if (routerAddresses.length === 0) {
		throw new Error("VAULT_ALLOWED_ROUTERS is required.");
	}

	console.log("Deploying Vault...");
	console.log("  Network:", hre.network.name);
	console.log("  Deployer:", deployer.address);
	console.log("  Admin:", admin);
	console.log("  KeeperHub relayer:", executor);
	console.log("  Max trade size bps:", maxTradeSizeBps);

	const vault = await hre.ethers.deployContract("Vault", [
		admin,
		executor,
		maxTradeSizeBps,
	]);
	await vault.waitForDeployment();

	const vaultAddress = await vault.getAddress();
	console.log("✓ Vault deployed:", vaultAddress);

	// Explicit role assignment for KeeperHub relayer (idempotent with constructor grant).
	const grantTx = await vault.setExecutor(executor, true);
	await grantTx.wait();
	console.log("  ✓ EXECUTOR_ROLE granted:", executor);

	for (const router of routerAddresses) {
		const tx = await vault.setRouterAllowed(router, true);
		await tx.wait();
		console.log("  ✓ Router allowlisted:", router);
	}

	for (const token of tokenAddresses) {
		const tx = await vault.setTokenAllowed(token, true);
		await tx.wait();
		console.log(
			`  ✓ Token allowlisted + max-approved for routers: ${token} (${routerAddresses.length} router(s))`
		);
	}

	const isLocal = hre.network.name === "hardhat" || hre.network.name === "localhost";
	if (!isLocal && process.env.ETHERSCAN_API_KEY) {
		console.log("Verifying contract...");
		try {
			await hre.run("verify:verify", {
				address: vaultAddress,
				constructorArguments: [admin, executor, maxTradeSizeBps],
			});
			console.log("✓ Contract verified");
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("Already Verified")) {
				console.log("✓ Contract already verified");
			} else {
				console.error("✗ Verification failed:", message);
			}
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
