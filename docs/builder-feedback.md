# Builder feedback (0G, ENS)

We share **honest integration notes** with partners the same way we do for other stacks—see repo-root [`FEEDBACK.md`](../FEEDBACK.md) (Uniswap, KeeperHub).

These sections are **draft outlines** for **0G** and substantive notes for **ENS / Basenames** as we ship real usage. Tone stays **grateful and specific** (what worked, what slowed us down, light nudges).

## 0G Storage

_Draft bullets to expand:_

- **Context** — How we use KV / indexer / flow contract for cycle logs; failure modes and timeouts.
- **What helped** — Anything that made integration faster.
- **Friction** — Indexer delays, auth, payload limits, or docs gaps (without sounding like a spec).

When drafts are ready, we can mirror the structure of `FEEDBACK.md` or keep shorter partner-specific notes here only.

---

# ENS & Basenames — builder feedback

Submitted as **builder feedback** for **ENS** and **Basenames / Base** identity workflows. Outline follows our other partner notes (**context → pain points → what we shipped → surprises → suggestions → code pointers**). We are thankful for ENS’s protocol work and Base’s push for L2 naming; the notes below are where our **autonomous vault agent** use case hit a wall.

## 1. Context: our use case

We build **user-owned vault agents** on **Base** (today: **Base Sepolia** for development). Each vault is a **smart contract** that holds funds and executes swaps via an automation path (scheduler + risk gates + relayer). We want a **human-readable on-chain identity** for that **vault address**—not only for the operator’s EOA:

| Need | Why it matters |
| ---- | -------------- |
| **Display** | Dashboards and vault headers should show a memorable name next to `0x…`, not only an internal DB label. |
| **Resolution** | We forward-resolve `*.base.eth` to prove a name **points at** the vault before we persist a link. |
| **Audit / logs** | Cycle logs and storage mirrors should be able to carry a stable public name when one exists. |
| **Economics** | Our product assumes **Base** (or another affordable L2) for **high-frequency, low-margin** agent activity. Moving the whole agent to **Ethereum L1** or **L1 Sepolia** for naming-only reasons would **break the cost model** for autonomous operation—we are not running this stack primarily as an L1 NFT or DeFi whale. |

**What already works on our side (brief):** We integrated **L1 ENS** for the **operator wallet** (`getEnsName` / `getEnsAvatar` on mainnet) for the account menu and optional `operatorEns` snapshots on trade-cycle records. **viem** and public RPC patterns behaved as documented. The gap is **not** “we couldn’t call ENS”—it’s **Basenames + primary name** for a **contract** vault.

## 2. Pain points: Basenames and “primary” for the vault

We wanted each **vault contract** to wear a **Basename** (e.g. a sub-label under a team name) so users see **`agent.example.base.eth`** next to the vault address, and our app can verify **forward resolution** (`name → vault address`) on Base.

**What we tried**

- **Transferring** the Basename (name NFT / registration) toward the **vault address** in the Basenames flow we had access to. We expected that **owning** the name on the vault or **pointing** the name at the vault would be enough for **reverse** display (“what name should we show for this `0x`?”).

**What actually happened**

- **Forward** resolution (`basename → address`) could be made consistent with our vault address for **verification** in the app.
- **Reverse** resolution for display (ENSIP-19 style **primary name** for that address on Base) stayed **empty** in practice: **transferring** or **assigning** the name did **not** establish a **primary Basename** for the **vault contract** in a way the standard **reverse** path could read from the browser (mainnet universal resolver + `coinType` for Base Sepolia).
- Net effect: **no primary ⇒ no automatic “show this name next to the vault”** via the same path that works for EOAs with a primary set in the ENS manager.

**Product gap (our framing)**

- On **ENS (L1)**, the ecosystem is used to **subnames**, **resolver records**, and flows to set a **primary name** for an address (with documentation and UIs that teams have learned over years).
- For **Basenames**, we did **not** find a **clear, reliable UI path** to set **`vault.base.eth` as the primary name for our vault contract address** the way we need for **reverse** display and for parity with our mental model from ENS.
- So we are **integration-complete on our side** for the **happy path** (“if a name is assigned and resolvable the way the protocol expects, we show it, resolve it, and log around it”), but **blocked by the Basenames product surface** for the **contract-as-agent** story.

