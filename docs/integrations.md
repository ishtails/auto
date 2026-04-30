# Integrations Playbook (Sponsor-First)

This document is a **detailed integration guide** for the hackathon MVP described in:

- `docs/requirements.md` (PRD + definition of done)
- `docs/guide.md` (layer separation + implementation checklist)
- `docs/tech.md` (sponsor-first mapping and constraints)

It focuses on **configuration + integration mechanics** (not business logic), and is intended to be a long-lived reference while implementing:

- **Execution**: KeeperHub → Uniswap V3
- **Agent-to-agent comms**: Gensyn AXL
- **Memory / state**: 0G Storage (KV + logs)
- **Identity**: ENS (via `viem`)

---

## What this doc *does not* repeat

The architectural “why” and the hackathon constraints are already captured in `docs/guide.md` and `docs/tech.md`.

This file is intentionally focused on the “how”:

- exact endpoints and auth
- tool names and request shapes
- local-dev setup steps
- integration-specific gotchas
- suggested module boundaries and env variables

---

## KeeperHub (Execution Layer)

KeeperHub provides two integration surfaces that are useful for this MVP:

1. **MCP Server** (workflow-based execution and monitoring)
2. **Direct Execution API** (execute without creating workflows)

### 1) MCP Server (workflow-based)

**Docs**: `https://docs.keeperhub.com/ai-tools/mcp-server`

#### Remote endpoint (recommended)

- Hosted MCP endpoint: `https://app.keeperhub.com/mcp`
- OAuth (browser-based) or API key (headless).

Examples from KeeperHub docs:

```bash
claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp
```

Headless:

```bash
claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp \
  --header "Authorization: Bearer kh_your_key_here"
```

#### Important MCP tools for MVP

- `list_action_schemas`: discover supported actions (filter category `web3`, `webhook`, etc.).
- `get_wallet_integration`: get a `walletId` required for write actions.
- `create_workflow`: build a workflow with trigger + actions.
- `execute_workflow`: trigger workflow execution and get execution id.
- `get_execution_status`, `get_execution_logs`: poll + retrieve tx hashes and errors.

#### Web3 actions (from MCP docs)

Read actions:
- `web3/check-balance`
- `web3/check-token-balance`
- `web3/read-contract`

Write actions (require `walletId`):
- `web3/transfer-funds`
- `web3/transfer-token`
- `web3/write-contract`

### 2) Direct Execution API (no workflow needed)

**Docs**: `https://docs.keeperhub.com/api/direct-execution`

This is the fastest path to “execution through KeeperHub” for MVP.

#### Auth

Send org API key as bearer:

```http
Authorization: Bearer kh_your_api_key
```

#### Rate limits and caps

- 60 req/min per API key.
- Optional org “spending caps” can fail with `422 SPENDING_CAP_EXCEEDED`.

#### Smart contract call endpoint

`POST /api/execute/contract-call`

Request shape (from docs):

```json
{
  "contractAddress": "0x...",
  "network": "base",
  "functionName": "exactInputSingle",
  "functionArgs": "[\"...\"]",
  "abi": "[{...}]",
  "value": "0",
  "gasLimitMultiplier": "1.2"
}
```

Notes:
- `functionArgs` and `abi` are passed as **JSON strings**.
- If ABI is omitted, KeeperHub can auto-fetch from explorer in some cases.
- Read functions return `{ "result": ... }`.
- Write functions return `{ "executionId": "...", "status": "completed|failed" }` synchronously.
- You can also poll `GET /api/execute/{executionId}/status` for tx hash/link and detailed status.

### Wallet integration implications

- In the MCP workflow world, KeeperHub explicitly requires `walletId` via `get_wallet_integration` for write actions.
- In the Direct Execution API world, errors like `422 Wallet not configured` are possible if a wallet is not set up for the org.

### MCP vs Direct Execution (decision rule)

- Prefer **Direct Execution API** for the MVP “single swap intent → tx hash” path.
- Prefer **MCP workflows** if you want workflow graphs, templates, and richer observability in KeeperHub.

---

## Uniswap V3 (Swap execution payload)

The Uniswap plugin in KeeperHub is focused on **LP position management**, not swaps:

