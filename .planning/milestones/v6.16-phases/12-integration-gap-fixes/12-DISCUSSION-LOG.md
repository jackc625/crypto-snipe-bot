# Phase 12: Integration Gap Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-04
**Phase:** 12-integration-gap-fixes
**Areas discussed:** Multi-dex price resolution, WebSocket chain status broadcast, Stale artifact cleanup, Testing strategy, Schema migration safety, WS reconnection behavior

---

## Multi-dex price resolution (INT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Add dex_name column | Schema migration v5 adds dex_name TEXT to trades table, insertTrade stores dex.name at snipe time, positions.ts matches on chain + pool_type + dex_name | ✓ |
| Try all matching quoters | positions.ts tries queryPrice with each V3 dex's quoter until one returns valid price. No schema change but doubles RPC calls | |
| Match by fee_tier heuristic | Use fee_tier to disambiguate V3 dexes. Fragile — breaks if both use same fee tiers | |

**User's choice:** Add dex_name column
**Notes:** Clean, future-proof approach. Canonical fix for DEX identity tracking.

---

### Backfill strategy

| Option | Description | Selected |
|--------|-------------|----------|
| NULL falls back to first-match | Existing trades have dex_name=NULL, positions.ts falls back to current behavior. No data backfill | ✓ |
| Backfill from factory address | Migration script queries tx_hash to determine which factory created the pair. Accurate but requires RPC calls | |

**User's choice:** NULL falls back to first-match
**Notes:** Only new trades benefit from precise matching.

---

### API surface

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, surface dex_name in API | getPnL returns dex_name alongside pool_type for display in trade history and positions | ✓ |
| No, internal only | dex_name stays internal for price resolution. API consumers don't see it | |

**User's choice:** Yes, surface dex_name in API

---

### queryPrice signature

| Option | Description | Selected |
|--------|-------------|----------|
| Keep DexConfig param | Fix is in positions.ts resolving correct DexConfig before calling queryPrice. No exitEngine changes | ✓ |
| Add dex_name lookup in queryPrice | queryPrice accepts dex_name string and resolves DexConfig internally. Adds coupling | |

**User's choice:** Keep DexConfig param

---

## WebSocket chain status broadcast (INT-03)

### Wiring approach

| Option | Description | Selected |
|--------|-------------|----------|
| Import broadcast in chains.ts | Direct import from broadcaster.ts, call after stop/start success. Simple, consistent | ✓ |
| Pass broadcast as parameter | chainRoutes() accepts broadcast callback. More testable but adds parameter threading | |
| Emit events from chains.ts | Node.js events that server.ts catches and broadcasts. Unnecessary indirection | |

**User's choice:** Import broadcast in chains.ts

---

### Broadcast payload

| Option | Description | Selected |
|--------|-------------|----------|
| Chain name + new status | Lightweight: { chain, status, warnings } | |
| Full chain list refresh | Entire GET /api/chains response. Dashboard replaces full chain state. Guarantees consistency | ✓ |
| Minimal event + client refetch | Hint event, client calls GET /api/chains. Adds round-trip | |

**User's choice:** Full chain list refresh

---

### Dashboard reaction

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-update state | WebSocketContext dispatches state update on event. ChainControls re-renders automatically | ✓ |
| Toast + auto-update | Show notification AND update state | |
| Notification only | Show notification with Refresh button | |

**User's choice:** Auto-update state

---

### Status builder

| Option | Description | Selected |
|--------|-------------|----------|
| Shared buildChainStatus helper | Extract GET / logic into shared function. DRY, broadcast matches REST response | ✓ |
| Inline in each handler | Duplicate status-building in stop/start handlers | |

**User's choice:** Shared buildChainStatus helper

---

### Event type management

| Option | Description | Selected |
|--------|-------------|----------|
| Inline strings | 'chain_status_change' as string literal. Only 2 WS event types total | ✓ |
| Shared WS event types | Enum/const object for all WS event types. Premature for 2 types | |

**User's choice:** Inline strings

---

## Stale artifact cleanup (INT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Delete + add to .gitignore | Delete all .js files from dashboard/src/, add pattern to .gitignore | ✓ |
| Delete only | Delete .js files, don't modify .gitignore | |
| Add .gitignore only | Add pattern but leave existing files | |

**User's choice:** Delete + add to .gitignore

---

### Cleanup scope

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, scan all dashboard/src/ | Check hooks, pages, types, utils too. Clean sweep | ✓ |
| Components only | Only clean dashboard/src/components/ | |

**User's choice:** Scan all dashboard/src/

---

## Testing strategy

### INT-02 test coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Unit test positions helper | Mock BSC contexts with 2 V3 dexes, verify correct selection and NULL fallback | |
| Unit + integration | Unit test helper plus integration test hitting /api/positions with seeded DB | ✓ |
| You decide | Claude picks appropriate coverage | |

**User's choice:** Unit + integration

---

### INT-03 test coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Unit test broadcast call | Verify chains.ts handlers call broadcast with correct payload | |
| Unit + WS integration | Unit test plus WS client integration test verifying event delivery | ✓ |
| You decide | Claude picks based on existing patterns | |

**User's choice:** Unit + WS integration

---

## Schema migration safety

| Option | Description | Selected |
|--------|-------------|----------|
| Standard user_version check | Check user_version < 5, ALTER TABLE, set user_version = 5 | |
| Column-existence guard | Check if column exists before ALTER TABLE, plus user_version check | ✓ |

**User's choice:** Column-existence guard

---

## WS reconnection behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Client refetches via REST | Dashboard calls GET /api/chains on reconnect. Existing behavior | ✓ |
| Server sends initial state on connect | Push chain_status_change after WS auth. Needs upgrade handler wiring | |
| You decide | Claude picks based on existing patterns | |

**User's choice:** Client refetches via REST

---

## Claude's Discretion

- Exact SQL for column-existence check in migration v5
- buildChainStatus helper structure (sync vs async, parameter shape)
- Test file organization (new files vs extending Phase 11 tests)
- Whether dex_name column needs an index
- WebSocketContext.js chain status dispatch pattern

## Deferred Ideas

None — discussion stayed within phase scope
