---
phase: 19-anti-rug-runtime-monitoring
plan: 01
subsystem: persistence
tags: [anti-rug, schema, sqlite, migration, lp-baseline, chain-state, additive]
requires:
  - "src/utils/db.ts:27 — CURRENT_SCHEMA_VERSION + migrateSchema framework (Phase 7+)"
  - "trades.id PRIMARY KEY (Phase 1+) — referenced by lp_baseline FOREIGN KEY"
  - "better-sqlite3@^12.8.0 named-bind + ON CONFLICT UPSERT semantics"
provides:
  - "lp_baseline table: per-trade LP-reserve / V3 active-liquidity snapshot at buy-success"
  - "chain_state table: per-chain last_seen_block for restart-time getLogs backfill (D-BACKFILL)"
  - "upsertLpBaseline (named-bind UPSERT) — consumed by Plan 19-03 src/anti-rug/lpBaseline.ts"
  - "getLpBaseline / deleteLpBaseline — consumed by Plan 19-04/19-05 detector + termination hook"
  - "upsertChainState / getChainState — consumed by Plan 19-04 detector resume + on-event-confirm"
affects:
  - "src/utils/db.ts — CURRENT_SCHEMA_VERSION 4→5 + new migration step + 5 prepared statements + 5 exports"
  - "data/bot.db — additive-only; existing tables (trades, exit_state, bot_state, schema_version) unchanged"
tech-stack:
  added: []  # No new packages per Phase 18 stack
  patterns:
    - "Single-table-with-pool_type-discriminator (vs separate v2/v3 tables) — matches Phase 7 exit_state CHECK discipline at db.ts:64-110"
    - "Named-bind UPSERT for multi-column inserts; positional for two-column chain_state"
    - "COLLATE NOCASE on pair_or_pool_address — same convention as trades.token"
    - "TEXT for bigint storage (reserves, liquidity, totalSupply) — same convention as trades.amount_in"
key-files:
  created:
    - "test/unit/db/lpBaselineMigration.test.ts (427 lines, 12 tests: 10 behaviors + 2 prod-module integration)"
  modified:
    - "src/utils/db.ts (+104 / -2 lines: schema v5 block + 5 prepared statements + multi-line export block)"
decisions:
  - "Single-table-with-pool_type-discriminator over separate v2/v3 tables (CONTEXT.md Claude-discretion; matches v3 exit_state CHECK pattern)"
  - "v3_position_nft_id stays NULLABLE in v6.17 (Research Open Question #3 — V3 baseline is pool-only; NFT-tracking deferred to v6.18+)"
  - "Named bind params for upsertLpBaseline (12 cols); positional for upsertChainState (3 cols) — readability over uniformity"
  - "Multi-line export block reformat over single-line append — keeps line length sane and lets future plans add per-block comments"
metrics:
  duration_minutes: ~20
  tasks_completed: 2
  files_modified: 1
  files_created: 1
  tests_added: 12
  unit_tests_total_after: 288
  commits: 2
  completed_date: "2026-05-24"
---

# Phase 19 Plan 01: Schema Migration v4→v5 (lp_baseline + chain_state) Summary

Land the additive SQLite schema migration v4→v5 that creates `lp_baseline` (per-trade LP-reserve / V3 active-liquidity snapshot recorded at buy-success) and `chain_state` (per-chain last-seen-block for restart-time `getLogs` backfill per D-BACKFILL), plus the 5 prepared statements (`upsertLpBaseline`, `getLpBaseline`, `deleteLpBaseline`, `upsertChainState`, `getChainState`) that the rest of the Phase 19 anti-rug module consumes.

## What Was Built

### Migration step (`src/utils/db.ts:122-153`)

A new `if (version < 5)` block inserted after the existing `if (version < 4)` dex_name block. Single `db.exec(...)` call wraps:

1. `CREATE TABLE IF NOT EXISTS lp_baseline` with 12 columns:
   - `trade_id INTEGER PRIMARY KEY` — one baseline per trade
   - `pool_type TEXT NOT NULL CHECK(pool_type IN ('v2', 'v3'))` — discriminator
   - `pair_or_pool_address TEXT NOT NULL COLLATE NOCASE` — case-insensitive address lookups
   - V2 nullable triplet: `v2_token0_reserve TEXT, v2_token1_reserve TEXT, v2_lp_total_supply TEXT`
   - V3 nullable quad: `v3_active_liquidity TEXT, v3_tick_at_snapshot INTEGER, v3_position_nft_id TEXT, v3_fee_tier INTEGER`
   - Common: `snapshot_block INTEGER NOT NULL, snapshot_ts INTEGER NOT NULL`
   - `FOREIGN KEY (trade_id) REFERENCES trades(id)`
