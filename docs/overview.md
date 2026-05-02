# Platform Overview

## What it is

An on-chain vault + agent loop:

- users authenticate with Privy
- each user owns one or more vaults
- a server-side trade cycle generates a proposal (Gemini), runs risk checks, and (optionally) executes a swap (KeeperHub → Uniswap)
- every cycle is logged (0G best-effort + Postgres cache)
- the UI consumes live/history activity via authenticated SSE

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
  - history delivered via SSE (backed by Postgres cache)

- **Funding UX**
  - user dropdown shows wallet address + ETH balance, refresh, and faucet link

## Debugging

- Set `DEBUG=true` on the server for deep cycle logs and 0G upload diagnostics.

