import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import type { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
	solidity: {
		version: "0.8.28",
		settings: {
			optimizer: { enabled: true, runs: 200 },
		},
	},
	networks: {
		hardhat: {
			forking: process.env.FORK_RPC_URL
				? {
						url: process.env.FORK_RPC_URL,
					}
				: undefined,
		},
		baseSepolia: {
			url: process.env.ALCHEMY_BASE_SEPOLIA_URL || "",
			accounts: process.env.DEPLOYER_PRIVATE_KEY
				? [process.env.DEPLOYER_PRIVATE_KEY]
				: [],
			chainId: 84_532,
		},
	},
	// Single string key → Etherscan API v2 (https://api.etherscan.io/v2/api + chainid).
	etherscan: {
		apiKey: process.env.ETHERSCAN_API_KEY || "",
	},
	typechain: {
		outDir: "typechain-types",
		target: "ethers-v6",
	},
};

export default config;
