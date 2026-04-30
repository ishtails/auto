### Sponsor Infrastructure Mapping

| Component | **Mandatory Sponsor Integration** | **Implementation Details** |
| :--- | :--- | :--- |
| **Execution** | **KeeperHub + Uniswap V3** | Route all Uniswap V3 swap intents through the **KeeperHub MCP Server** or CLI for guaranteed execution and gas optimization. Do not execute raw `viem` transactions directly. |
| **Agent Comm** | **Gensyn (AXL)** | Run a local AXL node. The Trading Agent and Risk Agent must communicate peer-to-peer via AXL HTTP requests, replacing standard internal function calls. |
| **Memory/State** | **0G Storage** | Use 0G Storage (KV or Log) as the absolute source of truth for agent reasoning, trade history, and portfolio state. Local databases (SQLite/JSON) are strictly prohibited. |
| **Identity** | **ENS** | Use `viem` ENS resolvers to bind `vault.eth`, `trader.eth`, and `risk.eth` to the agent identities and display them in the UI. |
| **AI Agents** | **0G Compute (Optional)** | If accessible, run the LLM inference (e.g., Qwen) within 0G's verifiable compute environment to prove the agent's actions. |

---

### Strategic Implementation for Hackathon Judging

To win, the architecture must center the sponsors. Here is how to structure the implementation to ensure your codebase hits the judging criteria for every track:

#### 1. Verifiable Execution via KeeperHub & Uniswap
Do not trigger trades directly from your backend. Your agent must formulate the trade intent and pass it to **KeeperHub**. KeeperHub handles the execution on **Uniswap V3** (Sepolia or Mainnet Fork). 
*   **Hackathon Requirement:** You must include a `FEEDBACK.md` in your repo root detailing your developer experience with both the Uniswap API and KeeperHub to qualify for their prizes.

#### 2. Decentralized Agent-to-Agent Messaging via Gensyn
Instead of having the Trading Agent call a simple function to trigger the Risk Agent, separate them into different logical services.
*   **Implementation:** Connect both agents using **Gensyn's AXL** (Agent eXchange Layer). The Trading Agent sends its proposed trade to the Risk Agent over the AXL peer-to-peer mesh. This directly targets the $5,000 Gensyn prize pool.

#### 3. Absolute Persistence via 0G Storage
Judges will look for where your state lives.
*   **Implementation:** Every time an agent makes a decision or a trade executes, push the JSON payload to **0G Storage**. Your frontend dashboard must fetch the historical logs directly from 0G, proving your agents have decentralized "memory."

#### 4. Cryptographic Identity via ENS
Don't use `0x...` addresses in your UI or logs.
*   **Implementation:** Every agent action, signature, or log entry must be tagged with an **ENS** subname (`trader.eth`). 

#### 5. AI Tooling Attribution (Hackathon Rule)
Since you are using AI to build this (Cursor, Copilot, LLMs), you must maintain a strict attribution log. 
*   **Implementation:** Keep a dedicated Markdown file in your repo linking all spec files, prompts, and explicitly stating which modules were AI-generated.

---

### The Mandatory "Sponsor-First" Stack
*   **Runtime:** Bun
*   **API:** Hono
*   **Contracts:** Solidity / Foundry
*   **Agent P2P Comm:** Gensyn AXL
*   **Execution Layer:** KeeperHub MCP -> Uniswap V3
*   **State & Memory:** 0G Storage
*   **Identity Layer:** ENS