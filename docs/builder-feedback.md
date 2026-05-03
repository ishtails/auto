# Builder feedback (0G, ENS)

We share **honest integration notes** with partners the same way we do for other stacks—see repo-root [`FEEDBACK.md`](../FEEDBACK.md) (Uniswap, KeeperHub).

These sections are **draft outlines** for **0G** and **ENS**. Flesh them out as we ship real usage; keep tone grateful and specific (what worked, what slowed us down, light nudges).

## 0G Storage

_Draft bullets to expand:_

- **Context** — How we use KV / indexer / flow contract for cycle logs; failure modes and timeouts.
- **What helped** — Anything that made integration faster.
- **Friction** — Indexer delays, auth, payload limits, or docs gaps (without sounding like a spec).

## ENS

_Draft bullets to expand:_

- **Context** — Where we want resolution (vault addresses, agent labels, etc.) and which chains matter.
- **What helped** — `viem` patterns, public RPC behavior.
- **Friction** — L2 resolver quirks, rate limits, or UX gaps for embedded-wallet users.

When drafts are ready, we can mirror the structure of `FEEDBACK.md` or keep shorter partner-specific notes here only.
