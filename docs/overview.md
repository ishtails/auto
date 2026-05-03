# Platform Overview

For the **current execution checklist** (architecture diagram, ENS, demo video, deployment verification, etc.), see [`plan.md`](./plan.md).

## What it is

An on-chain vault + agent loop:

- users authenticate with Privy
- each user owns one or more vaults
- a server-side trade cycle generates a proposal (Gemini), runs risk checks, and (optionally) executes a swap (KeeperHub → Uniswap)
- every cycle is logged to **0G Storage (KV)** as the durable audit trail; **Postgres** caches rows so the UI and SSE stay fast when 0G reads are slow
- the UI consumes live/history activity via authenticated SSE (backed by that Postgres cache)

## Current capabilities

- **Vaults**
  - create and view vaults
  - ownership checks on server
  - show vault address + copy helpers

- **Manual trade cycles**
  - trigger with configurable trade size / slippage / dry-run
  - show immediate RPC result and tx link (when live)

- **Agent log (UI)**
  - live activity feed with decision, risk reason, and Gemini reasoning (expandable)
  - each entry can show the **0G KV pointer** and, when the SDK returns them, **root hash / L1 tx** for the batch — history rows are still loaded from Postgres first
  - history delivered via SSE (Postgres cache)

- **Funding UX**
  - user dropdown shows wallet address + ETH balance, refresh, and faucet link

## Debugging

- Set `DEBUG=true` on the server for deep cycle logs and 0G upload diagnostics.

