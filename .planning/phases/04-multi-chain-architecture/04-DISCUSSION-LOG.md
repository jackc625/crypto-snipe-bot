# Phase 4: Multi-Chain Architecture - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-22
**Phase:** 04-multi-chain-architecture
**Areas discussed:** Chain config model, MEV protection, Capital allocation, Listener architecture

---

## Chain Config Model

### How should per-chain settings be organized?

| Option | Description | Selected |
|--------|-------------|----------|
| Chain registry object | Single chainRegistry in config.ts mapping chainId to {rpc, contracts, gas, dex[], mev}. Mirrors existing rpc map pattern | ✓ |
| Per-chain JSON files | Separate files like chains/ethereum.json, chains/bsc.json. Each file self-contained | |
| Env-driven chain list | Hardcoded contracts in config with ENABLED_CHAINS env var filter. Simplest approach | |

**User's choice:** Chain registry object
**Notes:** Recommended because it's a natural evolution of existing `rpc` map and `provider.ts` singleton. Right complexity for 4 chains.

### How should chains be enabled/disabled?

| Option | Description | Selected |
|--------|-------------|----------|
| Env var list | ENABLED_CHAINS=ethereum,bsc env var. Only listed chains get listeners | ✓ |
| Per-chain env flag | ETH_ENABLED=true, BSC_ENABLED=false. Each chain has own toggle | |
| RPC presence implies enabled | If ETH_RPC_URL is set, ETH is enabled. Zero extra env vars | |

**User's choice:** Env var list
**Notes:** None

### Should each chain support multiple DEX factories?

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-DEX per chain | dexes[] array with factory/router pairs per chain | ✓ |
| One DEX per chain | Exactly one factory + router per chain | |

**User's choice:** Multi-DEX per chain
**Notes:** None

### WebSocket or HTTP polling for events?

| Option | Description | Selected |
|--------|-------------|----------|
| WebSocket primary | WebSocketProvider for instant event detection. HTTP fallback | ✓ |
| HTTP polling only | Keep current JsonRpcProvider polling. Simpler, slightly slower | |

**User's choice:** WebSocket primary
**Notes:** Was deferred from Phase 2/3. Now implemented as primary transport.

---

## MEV Protection

### How should MEV protection work on non-ETH chains?

| Option | Description | Selected |
|--------|-------------|----------|
| Private RPC per chain | Each chain config specifies private/protected RPC endpoint. Simplest | |
| Chain-specific MEV services | Integrate each chain's native SDK: Flashbots (ETH), bloXroute (BSC), Flashbots Protect (Base), sequencer (Arb) | ✓ |
| Flashbots only + skip others | Only Flashbots on ETH. Other chains send via public RPC. Accept MEV risk | |

**User's choice:** Chain-specific MEV services
**Notes:** User requested detailed explanation of all options. Chose Option 2 for best-in-class protection per chain despite more integration work.

### Fallback when MEV service is unavailable?

| Option | Description | Selected |
|--------|-------------|----------|
| Fall back to public RPC | Send via standard RPC, accept MEV risk rather than miss opportunity | |
| Skip the snipe | Reject snipe entirely if MEV unavailable. Never trade unprotected | ✓ |
| Configurable per chain | Per-chain fallbackBehavior setting | |

**User's choice:** Skip the snipe
**Notes:** None

### MEV service health checking?

| Option | Description | Selected |
|--------|-------------|----------|
| Startup health check | Verify MEV services on boot, warn if unreachable, periodic re-check | ✓ |
| Fail at trade time | No startup check, discover failures when snipe opportunity arrives | |
| Startup check + block chain | Disable chain entirely if MEV unreachable at startup | |

**User's choice:** Startup health check
**Notes:** None

---

## Capital Allocation

### How should funds be distributed across chains?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed budget per chain | Per-chain max capital via env vars. Simple, predictable, independent | ✓ |
| Shared pool with weights | Total portfolio budget with configurable per-chain weights | |
| Opportunity-driven dynamic | No fixed budgets, capital flows to highest-scoring opportunities | |

**User's choice:** Fixed budget per chain
**Notes:** User requested detailed explanation of all options. Chose fixed budgets as pragmatic v1 approach. Dynamic allocation deferred.

### Per-chain or global snipe amount?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-chain snipe amount | Each chain has own snipe amount in native currency | ✓ |
| Global snipe amount | One snipeAmountETH used everywhere | |

**User's choice:** Per-chain snipe amount
**Notes:** Different chains have different gas costs and token economics.

---

## Listener Architecture

### How should concurrent chain listeners be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Async per-chain loops | All listeners in one Node.js process, concurrent via async event handlers | ✓ |
| Worker threads per chain | Each chain in its own worker thread. Better isolation, complex IPC | |
| Separate processes | Each chain as separate OS process. Maximum isolation, most operational overhead | |

**User's choice:** Async per-chain loops
**Notes:** User requested detailed explanation of all options. Chose single-process async model because Node.js event loop handles concurrent I/O naturally and shared state (SQLite, logger, notifier) is simpler.

### WebSocket reconnect behavior?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-reconnect with backoff | Exponential backoff (1s to 60s cap). Uses existing retry.ts pattern | ✓ |
| Fixed interval retry | Retry every 10s. Simpler but can hammer endpoints | |
| Disable chain after N failures | Stop chain after 5 consecutive failures. Requires manual restart | |

**User's choice:** Auto-reconnect with backoff
**Notes:** None

### How should Telegram notifications identify chains?

| Option | Description | Selected |
|--------|-------------|----------|
| Chain prefix in message | Prepend [ETH], [BSC], etc. to every alert | ✓ |
| Separate Telegram chats per chain | Each chain sends to its own chat/channel | |

**User's choice:** Chain prefix in message
**Notes:** None

### Should token safety pipeline be chain-aware?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-chain API routing | Chain config maps safety checks to API providers. honeypot.is for ETH, Go+ for BSC | ✓ |
| Universal checks only | Only run checks that work across all chains | |
| You decide | Claude's discretion | |

**User's choice:** Per-chain API routing
**Notes:** None

---

## Claude's Discretion

- Exact ChainConfig TypeScript interface structure and field names
- WebSocket reconnect implementation details
- bloXroute SDK integration specifics
- How to refactor bot.ts to accept chain context
- Safety API adapter pattern
- Boot sequence ordering
- How to handle existing addresses.json

## Deferred Ideas

- Dynamic capital allocation based on opportunity quality -- future enhancement
- Cross-chain position correlation -- v2 requirement ARISK-02
- Separate Telegram chats per chain -- revisit if volume overwhelming
- Automatic WS to HTTP failover -- deferred if complex
