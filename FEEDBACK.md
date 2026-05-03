# Sponsor integrations — builder feedback

Submitted for **Uniswap Foundation** and **KeeperHub** builder feedback. Each section is independent.

---

# Uniswap Developer Platform — builder feedback

Focus: **honest friction** from our real integration. Outline matches **KeeperHub** below (**context → pain points → surprises → gentle suggestions → code pointers**). We’re genuinely thankful for both stacks—a short “what helped” note sits at the end of section 1.

## 1. Context: our integration

We use the **Uniswap Trading API** (`POST /v1/quote` → `POST /v1/swap`) on **Base mainnet** for **Universal Router** calldata, biasing **v4** (hooks-inclusive) then **v3** / **v2**. On **Base Sepolia** the public API is not reliable enough for our demos, so we use a **separate path**: allowlisted **v3** pools, **QuoterV2** quotes, and **SwapRouter02** `exactInput*` calldata (`uniswap-builder.ts`)—optional Trading API on Sepolia behind `UNISWAP_TRADE_API_ON_SEPOLIA`, with **fallback** to the pool path when quotes fail.

Calldata is executed inside `**UserVault.executeSwap`** (nested router `swapCalldata`), then **KeeperHub** relays the tx—not an EOA Permit2 flow in our stack.


| Stage       | What we use                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mainnet** | Trading API → `CLASSIC` only → `/swap`; headers include `x-universal-router-version`, `x-permit2-disabled: true` for vault-style allowance + UR. |
| **Sepolia** | Custom pool graph + on-chain quotes + SwapRouter02; may attempt Trading API when opted in, then fall back.                                       |


**What actually helped (brief):** OpenAPI / `api.json` and a clear **quote → swap** shape made iteration possible once parameters matched. The problems below dominated our calendar.

## 2. Pain points and documentation gaps

### API versions, parameters, and backward compatibility

We lost **well over an hour** debugging a failing flow before discovering the root cause: we were effectively mixing expectations for **different API / Universal Router versions** and had **an extra request field** that did not belong on the path we were calling. Symptom looked like “bad calldata / wrong router”—we questioned our **vault architecture**, simulated raw calls in **Tenderly**, and still missed that it was a **contract / parameter mismatch**, not Uniswap v4 vs v3 logic.

**Nudge:** A clearer **“these pieces go together”** story in the docs (gateway, OpenAPI revision, `x-universal-router-version`, which body fields belong with which era) would have saved us that spiral—we’re sure this kind of polish is already on your radar. Even **light validation or warnings** when a request looks “almost right” would make wrong-version mistakes cheaper to spot than Tenderly sessions.

### Base Sepolia (and testnets generally)

It was **hard to discover which pools / routes are realistically tradeable on Base Sepolia**: public docs don’t give us a **canonical list** of “supported” testnet liquidity the way mainnet discovery does. Status of **other testnets** for the Trading API vs **bring-your-own-pool** is easy to miss. To get **repeatable** demos we had to **curate allowlisted tokens** with enough **real testnet liquidity** and wire **fixed fee tiers** ourselves—otherwise swaps fail for reasons that look like “our vault is broken.”

**Nudge:** Any extra **signposting** for Base Sepolia (and how other testnets compare)—even “here’s what we see teams use for demos”—would reduce guesswork. We know liquidity on testnets is never perfect; a bit more **visibility into what’s realistic to route** would have made our token picks less trial-and-error.

### Mainnet vs testnet: product complexity (our journey, not blame)

Because **mainnet** can follow **Trading API + v4-inclusive routing** while **Sepolia** needs our **v3 pool + Quoter** pipeline (and optional API attempts + fallback), we had to build **explicit branching and fallbacks** in code—effectively a **small state machine** (`chainId`, API availability, `routing === "CLASSIC"`, router address parity). That’s **rational** given network reality; we mention it only because a **single mental map** (even a short “if you’re on Sepolia vs mainnet, expect…”) would make that branching feel less bespoke.

### Vault / contract swapper path (still painful)

Our vault uses **ERC20 approve → router**, not Permit2 signing. We set `**x-permit2-disabled: true`**. Docs still read **EOA-first** in places.

**Nudge:** More **contract-first** wording alongside the wallet flows would help—when something’s off with `swapper` / `from` / router alignment, **gentler hints in errors** (“check swapper matches vault”) would narrow debugging faster than we managed on our own.

