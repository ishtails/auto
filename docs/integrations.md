# Integrations (Current)

This project links user-owned vaults to an agent loop. Integrations are intentionally server-driven: the web UI consumes typed RPC + SSE.

## Execution

- **KeeperHub**: server submits contract calls and polls until a `txHash` is available.
- **Uniswap V3 SwapRouter02**: calldata is built server-side and executed via the vault.

## LLM + Decisioning

- **Gemini**: generates strict JSON (`action`, `amountInWei`, and human-readable `reasoning`).
- **Risk**: deterministic gate + optional second opinion from the risk path (`MOCK_RISK_AGENT=true` skips remote calls for local demos).

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
- **Risk (local default)**: `MOCK_RISK_AGENT=true` avoids requiring separate risk infra.

---

## Risk agent (no AXL required)

The trade cycle combines **deterministic rails** with an optional **risk agent** decision path. For normal development and demos, set **`MOCK_RISK_AGENT=true`** so the server does not depend on extra P2P services.

Optional **Gensyn AXL**-style transport still exists in the codebase for experiments (`apps/server/src/integrations/axl-transport.ts` and related env vars). It is **not** part of the documented product or deployment checklist—see [`plan.md`](./plan.md). Keep any cross-process payloads small; large artifacts belong in **0G** with pointers.

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

### Optional (experimental AXL transport)

Only relevant if you turn off `MOCK_RISK_AGENT` and point the server at running peers—not needed for the checklist in [`plan.md`](./plan.md).

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
- `apps/server/src/integrations/axl-transport.ts` (optional / experimental)
  - only when exercising non-mock risk routing
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

