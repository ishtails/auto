## Product Requirements Document (PRD)

**Project Name**: Multi-Agent Trading Vault

### 1. Objective
Build an autonomous on-chain vault where multiple AI agents collaboratively decide, validate, and execute trades. The system must demonstrate autonomous decision-making and verifiable on-chain execution utilizing 0G, KeeperHub, Uniswap, and ENS.

### 2. Scope (Hackathon MVP)
**Included:**
*   User deposit into a vault smart contract.
*   Agent-driven trade decision (Trading Agent).
*   Secondary agent validation (Risk Agent).
*   Persistent state logging via 0G Storage.
*   Execution of a token swap via KeeperHub to Uniswap.
*   Agent identity resolution via ENS.
*   Minimal React dashboard for demonstration.

**Out of scope:**
*   Complex portfolio management.
*   Production-grade security or audits.
*   Custom infrastructure or custom agent frameworks.

### 3. System Overview
The system relies on a Bun/Hono backend to orchestrate the autonomous loop, connecting to sponsor infrastructure for all critical path operations.

*   **Identity**: ENS (resolving `vault.eth`, `trader.eth`, `risk.eth`).
*   **Memory/State**: 0G Storage (persists trade history and agent reasoning).
*   **Execution**: KeeperHub (handles transaction reliability and gas execution).
*   **DEX**: Uniswap V3 (processes the actual token swap).

### 4. Functional Requirements

#### 4.1 Vault Smart Contract
*   **Responsibilities**: Accept deposits, store user funds, allow authorized execution.
*   **Required Functions**: `deposit()`, `getBalance()`, `executeTrade()`.

#### 4.2 Trading Agent
*   **Responsibilities**: Generate trade decisions based on market data.
*   **Outputs**: Action (BUY/SELL/HOLD), trade size, human-readable reasoning string.

#### 4.3 Risk Agent
*   **Responsibilities**: Validate or reject proposed trades based on deterministic logic (e.g., max trade size).
*   **Outputs**: APPROVE/REJECT, reasoning string.

#### 4.4 Execution Module (KeeperHub & Uniswap)
*   **Responsibilities**: Execute approved trades on-chain reliably.
*   **Requirements**: The backend must submit the approved trade intent to KeeperHub (via MCP or CLI). KeeperHub routes the transaction to the Uniswap V3 router.
*   **Constraints**: One working swap path (ETH to USDC) on Sepolia testnet or mainnet fork.

#### 4.5 Memory & State (0G Storage)
*   **Responsibilities**: Provide persistent, verifiable storage for the agent system.
*   **Requirements**: Both agents must write their reasoning strings and decisions to 0G Storage. The frontend must read the latest state from 0G to display in the UI.

#### 4.6 Frontend Dashboard
*   **Requirements**: Display vault balance, ENS identities, agent reasoning (pulled from 0G), and verified on-chain transaction hashes.

### 5. Hackathon Compliance & Definition of Done

#### 5.1 Repository Requirements
To pass administrative checks and qualify for partner prizes, the GitHub repository must contain:
*   **`FEEDBACK.md`**: Located in the root directory. Must contain specific, actionable developer feedback on the Uniswap API and KeeperHub integration (bugs, DX friction, missing docs).
*   **AI Attribution Documentation**: A clear log specifying exactly which files, code blocks, or assets were generated using AI tools (Cursor, Copilot, ChatGPT).
*   **Prompt & Spec Transparency**: All spec files, prompt histories, and planning artifacts used during development must be committed to the repository.

#### 5.2 Demo Video Constraints
*   **Length**: Strictly between 2 and 4 minutes.
*   **Resolution**: Minimum export resolution of 720p.
*   **Audio**: Must use human voiceover explaining the project. AI text-to-speech synthesizers and AI voiceovers are strictly prohibited.
*   **Video Editing**: Footage cannot be artificially sped up to fit the time limit. Unnecessary waiting times can be cut, but the execution speed must be real.
*   **Visuals**: Use slides to summarize key points (maximum 4 bullet points per slide). Show the actual working project, not just slides with music.

#### 5.3 Success Criteria
1.  A deposit is made successfully.
2.  At least one full autonomous loop executes.
3.  Agent reasoning is written to and retrieved from 0G Storage.
4.  Trade execution is handled by KeeperHub and verified on Uniswap.
5.  All repository and demo video constraints are met perfectly.