# Execution checklist

Near-term work tracked for the team. Treat this as a living list—not a guarantee of order.

| Item | Notes |
| --- | --- |
| **Architecture diagram** | High-level picture: web → server → vault / KeeperHub / Uniswap / 0G / agent loop. |
| **Integrate ENS** | Resolve / display ENS where we show raw addresses (server or UI—TBD). |
| **Builder feedback** | Sponsor-facing notes in repo-root [`FEEDBACK.md`](../FEEDBACK.md) (**0G**, **Uniswap**, **KeeperHub**, **ENS / Basenames**). |
| **~~AXL~~** | **Removed from plan.** Risk path is covered by deterministic checks + `MOCK_RISK_AGENT` / optional wiring; no requirement to run Gensyn AXL for product milestones. |
| **Demo video** | Record a walkthrough of vault funding → manual cycle → activity log. |
| **Update README** | Root `README.md` should stay aligned with `docs/` and real scripts (`bun run web:dev`, env pointers). |
| **Verify deployment** | Smoke-test staging/production: auth, cycle, SSE, 0G best-effort. |

When this list is stable, fold completed items into release notes or archive them here with dates.

---

### Documentation synced with this plan (2026-05)

`docs/README.md`, [`integrations.md`](./integrations.md) (AXL no longer a setup requirement), [`overview.md`](./overview.md), [`roadmap.md`](./roadmap.md), and the root [`README.md`](../README.md) / [`FEEDBACK.md`](../FEEDBACK.md) were updated to match the checklist above. Remaining rows are still open work.
