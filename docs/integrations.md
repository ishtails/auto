# Integrations (Current)

This project links user-owned vaults to an agent loop. Integrations are intentionally server-driven: the web UI consumes typed RPC + SSE.

## Execution

- **KeeperHub**: server submits contract calls and polls until a `txHash` is available.
- **Uniswap V3 SwapRouter02**: calldata is built server-side and executed via the vault.

## LLM + Decisioning

- **Gemini**: generates strict JSON (`action`, `amountInWei`, and human-readable `reasoning`).
- **Risk**: deterministic gate + optional AXL risk agent (mockable).

## Storage + Streaming

- **0G Storage (KV)**: best-effort, verifiable log sink for `CycleLogRecord`.
- **Postgres (Drizzle)**: app state + a local cache for cycle logs (reliable history even when 0G reads time out).
- **SSE (Hono)**: authenticated stream of cycle history + updates to the web UI.

## Identity / UX

- **Privy**: login + embedded wallet UX; UI shows address, balances, and faucet link for Base Sepolia.

---

## Env vars (server)

This list is intentionally minimal; see `@auto/env` for the full set.

- **Database**: `DATABASE_URL`
- **Gemini**: `GEMINI_API_KEY`, `GEMINI_MODEL` (optional `MOCK_LLM=true`)
- **Execution**: `KEEPERHUB_BASE_URL`, `KEEPERHUB_API_KEY`, `UNISWAP_ROUTER_ADDRESS`
- **0G**: `OG_INDEXER_RPC`, `OG_KV_ENDPOINT`, `OG_RPC_URL`, `OG_PRIVATE_KEY`, `OG_FLOW_CONTRACT`
- **Debug**: `DEBUG=true`

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

