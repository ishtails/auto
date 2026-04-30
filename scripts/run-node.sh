#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/apps/contracts"
AXL_DIR="$ROOT_DIR/axl"

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
AXL_API_URL="${AXL_API_URL:-http://127.0.0.1:9002}"
START_NODE="${START_NODE:-1}" # set to 0 to require an already-running node
START_AXL="${START_AXL:-1}"   # set to 0 to require an already-running AXL node

is_rpc_up() {
	curl -s -m 1 -X POST "$RPC_URL" \
		-H "content-type: application/json" \
		--data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' >/dev/null
}

is_axl_up() {
	curl -s -m 1 "$AXL_API_URL/topology" >/dev/null 2>&1
}

wait_for_rpc() {
	local attempts=0
	while true; do
		if is_rpc_up; then
			return 0
		fi

		attempts=$((attempts + 1))
		if [[ "$attempts" -ge 60 ]]; then
			echo "Timed out waiting for Hardhat RPC at $RPC_URL" >&2
			return 1
		fi
		sleep 1
	done
}

wait_for_axl() {
	local attempts=0
	while true; do
		if is_axl_up; then
			return 0
		fi

		attempts=$((attempts + 1))
		if [[ "$attempts" -ge 30 ]]; then
			echo "Timed out waiting for AXL at $AXL_API_URL" >&2
			return 1
		fi
		sleep 1
	done
}

echo "→ Contracts: local node + deploy + AXL"
echo "  Repo: $ROOT_DIR"
echo "  RPC:  $RPC_URL"
echo "  AXL:  $AXL_API_URL"

# Check/start AXL node
if is_axl_up; then
	echo "✓ AXL already running"
else
	if [[ "$START_AXL" != "1" ]]; then
		echo "AXL node is not running and START_AXL=0; aborting." >&2
		exit 1
	fi

	if [[ ! -f "$AXL_DIR/node" ]]; then
		echo "⚠ AXL node binary not found at $AXL_DIR/node"
		echo "  Please build it first: cd axl && GOTOOLCHAIN=go1.25.5 go build -o node ./cmd/node/"
		exit 1
	fi

	if [[ ! -f "$AXL_DIR/node-config.json" ]]; then
		echo "⚠ AXL config not found at $AXL_DIR/node-config.json"
		echo "  Please create it first (see axl/README.md)"
		exit 1
	fi

	echo "→ Starting AXL node (background)..."
	(
		cd "$AXL_DIR"
		exec ./node -config node-config.json 2>&1 | sed 's/^/[axl] /'
	) &
	echo "  AXL PID: $!"
	echo "→ Waiting for AXL to be ready..."
	wait_for_axl
	echo "✓ AXL is up"
fi

# Check if RPC is already running
if is_rpc_up; then
	echo "✓ RPC already running"
	echo "→ Deploying contracts to localhost..."
	(
		cd "$CONTRACTS_DIR"
		exec bunx --bun hardhat run scripts/deploy.ts --network localhost
	)
	echo "✓ Done"
	exit 0
fi

if [[ "$START_NODE" != "1" ]]; then
	echo "Hardhat node is not running and START_NODE=0; aborting." >&2
	exit 1
fi

# Run deploy in background (it waits for RPC),
# then keep the node in the foreground so you can see logs.
echo "→ Starting deploy watcher (background)..."
(
	echo "→ Waiting for RPC..."
	wait_for_rpc
	echo "✓ RPC is up"
	echo "→ Deploying contracts to localhost..."
	cd "$CONTRACTS_DIR"
	bunx --bun hardhat run scripts/deploy.ts --network localhost
	echo "✓ Deploy complete"
) &

echo "→ Starting Hardhat node (foreground)..."
echo "  Tip: Ctrl+C to stop node (and end this script)."
cd "$CONTRACTS_DIR"
exec bunx --bun hardhat node
