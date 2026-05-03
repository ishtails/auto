# Execution checklist

Near-term work tracked for the team. Treat this as a living list—not a guarantee of order.

| Item | Notes |
| --- | --- |
| **Architecture diagram** | High-level picture: web → server → vault / KeeperHub / Uniswap / 0G / agent loop. |
| **Integrate ENS** | Resolve / display ENS where we show raw addresses (server or UI—TBD). |
| **Builder feedback (0G, ENS)** | Sponsor-facing notes in [`builder-feedback.md`](./builder-feedback.md) (see also repo-root `FEEDBACK.md` for other partners). |
| **~~AXL~~** | **Removed from plan.** Risk path is covered by deterministic checks + `MOCK_RISK_AGENT` / optional wiring; no requirement to run Gensyn AXL for product milestones. |
| **Demo video** | Record a walkthrough of vault funding → manual cycle → activity log. |
| **Update README** | Root `README.md` should stay aligned with `docs/` and real scripts (`bun run web:dev`, env pointers). |
| **Verify deployment** | Smoke-test staging/production: auth, cycle, SSE, 0G best-effort. |

When this list is stable, fold completed items into release notes or archive them here with dates.

---

### Documentation synced with this plan (2026-05)

`docs/README.md`, [`integrations.md`](./integrations.md) (AXL no longer a setup requirement), [`overview.md`](./overview.md), [`roadmap.md`](./roadmap.md), [`builder-feedback.md`](./builder-feedback.md) stub, and the root [`README.md`](../README.md) were updated to match the checklist above. Remaining rows are still open work.