2. `CREATE INDEX IF NOT EXISTS idx_lp_baseline_pool ON lp_baseline(pair_or_pool_address)` — backs the detector's pair→position dispatch table lookup (Plan 19-04).
3. `CREATE TABLE IF NOT EXISTS chain_state` with 3 columns: `chain TEXT PRIMARY KEY, last_seen_block INTEGER NOT NULL, last_updated_ts INTEGER NOT NULL`.

`CURRENT_SCHEMA_VERSION` bumped from 4 to 5. The trailing `db.pragma(\`user_version = ${CURRENT_SCHEMA_VERSION}\`)` references the constant — no inlined `5` literal.

Idempotent re-run is guaranteed by `CREATE TABLE IF NOT EXISTS` + the version-gated `if (version < 5)` block (proven by Test 3).

### Prepared statements (`src/utils/db.ts:447-499`)

All 5 declared at module level near the existing Phase 7 exit_state statements (`db.ts:394-411` is the canonical analog). Verbatim signatures:

```typescript
upsertLpBaseline = db.prepare(`
    INSERT INTO lp_baseline (
        trade_id, pool_type, pair_or_pool_address,
        v2_token0_reserve, v2_token1_reserve, v2_lp_total_supply,
        v3_active_liquidity, v3_tick_at_snapshot, v3_position_nft_id, v3_fee_tier,
        snapshot_block, snapshot_ts
    )
    VALUES (
        @tradeId, @poolType, @pairOrPoolAddress,
        @v2Token0Reserve, @v2Token1Reserve, @v2LpTotalSupply,
        @v3ActiveLiquidity, @v3TickAtSnapshot, @v3PositionNftId, @v3FeeTier,
        @snapshotBlock, @snapshotTs
    )
    ON CONFLICT(trade_id) DO UPDATE SET
        v2_token0_reserve = @v2Token0Reserve,
        v2_token1_reserve = @v2Token1Reserve,
        v2_lp_total_supply = @v2LpTotalSupply,
        v3_active_liquidity = @v3ActiveLiquidity,
        v3_tick_at_snapshot = @v3TickAtSnapshot,
        snapshot_block = @snapshotBlock,
        snapshot_ts = @snapshotTs
`);

getLpBaseline = db.prepare(`SELECT * FROM lp_baseline WHERE trade_id = ?`);

deleteLpBaseline = db.prepare(`DELETE FROM lp_baseline WHERE trade_id = ?`);

upsertChainState = db.prepare(`
    INSERT INTO chain_state (chain, last_seen_block, last_updated_ts)
    VALUES (?, ?, ?)
    ON CONFLICT(chain) DO UPDATE SET
        last_seen_block = excluded.last_seen_block,
        last_updated_ts = excluded.last_updated_ts
`);

getChainState = db.prepare(`SELECT last_seen_block, last_updated_ts FROM chain_state WHERE chain = ?`);
```

Note: `upsertLpBaseline.ON CONFLICT` refreshes only the runtime-mutable fields (reserves / liquidity / tick / snapshot block + ts). `pair_or_pool_address` and `pool_type` are immutable per row (set on first insert; not in the UPDATE clause). Rationale: a row's pool identity does not change over a trade's lifetime; if the pair changed, that's a new trade.

### Export block (`src/utils/db.ts:501-519`)

Reformatted from single-line concatenation to multi-line block for legibility, with an inline section comment marking the 5 new Phase 19 identifiers. Existing exports preserved verbatim; no removals.

### Tests (`test/unit/db/lpBaselineMigration.test.ts`)

12 tests across 5 describe blocks:

| Group | Tests | Purpose |
|-------|-------|---------|
| `production module integration` | 2 | Asserts the production `src/utils/db.ts` exports the 5 prepared statements AND that loading the module migrates the real on-disk DB to `user_version=5`. These are the contract tests — they fail until production is wired. |
| `migration mechanics` | Tests 1–3 | user_version=5 post-migration; both tables visible in sqlite_master; idempotent on re-run. |
| `lp_baseline V2 + V3 round-trip` | Tests 4–7, 9 | V2 row stores reserves with V3 fields NULL; V3 row stores liquidity+tick+fee with V2 fields NULL; CHECK constraint rejects `pool_type='v4'`; FOREIGN KEY rejects non-existent trade_id when foreign_keys=ON; idx_lp_baseline_pool index visible. |
| `chain_state ON CONFLICT upsert` | Test 8 | First `INSERT` writes a row; second `INSERT` on same `chain` overwrites both fields via ON CONFLICT DO UPDATE; exactly one row remains. |
| `migration chain v3→v5` | Test 10 | Constructs a v3-shaped DB (manual v1+v2+v3 + `user_version=3`), runs migration, asserts BOTH v4 (dex_name column) AND v5 (lp_baseline + chain_state) applied. |

