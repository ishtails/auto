Here is the crash course on how the architecture shifts.

### The Paradigm Shift: Traditional vs. Web3 AI

**1. Authority and Trust**
*   **Traditional:** Your backend asks the Gemini SDK a question, gets an answer, and writes it to Postgres. You trust your backend.
*   **Web3:** Your backend asks the LLM a question and decides to buy ETH. The blockchain does not trust your backend. The backend must cryptographically sign a transaction and submit it to a Smart Contract, which acts as the final bouncer.

**2. State and Memory**
*   **Traditional:** App state lives in a private database. User logs live in Datadog.
*   **Web3:** The financial state lives entirely on the blockchain. For your agent to be verifiable, its "memory" and reasoning logs cannot live in a local SQLite file. They must be pushed to a decentralized layer like 0G Storage so the public can audit exactly *why* an agent made a decision.

**3. Execution**
*   **Traditional:** You make an API call to Stripe or a database update to change a balance.
*   **Web3:** You construct a raw hexadecimal transaction payload. Because blockchains have variable gas fees and network congestion, agents often fail to execute transactions reliably. This is why you hand the payload off to an execution relayer like KeeperHub to ensure it actually lands on-chain via Uniswap.

---

### Separation of Concerns

To build this cleanly, prioritize good primitives and explicit contracts between your layers. 

#### The Smart Contract (The Vault)
**Role:** Asset custody and safety rails.
Think of the contract as a highly secure, very dumb bank vault. It knows nothing about AI, LLMs, or market sentiment. 
*   **What goes in:** Functions to deposit/withdraw funds. A strict `executeTrade` function. Hardcoded safety checks (e.g., maximum trade size, slippage limits, authorized callers). 
*   **What stays out:** No external API calls. No complex logic. No string parsing.

#### The Server / Backend (The Brain)
**Role:** Perception, reasoning, and orchestration.
This is your Bun runtime. It acts as the bridge between the off-chain world (LLMs, APIs) and the on-chain world.
*   **What goes in:** The continuous event loop. Fetching price data from Dexscreener. Building the prompt context. Executing the LangChain/OpenAI calls for the Trading and Risk agents. Routing peer-to-peer messages via Gensyn AXL. Pushing the JSON reasoning logs to 0G. Formatting the final trade intent and sending it to KeeperHub.
*   **What stays out:** Holding user funds. 

#### The Frontend (The Glass)
**Role:** Visualization and onboarding.
The UI should be as stateless as possible, reading directly from decentralized infrastructure.
*   **What goes in:** Wagmi hooks for the user to connect their wallet and deposit into the vault. ENS resolution to display `trader.eth` instead of wallet addresses. Fetching the agent reasoning strings directly from 0G Storage to render the live feed.
*   **What stays out:** Any agent logic or transaction building.

---

### Implementation Task List by Domain

Here is your execution checklist based on the PRD:

#### 1. Smart Contract Domain (Solidity / Foundry)
*   [ ] Write a minimal `Vault.sol` contract utilizing OpenZeppelin access controls.
*   [ ] Implement `deposit()` to accept user ETH/USDC.
*   [ ] Implement `executeTrade(tokenIn, tokenOut, amount, data)` restricted so only your KeeperHub relayer or agent wallet can call it.
*   [ ] Deploy the contract to Sepolia testnet or a local mainnet fork.

#### 2. Backend Domain (Bun / Hono / Agent Logic)
*   [ ] Set up a basic `while` loop or cron job running every 15-30 seconds.
*   [ ] **Trading Agent:** Write logic to fetch market data, pass it to the LLM, and parse a JSON response containing the action (BUY/SELL/HOLD) and reasoning.
*   [ ] **Agent Comms:** Spin up Gensyn AXL nodes. Have the Trading Agent send its proposed payload over the AXL network to the Risk Agent.
*   [ ] **Risk Agent:** Write deterministic validation logic to approve or reject the trade based on Vault balance and size limits.
*   [ ] **State Persistence:** Write a module that takes both agents' reasoning strings and pushes them to 0G Storage.
*   [ ] **Execution:** If approved, use the Uniswap V3 SDK to calculate swap parameters, format the transaction intent, and push it to the KeeperHub MCP server for on-chain settlement.

#### 3. Frontend Domain (Next.js / React / Web3)
*   [ ] Scaffold a Next.js app with Wagmi and RainbowKit for wallet connection.
*   [ ] Build a "Deposit" component that interacts with the `Vault.sol` contract.
*   [ ] Integrate the `viem` ENS resolver to look up and display `vault.eth`, `trader.eth`, and `risk.eth`.
*   [ ] Build a live feed component that polls 0G Storage to display the agents' internal monologues and decisions.
*   [ ] Add a UI element that links the final KeeperHub execution to the actual Uniswap block explorer transaction hash.