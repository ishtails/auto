import hre from "hardhat";

// deployer template from an old project. update it accordingly.
async function main() {
	const TRUSTED_FORWARDER = process.env.GELATO_TRUSTED_FORWARDER;

	if (!TRUSTED_FORWARDER) {
		throw new Error(
			"GELATO_TRUSTED_FORWARDER is not set. " +
				"Get it from the Gelato Relay dashboard for Base Sepolia."
		);
	}

	console.log("Deploying MetxFactory...");
	console.log("  Trusted forwarder:", TRUSTED_FORWARDER);

	const factory = await hre.ethers.deployContract("MetxFactory", [
		TRUSTED_FORWARDER,
	]);

	await factory.waitForDeployment();

	const address = await factory.getAddress();
	console.log("✓ MetxFactory deployed to:", address);

	const { chainId } = await hre.ethers.provider.getNetwork();
	const isLocalDev =
		hre.network.name === "hardhat" || Number(chainId) === 31_337;

	// ── Auto-verify on BaseScan (public chains only) ───────────
	if (isLocalDev) {
		console.log(
			"\nSkipping BaseScan verification (local / unsupported chain for explorers)"
		);
	} else if (process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY) {
		console.log("\nVerifying on BaseScan...");
		try {
			await hre.run("verify:verify", {
				address,
				constructorArguments: [TRUSTED_FORWARDER],
			});
			console.log("✓ Contract verified on BaseScan");
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("Already Verified")) {
				console.log("✓ Contract already verified on BaseScan");
			} else {
				console.error("✗ Verification failed:", message);
			}
		}
	} else {
		console.log(
			"\nSkipping contract verification (set ETHERSCAN_API_KEY from etherscan.io/apis)"
		);
		console.log("To verify manually:");
		console.log(
			`  npx hardhat verify --network baseSepolia ${address} ${TRUSTED_FORWARDER}`
		);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
