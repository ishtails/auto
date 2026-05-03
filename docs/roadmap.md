# Roadmap / Vision

This doc is for **longer-horizon ideas**. Active near-term tasks live in [`plan.md`](./plan.md) (architecture diagram, ENS integration, partner notes in repo-root [`FEEDBACK.md`](../FEEDBACK.md), demo video, README polish, deployment verification). **AXL is not on that path**—risk uses deterministic checks plus mock or optional wiring.

## Submission / docs backlog (manual)

- [ ] **README refresh** — root `README.md`, `docs/overview.md`, `docs/integrations.md`: judge-facing table (feature → 0G product KV / DA blob / Compute Router → `@0gfoundation/0g-ts-sdk` paths), verifier stage + dual Storage one-liner, env `OG_DA_CYCLE_TRACE`, link to [Storage SDK](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk).

## The “Voice” (high impact)

- **Telegram bot integration**
  - Link a vault to a Telegram `chat_id`.
  - Push trade notifications.
  - Commands: `/status` (balances + last cycle), `/run` (trigger a cycle).

- **Proactive trade pitching (Analyst Mode)**
  - Default to “suggest + ask permission” instead of auto-execute.
  - Approval UX: button in UI (and/or Telegram) to execute the suggested trade.

- **Conversational memory (RAG chat)**
  - “Chat with my agent” UI.
  - Queries: “Why did you buy yesterday?”
  - Backend retrieves relevant `CycleLogRecord`s (Postgres cache + 0G pointers) and asks Gemini to explain decisions.

## Market context (better prompts)

- **DexScreener integration**
  - Fetch: current price, 1h/24h change, volume + buy/sell ratio.
  - Inject this into the proposal prompt before `runTradeCycle`.

## The “Fast Path” (scheduling)

- **Custom event scheduler**
  - Add a UI tab for schedules: “Every 15 mins”, “Daily at 9 AM”, etc.
  - Add `vault_events` table.
  - Implement a simple 60s master tick to process due events.

- **Event-specific prompts**
  - Per-event instruction override (ex: “Friday 4pm: liquidate 50% to USDC”).
  - Combine safely with risk rails (max trade bps, slippage).

## The “Flex” (advanced)

- **Copy-trading leaderboards**
  - Public leaderboard (PnL/ROI over time).
  - “Clone strategy” copies system prompt + risk params into a new user vault.

