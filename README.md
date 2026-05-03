# auto

On-chain vaults with a **server-side trade cycle** (LLM proposal, risk checks, optional execution via KeeperHub and Uniswap) and a **Next.js** web app (Privy, live activity via SSE). The repo was bootstrapped with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack) and uses Hono, oRPC, and Turborepo.

## Documentation

- [`docs/overview.md`](./docs/overview.md) — what the platform does today
- [`docs/plan.md`](./docs/plan.md) — near-term checklist (architecture diagram, ENS, 0G/ENS builder feedback, demo video, README, deployment verification; **AXL is not on this plan**)
- [`docs/integrations.md`](./docs/integrations.md) — integrations and env vars
- [`docs/roadmap.md`](./docs/roadmap.md) — longer-horizon ideas
- [`docs/builder-feedback.md`](./docs/builder-feedback.md) — draft sponsor notes for 0G and ENS

Partner-facing integration notes also live in [`FEEDBACK.md`](./FEEDBACK.md) at the repo root.

## Stack

- **TypeScript** — types across apps and packages
- **Next.js** — web app (`apps/web`, default dev port **3001**)
- **Hono + oRPC** — API (`apps/server`)
- **Tailwind + shadcn** — shared UI in `packages/ui`
- **Bun** — runtime and package manager
- **Biome (Ultracite)** — lint and format
- **Turborepo** — monorepo tasks

## Getting started

Install dependencies:

```bash
bun install
```

Configure the server from `apps/server/.env.example` → `.env.staging` or `.env.local` (see [`docs/integrations.md`](./docs/integrations.md)).

Run **web + API** together:

```bash
bun run web:dev
```

Open [http://localhost:3001](http://localhost:3001). Point `NEXT_PUBLIC_SERVER_URL` at your API (often `http://localhost:3000` in dev).

## UI customization

React apps share shadcn/ui primitives through `packages/ui`.

- Design tokens: `packages/ui/src/styles/globals.css`
- Primitives: `packages/ui/src/components/*`
- Config: `packages/ui/components.json` and `apps/web/components.json`

### Add shared components

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

```tsx
import { Button } from "@auto/ui/components/button";
```

App-specific blocks: run the shadcn CLI from `apps/web`.

## Formatting

- `bun run check` — Ultracite / Biome fix

## Project structure

```
auto/
├── apps/
│   ├── web/         # Next.js frontend
│   └── server/      # Hono + oRPC API
├── packages/
│   ├── ui/          # Shared shadcn/ui
│   ├── api/         # Shared API / router types
│   └── ...
├── docs/            # Platform docs + execution checklist
```

## Scripts

- `bun run web:dev` — server (`dev:staging`) + web dev
- `bun run dev:web` — web only
- `bun run dev:server` — server only (`dev` filter)
- `bun run build` — build all
- `bun run check-types` — TypeScript across packages
- `bun run check` — lint and format
