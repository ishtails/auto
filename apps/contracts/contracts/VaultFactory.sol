// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { UserVault } from "./UserVault.sol";

/// @title VaultFactory — EIP-1167 clone factory with on-chain EIP-712 verification
/// @notice Deploys minimal-proxy UserVault instances. Each deployment requires a valid
///         EIP-712 signature from the vault owner proving explicit consent.
contract VaultFactory is EIP712 {
	using ECDSA for bytes32;

	address public immutable implementation;
	address public deployer;
	address public protocolFeeReceiver;
	uint16 public defaultFeeBps;
	uint16 public constant MAX_FEE_BPS = 500; // 5% ceiling
	uint8 public maxVaultsPerUser;

	/// @dev EIP-712 typehash for DeployConfig struct
	bytes32 public constant DEPLOY_CONFIG_TYPEHASH =
		keccak256(
			"DeployConfig(address owner,address swapRouter,uint16 maxTradeSizeBps,uint256 nonce)"
		);

	/// @dev Per-user deploy nonce (prevents signature replay)
	mapping(address owner => uint256 nonce) public deployNonces;

	/// @dev Per-user vault count (enforces deploy limit)
	mapping(address owner => uint256 count) public vaultCount;

	/// @dev Track all vaults deployed for an owner
	mapping(address owner => address[] vaults) private _userVaults;

	error Unauthorized();
	error InvalidSignature();
	error DeployLimitReached(address owner, uint8 max);
	error InvalidAddress();
	error FeeTooHigh(uint16 bps, uint16 max);

	event VaultDeployed(
		address indexed owner,
		address indexed vault,
		address indexed agent,
		bytes32 configHash
	);
	event DeployerUpdated(address indexed previous, address indexed next);
	event FeeConfigUpdated(address receiver, uint16 feeBps);
	event MaxVaultsUpdated(uint8 max);

	modifier onlyDeployer() {
		if (msg.sender != deployer) revert Unauthorized();
		_;
	}

	/// @param _implementation Address of the deployed UserVault implementation
	/// @param _deployer Platform deployer/server wallet
	/// @param _protocolFeeReceiver Address receiving protocol fees
	/// @param _defaultFeeBps Default fee for new vaults (0 for V1)
	/// @param _maxVaultsPerUser Maximum vaults per user address
	constructor(
		address _implementation,
		address _deployer,
		address _protocolFeeReceiver,
		uint16 _defaultFeeBps,
		uint8 _maxVaultsPerUser
	) EIP712("AutoVaultFactory", "1") {
		if (_implementation == address(0) || _deployer == address(0)) {
			revert InvalidAddress();
		}
		if (_defaultFeeBps > MAX_FEE_BPS) {
			revert FeeTooHigh(_defaultFeeBps, MAX_FEE_BPS);
		}

		implementation = _implementation;
		deployer = _deployer;
		protocolFeeReceiver = _protocolFeeReceiver;
		defaultFeeBps = _defaultFeeBps;
		maxVaultsPerUser = _maxVaultsPerUser > 0 ? _maxVaultsPerUser : 3;
	}

	/// @notice Deploy a new UserVault clone with on-chain EIP-712 signature verification
	/// @param _owner The user's wallet address (becomes vault owner)
	/// @param _agent The server/relayer address (authorized to execute swaps)
	/// @param _swapRouter Uniswap V3 SwapRouter address
	/// @param _maxTradeSizeBps Max single trade size as % of vault balance
	/// @param _ownerSignature EIP-712 signature from _owner over DeployConfig
	/// @return vault Address of the newly deployed vault clone
	function deployVault(
		address _owner,
		address _agent,
		address _swapRouter,
		uint16 _maxTradeSizeBps,
		bytes calldata _ownerSignature
	) external onlyDeployer returns (address vault) {
		if (_owner == address(0) || _agent == address(0) || _swapRouter == address(0)) {
			revert InvalidAddress();
		}

		// Enforce per-user deploy limit
		if (vaultCount[_owner] >= maxVaultsPerUser) {
			revert DeployLimitReached(_owner, maxVaultsPerUser);
		}

		// Build and verify EIP-712 signature
		uint256 nonce = deployNonces[_owner];
		bytes32 structHash = keccak256(
			abi.encode(DEPLOY_CONFIG_TYPEHASH, _owner, _swapRouter, _maxTradeSizeBps, nonce)
		);
		bytes32 digest = _hashTypedDataV4(structHash);
		address signer = ECDSA.recover(digest, _ownerSignature);

		if (signer != _owner) {
			revert InvalidSignature();
		}

		// Increment nonce (prevents replay)
		deployNonces[_owner] = nonce + 1;

		// Deploy minimal proxy clone
		vault = Clones.clone(implementation);

		// Initialize the clone
		UserVault(payable(vault)).initialize(
			_owner,
			_agent,
			_swapRouter,
			protocolFeeReceiver,
			defaultFeeBps,
			_maxTradeSizeBps
		);

		// Track vault
		vaultCount[_owner]++;
		_userVaults[_owner].push(vault);

		emit VaultDeployed(_owner, vault, _agent, structHash);
	}

	// ─── Admin Functions ─────────────────────────────────────────────

	/// @notice Transfer deployer role
	function setDeployer(address _deployer) external onlyDeployer {
		if (_deployer == address(0)) revert InvalidAddress();
		address previous = deployer;
		deployer = _deployer;
		emit DeployerUpdated(previous, _deployer);
	}

	/// @notice Update protocol fee config for future deployments
	function setFeeConfig(address _receiver, uint16 _feeBps) external onlyDeployer {
		if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh(_feeBps, MAX_FEE_BPS);
		protocolFeeReceiver = _receiver;
		defaultFeeBps = _feeBps;
		emit FeeConfigUpdated(_receiver, _feeBps);
	}

	/// @notice Update max vaults per user
	function setMaxVaultsPerUser(uint8 _max) external onlyDeployer {
		maxVaultsPerUser = _max;
		emit MaxVaultsUpdated(_max);
	}

	// ─── View Functions ──────────────────────────────────────────────

	/// @notice Get all vaults deployed for an owner
	function getUserVaults(address _owner) external view returns (address[] memory) {
		return _userVaults[_owner];
	}

	/// @notice Get the current deploy nonce for an owner (used for EIP-712 signing)
	function getNonce(address _owner) external view returns (uint256) {
		return deployNonces[_owner];
	}

	/// @notice Get the EIP-712 domain separator
	function getDomainSeparator() external view returns (bytes32) {
		return _domainSeparatorV4();
	}
}
