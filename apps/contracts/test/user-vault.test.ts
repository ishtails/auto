import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import type { MockERC20, UserVault, VaultFactory } from "../typechain-types";

// EIP-712 domain and type definitions
const DEPLOY_CONFIG_TYPES = {
	DeployConfig: [
		{ name: "owner", type: "address" },
		{ name: "swapRouter", type: "address" },
		{ name: "maxTradeSizeBps", type: "uint16" },
		{ name: "nonce", type: "uint256" },
	],
};

describe("UserVault + VaultFactory", () => {
	async function deployFixture() {
		const [deployer, vaultOwner, agent, feeReceiver, attacker] =
			await ethers.getSigners();

		// Deploy mock tokens
		const MockERC20 = await ethers.getContractFactory("MockERC20");
		const tokenIn = (await MockERC20.deploy(
			"WETH",
			"WETH"
		)) as unknown as MockERC20;
		const tokenOut = (await MockERC20.deploy(
			"USDC",
			"USDC"
		)) as unknown as MockERC20;

		// Deploy mock swap router
		const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
		const mockRouter = await MockSwapRouter.deploy();

		// Deploy UserVault implementation
		const UserVaultFactory = await ethers.getContractFactory("UserVault");
		const implementation =
			(await UserVaultFactory.deploy()) as unknown as UserVault;

		// Deploy VaultFactory
		const VaultFactoryContract =
			await ethers.getContractFactory("VaultFactory");
		const factory = (await VaultFactoryContract.deploy(
			await implementation.getAddress(),
			deployer.address,
			feeReceiver.address,
			0, // feeBps = 0 for V1
			3 // maxVaultsPerUser
		)) as unknown as VaultFactory;

		return {
			deployer,
			vaultOwner,
			agent,
			feeReceiver,
			attacker,
			tokenIn,
			tokenOut,
			mockRouter,
			implementation,
			factory,
		};
	}

	async function deployVaultViaFactory(
		fixture: Awaited<ReturnType<typeof deployFixture>>,
		feeBps = 0
	) {
		const { factory, vaultOwner, agent, mockRouter, deployer } = fixture;

		// Update fee if non-zero
		if (feeBps > 0) {
			await factory
				.connect(deployer)
				.setFeeConfig(fixture.feeReceiver.address, feeBps);
		}

		const nonce = await factory.getNonce(vaultOwner.address);
		const maxTradeSizeBps = 5000;
		const chainId = (await ethers.provider.getNetwork()).chainId;

		const domain = {
			name: "AutoVaultFactory",
			version: "1",
			chainId,
			verifyingContract: await factory.getAddress(),
		};

		const message = {
			owner: vaultOwner.address,
			swapRouter: await mockRouter.getAddress(),
			maxTradeSizeBps,
			nonce,
		};

		const signature = await vaultOwner.signTypedData(
			domain,
			DEPLOY_CONFIG_TYPES,
			message
		);

		const tx = await factory
			.connect(deployer)
			.deployVault(
				vaultOwner.address,
				agent.address,
				await mockRouter.getAddress(),
				maxTradeSizeBps,
				signature
			);

		const receipt = await tx.wait();
		const event = receipt?.logs.find((log) => {
			try {
				return factory.interface.parseLog(log as any)?.name === "VaultDeployed";
			} catch {
				return false;
			}
		});

		const parsed = factory.interface.parseLog(event as any);
		const vaultAddress = parsed?.args.vault;

		const vault = (await ethers.getContractAt(
			"UserVault",
			vaultAddress
		)) as unknown as UserVault;

		return { vault, vaultAddress };
	}

	// ─── Factory Tests ───────────────────────────────────────────────

	describe("VaultFactory", () => {
		it("deploys vault with valid EIP-712 signature", async () => {
			const fixture = await loadFixture(deployFixture);
			const { vault } = await deployVaultViaFactory(fixture);

			expect(await vault.owner()).to.equal(fixture.vaultOwner.address);
			expect(await vault.authorizedAgent()).to.equal(fixture.agent.address);
			expect(await vault.maxTradeSizeBps()).to.equal(5000);
		});

		it("rejects invalid EIP-712 signature", async () => {
			const fixture = await loadFixture(deployFixture);
			const { factory, vaultOwner, agent, mockRouter, deployer, attacker } =
				fixture;

			const nonce = await factory.getNonce(vaultOwner.address);
			const chainId = (await ethers.provider.getNetwork()).chainId;

			const domain = {
				name: "AutoVaultFactory",
				version: "1",
				chainId,
				verifyingContract: await factory.getAddress(),
			};

			// Attacker signs instead of owner
			const signature = await attacker.signTypedData(
				domain,
				DEPLOY_CONFIG_TYPES,
				{
					owner: vaultOwner.address,
					swapRouter: await mockRouter.getAddress(),
					maxTradeSizeBps: 5000,
					nonce,
				}
			);

			await expect(
				factory
					.connect(deployer)
					.deployVault(
						vaultOwner.address,
						agent.address,
						await mockRouter.getAddress(),
						5000,
						signature
					)
			).to.be.revertedWithCustomError(factory, "InvalidSignature");
		});

		it("enforces per-user deploy limit", async () => {
			const fixture = await loadFixture(deployFixture);

			// Deploy 3 vaults (max)
			await deployVaultViaFactory(fixture);
			await deployVaultViaFactory(fixture);
			await deployVaultViaFactory(fixture);

			// 4th should fail
			const { factory, vaultOwner, agent, mockRouter, deployer } = fixture;
			const nonce = await factory.getNonce(vaultOwner.address);
			const chainId = (await ethers.provider.getNetwork()).chainId;

			const domain = {
				name: "AutoVaultFactory",
				version: "1",
				chainId,
				verifyingContract: await factory.getAddress(),
			};

			const signature = await vaultOwner.signTypedData(
				domain,
				DEPLOY_CONFIG_TYPES,
				{
					owner: vaultOwner.address,
					swapRouter: await mockRouter.getAddress(),
					maxTradeSizeBps: 5000,
					nonce,
				}
			);

			await expect(
				factory
					.connect(deployer)
					.deployVault(
						vaultOwner.address,
						agent.address,
						await mockRouter.getAddress(),
						5000,
						signature
					)
			).to.be.revertedWithCustomError(factory, "DeployLimitReached");
		});

		it("only deployer can deploy vaults", async () => {
			const fixture = await loadFixture(deployFixture);
			const { factory, vaultOwner, agent, mockRouter, attacker } = fixture;

			await expect(
				factory
					.connect(attacker)
					.deployVault(
						vaultOwner.address,
						agent.address,
						await mockRouter.getAddress(),
						5000,
						"0x00"
					)
			).to.be.revertedWithCustomError(factory, "Unauthorized");
		});
	});

	// ─── Vault Access Control Tests ──────────────────────────────────

	describe("Access Control", () => {
		it("owner can withdraw tokens — no protocol fee", async () => {
			const fixture = await loadFixture(deployFixture);
			const { vault } = await deployVaultViaFactory(fixture, 100); // 1% fee
			const { vaultOwner, tokenIn } = fixture;

			// Fund vault
			const amount = ethers.parseEther("10");
			await tokenIn.mint(await vault.getAddress(), amount);

			const ownerBalBefore = await tokenIn.balanceOf(vaultOwner.address);
			await vault
				.connect(vaultOwner)
				.withdraw(await tokenIn.getAddress(), amount, vaultOwner.address);
			const ownerBalAfter = await tokenIn.balanceOf(vaultOwner.address);

			// Full amount received — no fee deducted
			expect(ownerBalAfter - ownerBalBefore).to.equal(amount);
		});

		it("agent cannot withdraw", async () => {
			const fixture = await loadFixture(deployFixture);
			const { vault } = await deployVaultViaFactory(fixture);
			const { agent, tokenIn } = fixture;

			await tokenIn.mint(await vault.getAddress(), ethers.parseEther("1"));

			await expect(
				vault
					.connect(agent)
					.withdraw(
						await tokenIn.getAddress(),
						ethers.parseEther("1"),
						agent.address
					)
			).to.be.revertedWithCustomError(vault, "Unauthorized");
		});

		it("non-agent cannot execute swap", async () => {
			const fixture = await loadFixture(deployFixture);
			const { vault } = await deployVaultViaFactory(fixture);
			const { attacker, tokenIn, tokenOut } = fixture;

			await expect(
				vault.connect(attacker).executeSwap({
					tokenIn: await tokenIn.getAddress(),
					amountIn: ethers.parseEther("1"),
					tokenOut: await tokenOut.getAddress(),
					amountOutMinimum: 0,
					swapCalldata: "0x",
					deadline: Math.floor(Date.now() / 1000) + 3600,
				})
			).to.be.revertedWithCustomError(vault, "Unauthorized");
		});

		it("owner can revoke and change agent", async () => {
			const fixture = await loadFixture(deployFixture);
			const { vault } = await deployVaultViaFactory(fixture);
			const { vaultOwner, attacker } = fixture;

			await vault.connect(vaultOwner).setAuthorizedAgent(attacker.address);
			expect(await vault.authorizedAgent()).to.equal(attacker.address);
		});

		it("owner can pause and unpause agent", async () => {
			const fixture = await loadFixture(deployFixture);
			const { vault } = await deployVaultViaFactory(fixture);
			const { vaultOwner, agent, tokenIn, tokenOut } = fixture;

			await vault.connect(vaultOwner).pauseAgent();

			await expect(
				vault.connect(agent).executeSwap({
					tokenIn: await tokenIn.getAddress(),
					amountIn: ethers.parseEther("1"),
					tokenOut: await tokenOut.getAddress(),
					amountOutMinimum: 0,
					swapCalldata: "0x",
					deadline: Math.floor(Date.now() / 1000) + 3600,
				})
			).to.be.revertedWithCustomError(vault, "AgentPaused");

			await vault.connect(vaultOwner).unpauseAgent();
			expect(await vault.agentPaused()).to.equal(false);
		});
	});

	// ─── Swap Execution Tests ────────────────────────────────────────

	describe("Swap Execution", () => {
		it("agent executes swap with zero allowance at rest", async () => {
			const fixture = await loadFixture(deployFixture);
			const { vault } = await deployVaultViaFactory(fixture);
			const { agent, tokenIn, tokenOut, mockRouter } = fixture;

			const swapAmount = ethers.parseEther("1");
			const outputAmount = ethers.parseUnits("1800", 6);

			// Fund vault with tokenIn
			await tokenIn.mint(await vault.getAddress(), ethers.parseEther("10"));
			// Fund mock router with tokenOut (it sends this back)
			await tokenOut.mint(await mockRouter.getAddress(), outputAmount);

			// Build calldata: MockSwapRouter.swap(tokenIn, tokenOut, amountIn, amountOut, recipient)
			const swapCalldata = mockRouter.interface.encodeFunctionData("swap", [
				await tokenIn.getAddress(),
				await tokenOut.getAddress(),
				swapAmount,
				outputAmount,
				await vault.getAddress(), // recipient = vault
			]);

			await vault.connect(agent).executeSwap({
				tokenIn: await tokenIn.getAddress(),
				amountIn: swapAmount,
				tokenOut: await tokenOut.getAddress(),
				amountOutMinimum: outputAmount,
				swapCalldata,
				deadline: Math.floor(Date.now() / 1000) + 3600,
			});

			// Verify zero allowance at rest
			const allowance = await tokenIn.allowance(
				await vault.getAddress(),
				await mockRouter.getAddress()
			);
			expect(allowance).to.equal(0);

			// Verify output received
			const vaultOutBal = await tokenOut.balanceOf(await vault.getAddress());
			expect(vaultOutBal).to.equal(outputAmount);
		});

		it("post-swap protocol fee is correctly calculated", async () => {
			const fixture = await loadFixture(deployFixture);
			const feeBps = 100; // 1%
			const { vault } = await deployVaultViaFactory(fixture, feeBps);
			const { agent, tokenIn, tokenOut, mockRouter, feeReceiver } = fixture;

			const swapAmount = ethers.parseEther("1");
			const outputAmount = ethers.parseUnits("10000", 6); // 10000 USDC

			await tokenIn.mint(await vault.getAddress(), ethers.parseEther("10"));
			await tokenOut.mint(await mockRouter.getAddress(), outputAmount);

			const swapCalldata = mockRouter.interface.encodeFunctionData("swap", [
				await tokenIn.getAddress(),
				await tokenOut.getAddress(),
				swapAmount,
				outputAmount,
				await vault.getAddress(),
			]);

			await vault.connect(agent).executeSwap({
				tokenIn: await tokenIn.getAddress(),
				amountIn: swapAmount,
				tokenOut: await tokenOut.getAddress(),
				amountOutMinimum: 0, // Allow fee deduction
				swapCalldata,
				deadline: Math.floor(Date.now() / 1000) + 3600,
			});

			// Fee = 10000 * 100 / 10000 = 100 USDC
			const expectedFee = ethers.parseUnits("100", 6);
			const expectedVaultBal = outputAmount - expectedFee;

			const vaultBal = await tokenOut.balanceOf(await vault.getAddress());
			const feeReceiverBal = await tokenOut.balanceOf(feeReceiver.address);

			expect(vaultBal).to.equal(expectedVaultBal);
			expect(feeReceiverBal).to.equal(expectedFee);
		});

		it("swap output stays in vault (forced recipient)", async () => {
			const fixture = await loadFixture(deployFixture);
			const { vault } = await deployVaultViaFactory(fixture);
			const { agent, tokenIn, tokenOut, mockRouter } = fixture;

			const swapAmount = ethers.parseEther("1");
			const outputAmount = ethers.parseUnits("1800", 6);

			await tokenIn.mint(await vault.getAddress(), ethers.parseEther("10"));
			await tokenOut.mint(await mockRouter.getAddress(), outputAmount);

			// Even though recipient is set to vault in calldata, the vault
			// verifies via balance delta — output must land in the vault
			const swapCalldata = mockRouter.interface.encodeFunctionData("swap", [
				await tokenIn.getAddress(),
				await tokenOut.getAddress(),
				swapAmount,
				outputAmount,
				await vault.getAddress(),
			]);

			await vault.connect(agent).executeSwap({
				tokenIn: await tokenIn.getAddress(),
				amountIn: swapAmount,
				tokenOut: await tokenOut.getAddress(),
				amountOutMinimum: outputAmount,
				swapCalldata,
				deadline: Math.floor(Date.now() / 1000) + 3600,
			});

			const vaultBal = await tokenOut.balanceOf(await vault.getAddress());
			expect(vaultBal).to.equal(outputAmount);
		});
	});
});
