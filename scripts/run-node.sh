#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/apps/contracts"
AXL_DIR="$ROOT_DIR/axl"

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
AXL_API_URL="${AXL_API_URL:-http://127.0.0.1:9002}"
AXL_RISK_API_URL="${AXL_RISK_API_URL:-http://127.0.0.1:9012}"
START_NODE="${START_NODE:-1}" # set to 0 to require an already-running node
START_AXL="${START_AXL:-1}"   # set to 0 to require an already-running AXL node
START_RISK_AGENT="${START_RISK_AGENT:-1}" # set to 0 to skip risk agent

is_rpc_up() {
	curl -s -m 1 -X POST "$RPC_URL" \
		-H "content-type: application/json" \
		--data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' >/dev/null
}

is_axl_up() {
	curl -s -m 1 "$AXL_API_URL/topology" >/dev/null 2>&1
}

is_axl_risk_up() {
	curl -s -m 1 "$AXL_RISK_API_URL/topology" >/dev/null 2>&1
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
	local url="$1"
	local attempts=0
	while true; do
		if curl -s -m 1 "$url/topology" >/dev/null 2>&1; then
			return 0
		fi

		attempts=$((attempts + 1))
		if [[ "$attempts" -ge 30 ]]; then
			echo "Timed out waiting for AXL at $url" >&2
			return 1
		fi
		sleep 1
	done
}

echo "→ Contracts: local node + deploy + AXL (trading + risk) + Risk Agent"
echo "  Repo: $ROOT_DIR"
echo "  RPC:  $RPC_URL"
echo "  AXL Trading: $AXL_API_URL"
echo "  AXL Risk:    $AXL_RISK_API_URL"

# Check/start AXL trading node
if is_axl_up; then
	echo "✓ AXL trading node already running"
else
	if [[ "$START_AXL" != "1" ]]; then
		echo "AXL trading node is not running and START_AXL=0; aborting." >&2
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

	echo "→ Starting AXL trading node (background)..."
	(
		cd "$AXL_DIR"
		exec ./node -config node-config.json 2>&1 | sed 's/^/[axl-trading] /'
	) &
	echo "  AXL Trading PID: $!"
fi

# Check/start AXL risk node
if is_axl_risk_up; then
	echo "✓ AXL risk node already running"
else
	if [[ "$START_AXL" != "1" ]]; then
		echo "AXL risk node is not running and START_AXL=0; aborting." >&2
		exit 1
	fi

	if [[ ! -f "$AXL_DIR/node" ]]; then
		echo "⚠ AXL node binary not found at $AXL_DIR/node"
		echo "  Please build it first: cd axl && GOTOOLCHAIN=go1.25.5 go build -o node ./cmd/node/"
		exit 1
	fi

	if [[ ! -f "$AXL_DIR/node-config-risk.json" ]]; then
		echo "⚠ AXL risk config not found at $AXL_DIR/node-config-risk.json"
		echo "  Creating default risk node config..."
		cat > "$AXL_DIR/node-config-risk.json" << 'EOF'
{
  "PrivateKeyPath": "private-risk.pem",
  "Peers": [],
  "Listen": [],
  "api_port": 9012,
  "tcp_port": 7001
}
EOF
	fi

	if [[ ! -f "$AXL_DIR/private-risk.pem" ]]; then
		echo "→ Generating risk node key..."
		if command -v openssl >/dev/null 2>&1; then
			openssl genpkey -algorithm ed25519 -out "$AXL_DIR/private-risk.pem" 2>/dev/null
		else
			echo "⚠ OpenSSL not found. Please generate $AXL_DIR/private-risk.pem manually"
			exit 1
		fi
	fi

	echo "→ Starting AXL risk node (background)..."
	(
		cd "$AXL_DIR"
		exec ./node -config node-config-risk.json 2>&1 | sed 's/^/[axl-risk] /'
	) &
	echo "  AXL Risk PID: $!"
fi

# Wait for both AXL nodes
echo "→ Waiting for AXL nodes to be ready..."
wait_for_axl "$AXL_API_URL"
echo "✓ AXL trading node is up"
wait_for_axl "$AXL_RISK_API_URL"
echo "✓ AXL risk node is up"

# Start risk agent script
if [[ "$START_RISK_AGENT" == "1" ]]; then
	echo "→ Starting risk agent script (background)..."
	(
		cd "$ROOT_DIR"
		# Get the trading peer ID for the risk agent to respond to
		TRADING_PEER_ID=$(curl -s "$AXL_API_URL/topology" | grep -o '"our_public_key":"[^"]*"' | cut -d'"' -f4)
		if [[ -n "$TRADING_PEER_ID" ]]; then
			echo "  Risk agent will respond to trading peer: $TRADING_PEER_ID"
			AXL_RISK_API_URL="$AXL_RISK_API_URL" TRADING_PEER_ID="$TRADING_PEER_ID" exec bun run scripts/risk-agent.ts 2>&1 | sed 's/^/[risk-agent] /'
		else
			echo "  Could not get trading peer ID, using default"
			AXL_RISK_API_URL="$AXL_RISK_API_URL" exec bun run scripts/risk-agent.ts 2>&1 | sed 's/^/[risk-agent] /'
		fi
	) &
	echo "  Risk Agent PID: $!"
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
