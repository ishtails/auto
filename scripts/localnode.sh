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

# Track background PIDs for cleanup
BG_PIDS=()

cleanup() {
	echo ""
	echo "→ Cleaning up background processes..."
	
	# Kill tracked background processes
	for pid in "${BG_PIDS[@]:-}"; do
		if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
			echo "  Killing PID $pid"
			kill -TERM "$pid" 2>/dev/null || true
			sleep 0.5
			kill -KILL "$pid" 2>/dev/null || true
		fi
	done
	
	# Kill any lingering AXL node processes by pattern
	if command -v pkill >/dev/null 2>&1; then
		pkill -f "./node -config node-config" 2>/dev/null || true
	fi
	
	# Also kill any lingering AXL nodes on our ports
	if command -v kill-port >/dev/null 2>&1; then
		for port in 9002 9012 7001 7002; do
			kill-port "$port" 2>/dev/null || true
		done
	elif command -v lsof >/dev/null 2>&1; then
		for port in 9002 9012 7001 7002; do
			local pids
			pids=$(lsof -t -i TCP:"$port" 2>/dev/null || true)
			if [[ -n "$pids" ]]; then
				kill -9 $pids 2>/dev/null || true
			fi
		done
	fi
	
	echo "✓ Cleanup complete"
}

trap cleanup EXIT INT TERM

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
		./node -config node-config.json 2>&1 | sed 's/^/[axl-trading] /'
	) &
	BG_PIDS+=("$!")
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
		./node -config node-config-risk.json 2>&1 | sed 's/^/[axl-risk] /'
	) &
	BG_PIDS+=("$!")
	echo "  AXL Risk PID: $!"
fi

# Wait for both AXL nodes
echo "→ Waiting for AXL nodes to be ready..."
wait_for_axl "$AXL_API_URL"
echo "✓ AXL trading node is up"
wait_for_axl "$AXL_RISK_API_URL"
echo "✓ AXL risk node is up"

# Get peer IDs (for risk agent config)
TRADING_PEER_ID=$(curl -s "$AXL_API_URL/topology" | grep -o '"our_public_key":"[^"]*"' | cut -d'"' -f4)
RISK_PEER_ID=$(curl -s "$AXL_RISK_API_URL/topology" | grep -o '"our_public_key":"[^"]*"' | cut -d'"' -f4)

if [[ -n "$TRADING_PEER_ID" && -n "$RISK_PEER_ID" ]]; then
	echo "  Trading peer: $TRADING_PEER_ID"
	echo "  Risk peer: $RISK_PEER_ID"
fi

# Start risk agent script
if [[ "$START_RISK_AGENT" == "1" && -n "${TRADING_PEER_ID:-}" ]]; then
	echo "→ Starting risk agent script (background)..."
	(
		cd "$ROOT_DIR"
		echo "  Risk agent will respond to trading peer: $TRADING_PEER_ID"
		AXL_RISK_API_URL="$AXL_RISK_API_URL" TRADING_PEER_ID="$TRADING_PEER_ID" bun run scripts/risk-agent.ts 2>&1 | sed 's/^/[risk-agent] /'
	) &
	BG_PIDS+=("$!")
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
BG_PIDS+=("$!")
echo "  Deploy watcher PID: $!"

echo "→ Starting Hardhat node (foreground)..."
echo "  Tip: Ctrl+C to stop everything (AXL nodes, risk agent, hardhat)."
cd "$CONTRACTS_DIR"
bunx --bun hardhat node &
HARDHAT_PID=$!
BG_PIDS+=("$HARDHAT_PID")

# Wait for hardhat to finish (or be interrupted)
wait "$HARDHAT_PID"