## 3. What we shipped anyway (so reviewers can see the wiring)

- **Server:** Forward resolution against the **Basenames registry** on the vault chain; **`setVaultAgentBasename`** rejects names that do not resolve to the vault; **`agent_basename`** stored on the agent profile after verification.
- **Web:** Edit-agent field for an optional `*.base.eth`, client-side **ENSIP-19** reverse attempt via **mainnet** + chain `coinType` for **Base Sepolia** (when a **primary** exists), plus **fallback** to the DB-linked name for display.
- **Trade cycles:** Optional **`operatorEns`** snapshot remains **L1 ENS for the operator wallet**, not Basenames for the vault—documented so we don’t confuse the two identities.

This is the stack we would **expand** the moment Basenames (or docs) make **primary for contract addresses** obvious and actionable for builders.

## 4. Road not taken: L1 ENS bridging identity to L2

We considered a heavier pattern: **bind an L1 `.eth` (or subname) to the agent** and **tunnel** recognition to L2 via CCIP / dual resolution / bespoke UX. That may be **protocol-possible**, but it is **operationally heavy** for a hackathon-scale team: extra resolver steps, more user education, and more failure modes in the wallet. We **timeboxed** and stayed on **Base-native** naming.

## 5. Economics and chain choice (why this feedback isn’t “just use L1”)

If we were forced to **anchor identity on Ethereum L1** or run the **agent’s economic core on L1 Sepolia** instead of **Base Sepolia / Base mainnet**, **gas and operational cost** would dominate relative to the **small, frequent** actions an autonomous agent takes. Our **foundation** is **L2-first profitability**; naming has to **meet us there**, not pull the vault onto L1 for a label.

## 6. Suggestions (wishlist, not demands)

- **Basenames UI / docs — primary for contracts** — Explicit guidance (and ideally a **first-class action**) for **setting the primary Basename for a smart contract address** that holds an agent, not only EOAs. If that already exists and we missed it, a **single “contract agents”** doc page would help the next team.
- **Clarify transfer vs primary** — A short **“transferring registration ≠ reverse name in wallets/apps”** note would have saved us a debugging spiral.
- **Parity with ENS subname mental model** — Where Basenames **differs** from **ENS subnames + primary** (capabilities and limits), an honest **comparison table** reduces wrong assumptions.
- **Optional: discovery without primary** — If reverse stays strict, an **endorsed** way to ask “what `*.base.eth` **addr records** point at this address?” (indexer, subgraph, or read pattern) would unblock **display** when primary is unset—understanding this may be **non-trivial** on-chain.

## 7. Implementation pointers (for reviewers)

| Concern | Location |
| ------- | -------- |
| Forward Basename resolution (server) | [`apps/server/src/integrations/basenames-resolve.ts`](../apps/server/src/integrations/basenames-resolve.ts) |
| Verify + persist linked basename | [`setVaultAgentBasename` in `apps/server/src/router.ts`](../apps/server/src/router.ts) |
| Client reverse (ENSIP-19, dev debug logs) | [`apps/web/src/lib/read-address-base-basename.ts`](../apps/web/src/lib/read-address-base-basename.ts), [`use-vault-address-display-name.ts`](../apps/web/src/hooks/use-vault-address-display-name.ts) |
| Operator L1 ENS snapshot (cycles) | [`apps/server/src/integrations/ens-operator-snapshot.ts`](../apps/server/src/integrations/ens-operator-snapshot.ts) |
| Operator ENS in UI | [`apps/web/src/hooks/use-operator-ens.ts`](../apps/web/src/hooks/use-operator-ens.ts) |

Thank you to ENS and Base for the naming work so far; we hope this use case (**L2 vault agents**) becomes easier to dress with **human-readable names** without abandoning **L2 economics**.
