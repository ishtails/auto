# Auto

**Verified DeAI: Router-gated inference, KeeperHub settlement, traces anchored on 0G.**

Auto treats **decentralized AI** as more than a chat model behind an API — it is a pipeline where inference is **separated from verification**, outcomes are **anchored to decentralized storage**, and swaps only fire when **policy + verifier + execution** all agree. Run several agents in parallel, each with its own rules, risk limits, and memory; review what they propose, then let the strong ones run on a schedule or on demand.

| | |
| --- | --- |
| **DeAI verification** | A dedicated **0G Compute** Router pass approves or rejects proposals using the same memory and JSON the model saw — decentralized inference as a gate, not decoration. |
| **DeAI auditability** | **0G Storage** (**KV** + **DA**) holds stream state and full-cycle traces so reasoning and execution are inspectable long after the HTTP response returns. |
| **DeAI guardrails** | Deterministic checks first, optional **KeeperHub** execution on-chain last — keep flows in **suggest-only** mode or turn on automated swaps when you are ready. |

**Same pipeline, provable artifacts.** Auto is a reference implementation: an LLM proposes; **0G Compute** verifies; **KeeperHub** settles against an EVM vault; **0G Storage** preserves the reasoning graph for audit and replay — no “trust our backend” story.

<img width="1780" height="1071" alt="Screenshot 2026-05-03 at 8 17 53 PM" src="https://github.com/user-attachments/assets/e8fa1ace-bfbc-4d4b-8be1-97f78bbe2ace" />

<br/>

---

## The problem this solves

Autonomous agents that move real capital are stuck between two bad options: **centralized black boxes** (fast UX, zero defensibility) or **on-chain scripts** (transparent but rigid). Auto sits in the middle: **human-grade reasoning** from an LLM, **deterministic gates** before capital moves, a **named verifier stage** on **0G Compute**, and **durable proofs** on **0G Storage** so anyone can answer: *what was proposed, what was checked, what actually ran, and where is the evidence?*

That combination—**intent → policy → verified judgment → execution → provable record**—is the architectural bet this repo demonstrates end-to-end. **Base** is only the L2 this deployment targets for vaults and DEX calldata; the DeAI shape is the center, not any single chain.

---

## What Auto is

Auto is a production-shaped monorepo: operators authenticate, configure vaults, and run trade cycles on demand or on a schedule. Each cycle emits a structured artifact (proposal, risk outcome, optional swap execution). The interface stays instant because **Postgres** caches history and **SSE** pushes updates as background work completes; **0G** receives the authoritative audit in parallel—**KV** for stream-oriented state and **DA** blobs for a complete JSON trace per cycle. **Execution defaults to Base** (KeeperHub + Uniswap) in this tree; swap env and integrations for another EVM L2 and the rest of the stack stays the same.

---

## Why this architecture

- **Verifiability over vibes.** KV + DA patterns and a Router-mediated inference step on **0G Compute** make the story linear and inspectable: *propose → gate → verify → execute → anchor on 0G*.
- **Latency where users touch the product; durability where capital and reputation matter.** Chains and decentralized storage are not synchronous with a click. Postgres + SSE keep the UI honest; workers finish KV/DA writes and reconcile rows when proofs land so activity cards update without blocking HTTP.
- **One surface for reviewers.** Next.js + Hono in a single Turborepo so a line in the integration table maps straight to the implementation.

---

## How a cycle runs

1. **Suggest** — The model emits a strict JSON trade proposal using trading memory (prior cycles) and vault rules.
2. **Gate** — Deterministic risk checks run first (allowlists, sizing, and related policy).
3. **Verify** — If the gate passes, **0G Compute** (Router) performs a verifier pass: same memory and proposal in separated prompt blocks → approve/reject.
4. **Execute (optional)** — When policy allows and risk is green, the server builds **Uniswap** calldata and submits via **KeeperHub** to the user’s on-chain vault (configured chain in this repo: **Base**).
5. **Record** — The cycle persists for the UI; **KV** and (by default) a **DA** trace upload run in the background; the UI surfaces pointers, batch roots, and transaction links as they confirm.

Skimming for integrations? The next section maps each step to docs, code, and environment.

---

## Integration map

Note: All builder feedback (**0G**, **Uniswap**, **KeeperHub**, **ENS / Basenames**) is in [`FEEDBACK.md`](./FEEDBACK.md).

<br/>
<img width="1783" height="631" alt="Screenshot 2026-05-04 at 12 05 49 AM" src="https://github.com/user-attachments/assets/b53b7176-7955-43be-a959-a926f60c9c7f" />
<br/>

Each row is something you can run, click, or grep in the repo.