Each test constructs a fresh `Database(':memory:')` — no cross-test contamination. Helper functions `applyV1Migration`, `applyV2Migration`, `applyV3Migration`, `runFullMigration` mirror the production migration shape at `src/utils/db.ts:29-156` so reviewers can read both side-by-side.

## TDD Cycle

Per the plan's `tdd="true"` directive, both tasks followed the RED→GREEN cycle:

1. **RED** (commit `6091100`): Wrote the 12-test file. Production tests failed with `expected undefined to be defined` (upsertLpBaseline not exported) and `expected 4 to be 5` (CURRENT_SCHEMA_VERSION still 4). In-memory replica tests passed because the helper already encoded the v5 contract.
2. **GREEN** (commit `522ae08`): Bumped CURRENT_SCHEMA_VERSION, added the migration block, declared the 5 prepared statements, appended the 5 exports. All 12 tests pass; production module logs `Created lp_baseline + chain_state tables (schema version 5)` on first load (visible in test output stdout).

No REFACTOR commit was needed — the implementation is straight-line and matches the plan's verbatim shape.

## Decisions Made

### 1. Single-table-with-`pool_type`-discriminator over separate v2/v3 tables

Per CONTEXT.md Claude's-discretion + 19-RESEARCH.md §1.3 (Research Open Question #1). Chose single-table because:

- Matches the existing v3 migration's CHECK-constraint pattern at `db.ts:64-110` (`action IN ('buy','sell','partial_sell','fail')`, `pool_type IN ('v2','v3')`)
- One INSERT statement / one prepared statement / one export — half the surface area of two-table option
- `trade_id PRIMARY KEY` guarantees one row per trade either way; the discriminator scales linearly with future pool types if needed
- Trade-off: NULLs on the opposite-type columns. Storage cost is negligible (~80 bytes per row × ~10 concurrent positions max per D-TERMINATION = under 1 KB on disk).

Rejected alternatives:
- **Two tables (`lp_baseline_v2` / `lp_baseline_v3`)** — doubles the prepared-statement count + forces every consumer (Plan 19-03, 19-04, 19-05) to branch on pool_type before choosing the statement.
- **Polymorphic JSON column** — opaque to SQLite; can't index by reserve values if we ever need that.

### 2. `v3_position_nft_id` stays NULLABLE; not populated in v6.17

Per CONTEXT.md Claude's-discretion + 19-RESEARCH.md Open Question #3. V3 baseline in v6.17 is pool-only — the detector subscribes to `UniswapV3Pool.Burn/Collect` events, NOT to the `NonfungiblePositionManager` Transfer events. The NFT-id field stays in the schema as future-proofing for v6.18+ NFT-tracking expansion but receives NULL on every v6.17 insert.

This is a deliberate forward-compatibility hook — same shape as `dex_name TEXT DEFAULT NULL` added in v4 (which started NULL and was populated only after Phase 12).

### 3. Named-bind for upsertLpBaseline; positional for upsertChainState

`upsertLpBaseline` has 12 bind parameters across two clause groups (VALUES + ON CONFLICT UPDATE) where 6 of the 12 appear in both groups. Named binds (`@tradeId`) deduplicate the wire-up at the call site and make the SQL self-documenting.

`upsertChainState` has 3 columns total with a trivial 1:1 mapping. Positional binds (`?, ?, ?`) are the shorter, idiomatic form for this case — matches the existing `isTokenSniped`, `updateTradeStatus` positional convention at `db.ts:215-217, 232-234`.

### 4. Multi-line export block over single-line append

The existing export was a single ~250-char line. Adding 5 more identifiers would push it past 350 chars. Reformatted to one identifier per line with an inline `// Phase 19 / ANTIRUG-04 / ANTIRUG-16` section comment so future plans (19-03, 19-04, 19-05) have a clear insertion point and the diff stays clean.

This is purely cosmetic — no semantic change. Existing identifiers preserved verbatim in their original order.

## Deviations from Plan

None. The plan was executed exactly as written. All 10 enumerated behaviors became `it(...)` blocks. The implementation matches the verbatim shape from 19-PATTERNS.md §"`src/utils/db.ts`" (lines 749-826). No auto-fixes (Rules 1-3) applied; no architectural questions (Rule 4) raised.

