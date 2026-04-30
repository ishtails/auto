#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/apps/contracts"

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
START_NODE="${START_NODE:-1}" # set to 0 to require an already-running node

is_rpc_up() {
	curl -s -m 1 -X POST "$RPC_URL" \
		-H "content-type: application/json" \
		--data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' >/dev/null
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

echo "→ Contracts: local node + deploy"
echo "  Repo: $ROOT_DIR"
echo "  RPC:  $RPC_URL"

node_started_by_script=0

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

node_started_by_script=1

echo "→ Starting Hardhat node (foreground)..."
echo "  Tip: Ctrl+C to stop node (and end this script)."
cd "$CONTRACTS_DIR"
exec bunx --bun hardhat node