- `https://docs.keeperhub.com/plugins/uniswap`

For swaps, the MVP approach is:

- Use KeeperHub **contract-call** / **web3/write-contract** against **Uniswap V3 SwapRouter**.

### SwapRouter call: `exactInputSingle`

Core struct fields (standard Uniswap V3 router):

- `tokenIn`: address
- `tokenOut`: address
- `fee`: uint24 (e.g. 500 / 3000 / 10000)
- `recipient`: address
- `amountIn`: uint256
- `amountOutMinimum`: uint256 (slippage protection)
- `sqrtPriceLimitX96`: uint160 (set to 0 for no limit)

### Practical risk-rails

Your Risk Agent should deterministically enforce:

- **max trade size** (absolute and/or percent of vault balance)
- **slippage bound** (compute `amountOutMinimum`)
- **allowlist** of token pairs (for MVP, one path like ETH → USDC)
- **chain allowlist** (e.g. Base Sepolia only)

### Output to log

Persist enough data to verify the swap later:

- Router address, function name, args (or calldata hash)
- amountIn / amountOutMinimum / fee tier
- executionId, tx hash, explorer link

---

## 0G Storage (Memory + State)

**Docs**: `https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk`

0G gives you **content-addressed blobs** (Merkle-rooted logs) and **KV** (pointers/indexes). For this project, use blobs for immutable JSON log entries and KV for `latest` + `log:<seq>` indexing.

### TypeScript SDK basics

Install (docs):

```bash
npm install @0gfoundation/0g-ts-sdk ethers
```

Initialize (docs example values; update endpoints from 0G network overview):

- `RPC_URL`: EVM RPC endpoint (testnet/mainnet)
- `INDEXER_RPC`: indexer endpoint (turbo/standard)

### Uploading a JSON log (recommended)

Use in-memory upload to avoid local files:

- Build the log JSON payload
- Serialize to bytes
- Upload via `MemData`
- Record the returned `rootHash` (and tx hash)

Persist to KV:

- `latest` → rootHash
- `log:<seq>` → rootHash

### KV gotchas (important)

From docs, KV write uses `Batcher` and KV read uses `KvClient`, but:

- `KvClient` example uses a raw IP endpoint (e.g. `http://...:6789`) which can change.
- Decide early whether:
  - the **server** reads KV and serves it to the web, or
  - the **web** reads KV directly (requires stable KV endpoint and browser-safe bundle).

### Browser support gotchas (very important for Next.js)

The 0G TS SDK:

- imports Node modules (`fs`, `crypto`) at load time
- requires polyfills/stubs in browser bundlers

Docs explicitly note:

- `indexer.download()` uses `fs.appendFileSync` and **does not work in browsers**.
- For browsers, you may need the starter kit’s approach and manual segment downloads.

**MVP recommendation**:

- Do **all 0G writes** on the server.
- For reads:
  - either proxy through server endpoints, or
  - use a thin client read path only after confirming the SDK can be bundled in Next.

### Encryption support

Docs mention client-side encryption (`aes256` or `ecies`) and `peekHeader` detection.

For hackathon MVP:

- you likely want plaintext logs for public auditability.
- if you do encrypt, document key custody very clearly (no server-side recovery).

---

## Gensyn AXL (Agent-to-Agent Comms)

**Docs**:

- Get started: `https://docs.gensyn.ai/tech/agent-exchange-layer/get-started`
- Config: `https://docs.gensyn.ai/tech/agent-exchange-layer/configuration.md`

AXL is a **P2P node** (Go binary) exposing a local HTTP API by default.

### What you must do to satisfy the PRD

Trading Agent and Risk Agent must communicate over AXL (not in-process calls).

Minimal pattern:

1. Start node A (trading) and node B (risk) with persistent identities.
2. Exchange public keys.
3. Trading sends proposal JSON to Risk via `/send`.
4. Risk receives via `/recv`, validates, replies via `/send`.

### Build and run

From docs:

```bash
git clone https://github.com/gensyn-ai/axl.git
cd axl
go build -o node ./cmd/node/
./node -config node-config.json
```

### Key generation

Generate an ed25519 key (docs note macOS openssl caveat):

```bash
openssl genpkey -algorithm ed25519 -out private.pem
```

