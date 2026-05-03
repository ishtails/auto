# Integrations (Current)

This project links user-owned vaults to an agent loop. Integrations are intentionally server-driven: the web UI consumes typed RPC + SSE.

## Execution

- **KeeperHub**: server submits contract calls and polls until a `txHash` is available.
- **Uniswap V3 SwapRouter02**: calldata is built server-side and executed via the vault.

## LLM + Decisioning

- **Gemini**: generates strict JSON (`action`, `amountInWei`, and human-readable `reasoning`).
- **Risk**: deterministic gate, then **0G Compute Router** audit of Gemini’s JSON (`MOCK_RISK_AGENT=true` skips the Router for local demos).

## Storage + Streaming

**One sentence:** Postgres is the **queryable cache** for fast UI and SSE; **0G Storage (KV)** is the **canonical durable log** (stream per vault) with pointer + optional batch **txHash / rootHash** when the SDK completes.

- **0G Storage (KV)**: append-only audit for each `CycleLogRecord`; judge/demo visibility via pointer and on-chain batch metadata.
- **Postgres (Drizzle)**: mirrors cycle rows so history stays reliable when 0G KV reads are flaky or slow.
- **SSE (Hono)**: pushes updates to the web UI from server state (fed by the Postgres cache).

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
- **Risk (local default)**: `MOCK_RISK_AGENT=true` avoids requiring separate risk infra.

---

## Risk agent (deterministic + 0G Compute Router)

The trade cycle combines **deterministic rails** (`risk-gate`) with a **secondary audit** of Gemini’s JSON proposal via the **[0G Compute Router](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview)** (`apps/server/src/integrations/og-compute-risk.ts`): OpenAI-compatible `/chat/completions`, structured JSON verdict (`APPROVE` / `REJECT`). For local dev without a Router API key, set **`MOCK_RISK_AGENT=true`** to skip that pass (approve).

When **`MOCK_RISK_AGENT=false`**, set **`OG_COMPUTE_ROUTER_API_KEY`** (from [pc.testnet.0g.ai](https://pc.testnet.0g.ai/) testnet or mainnet PC). Optional: **`OG_COMPUTE_ROUTER_URL`**, **`OG_COMPUTE_ROUTER_MODEL`**, **`OG_COMPUTE_ROUTER_JSON_MODE`** (disable if the model rejects JSON mode).

---

## ENS (Identity) via `viem`

Primary actions (viem docs):

- `getEnsName({ address })` for reverse lookup
- `getEnsAddress({ name })` for forward resolution

Chain nuance:

- For L2 chain-specific resolution, you may need chain-aware coin types / resolver settings.

Near-term direction:

- Track concrete ENS UX in [`plan.md`](./plan.md) (display names vs raw hex).
- Until wired through the UI, a simple config mapping + `viem` resolution at runtime is enough for experiments.
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

### 0G Compute Router (secondary risk)

- `OG_COMPUTE_ROUTER_URL` — default testnet Router base (`…/v1`)
- `OG_COMPUTE_ROUTER_API_KEY` — required when `MOCK_RISK_AGENT=false`
- `OG_COMPUTE_ROUTER_MODEL` — e.g. `qwen/qwen-2.5-7b-instruct` (default; supports `response_format` per Router catalog)
- `OG_COMPUTE_ROUTER_JSON_MODE` — `true` / `false` (JSON response format)

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
- `apps/server/src/integrations/og-compute-risk.ts`
  - 0G Compute Router secondary risk pass when `MOCK_RISK_AGENT=false`
- `apps/web/src/integrations/0g/*` OR `apps/web/src/app/api/*`
  - if browser bundling is painful, proxy reads through server routes
- `apps/web/src/integrations/ens/*`
  - ENS resolution wrappers using `viem`

---

## Common gotchas checklist

- **Secrets**:
  - Never commit `.env` files. Keep `.env.example` templates up to date.
  - Never expose `OG_PRIVATE_KEY` or KeeperHub keys to the web.
- **0G in browser**:
  - avoid bundling the TS SDK in Next until you validate polyfills; proxy reads if needed.
- **Risk / bridge payloads**:
  - keep cross-process messages small; store large logs in 0G and pass pointers.
- **KeeperHub swap support**:
  - Uniswap plugin docs cover LP positions, not swaps.
  - Use contract-call to SwapRouter for swaps.
- **Determinism**:
  - Risk Agent validation must be deterministic and auditable.
  - Log inputs, outputs, and constraints (max trade %, slippage rules) to 0G.