Two minor refinements (still inside the plan's spec):

1. The two production-module integration tests (Tests A and B in the test file) were ADDED beyond the 10 behaviors listed in Task 1. Rationale: the 10 behaviors all use the in-memory `runFullMigration` helper and prove the contract in isolation. Without the production-module tests, the contract could be satisfied by the helper alone while production was broken — i.e., "testing the map, not the territory" (Phase 15 REVIEWS.md HIGH #2). The 2 production tests close that gap by importing the real `src/utils/db.ts` and asserting (a) the 5 prepared statements are exported and (b) the live on-disk DB reaches `user_version=5`. This is consistent with the Phase 15 `makeIsTokenSnipedStmt` factory pattern.
2. The export block was reformatted from single-line to multi-line. Plan said "Append all five identifiers to the existing module `export { ... }` block" — the append is verbatim; the reformatting is a soft cosmetic adjustment that preserves all existing identifiers in order.

## Test Edge Cases Surfaced

- **Foreign-key enforcement is per-connection in SQLite**, not per-database. Tests 7 required an explicit `db.pragma('foreign_keys = ON')` before the violation INSERT. The production bot does NOT currently enable foreign_keys (the existing `exit_state` FK at `db.ts:76` is similarly unenforced at runtime). This is consistent with the existing pattern; if Plan 19-03+ wants real FK enforcement, that's a separate cross-cutting choice (out of scope for 19-01).
- **`createTestDb()` helper at `test/helpers/testDb.ts` is NOT updated to v5**. The helper builds its own schema and explicitly sets `user_version=4`. The pre-existing `db.test.ts` test "Schema v4: user_version pragma returns 4" still passes because the helper is isolated. **Deferred to future plans (19-03+)** that consume `createTestDb()` and need lp_baseline / chain_state tables in their fixtures. Not in scope for 19-01 per the plan's "Do NOT modify any existing prepared statement" guard interpreted strictly.

## Files Touched

| File | Action | Lines | Commit |
|------|--------|-------|--------|
| `test/unit/db/lpBaselineMigration.test.ts` | created | +427 | `6091100` |
| `src/utils/db.ts` | modified | +104 / -2 | `522ae08` |

## Verification

| Check | Result |
|-------|--------|
| `npm run test:unit -- db/lpBaselineMigration` | 12/12 passing |
| `npm run test:unit` (full unit suite) | 288/288 passing — no regressions |
| `npx tsc --noEmit` (main tsconfig) | clean |
| `npx tsc --noEmit -p tsconfig.bot.json` | clean |
| `cd dashboard && npx tsc --noEmit` | clean |
| `git diff src/utils/db.ts` | only the 6 specified additive changes; no edits to trades / exit_state / bot_state / schema_version |
| Production DB migrated in-place | `data/bot.db` schema upgraded from v4→v5 on first module load; log line emitted |

## Downstream Hand-off

This plan unblocks:

- **Plan 19-03** (`src/anti-rug/lpBaseline.ts`) — imports `upsertLpBaseline, getLpBaseline, deleteLpBaseline` from `src/utils/db.ts`. `snapshotLpBaseline(ctx, dex, tradeId, ...)` calls `upsertLpBaseline.run({...})` at buy-success.
- **Plan 19-04a/b/c** (`src/anti-rug/detector.ts`) — imports `upsertChainState, getChainState` for backfill bookkeeping. `getChainState.get(chainName)` resolves `lastSeenBlock` at startup → `getLogs(lastSeenBlock+1, currentBlock)` chunked backfill loop per D-BACKFILL.
- **Plan 19-05** (cleanup hook on `amount_remaining=0`) — calls `deleteLpBaseline.run(tradeId)` when a position fully closes per D-TERMINATION.

No `lp_baseline` row should ever exist for a `trades.status='sold'` trade after Plan 19-05 lands; until then, the lifecycle is "create at buy → never delete" which is acceptable for v6.17 because bot has zero open positions at ship time and the row count is bounded by concurrent open positions (max ~10s).

## Self-Check: PASSED

- File `test/unit/db/lpBaselineMigration.test.ts` — **FOUND**
- File `src/utils/db.ts` (modified) — **FOUND** (CURRENT_SCHEMA_VERSION=5; lp_baseline + chain_state migration block; 5 prepared statements; 5 exports)
- Commit `6091100` (test RED) — **FOUND**
- Commit `522ae08` (feat GREEN) — **FOUND**
- 12/12 test passing — **VERIFIED** via `npm run test:unit -- db/lpBaselineMigration`
- 288/288 full unit suite passing — **VERIFIED**
- TypeScript clean across all 3 tsconfig projects — **VERIFIED**