### Config essentials

Minimal config (`node-config.json`):

```json
{
  "PrivateKeyPath": "private.pem",
  "Peers": []
}
```

Key ports (defaults from config docs):

- `api_port`: 9002 (HTTP interface)
- `bridge_addr`: 127.0.0.1 (HTTP bind)
- `tcp_port`: 7000 (internal gVisor TCP)
- `max_message_size`: 16777216 (16 MB)

### Enabling MCP / A2A services (optional)

AXL can route “MCP messages” and “A2A messages”, but enabling them requires:

- setting `router_addr` / `a2a_addr` in config, and
- running the Python MCP router and A2A server processes.

For MVP, **plain `/send` + `/recv`** is sufficient unless the hackathon specifically requires A2A.

### Verify node is running

From docs:

```bash
curl -s http://127.0.0.1:9002/topology
```

### Message sizing and timeouts

From config docs:

- default max message size: **16 MB**
- read timeout: 60s
- idle timeout: 300s

Design your payloads to be small:

- send only what Risk needs (params + small reasoning)
- store big logs in 0G and send only pointers if needed

### Security note

Do not expose the AXL HTTP API (`bridge_addr`) beyond localhost unless you understand the implications:

- anyone who can reach the API can send messages “as your node”.

---

## ENS (Identity) via `viem`

Primary actions (viem docs):

- `getEnsName({ address })` for reverse lookup
- `getEnsAddress({ name })` for forward resolution

Chain nuance:

- For L2 chain-specific resolution, you may need chain-aware coin types / resolver settings.

MVP recommendation:

- Maintain a simple config mapping (expected ENS names) and resolve them at runtime for display.
- Cache resolution results in memory on the server or in the client query cache to avoid repeated RPC calls.

---

## Environment variables (recommended inventory)

### KeeperHub

- `KEEPERHUB_API_KEY` (server-only)
- `KEEPERHUB_BASE_URL` (optional; default to docs domain)

### 0G Storage

You will need some combination of:

- `OG_RPC_URL` (EVM RPC)
- `OG_INDEXER_RPC` (Turbo/Standard indexer)
- `OG_PRIVATE_KEY` (server-only signer key; never expose to web)
- `OG_KV_ENDPOINT` (if using `KvClient` directly)
- `OG_KV_STREAM_ID` (KV stream to write pointers into)

### Gensyn AXL

- `AXL_TRADING_API_URL` (e.g. `http://127.0.0.1:9002`)
- `AXL_RISK_API_URL` (e.g. `http://127.0.0.1:9012`)
- `AXL_RISK_PEER_ID` / `AXL_TRADING_PEER_ID` (public keys)

### Web

- `NEXT_PUBLIC_SERVER_URL` (already enforced by `@auto/env/web`)

---

## Suggested module boundaries (fits your repo)

These are **implementation boundaries** to keep integrations clean and testable.

- `apps/server/src/integrations/keeperhub/*`
  - direct execution client (request/response types)
  - optional workflow/MCP helper wrappers
- `apps/server/src/integrations/0g/*`
  - log writer (upload)
  - kv pointer writer (latest + index)
- `apps/server/src/integrations/axl/*`
  - send/recv wrappers + typed envelopes
- `apps/web/src/integrations/0g/*` OR `apps/web/src/app/api/*`
  - if browser bundling is painful, proxy reads through server routes
- `apps/web/src/integrations/ens/*`
  - ENS resolution wrappers using `viem`

---

## Common gotchas checklist

- **Secrets**:
  - Never commit `**/.env`. Keep `**/.env.example` templates.
  - Never expose `OG_PRIVATE_KEY` or KeeperHub keys to the web.
- **0G in browser**:
  - avoid bundling the TS SDK in Next until you validate polyfills; proxy reads if needed.
- **AXL message size**:
  - keep messages small; store large logs in 0G; send pointers/ids over AXL.
- **KeeperHub swap support**:
  - Uniswap plugin docs cover LP positions, not swaps.
  - Use contract-call to SwapRouter for swaps.
- **Determinism**:
  - Risk Agent validation must be deterministic and auditable.
  - Log inputs, outputs, and constraints (max trade %, slippage rules) to 0G.

