# Uniswap Developer Platform — builder feedback

This file is submitted for **Uniswap Foundation / “Best Uniswap API integration”** prize eligibility. It describes our real integration experience: what worked, what did not, and what we want next.

## Summary

We integrated the **Uniswap Trading API** (`POST /v1/quote` → `POST /v1/swap`) so the agent can obtain **Universal Router** calldata on **Base mainnet**, with routing that explicitly prefers **Uniswap v4** (inclusive of pools that use **hooks**), then **v3** and **v2**. For **Base Sepolia**, we still use a **local, allowlisted pool** path: the public Trading API is aimed at production networks, and testnet liquidity/routing is unreliable for demo accounts.

## What worked well

- **Single mental model**: Quote returns a `routing` discriminator; for on-chain execution we follow **CLASSIC** routes into `/swap` and get a ready `TransactionRequest` (`to`, `data`, `value`). That maps cleanly to our vault pattern: **ERC20 approve → `call(data)` on the router**.
- **Protocol knobs**: The `protocols` array and `hooksOptions: "V4_HOOKS_INCLUSIVE"` are exactly the right levers to show judges we are not “v3-only”; we can bias the solver toward **v4** without forking routing code.
- **OpenAPI**: Hosting `api.json` on the gateway made it practical to validate request shapes and headers (`x-universal-router-version`, `x-permit2-disabled`) without guessing.
- **Alignment with sponsor story**: The same API path powers “agentic finance” — the server can explain **route objects** (including **v4 pool entries**) to the LLM for transparency, while execution stays composable with a **smart wallet / vault**.

## Friction and gaps

1. **Permit2 vs custodial vaults**  
   Our `UserVault` uses **classic ERC20 approvals** to `swapRouter` and a relayer that calls `executeSwap`. The API’s happy path often assumes **Permit2** and wallet signing. We set **`x-permit2-disabled: true`** so `/quote`/`/swap` target the **approve → Universal Router** flow. That is correct for us, but:
   - The docs could use a **first-class “vault / contract swapper”** guide: required headers, simulation pitfalls, and how `swapper` should be set when the balance lives in a contract.
   - A small **decision tree** (EOA + Permit2 vs contract allowance + UR) would reduce integrator anxiety.

2. **`swap.from` and `swapper` consistency**  
   We assert `/swap.from` matches the vault address passed as `swapper`. When it diverges, debugging is opaque. A structured error (“swapper must equal calldata payer” / “expected spender”) would speed up integration.

3. **Testnet**  
   For hackathon demos on **Base Sepolia**, we could not depend on the Trading API alone. We documented a **fallback** (configured pools + local quote). A supported **testnet quote** mode (even rate-limited) would help teams ship one codebase for demo + prod.

4. **Non-CLASSIC routings**  
   UniswapX / Dutch / bridge routings are powerful but do not map to our current **single-tx `swapRouter.call`** vault. We fail fast when `routing !== "CLASSIC"`. A short **“vault compatibility matrix”** in the docs would set expectations.

5. **Simulation**  
   We did not turn on `simulateTransaction` everywhere yet (cost/latency tradeoff). When we did experiment, failures were sometimes clearer than on-chain reverts — but error strings could be more **actionable** (e.g. “allowance”, “deadline”, “router mismatch”).

## Bugs / surprises

- **Router address drift**: `/swap.to` must match the vault’s configured `swapRouter` at deploy time. We validate and throw a descriptive error; in practice, teams will mess this up once — a **“expected router for chain X”** helper in docs would help.
- **Non-zero `value`**: Our vault path is **ERC20-only** for swaps. If `/swap` returns `value != 0` (wrap/unwrap edge), we reject loudly. That is correct but worth calling out in a vault integration note.

## What we wish existed

- **Chained agent actions** (as teased in Uniswap’s roadmap): quote → risk → optionally **LP adjust** → settle, with one correlation id across steps.
- **Explicit v4 hook metadata in quotes**: richer hook identifiers in the route payload for **auditability** in agent logs (even if compressed).
- **Official “agent” TypeScript SDK** that wraps `/quote`, `/swap`, and **error normalization** (similar to how `uniswap-ai` skills accelerate Cursor workflows).

## Our implementation (for reviewers)

- **Mainnet (Base, chain 8453)**: `apps/server/src/integrations/uniswap-trade-api.ts` — Trading API, `protocols: ["V4","V3","V2"]`, `hooksOptions: "V4_HOOKS_INCLUSIVE"`, Universal Router calldata from `/swap`.
- **Testnet (Base Sepolia)**: `apps/server/src/integrations/uniswap-builder.ts` — allowlisted `TOKENS` pools + `@uniswap/v3-sdk` quotes + `exactInputSingle` / `exactInput` for execution (best-effort demo).
- **Env**: `UNISWAP_TRADE_API_KEY`, `UNISWAP_TRADE_API_URL`, `UNISWAP_UNIVERSAL_ROUTER_VERSION`, `UNISWAP_API_PERMIT2_DISABLED` in `packages/env/src/server.ts`.

Thank you for the **Developer Platform** and for prioritizing **AI-first** docs — it materially lowered the time-to-first-working-quote.
