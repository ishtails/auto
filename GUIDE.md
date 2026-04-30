# Trading System - Local Development Guide

Quick guide to run a complete trading cycle locally using Hardhat, AXL P2P network, and the risk agent.

## Prerequisites

- Node.js + Bun installed
- Docker (optional, for Hardhat node)
- All dependencies installed (`bun install`)

## 1. Start Infrastructure

Start everything in one terminal:

```bash
bun run hardhat
```

This starts:
- Hardhat node (RPC on :8545)
- AXL trading node (API on :9002)
- AXL risk node (API on :9012)
- Risk agent script
- Deploys vault contract

Wait for "✓ Deploy complete" message.

## 2. Start Server (new terminal)

```bash
cd apps/server && bun dev
```

Server runs on http://localhost:3000

## 3. Fund the Vault

The vault needs WETH (not raw ETH). Run these in a third terminal:

### 3a. Deposit ETH to get WETH
```bash
curl -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_sendTransaction",
    "params": [{
      "from": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "to": "0x4200000000000000000000000000000000000006",
      "value": "0x8AC7230489E80000",
      "data": "0xd0e30db0"
    }],
    "id": 1
  }'
```

### 3b. Transfer WETH to vault
```bash
curl -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_sendTransaction",
    "params": [{
      "from": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "to": "0x4200000000000000000000000000000000000006",
      "data": "0xa9059cbb000000000000000000000000c664b5b530fa058eb2b52557f4d35ddab5c2c31c000000000000000000000000000000000000000000000000002386f26fc10000",
      "gas": "0x186a0"
    }],
    "id": 1
  }'
```

## 4. Run Trade Cycle (Dry Run)

```bash
curl -X POST http://localhost:3000/rpc/runTradeCycle \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "1000000000000000000",
    "maxSlippageBps": 100,
    "dryRun": true
  }'
```

Expected response:
```json
{
  "cycleId": "...",
  "decision": "APPROVE",
  "executionId": null,
  "txHash": null,
  "logPointer": "auto-trade-cycles-dev:..."
}
```

## Common Issues

### AXL 502 Error
- Wait 10-15s after startup for nodes to peer
- Check `curl -s http://127.0.0.1:9002/topology | jq '.peers | length'`
- Should show 3 peers (2 external + 1 local)

### "insufficient vault balance"
- Vault needs WETH, not ETH
- Follow steps 3a and 3b above

### Risk agent not responding
- Agent polls every 2s, there's a delay between send/receive
- Server waits 2.5s then polls - this is expected behavior

### Ports already in use
```bash
kill-port 9002
kill-port 9012
kill-port 8545
```

## Stop Everything

In the hardhat terminal, press **Ctrl+C**. The cleanup trap will kill:
- AXL trading node
- AXL risk node
- Risk agent
- Hardhat node

## Environment Variables (apps/server/.env)

Key vars you might need:
```bash
# AXL
AXL_TRADING_API_URL=http://127.0.0.1:9002
AXL_RISK_API_URL=http://127.0.0.1:9012
AXL_RISK_PEER_ID=f3b4d2afac912976bab7d85f658d616d0eadc44da0a2f1617a1a1b8fd675384c

# Hardhat (auto-deployed)
VAULT_ADDRESS=0xc664B5B530Fa058EB2B52557f4D35dDAb5C2C31c
CHAIN_RPC_URL=http://127.0.0.1:8545

# Uniswap (use real Base RPC for quotes)
ROUTER_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

# 0G (testnet - logging fails gracefully locally)
OG_RPC_URL=https://evmrpc-testnet.0g.ai
OG_FLOW_CONTRACT=0x2b8C4E58eE0475aE0A9e5B091c1D9632fFA43E6E
```

## Architecture Overview

```
┌─────────────┐     AXL P2P      ┌─────────────┐
│ Trading Node │ ←──────────────→ │  Risk Node  │
│   :9002      │                  │   :9012     │
└──────┬──────┘                  └──────┬──────┘
       │                                  │
       │ HTTP                             │ HTTP
       ↓                                  ↓
┌─────────────┐                    ┌─────────────┐
│   Server    │                    │ Risk Agent  │
│  :3000      │                    │  (script)   │
└──────┬──────┘                    └─────────────┘
       │
       │ JSON-RPC
       ↓
┌─────────────┐
│  Hardhat    │
│   :8545     │
└─────────────┘
```
