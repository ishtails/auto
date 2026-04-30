import { expect } from "chai";
import { ethers, network } from "hardhat";

const BASE_MAINNET = {
	WETH: "0x4200000000000000000000000000000000000006",
	UNIVERSAL_ROUTER: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
} as const;

const FORK_RPC_URL = process.env.FORK_RPC_URL;
const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER
	? Number(process.env.FORK_BLOCK_NUMBER)
	: undefined;
const WETH_WHALE = process.env.WETH_WHALE;

const erc20Abi = [
	"function balanceOf(address) view returns (uint256)",
	"function transfer(address to, uint256 amount) returns (bool)",
] as const;

describe("Vault fork smoke (optional)", () => {
	it("funds vault with WETH and reaches router call path", async function () {
		if (!(FORK_RPC_URL && WETH_WHALE)) {
			this.skip();
		}

		await network.provider.request({
			method: "hardhat_reset",
			params: [
				{
					forking: {
						jsonRpcUrl: FORK_RPC_URL,
						blockNumber: FORK_BLOCK_NUMBER,
					},
				},
			],
		});

		const [admin, executor] = await ethers.getSigners();

		const vaultFactory = await ethers.getContractFactory("Vault");
		const vault: any = await vaultFactory.deploy(
			admin.address,
			executor.address,
			5000
		);
		await vault.waitForDeployment();

		const weth: any = new ethers.Contract(BASE_MAINNET.WETH, erc20Abi, admin);

		await vault
			.connect(admin)
			.setRouterAllowed(BASE_MAINNET.UNIVERSAL_ROUTER, true);
		await vault.connect(admin).setTokenAllowed(BASE_MAINNET.WETH, true);

		await network.provider.request({
			method: "hardhat_impersonateAccount",
			params: [WETH_WHALE],
		});
		await network.provider.send("hardhat_setBalance", [
			WETH_WHALE,
			"0x1000000000000000000",
		]);

		const whaleSigner = await ethers.getSigner(WETH_WHALE);
		const transferAmount = ethers.parseEther("1");
		await weth
			.connect(whaleSigner)
			.transfer(await vault.getAddress(), transferAmount);

		await network.provider.request({
			method: "hardhat_stopImpersonatingAccount",
			params: [WETH_WHALE],
		});

		expect(await weth.balanceOf(await vault.getAddress())).to.be.greaterThan(
			0n
		);

		const request = {
			target: BASE_MAINNET.UNIVERSAL_ROUTER,
			tokenIn: BASE_MAINNET.WETH,
			amountIn: ethers.parseEther("0.1"),
			data: "0x",
		};

		await expect(
			vault.connect(executor).executeTrade(request)
		).to.be.revertedWithCustomError(vault, "ExternalCallFailed");
	});
});
