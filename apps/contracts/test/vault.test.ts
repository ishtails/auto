import { expect } from "chai";
import { ethers } from "hardhat";
import { describe, it } from "mocha";

describe("Vault", () => {
	const ONE_ETH = ethers.parseEther("1");
	const MAX_BPS = 5_000n;

	async function deployFixture() {
		const [admin, executor, user, other] = await ethers.getSigners();

		const tokenFactory = await ethers.getContractFactory("MockERC20");
		const routerFactory = await ethers.getContractFactory("MockSwapRouter");
		const vaultFactory = await ethers.getContractFactory("Vault");

		const tokenA: any = await tokenFactory.deploy("Token A", "TKA");
		const tokenB: any = await tokenFactory.deploy("Token B", "TKB");
		const router: any = await routerFactory.deploy();
		const vault: any = await vaultFactory.deploy(
			admin.address,
			executor.address,
			MAX_BPS
		);

		return { admin, executor, user, other, tokenA, tokenB, router, vault };
	}

	it("accepts ETH deposit and reports balance", async () => {
		const { user, vault } = await deployFixture();

		await expect(vault.connect(user).depositETH({ value: ONE_ETH }))
			.to.emit(vault, "DepositETH")
			.withArgs(user.address, ONE_ETH);

		expect(await vault.getVaultBalance(ethers.ZeroAddress)).to.equal(ONE_ETH);
	});

	it("allowlists token and auto-approves allowlisted router", async () => {
		const { admin, tokenA, router, vault } = await deployFixture();

		await vault
			.connect(admin)
			.setRouterAllowed(await router.getAddress(), true);
		await vault.connect(admin).setTokenAllowed(await tokenA.getAddress(), true);

		expect(
			await tokenA.allowance(
				await vault.getAddress(),
				await router.getAddress()
			)
		).to.equal(ethers.MaxUint256);

		await vault
			.connect(admin)
			.setTokenAllowed(await tokenA.getAddress(), false);
		expect(
			await tokenA.allowance(
				await vault.getAddress(),
				await router.getAddress()
			)
		).to.equal(0n);
	});

	it("accepts token deposit only for allowlisted token", async () => {
		const { admin, user, tokenA, tokenB, vault } = await deployFixture();

		await tokenA.mint(user.address, 1000n);
		await tokenB.mint(user.address, 1000n);
		await vault.connect(admin).setTokenAllowed(await tokenA.getAddress(), true);

		await tokenA.connect(user).approve(await vault.getAddress(), 1000n);
		await expect(
			vault.connect(user).depositToken(await tokenA.getAddress(), 1000n)
		)
			.to.emit(vault, "DepositToken")
			.withArgs(user.address, await tokenA.getAddress(), 1000n);

		await tokenB.connect(user).approve(await vault.getAddress(), 1000n);
		await expect(
			vault.connect(user).depositToken(await tokenB.getAddress(), 1000n)
		).to.be.revertedWithCustomError(vault, "TokenNotAllowed");
	});

	it("rejects executeTrade from non-executor", async () => {
		const { admin, user, tokenA, router, vault } = await deployFixture();
		await vault.connect(admin).setTokenAllowed(await tokenA.getAddress(), true);
		await vault
			.connect(admin)
			.setRouterAllowed(await router.getAddress(), true);
		await tokenA.mint(await vault.getAddress(), 1000n);

		const data = router.interface.encodeFunctionData("swapExactInputSingle", [
			await tokenA.getAddress(),
			await tokenA.getAddress(),
			100n,
			90n,
			await vault.getAddress(),
		]);

		const request = {
			target: await router.getAddress(),
			tokenIn: await tokenA.getAddress(),
			amountIn: 100n,
			data,
		};

		await expect(vault.connect(user).executeTrade(request))
			.to.be.revertedWithCustomError(vault, "UnauthorizedExecutor")
			.withArgs(user.address);
	});

	it("rejects disallowed router or token", async () => {
		const { admin, executor, tokenA, router, vault } = await deployFixture();
		await tokenA.mint(await vault.getAddress(), 1000n);

		const data = router.interface.encodeFunctionData("swapExactInputSingle", [
			await tokenA.getAddress(),
			await tokenA.getAddress(),
			100n,
			90n,
			await vault.getAddress(),
		]);

		const request = {
			target: await router.getAddress(),
			tokenIn: await tokenA.getAddress(),
			amountIn: 100n,
			data,
		};

		await expect(
			vault.connect(executor).executeTrade(request)
		).to.be.revertedWithCustomError(vault, "RouterNotAllowed");

		await vault
			.connect(admin)
			.setRouterAllowed(await router.getAddress(), true);
		await expect(
			vault.connect(executor).executeTrade(request)
		).to.be.revertedWithCustomError(vault, "TokenNotAllowed");
	});

	it("enforces max-trade bps and balance checks", async () => {
		const { admin, executor, tokenA, tokenB, router, vault } =
			await deployFixture();
		await vault
			.connect(admin)
			.setRouterAllowed(await router.getAddress(), true);
		await vault.connect(admin).setTokenAllowed(await tokenA.getAddress(), true);
		await vault.connect(admin).setTokenAllowed(await tokenB.getAddress(), true);
		await tokenA.mint(await vault.getAddress(), 1000n);
		await tokenB.mint(await router.getAddress(), 10_000n);

		const data = router.interface.encodeFunctionData("swapExactInputSingle", [
			await tokenA.getAddress(),
			await tokenB.getAddress(),
			600n,
			590n,
			await vault.getAddress(),
		]);

		const request = {
			target: await router.getAddress(),
			tokenIn: await tokenA.getAddress(),
			amountIn: 600n,
			data,
		};

		await expect(
			vault.connect(executor).executeTrade(request)
		).to.be.revertedWithCustomError(vault, "TradeTooLarge");

		const requestLarge = {
			target: await router.getAddress(),
			tokenIn: await tokenA.getAddress(),
			amountIn: 2000n,
			data,
		};
		await expect(
			vault.connect(executor).executeTrade(requestLarge)
		).to.be.revertedWithCustomError(vault, "InsufficientBalance");
	});

	it("executes successful swap and emits TradeExecuted", async () => {
		const { admin, executor, tokenA, tokenB, router, vault } =
			await deployFixture();
		await vault
			.connect(admin)
			.setRouterAllowed(await router.getAddress(), true);
		await vault.connect(admin).setTokenAllowed(await tokenA.getAddress(), true);
		await vault.connect(admin).setTokenAllowed(await tokenB.getAddress(), true);
		await tokenA.mint(await vault.getAddress(), 1000n);
		await tokenB.mint(await router.getAddress(), 10_000n);

		const data = router.interface.encodeFunctionData("swapExactInputSingle", [
			await tokenA.getAddress(),
			await tokenB.getAddress(),
			500n,
			490n,
			await vault.getAddress(),
		]);

		const request = {
			target: await router.getAddress(),
			tokenIn: await tokenA.getAddress(),
			amountIn: 500n,
			data,
		};

		const tokenABefore = await tokenA.balanceOf(await vault.getAddress());
		const tokenBBefore = await tokenB.balanceOf(await vault.getAddress());

		await expect(vault.connect(executor).executeTrade(request)).to.emit(
			vault,
			"TradeExecuted"
		);

		expect(await tokenA.balanceOf(await vault.getAddress())).to.equal(
			tokenABefore - 500n
		);
		expect(await tokenB.balanceOf(await vault.getAddress())).to.equal(
			tokenBBefore + 495n
		);
	});

	it("bubbles router failure through ExternalCallFailed", async () => {
		const { admin, executor, tokenA, tokenB, router, vault } =
			await deployFixture();
		await vault
			.connect(admin)
			.setRouterAllowed(await router.getAddress(), true);
		await vault.connect(admin).setTokenAllowed(await tokenA.getAddress(), true);
		await vault.connect(admin).setTokenAllowed(await tokenB.getAddress(), true);
		await tokenA.mint(await vault.getAddress(), 1000n);
		await tokenB.mint(await router.getAddress(), 10_000n);
		await router.setShouldRevert(true);

		const data = router.interface.encodeFunctionData("swapExactInputSingle", [
			await tokenA.getAddress(),
			await tokenB.getAddress(),
			500n,
			490n,
			await vault.getAddress(),
		]);

		const request = {
			target: await router.getAddress(),
			tokenIn: await tokenA.getAddress(),
			amountIn: 500n,
			data,
		};

		await expect(
			vault.connect(executor).executeTrade(request)
		).to.be.revertedWithCustomError(vault, "ExternalCallFailed");
	});
});