### Routing mode and errors

We **fail fast** when `routing !== "CLASSIC"` because our vault does a **single** `swapRouter.call`. Non-classic routes aren’t “wrong,” they’re **incompatible** with our executor—today we infer that from trial.

**Nudge:** A small **“which routing modes play nice with a single contract `call`”** note—and slightly **friendlier errors** when we’re in the wrong mode—would match how polished the happy path already feels.

### Simulation

We experimented with `simulateTransaction` on `/swap`—sometimes clearer than on-chain reverts; over time, **more consistent wording** across those paths would make automation a bit easier (totally understand that’s incremental polish).

## 3. Surprises we validated in code

- `**/swap.to` vs deployed vault `swapRouter`**: must match Universal Router the API targets—we assert and throw; others will hit **silent wrong-router** failures first.
- **Non-zero `tx.value` from `/swap`**: we reject—vault path is **ERC20-in / ERC20-out** only; a **footnote for contract integrators** on wrap/unwrap edges would have saved a double-take.

## 4. Things that would make our lives easier

We’re sure many of these are already on a roadmap somewhere—these are **wishlist-style**, not demands:

- **Versioning story** — anything that makes **version + headers + body** mismatches easier to spot early (our #1 detour).
- **Testnet signposting** — Sepolia vs mainnet expectations in one friendly place.
- **Richer errors when something’s mis-wired** — swapper, router, routing mode—we’ll take any incremental clarity.
- **Examples skewed toward agents / contracts** — building on the great direction of `uniswap-ai` and the existing API surface.

## 5. Implementation pointers (for reviewers)


| Concern                                                 | Location                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trading API (`/quote`, `/swap`, Permit2-off vault path) | `apps/server/src/integrations/uniswap-trade-api.ts`                                                                                                                                  |
| Mainnet vs Sepolia, pool fallback, `CLASSIC` gate       | `apps/server/src/integrations/uniswap-builder.ts`                                                                                                                                    |
| Env                                                     | `UNISWAP_TRADE_API_KEY`, `UNISWAP_TRADE_API_URL`, `UNISWAP_UNIVERSAL_ROUTER_VERSION`, `UNISWAP_API_PERMIT2_DISABLED`, `UNISWAP_TRADE_API_ON_SEPOLIA` in `packages/env/src/server.ts` |
| Debug (`DEBUG=true`)                                    | `integrationDebugLog(..., "Uniswap", ...)` in `apps/server/src/router/debug.ts`                                                                                                      |


Thank you for the Developer Platform work so far; the friction above is offered in the spirit of “this would have saved us time,” not criticism. We’d love to keep building on what you’ve shipped.

---

# KeeperHub — builder feedback

Thank you for building an execution layer we could actually lean on for demos—the notes below are **observations** from shipping, not a punch list.

## 1. Context: our stack

We use KeeperHub as the **execution layer** for an autonomous portfolio agent:


| Layer          | Role                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brain**      | Bun/TypeScript server — scheduled LLM trade cycles (`runTradeCycle` in `apps/server/src/router/run-trade-cycle.ts`).                                                                                                                      |
| **Routing**    | Uniswap Trading API or Sepolia pool fallback → calldata for `UserVault.executeSwap`.                                                                                                                                                      |
| **Encoding**   | `encodeVaultExecuteTrade` (`apps/server/src/integrations/vault-executor.ts`) builds `**executeSwap`** args (nested router calldata, deadlines, minOut).                                                                                   |
| **Muscle**     | KeeperHub — `POST /api/execute/contract-call` → poll `GET /api/execute/:id/status` (`apps/server/src/integrations/keeperhub-client.ts`).                                                                                                  |
| **Settlement** | `**UserVault.sol`** — only the vault’s `**authorizedAgent**` may call `**executeSwap**`; we bind that to `**KEEPERHUB_RELAYER_ADDRESS**` at deploy time so KeeperHub’s relayer matches on-chain ACL (see vault factory / deploy scripts). |


**Important nuance:** our backend does **not** EIP-712-sign the final chain tx — we submit ABI + JSON `**functionArgs`** and KeeperHub broadcasts (relayer pays gas). Misalignment between dashboard relayer, env relayer, and vault `**authorizedAgent**` tripped us once—**a tiny “three corners must match” diagram** in docs would be a kindness to the next integrator.

**Execution proof (Base Sepolia):**

- Tx: [https://sepolia.basescan.org/tx/0x86b710d1e8bd9e5920acc72b7cde1bbba24205d837a0be140909adba7b495d8b](https://sepolia.basescan.org/tx/0x86b710d1e8bd9e5920acc72b7cde1bbba24205d837a0be140909adba7b495d8b)  
- Relayer we configured for vault ACL: `0x7E99B7ae3D00d9A6D674608dd2DCb83e9148bB0C`

## 2. What we ran into

- **502 Bad Gateway (execute)** — During Base Sepolia demos we saw **transient 502s** on `POST .../contract-call`. From our client we mostly saw **HTTP status** (`keeperhub execute failed: 502`) without much to distinguish **gateway blip** vs **upstream** vs **payload**—so we fell back to **retries** and crossed fingers. Any extra signal you ever add here would make sleep easier (we know infra is hard).
- **Thin HTTP errors on our side** — On non-OK responses we currently collapse to `keeperhub execute failed: ${status}` and **don’t retain bodies**—that’s on us too; richer responses would only help if we plumbed them through.
- **Opaque on-chain failures** — When status comes back **failed**, we only see whatever fits in `**payload.error`**. Deep `**UserVault**` → router reverts are hard to interpret without **decoded reasons**—same rough edge in the **dashboard** (see section 3).
- **Polling** — We **poll** status on a fixed interval (`keeperhub-client.ts`). It works; **event-driven** delivery someday would be lovely for long-running agents—not urgent, just a direction we’d celebrate if it ever fits your product story.

## 3. Dashboard & onboarding

The dashboard got us **farther than console-only debugging**, which we appreciate. A couple of spots where a little more context would have reduced hopping to BaseScan:

- **“No step logs available”** — We saw **success/error counts** and rows labeled Contract-Call **Error** / **Success** with duration and network, but **not much narrative** about what failed (revert reason, trace, parsed calldata). For router-heavy paths we mostly correlated manually.
- **Onboarding path** — We didn’t get far into **workflows** or every dashboard surface in the time we had. If you ever add **short walkthroughs** or a **lightweight in-product checklist** (first key → first execution → where to look when something fails), that would likely help the next team like us get oriented faster—no rush; we’re guessing this kind of polish is never really “done.”

## 4. Docs & knobs we puzzled over

- **Gas** — We currently send a fixed `gasLimitMultiplier: "1.2"` on `contract-call` payloads (hardcoded in `keeperhub-client.ts`). **Exact gas** for Uniswap + vault paths is hard to predict. Any **clear, safe patterns** for when to nudge that knob (and when the platform will reject) would save a bit of trial-and-error on our side.
- **Relayer ↔ contract ACL** — The mental model is “three addresses must agree.” A short **vault / agent pattern** note (deploy with `authorizedAgent` set to your relayer, sanity-check on BaseScan, then call `executeSwap`) would sit nicely alongside generic API auth docs—we stumbled once here and suspect we won’t be the last.

## 5. Nice-to-haves (if they ever fit)

No expectations—these are directions we’d **celebrate** if they ever lined up with your roadmap:

- **Push-ish updates** — Anything that lets a long-running agent learn when something **settled or failed** without living purely inside a poll loop would feel great (exact shape totally up to you).
- **Batching / fewer round-trips** — Rebalances sometimes imply **multiple** contract calls; when chain semantics allow, anything that **cuts chatter** is welcome.
- **Richer execution detail in the product** — Raw calldata, traces, or **decoded reverts** from `UserVault` / downstream routers would pair nicely with clearer step-by-step logs over time.
- **Friendlier 5xx stories** — Even occasional hints on **retryability** or **upstream vs payload** (when you can) would help automated clients sleep—we know not everything can be crisp.

## 6. Implementation pointers (for reviewers)


| Concern                           | Location                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| KeeperHub HTTP client             | `apps/server/src/integrations/keeperhub-client.ts`                                                     |
| Vault calldata packaging          | `apps/server/src/integrations/vault-executor.ts`                                                       |
| Env                               | `KEEPERHUB_BASE_URL`, `KEEPERHUB_API_KEY`, `KEEPERHUB_RELAYER_ADDRESS` in `packages/env/src/server.ts` |
| Labeled debug logs (`DEBUG=true`) | `integrationDebugLog(..., "Keeper Hub", ...)` in `apps/server/src/router/debug.ts`                     |


Thank you again for KeeperHub; we’re rooting for you