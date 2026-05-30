# Phase 3: SQLite Storage & Code Quality - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace JSON file storage with SQLite for atomic writes, concurrent access, and full transaction audit trail. Add structured logging with severity levels replacing all console.log/emoji output. Centralize provider instances (singleton per chain) and ABI definitions. No new bot capabilities — only infrastructure improvements that are preconditions for multi-chain (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### SQLite library & storage
- **D-01:** Use `better-sqlite3` as the SQLite binding — synchronous API, fastest Node.js option, WAL mode for concurrent reads. No ORM layer needed for ~3 tables.
- **D-02:** SQLite is the sole source of truth — no in-memory cache that can diverge from disk (DB-02). The current in-memory `state` object in storage.ts is eliminated.
- **D-03:** WAL mode enabled on DB creation for concurrent read access during monitoring loops.

### Audit trail & P&L
- **D-04:** Trade events only — record buy, sell, and status changes with timestamps, prices, gas costs. No validation results or monitoring tick history. Keeps DB lean and queryable (DB-03).
- **D-05:** P&L computed on query via SQL JOIN, not stored at sell time. Raw data (buy price, sell price, gas) is the source of truth. Future-proofs for partial sells in Phase 7 (DB-04).
- **D-06:** Trades table schema: id, token, chain, action (buy/sell/fail), tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status.

### Data migration
- **D-07:** Auto-migrate `.bot-state.json` on first run — detect file, import tokens into SQLite, rename to `.bot-state.json.bak`. Zero manual effort. If SQLite DB already exists, skip migration silently.

### Structured logging
- **D-08:** JSON lines format for all log output — each line is a JSON object with level, msg, contextual fields, and timestamp. Machine-parseable, grep-friendly.
- **D-09:** Log level filtering via `LOG_LEVEL` environment variable. Levels: debug < info < warn < error. Default: info.
- **D-10:** Telegram alerts remain separate from logging — explicit `sendTelegramAlert()` calls in business logic. Error logs do NOT auto-trigger Telegram alerts. Different concerns, different channels.

### Claude's Discretion
- Specific logging library choice (pino, winston, or lightweight custom implementation)
- SQLite schema details beyond the trades table (indexes, constraints, additional tables if needed)
- Singleton provider implementation pattern (module-level cache, class, or factory function)
- ABI centralization file structure (single file vs per-contract)
- DB file location (project root vs data directory)
- Migration error handling (what happens if .bot-state.json is corrupted)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — DB-01 through DB-04 (SQLite storage), INFRA-01 through INFRA-03 (code quality)

### Current implementation (being replaced)
- `src/utils/storage.ts` — Current JSON file storage with in-memory state, synchronous writes, no concurrency control (56 lines)
- `src/utils/logger.ts` — Current 4-line logger wrapping console.log with ISO timestamp

### Provider duplication (being consolidated)
- `src/bot.ts:31` — `new ethers.JsonRpcProvider()`
- `src/alphaDrop.ts:29,36` — Two separate provider instantiations
- `src/utils/tokenSafety.ts:7,96,175,204` — Four separate provider instantiations
- `src/utils/pairDiscovery.ts:9` — Provider instantiation

### ABI duplication (being centralized)
- `src/utils/tokenSafety.ts:9,18,24,95,270` — Five inline ABI arrays (ERC20_METADATA_ABI, ROUTER_ABI, PAIR_ABI, balanceOf ABI, additional ABI)
- `src/alphaDrop.ts:28,35` — Two inline pair ABI arrays

### Prior phase context
- `.planning/phases/01-bug-fixes-hardening/01-CONTEXT.md` — Exit manager, shutdown behavior, storage patterns being replaced
- `.planning/phases/02-ethers-v6-migration/02-CONTEXT.md` — Deferred items (singleton providers, centralized ABIs, structured logging) now being addressed

### Codebase analysis
- `.planning/codebase/CONVENTIONS.md` — Naming patterns, import organization, error handling patterns to maintain
- `.planning/codebase/STRUCTURE.md` — Directory layout, where to add new code
- `.planning/codebase/CONCERNS.md` — Known issues including storage concurrency problems

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/retry.ts`: Exponential backoff retry — not directly relevant but shows utility module pattern to follow
- `src/utils/notifier.ts`: `sendTelegramAlert()` — stays as-is, separate from logging (D-10)
- `src/config.ts`: CONFIG object pattern — LOG_LEVEL and DB path should follow same env var pattern

### Established Patterns
- Config via environment variables in `src/config.ts` with dotenv — new vars (LOG_LEVEL, DB path) follow this
- Named exports for utility functions (`export function`, `export async function`)
- camelCase files in `src/utils/` directory
- No barrel files — direct imports from specific modules
- 4-space indentation, semicolons, TypeScript strict mode

### Integration Points
- `storage.ts` exports consumed by: `bot.ts` (markSniped, isAlreadySniped, updateTokenStatus, flushState, getState), `exitManager` (updateTokenStatus)
- Provider instances consumed by: every module that creates Contract instances
- ABI arrays consumed by: tokenSafety.ts (Contract creation), alphaDrop.ts (pair queries), bot.ts (router/factory contracts)
- Logger consumed by: every module (currently console.log calls throughout)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard infrastructure improvements following the decisions above.

</specifics>

<deferred>
## Deferred Ideas

- Validation result logging to DB (what checks passed/failed per token) — could be added later if pipeline tuning needs data
- Log-triggered Telegram alerts (auto-alert on error-level logs) — revisit if manual alert placement becomes burdensome
- WebSocket provider for real-time events instead of polling — Phase 4+ concern
- TypeScript strictness improvements (replacing `any` types) — nice-to-have, not scoped

</deferred>

---

*Phase: 03-sqlite-storage-code-quality*
*Context gathered: 2026-03-22*