| Capability                 | 0G / stack                                                                                        | Try it                                                                                                          | Where in code                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verifier on **0G Compute** | [Compute Router](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview) | Turn off mocks, set a Router API key, run a cycle; logs show `verifier stage start` → `verifier stage verdict`. | `[og-compute-verifier.ts](./apps/server/src/integrations/og-compute-verifier.ts)` · `[og-compute-risk.ts](./apps/server/src/integrations/og-compute-risk.ts)` |
| Memory fed into verifier   | Same entries as Gemini                                                                            | Set `DEBUG=true` and watch `memoryEntries` on verifier start.                                                   | `[trading-memory-source.ts](./apps/server/src/services/trading-memory-source.ts)` · `[run-trade-cycle.ts](./apps/server/src/router/run-trade-cycle.ts)`       |
| **KV** audit trail         | [Storage SDK — KV](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk)                   | Open a vault → Recent activity → audit block: stream pointer, KV batch root, batch tx.                          | `[og-logger.ts](./apps/server/src/integrations/og-logger.ts)` · `[og-cycle-log-queue.ts](./apps/server/src/services/og-cycle-log-queue.ts)`                   |
| **DA** full trace blob     | [Storage SDK — upload](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk) (`MemData`)   | Same card: DA trace root and DA blob tx (optional: `OG_DA_CYCLE_TRACE=false` to skip).                          | `[og-cycle-da-blob.ts](./apps/server/src/integrations/og-cycle-da-blob.ts)`                                                                                   |
| Live UI                    | Postgres + SSE                                                                                    | Scroll activity; proofs can appear shortly after the cycle returns 200.                                         | `[cycle-stream.ts](./apps/server/src/router/cycle-stream.ts)` · `[use-vault-cycle-feed.ts](./apps/web/src/app/vaults/[id]/use-vault-cycle-feed.ts)`           |
| Swaps                      | **KeeperHub** + **Uniswap** on configured EVM L2 (this repo: **Base**)                             | Live mode: cycle returns a swap `txHash`; explorer link matches the deployment chain.                            | `[keeperhub-client.ts](./apps/server/src/integrations/keeperhub-client.ts)` · `integrations/` (Uniswap builder)                                               |
| **ENS** (identity)         | [ENS](https://docs.ens.domains/) — resolution on **Ethereum mainnet**                               | Connect a wallet with a primary `.eth` name (and optional `avatar` record); account menu + cycle logs pick it up. | `[ens-operator-snapshot.ts](./apps/server/src/integrations/ens-operator-snapshot.ts)` · `[use-operator-ens.ts](./apps/web/src/hooks/use-operator-ens.ts)` · `[user-dropdown.tsx](./apps/web/src/components/user-dropdown.tsx)` |


TypeScript SDK used here: `[@0gfoundation/0g-ts-sdk](https://www.npmjs.com/package/@0gfoundation/0g-ts-sdk)`

Handy links


|                            |                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Storage explorer (Galileo) | [storagescan-galileo.0g.ai](https://storagescan-galileo.0g.ai) (also `OG_STORAGE_EXPLORER_BASE`) |
| Testnet keys / credits     | [pc.testnet.0g.ai](https://pc.testnet.0g.ai/)                                                    |
| ENS manager (register / profile) | [app.ens.domains](https://app.ens.domains)                                                 |


---

## ENS (identity)

ENS integration is **read-only** and **best-effort**: we never block vault flows on name resolution.

- **Chain:** All ENS reads use **Ethereum L1** (ENS’s home chain), via viem `getEnsName` → `normalize` → `getEnsAvatar`, consistent with [ENS docs](https://docs.ens.domains/web/quickstart). Vaults and swaps use the app’s configured L2 — **Base** (e.g. Base Sepolia) in this repository.
- **Wallet vs in-app agent name:** The **agent name** you set when creating or editing a vault is stored in our DB only. A public **`.eth` primary name** and **avatar** belong to the **operator wallet** (the user’s `primary_wallet_address`). Register or update those in [ENS manager](https://app.ens.domains); the app does not sell or mint names.
- **Where it shows up:**
  - **Account menu** — primary name and avatar on the trigger (when present), a one-line note that ENS is L1 and vaults use the configured L2 (Base here), and a link to **Register / manage ENS**.
  - **Trade cycles** — Each new cycle may include an optional `operatorEns` snapshot (`primaryName`, `avatarUrl`) on the persisted `CycleLogRecord` for audit/UI; older rows omit it.
- **Optional env:** `ETH_MAINNET_RPC_URL` (server) and `NEXT_PUBLIC_ETH_MAINNET_RPC_URL` (web) override the default public mainnet RPC; see `[packages/env](./packages/env)` and `[apps/server/.env.example](./apps/server/.env.example)`.

### Basenames (`*.base.eth`) and vault agents

We **verify** optional **`*.base.eth`** names against the **vault contract address** (forward resolution on Base) and store a normalized link in the agent profile. **Reverse** display in the UI relies on a **primary** name for that address (ENSIP-19 via mainnet resolver + chain `coinType`); **transferring** a name to the vault does **not** by itself set **primary**, and the Basenames flows we used did not give us a clear way to set **primary for a smart contract** the way ENS manager does for EOAs. We therefore often fall back to the **DB-linked** name after a successful save, not automatic on-chain reverse.

For **partner-facing ENS / Basenames notes** (use case, primary-name gap, L2 economics, wishlist), see **[`FEEDBACK.md`](./FEEDBACK.md)** — **ENS & Basenames — builder feedback**.

---

## Execution pipeline

```mermaid
flowchart LR
  subgraph client [Web]
    UI[Next.js + Privy]
  end
  subgraph api [Server]
    Hono[Hono + oRPC]
    Cycle[Trade cycle]
    Verifier[0G Compute verifier]
    KV[0G KV]
    DA[0G DA blob]
    PG[(Postgres)]
  end
  subgraph external [Partners]
    Gemini[Gemini]
    KH[KeeperHub]
    Router[0G Compute Router]
  end
  UI --> Hono
  Hono --> Cycle
  Cycle --> Gemini
  Cycle --> Verifier
  Verifier --> Router
  Cycle --> KH
  Cycle --> PG
  Hono --> SSE[SSE]
  SSE --> PG
  Cycle --> KV
  Cycle --> DA
  UI --> SSE
```



Postgres and SSE optimize for responsiveness; **0G Storage** uses **KV** for stream-shaped audit keys and **DA** for a full JSON envelope per cycle. With both paths enabled, expect two storage-related transactions (KV batch + DA upload).

---

## Run it locally

You’ll need [Bun](https://bun.sh/), a Postgres URL, and the keys listed under [Environment](#environment) (start from the example file).

```bash
bun install
cp apps/server/.env.example apps/server/.env.staging   # or .env.local
# Fill in secrets, then:
bun run web:dev
```

- Frontend: [http://localhost:3001](http://localhost:3001)  
- API: [http://localhost:3000](http://localhost:3000) — set `NEXT_PUBLIC_SERVER_URL` in the web app to match.

Quick sanity check

1. Sign in with Privy and open a vault.
2. Run a trade cycle (dry-run or live, depending on your env).
3. Under Recent activity, open Audit trail · 0G Storage and confirm pointer / KV / DA fields as jobs finish.
4. Optional: `GET /diagnostics` on the API for a short health summary.
5. Optional: use a wallet with a **primary ENS name** on mainnet — the account menu and new cycle rows should show name/avatar when resolution succeeds.

Repo hygiene

```bash
bun run check
bun run check-types
```

---

## Environment


| Area           | What you need                                                                                             | Tip                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Core app       | `DATABASE_URL`, `CORS_ORIGIN`, Privy, deploy secrets                                                      | See `[apps/server/.env.example](./apps/server/.env.example)` |
| LLM            | `GEMINI_API_KEY`, `GEMINI_MODEL`                                                                          | `MOCK_LLM=true` skips Gemini for local experiments           |
| **0G Storage** | `OG_RPC_URL`, `OG_INDEXER_RPC`, `OG_KV_ENDPOINT`, `OG_PRIVATE_KEY`, `OG_FLOW_CONTRACT`, `OG_KV_STREAM_ID` | Fund the signer for both **KV** and **DA** if DA is enabled  |
| DA traces      | `OG_DA_CYCLE_TRACE`                                                                                       | Default on; set `false` to skip blob uploads                 |
| **0G Compute** | `OG_COMPUTE_ROUTER_API_KEY`                                                                               | Required for a real verifier unless `MOCK_RISK_AGENT=true`   |
| Execution      | `KEEPERHUB_`*, `UNISWAP_ROUTER_ADDRESS`, chain RPC                                                        | `MOCK_EXECUTION=true` fakes a successful swap                |
| Web            | `NEXT_PUBLIC_SERVER_URL`                                                                                  | Must point at your API                                       |
| **ENS** (optional) | `ETH_MAINNET_RPC_URL`, `NEXT_PUBLIC_ETH_MAINNET_RPC_URL`                                            | Override L1 RPC for `getEnsName` / `getEnsAvatar` (browser RPCs can be rate-limited) |

More detail (internal): `docs/integrations.md` and `packages/env`.

---

## Repository layout

```
auto/
├── apps/web/          # Next.js — vault UI, SSE client
├── apps/server/       # Hono + oRPC — cycles, 0G, KeeperHub, scheduler
├── packages/api/      # Shared types and RPC contracts
├── packages/env/      # Validated env for server and web
├── packages/ui/       # Shared UI primitives
└── docs/              # Deeper notes (overview, integrations, roadmap)
```

Further reading: [`FEEDBACK.md`](./FEEDBACK.md)

---

## Stack & scripts

Stack: TypeScript, Turborepo, Bun, Next.js, Hono, oRPC, Drizzle + Postgres, `@0gfoundation/0g-ts-sdk`, Biome (Ultracite). Bootstrapped from [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack).


| Command                                  | Purpose                                 |
| ---------------------------------------- | --------------------------------------- |
| `bun run web:dev`                        | API + web (typically ports 3000 / 3001) |
| `bun run dev:web` / `bun run dev:server` | Run one side only                       |
| `bun run build`                          | Production build                        |
| `bun run check`                          | Lint + format                           |
| `bun run check-types`                    | Typecheck the monorepo                  |


---

## Security

Do not commit real `.env` files or private keys. Treat `OG_PRIVATE_KEY`, `KEEPERHUB_API_KEY`, `GEMINI_API_KEY`, and `OG_COMPUTE_ROUTER_API_KEY` as server-only secrets.
