# Phase 17: Tech Debt Cleanup & Audit Baseline - Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 13 (5 modified + 8 created/augmented)
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/utils/db.ts` (line 215 delete) | model/storage | CRUD | n/a (single-line dead-code delete) | exact (already verified zero callers) |
| `.github/workflows/test.yml` (append guards) | config (CI) | batch | `.github/workflows/test.yml` (existing `test` job) | exact (smallest-diff append) |
| `.planning/milestones/v6.17-debt-baseline.md` (NEW) | doc/audit-artifact | batch | `.planning/milestones/v6.16-MILESTONE-AUDIT.md` | role-match (audit ledger sibling) |
| `.planning/phases/02-ethers-v6-migration/02-VALIDATION.md` (augment) | doc/validation | n/a | existing `02-VALIDATION.md` (own structure) | exact (in-place inline section) |
| `.planning/phases/09-testing-infrastructure/09-VALIDATION.md` (augment) | doc/validation | n/a | existing `09-VALIDATION.md` (own structure) | exact (in-place inline section) |
| Phase 1 FIX-01 harm-test (NEW describe block in `test/integration/exitMonitor.test.ts`) | test (integration) | request-response | `test/integration/exitMonitor.test.ts` Describe 1 (Sell lock mutex), Describe 3 (connection failure) | exact (file already exists, add describe block) |
| Phase 3 SQLite atomicity harm-test (NEW or new describe in `test/unit/db.test.ts`) | test (unit) | CRUD | `test/unit/db.test.ts` Describe `transactions` (lines 27-65) | exact (DB-touching unit) |
| Phase 5 V3-02 liquidity-wait harm-test (NEW in `test/integration/`) | test (integration) | event-driven | `test/integration/exitMonitor.test.ts` Describe 3 + `test/integration/wsReconnect.test.ts` (mock provider WS pattern) | role-match (no existing fork test for V3-02) |
| Phase 6 RISK daily-loss harm-test (NEW describe in `test/unit/riskManager.test.ts`) | test (unit) | request-response | `test/unit/riskManager.test.ts` (existing `daily_loss_limit` it at line 78) | exact (file exists, augment) |
| Phase 7 EXIT-01 stop-loss → executeFullSell harm-test (NEW describe in `test/unit/exitEngineSell.test.ts`) | test (unit) | event-driven | `test/unit/exitEngineSell.test.ts` Describe `executeFullSell — receipt decoding integration` (lines 136-204) | exact (mock pattern matches exactly) |
| Phase 8 DASH/MON health version harm-test (NEW it in `test/integration/api/health.test.ts`) | test (integration) | request-response | `test/integration/api/health.test.ts` it `returns 200 with status ok…` (lines 57-72) — already asserts `body.version` toMatch | exact (already asserts version, just relabel under harm-prevention describe block) |
| Phase 10 partial-sell amount_out harm-test (NEW describe in `test/unit/exitEngineSell.test.ts`) | test (unit) | event-driven | `test/unit/exitEngineSell.test.ts` Describe `executePartialSell — receipt decoding integration` (line 206 onward) | exact (mock pattern matches exactly) |
| `src/telegramListener.ts` lines 55,61 (verify-only at execution time) | source/runtime | n/a | n/a (pre-scout already verified clean) | exact (no edit; record verification result) |

## Pattern Assignments

### `src/utils/db.ts` (model, CRUD — DELETE-ONLY edit at line 215)

**Analog:** N/A (isolated dead-code deletion; verified zero callers per CONTEXT.md `<code_context>` line 273-275 and v6.16-MILESTONE-AUDIT.md line 169)

**Action:** Delete the 3-line `getTradesByToken` `db.prepare(...)` const declaration at lines 215-217. No other plumbing — the export statement no longer references it (Phase 16 already removed the export per v6.16-MILESTONE-AUDIT.md).

**Excerpt of the lines to delete** (`src/utils/db.ts:215-217`):
```typescript
const getTradesByToken = db.prepare(`
    SELECT * FROM trades WHERE token = ? AND chain = ? ORDER BY timestamp ASC
`);
```

**Surrounding context preserved** (lines 210-213, 219-221 must remain intact):
```typescript
const insertTrade = db.prepare(`
    INSERT INTO trades (token, chain, action, tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status, pool_type, fee_tier, dex_name)
    VALUES (@token, @chain, @action, @txHash, @block, @timestamp, @amountIn, @amountOut, @gasCost, @priceAtAction, @status, @poolType, @feeTier, @dexName)
`);

const updateTradeStatus = db.prepare(`
    UPDATE trades SET status = ? WHERE token = ? AND chain = ? AND status = 'pending'
`);
```

**Verification at execution time:** `grep -n getTradesByToken src/utils/db.ts dashboard/src test/` should return 0 hits after the delete (confirms no caller plumbing).

---

### `.github/workflows/test.yml` (config/CI, batch — APPEND guards to existing `test` job)

**Analog:** `.github/workflows/test.yml` itself — the file currently contains a single `test` job with 5 steps (lines 8-19). Smallest-diff path per D-10 is to append two new `run` steps to this same job.

**Existing `test` job shape** (`.github/workflows/test.yml:8-19`):
```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci --legacy-peer-deps
      - run: npm run test:unit
      - run: npm run test:integration
```

**Append-point pattern** (after the `test:integration` step, two new `run` steps):

1. **`.todo` ban guard** (D-08 #1, D-09 strict ban — fail closed on ANY match):
```yaml
      - name: Ban .todo test stubs
        run: |
          # D-09: Strict ban (NOT allowlist-with-reason). Use it.skip('reason: ...') instead.
          if find test/ -name '*.todo*' -print | grep -q .; then
            echo "ERROR: .todo file(s) found in test/"
            find test/ -name '*.todo*' -print
            exit 1
          fi
          if grep -rEn '\.todo\s*\(|it\.todo\s*\(|test\.todo\s*\(|describe\.todo\s*\(' test/; then
            echo "ERROR: .todo() invocation(s) found in test/"
            exit 1
          fi
```

2. **`tsc --noEmit` × 3 tsconfig variants** (D-08 #2 — fail closed on ANY error; all three configs must exit clean):
```yaml
      - name: TypeScript check (root tsconfig.json)
        run: npx tsc --noEmit -p tsconfig.json
      - name: TypeScript check (tsconfig.bot.json)
        run: npx tsc --noEmit -p tsconfig.bot.json
      - name: TypeScript check (dashboard/tsconfig.json)
        run: npx tsc --noEmit -p dashboard/tsconfig.json
```

**Pattern conventions to copy** from the existing job:
- `runs-on: ubuntu-latest` — same runner
- Step using `npm` / `npx` directly without `bash -c` wrapper (matches existing `npm ci --legacy-peer-deps` + `npm run test:unit` style on lines 17-19)
- No additional `actions/checkout` — checkout is shared across steps in the same job
- Fail-closed via `exit 1` (consistent with `require: true` env-var convention from CONTEXT.md `<code_context>` line 256-258)

**Three tsconfig paths confirmed via filesystem scan:**
- `C:/Users/jackc/WebstormProjects/crypto-snipe-bot/tsconfig.json` (root)
- `C:/Users/jackc/WebstormProjects/crypto-snipe-bot/tsconfig.bot.json` (bot-only)
- `C:/Users/jackc/WebstormProjects/crypto-snipe-bot/dashboard/tsconfig.json` (dashboard frontend)

---

### `.planning/milestones/v6.17-debt-baseline.md` (NEW — doc/audit-artifact, batch)

**Analog:** `.planning/milestones/v6.16-MILESTONE-AUDIT.md` (sibling audit ledger; the doc Phase 17 closes out per CONTEXT.md `<canonical_refs>` line 168-172)

**Frontmatter pattern** (`.planning/milestones/v6.16-MILESTONE-AUDIT.md:1-43`):
```yaml
---
milestone: v6.16
audited: 2026-04-14T00:00:00Z
status: tech_debt
scores:
  requirements: 48/48
  phases: 16/16
  integration: 47/47
  flows: 5/5
gaps:
  requirements: []
  integration: []
  flows: []
tech_debt:
  - phase: 01-bug-fixes-hardening
    items:
      - "Diagnostic console.log in telegramListener.ts (lines 55, 61) marked for removal"
      - "releaseSellLock exported but never called (safe due to clearAllTimersForToken)"
  - phase: 03-sqlite-storage-code-quality
    items:
      - "..."
nyquist:
  compliant_phases: ["04", "11", "12", "13", "14", "15", "16"]
  partial_phases: ["01", "02", "03", "05", "06", "07", "08", "09", "10"]
  missing_phases: []
  overall: "PARTIAL - 7/16 compliant, 9/16 partial"
---
```

**Body conventions to mirror:**
- Top H1 with milestone label (`# Milestone v6.16 Audit Report`)
- Tabular per-phase status (`| Phase | Status | Score | Key Notes |`)
- Numbered tech-debt summary per phase
- Closing horizontal rule + `_Audited: ..._` / `_Auditor: ..._` footer

**Adapt for v6.17 baseline:**
- Filename: `v6.17-debt-baseline.md` (matches sibling-naming convention per CONTEXT.md `<code_context>` line 278-281: same dir as planned `v6.17-honeypot-checker-audit.md`/`v6.17-safety-bank-audit.md`)
- Frontmatter `milestone: v6.17`, `status: baseline` (or `tech_debt` if non-zero), `scoped: 2026-04-29` (the wave-0 execution date)
- Body sections (planner discretion per `<decisions>` D-Claude's-Discretion line 134-139):
  - **Wave 0 CI command outputs** (verbatim, with date stamp)
  - **Per-claim verify-then-act ledger** (one row per `tech_debt:` item from v6.16-MILESTONE-AUDIT.md lines 14-37) with verification command, output, and disposition (`verified-resolved` / `acted-on` / `still-valid`)
  - **DEBT-03/04 conditional close-out** (if 0/0 confirmed: close as "verified-empty"; otherwise enumerate remaining work)
  - **`tsc --noEmit` × 3 tsconfig output**

**Tabular preferred for audit-friendliness** per Claude's Discretion line 136 — narrative reserved for context where the table can't carry it.

---

### `.planning/phases/02-ethers-v6-migration/02-VALIDATION.md` (doc/validation — INLINE augmentation)

**Analog:** the existing `02-VALIDATION.md` itself (target file structure must be respected — D-02 INLINE means in-place section append, NOT a rewrite).

**Existing structure to preserve** (`.planning/phases/02-ethers-v6-migration/02-VALIDATION.md`):
1. Frontmatter block (lines 1-8) — preserved as-is
2. `# Phase 2 — Validation Strategy` H1 (line 10)
3. Section H2s in order: Test Infrastructure, Sampling Rate, Per-Task Verification Map, Wave 0 Requirements, Manual-Only Verifications, Validation Sign-Off, Validation Audit 2026-04-13

**Insertion point:** Append a NEW H2 section after `## Validation Audit 2026-04-13` (line 77+) titled (planner-discretion-named, e.g.) `## Harm-Prevention Assertion (Phase 17 / DEBT-05)`.

**Section content shape** (D-02 — pure type-system property, document inline):
- Harm scenario: "Did the migration preserve correct numerical behavior in the BigInt arithmetic paths the v5 codebase used?"
- Pointer to existing tests: `test/unit/ethersV6BigIntArithmetic.test.ts` (9 tests), `test/unit/ethersV5PatternsAbsent.test.ts` (12 tests, ban regex enforces zero v5 surface), `test/unit/ethersV6ToolboxConfig.test.ts` (7 tests)
- Pointer to tsc-clean baseline: `v6.17-debt-baseline.md` `tsc --noEmit -p tsconfig.bot.json` exit 0
- Frontmatter delta: `nyquist_compliant: true` already set; add `harm_prevention: inline` field for planner discretion

**Pattern reference for the existing test files** (already cataloged in 02-VALIDATION.md line 87-92, lines 39-46):
| Test file | Tests | Purpose |
|-----------|-------|---------|
| `test/unit/ethersV5PatternsAbsent.test.ts` | 12 | structural ban regex `/@ethersproject\//`, `/BigNumber/`, `/.callStatic./`, etc. |
| `test/unit/ethersV6BigIntArithmetic.test.ts` | 9 | static + runtime |
| `test/unit/ethersV6ToolboxConfig.test.ts` | 7 | static analysis |

---

### `.planning/phases/09-testing-infrastructure/09-VALIDATION.md` (doc/validation — INLINE augmentation)

**Analog:** the existing `09-VALIDATION.md` itself (preserves structure per D-02).

**Existing structure to preserve** (`.planning/phases/09-testing-infrastructure/09-VALIDATION.md`):
1. Frontmatter (lines 1-9)
2. H2s in order: Test Infrastructure, Sampling Rate, Per-Task Verification Map, Wave 0 Requirements, Manual-Only Verifications, Validation Sign-Off, Validation Audit 2026-04-13

**Insertion point:** Append a NEW H2 section after `## Validation Audit 2026-04-13` (line 86+) titled (planner-discretion-named) `## Harm-Prevention Assertion (Phase 17 / DEBT-05)`.

**Section content shape** (D-02 — meta phase, document inline):
- Harm scenario: "Does CI actually fail when a test fails (i.e., the testing infrastructure itself is honest)?"
- Pointer to CI exit-non-zero behavior: `.github/workflows/test.yml` `npm run test:unit` returns the vitest exit code; failing test = non-zero = blocked merge (cite the new `.todo` and `tsc` guards as additional invariant locks)
- Pointer to pre-existing 343/343 green: `09-VALIDATION.md` line 94 `351 automated tests + 7 manual fork tests`
- Cross-reference to v6.17 baseline doc `v6.17-debt-baseline.md`

---

### Phase 1 FIX-01 harm-prevention test (NEW describe block in `test/integration/exitMonitor.test.ts`)

**Analog:** `test/integration/exitMonitor.test.ts` Describe 1 (`Sell lock mutex`, lines 11-139) and Describe 3 (`Connection failure in exit monitor`, lines 374-618). The harm scenario for FIX-01 is the exit-monitor sell-lock race — file already exists with the established `vi.doMock` + `importExitManager()` pattern.

**FIX-04 EXCLUSION** (per D-02 line 54-56): Phase 1's harm-prevention test EXCLUDES FIX-04 (V2 sell-sim) — addressed via fresh implementation in HONEY-07; validated at fresh-implementation time.

**Imports/mock pattern** (`test/integration/exitMonitor.test.ts:1-29`):
```typescript
// test/integration/exitMonitor.test.ts
// Integration tests for exit monitor sell lock mutex (TEST-04),
// exit trigger correctness at price thresholds (TEST-04),
// and connection failure resilience (D-20 category 4).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Sell lock mutex (exitManager)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function importExitManager() {
        vi.doMock('../../src/utils/logger', () => ({
            logger: {
                child: () => ({
                    info: vi.fn(), warn: vi.fn(), debug: vi.fn(),
                    error: vi.fn(), fatal: vi.fn(),
                }),
            },
        }));
        vi.doMock('../../src/utils/db', () => ({
            closeDb: vi.fn(),
        }));
        return await import('../../src/utils/exitManager');
    }
```

**Existing race-condition harm scenario assertion** (`test/integration/exitMonitor.test.ts:118-138`, the closest analog to FIX-01's exit-monitor race):
```typescript
    it('concurrent sell prevention: lock -> reject -> release -> re-acquire', async () => {
        const em = await importExitManager();
        em.clearAllTimers();

        // Thread A acquires lock
        const threadAResult = em.tryAcquireSellLock('eth', '0xToken');
        expect(threadAResult).toBe(true);

        // Thread B tries to acquire -- rejected
        const threadBResult = em.tryAcquireSellLock('eth', '0xToken');
        expect(threadBResult).toBe(false);

        // Thread A completes sell and releases lock
        em.releaseSellLock('eth', '0xToken');

        // Thread B retries -- succeeds
        const threadBRetry = em.tryAcquireSellLock('eth', '0xToken');
        expect(threadBRetry).toBe(true);

        em.releaseSellLock('eth', '0xToken');
    });
```

**Describe block convention** (D-03 prefix `Phase N harm-prevention:`):
```typescript
describe('Phase 1 harm-prevention: FIX-01 exit-monitor race (sell-lock cannot be double-acquired)', () => {
    // observable-effect rigor (D-04): assert tryAcquireSellLock returns false
    // when a sibling timer would have raced into a second sell tx pre-FIX-01
});
```

**D-04 observable effect to assert:** `expect(em.tryAcquireSellLock(chain, token)).toBe(false)` after a sibling acquisition + verify the underlying sell would not have submitted a transaction (mock `sendTxWithRetry` and assert `not.toHaveBeenCalled()`).

---

### Phase 3 SQLite atomicity / WAL property harm-test (NEW describe block in `test/unit/db.test.ts`)

**Analog:** `test/unit/db.test.ts` Describe `transactions` (lines 27-65) — the existing rollback-on-CHECK-violation test is the structural template.

**Imports/setup** (`test/unit/db.test.ts:1-7`):
```typescript
// test/unit/db.test.ts
// Unit tests for SQLite storage layer (TEST-02).
// Uses in-memory SQLite via createTestDb() for isolation -- zero disk I/O.

import { describe, it, expect } from 'vitest';
import { createTestDb } from '../helpers/testDb';
import { normalizeLegacyMainnetRows, makeIsTokenSnipedStmt } from '../../src/utils/db';
```

**Atomic rollback pattern** (`test/unit/db.test.ts:45-64`):
```typescript
        it('transaction with CHECK constraint violation rolls back entirely', () => {
            const db = createTestDb();
            const insertValid = db.prepare(
                `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'buy', 'pending', '0.01')`
            );
            const insertInvalid = db.prepare(
                `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'INVALID_ACTION', 'pending', '0.01')`
            );

            const insertBoth = db.transaction(() => {
                insertValid.run('0xtokenA');
                insertInvalid.run('0xtokenB'); // Should fail CHECK constraint
            });

            expect(() => insertBoth()).toThrow();

            const count = db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number };
            expect(count.c).toBe(0); // Rolled back
            db.close();
        });
```

**WAL pragma assertion pattern** (`test/unit/db.test.ts:67-74`):
```typescript
    describe('pragmas', () => {
        it('WAL mode: in-memory DB returns journal_mode=memory', () => {
            const db = createTestDb();
            const result = db.pragma('journal_mode', { simple: true });
            // In-memory SQLite uses 'memory' even when WAL is requested (D-09 from STATE)
            expect(result).toBe('memory');
            db.close();
        });
```

**Test infrastructure** (`test/helpers/testDb.ts:19-72`):
```typescript
export function createTestDb(): Database.Database {
    const db = new Database(':memory:');

    // Match production pragmas (WAL is issued for parity but :memory: uses journal_mode=memory)
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');

    // Create trades table (schema version 3 — includes pool_type, fee_tier, partial_sell action)
    // ...
    db.pragma('user_version = 4');
    return db;
}
```

**Describe block convention:**
```typescript
describe('Phase 3 harm-prevention: SQLite atomicity (transaction violation does not leave partial rows)', () => {
    it('transaction failure rolls back all rows in the same transaction', () => { ... });
});
```

**D-04 observable effect to assert:** post-failure `SELECT COUNT(*) FROM trades` returns 0 (or the pre-transaction count) — proves no partial write survived. Use `createTestDb()` from `test/helpers/testDb.ts` for isolation.

---

### Phase 5 V3-02 liquidity-wait harm-test (NEW in `test/integration/`)

**Analog:** Two combined patterns:
1. `test/integration/exitMonitor.test.ts` Describe 3 (`Connection failure`, lines 374-618) — for event-handler mocking with `vi.doMock` + log assertions
2. `test/integration/wsReconnect.test.ts` (lines 17-72) — for `MockWebSocketProvider` event subscription pattern

**Production code under harm scenario** (`src/bot.ts:379-391`):
```typescript
    // V3-02: Wait for liquidity (D-01 subscribe+timeout, D-02 same-block check)
    if (!awaited) {
        ctx.log.info({ token: targetToken, pool: poolAddress }, 'No Mint event within timeout, dropping V3 opportunity');
        await sendCtxAlert(ctx, `*V3 pool no liquidity (30s timeout)* \`${targetToken}\``);
        return;
    }
    // D-03: Minimum liquidity threshold check
    if (!hasLiquidity) {
        ctx.log.info({ token: targetToken, feeTier }, 'V3 pool below min liquidity threshold, skipping');
        await sendCtxAlert(ctx, `*V3 pool below min liquidity* \`${targetToken}\``);
        return;
    }
```

**Mocking pattern from exitMonitor connection failure** (`test/integration/exitMonitor.test.ts:417-422`):
```typescript
        vi.doMock('../../src/utils/exitManager', () => ({
            tryAcquireSellLock: vi.fn(),
            releaseSellLock: vi.fn(),
            registerExitMonitor: vi.fn(),
            clearAllTimersForToken: vi.fn(),
            clearAllTimers: vi.fn(),
        }));
```

**MockWebSocketProvider event-subscription pattern** (`test/integration/wsReconnect.test.ts:50-67`):
```typescript
                    WebSocketProvider: class MockWebSocketProvider {
                        url: string;
                        chainId: number | undefined;
                        destroyed = false;
                        constructor(url: string, chainId?: number) {
                            this.url = url;
                            this.chainId = chainId;
                            mockWsInstances.push(this);
                        }
                        destroy() {
                            this.destroyed = true;
                        }
                    },
```

**Describe block convention:**
```typescript
describe('Phase 5 harm-prevention: V3-02 liquidity wait blocks the snipe when Mint event never arrives', () => {
    it('handleNewPairForChain returns without buying when Mint subscription times out at 30s', async () => { ... });
});
```

**D-04 observable effect to assert:**
- Mock the WebSocket pool to never emit `Mint` event
- Advance fake timers to 30s+
- `expect(ctx.log.info).toHaveBeenCalledWith(expect.objectContaining({ token: ..., pool: ... }), 'No Mint event within timeout, dropping V3 opportunity')` — structured pino log emission
- `expect(buyV3OrSomeBuyMock).not.toHaveBeenCalled()` — observable effect: no buy submitted

**Note for planner:** V3-03 EXCLUDED per D-02 line 47-49 — only V3-02 (liquidity wait) is in scope here.

**Decision deferred to planner** per CONTEXT.md `<canonical_refs>` line 217: "Phase 5 V3-02 liquidity wait may need fork test infrastructure" — planner picks integration vs fork based on whether they can reuse the existing mock-WebSocket pattern from `wsReconnect.test.ts` (integration) or need real Hardhat fork (fork). Recommendation: integration with mocked WebSocket — the mock pattern already exists and the harm scenario is event-timing, not chain-state.

---

### Phase 6 RISK daily-loss harm-test (NEW describe in `test/unit/riskManager.test.ts`)

**Analog:** `test/unit/riskManager.test.ts` (existing daily-loss test at line 78-85; mock setup at lines 19-37).

**Imports/mock pattern** (`test/unit/riskManager.test.ts:1-37`):
```typescript
// test/unit/riskManager.test.ts
// Unit tests for risk manager gate checks.
// Mocks DB and config to test each risk rule independently.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/testDb';
import type Database from 'better-sqlite3';

// ---- Mock dependencies ----

let testDb: Database.Database;

// Prepared statement mocks that canSnipe calls
const mockGetOpenPositionCount = { get: vi.fn() };
const mockGetTotalExposure = { get: vi.fn() };
const mockGetDailyRealizedLoss = { get: vi.fn() };
const mockExposureByChain = { all: vi.fn() };

vi.mock('../../src/utils/db', () => ({
    db: { prepare: vi.fn().mockReturnValue(mockExposureByChain) },
    getOpenPositionCount: mockGetOpenPositionCount,
    getTotalExposure: mockGetTotalExposure,
    getDailyRealizedLoss: mockGetDailyRealizedLoss,
}));

vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
        }),
    },
}));
```

**Existing daily-loss assertion** (`test/unit/riskManager.test.ts:78-85`) — already a strong harm-prevention shape:
```typescript
    it('returns {allowed:false, reason:"daily_loss_limit"} when daily loss exceeded', () => {
        // maxCapital = 1.0, dailyLossPct = 10%, so threshold = -0.1
        // total_loss of -0.15 exceeds threshold
        mockGetDailyRealizedLoss.get.mockReturnValue({ total_loss: -0.15 });
        const result = canSnipe('eth', '0.05', '1.0');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('daily_loss_limit');
    });
```

**Production log emission to also assert** (`src/riskManager.ts:105` — pino `log.warn` shape):
```typescript
log.warn({ chain: chainName, reason: result.reason, details: result.details }, 'Risk check failed');
```

**Describe block convention:**
```typescript
describe('Phase 6 harm-prevention: RISK daily-loss gate blocks the snipe', () => {
    it('canSnipe returns allowed=false AND emits structured pino warn line when daily loss exceeded', async () => { ... });
});
```

**D-04 observable effect to assert (combined for D-04 rigor):**
1. `expect(result.allowed).toBe(false)` and `expect(result.reason).toBe('daily_loss_limit')` (function-return assertion, already in existing test)
2. PLUS assert structured pino warn emission via `expect(loggerChildWarn).toHaveBeenCalledWith(expect.objectContaining({ chain: 'eth', reason: 'daily_loss_limit' }), expect.any(String))` — uses the `expect.objectContaining` payload-shape pattern from `test/unit/configEnvVar.test.ts:171-176`
3. Assert downstream snipe handler is not entered (mock and assert not-called)

---

### Phase 7 EXIT-01 stop-loss → executeFullSell harm-test (NEW describe in `test/unit/exitEngineSell.test.ts`)

**Analog:** `test/unit/exitEngineSell.test.ts` Describe `executeFullSell — receipt decoding integration` (lines 136-204). The mock matrix already covers exitEngine + db + logger + txManager + decodeReceipt — same pattern is the closest analog for stop-loss-triggers-sell.

**Imports/mock matrix** (`test/unit/exitEngineSell.test.ts:1-95`):
```typescript
// test/unit/exitEngineSell.test.ts
// Execution-path tests for executeFullSell and executePartialSell.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertTradeRun = vi.fn();
const updateTradeStatusRun = vi.fn();
const deleteExitStateRun = vi.fn();

vi.mock('../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: insertTradeRun },
    updateTradeStatus: { run: updateTradeStatusRun },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: vi.fn() },
    deleteExitState: { run: deleteExitStateRun },
    getTradeIdForPendingToken: { get: vi.fn() },
}));

vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
        }),
    },
}));

vi.mock('../../src/config', () => ({
    CONFIG: {
        trailingStopPct: 15,
        trailingMinPct: 5,
        trailingMaxPct: 40,
        stopLossPercent: 25,
        // ... other config
    },
}));

const tryAcquireSellLockMock = vi.fn().mockReturnValue(true);
vi.mock('../../src/utils/exitManager', () => ({
    tryAcquireSellLock: tryAcquireSellLockMock,
    releaseSellLock: vi.fn(),
    registerExitMonitor: vi.fn(),
    clearAllTimersForToken: vi.fn(),
}));

vi.mock('../../src/utils/notifier', () => ({
    sendCtxAlert: vi.fn().mockResolvedValue(undefined),
}));

const sendTxWithRetryMock = vi.fn();
vi.mock('../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
}));

const decodeReceiptMock = vi.fn();
vi.mock('../../src/utils/receiptDecoder', () => ({
    decodeReceipt: decodeReceiptMock,
}));
```

**executeFullSell call assertion pattern** (`test/unit/exitEngineSell.test.ts:137-172`):
```typescript
describe('executeFullSell — receipt decoding integration', () => {
    it('records non-null amountOut/gasCost/block when decodeReceipt returns data', async () => {
        sendTxWithRetryMock.mockResolvedValue('0xabc...');
        decodeReceiptMock.mockResolvedValue({
            amountOut: '1000000000000000000',
            gasCost: '300000000000000',
            blockNumber: 12345,
        });

        const ok = await executeFullSell(
            mockCtx, mockDex,
            '0xtokenaddress0000000000000000000000000000',
            null,
            'trailing-stop',
            1,
            'test reason',
        );

        expect(ok).toBe(true);
        expect(decodeReceiptMock).toHaveBeenCalledTimes(1);
        // ... toHaveBeenCalledWith assertions
        expect(insertTradeRun).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'sell',
                amountOut: '1000000000000000000',
                gasCost: '300000000000000',
                block: 12345,
            }),
        );
    });
});
```

**Production code under harm** (`src/exitEngine.ts:747-758`):
```typescript
    // Step 6: Below 2x: fixed stop-loss (D-01)
    if (priceMultiple < 2) {
        const fixedStopPrice = state.entryPrice * (1 - exitConfig.stopLossPct / 100);
        if (price <= fixedStopPrice) {
            const detail = formatExitReason('stop-loss', { ... });
            ctx.log.info({ token: tokenAddress, detail }, 'Fixed stop-loss triggered');
            await executeFullSell(ctx, dex, tokenAddress, feeTier, 'stop-loss', state.tradeId, detail);
        }
    }
```

**Describe block convention:**
```typescript
describe('Phase 7 harm-prevention: EXIT-01 stop-loss triggers executeFullSell with reason="stop-loss"', () => {
    it('drives executeFullSell with reason="stop-loss" when price <= entry * (1 - stopLossPct/100)', async () => { ... });
});
```

**D-04 observable effect to assert:**
- Set `entryPrice=100`, `stopLossPct=30`, current price `65`
- Trigger the pollExitStrategy code path
- `expect(sendTxWithRetryMock).toHaveBeenCalledTimes(1)` — sell tx submitted
- `expect(insertTradeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'sell' }))` — DB row inserted

**Note for planner:** Phase 7 already has very strong existing test coverage (4 tests in exitEngineSell.test.ts, multiple in exitMonitor.test.ts). The harm-prevention test should reuse the mock matrix verbatim and add ONE new `it` that drives the full happy-path through `pollExitStrategy` with a stop-loss-triggering price — the existing tests cover threshold computation but not the wired-through-to-`executeFullSell` invocation. That's the harm scenario gap.

---

### Phase 8 DASH/MON health-version harm-test (NEW it in `test/integration/api/health.test.ts`)

**Analog:** `test/integration/api/health.test.ts` lines 57-72 — already asserts `body.version` is a string matching semver, plus the test mocks db/riskManager and uses an Express + http harness.

**Imports/setup pattern** (`test/integration/api/health.test.ts:1-50`):
```typescript
// test/integration/api/health.test.ts
// Health endpoint tests: 200 ok when connected, 503 degraded when disconnected.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createMockChainContext, createDisconnectedContext } from '../../fixtures/api.fixtures';

vi.mock('../../../src/utils/db', () => ({
    getOpenPositionCount: { get: () => ({ count: 3 }) },
    getTotalExposure: { get: () => ({ total: 0.15 }) },
    getPnL: () => [
        { realized_pnl: 0.05 },
        { realized_pnl: -0.02 },
    ],
}));

vi.mock('../../../src/riskManager', () => ({
    getPortfolioExposure: () => ({ total: 0.15, byChain: { eth: 0.15 } }),
}));

const { healthRoutes } = await import('../../../src/api/routes/health');

async function requestHealth(app: express.Express): Promise<{ status: number; body: Record<string, unknown> }> {
    // ... node http harness, returns parsed JSON body
}
```

**Existing version assertion pattern** (`test/integration/api/health.test.ts:57-72`):
```typescript
    it('returns 200 with status ok when chain connected', async () => {
        const ctx = createMockChainContext();
        const app = express();
        app.use('/health', healthRoutes([ctx]));

        const { status, body } = await requestHealth(app);

        expect(status).toBe(200);
        expect(body.status).toBe('ok');
        expect(body).toHaveProperty('version');
        expect(typeof body.version).toBe('string');
        expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
        // ...
    });
```

**Describe block convention** (per D-03 — existing test already asserts the harm scenario; planner can either:
- (A) wrap the assertions above in a new `describe('Phase 8 harm-prevention: ...', ...)` sibling block at the top of the file
- (B) augment the existing `it` to make the version assertion the primary harm-prevention claim
- Recommended: (A) — preserves existing tests untouched and adds the harm-prevention discoverability marker.

**Describe block:**
```typescript
describe('Phase 8 harm-prevention: DASH/MON /health endpoint emits version from package.json (INT-HEALTH-VERSION closure)', () => {
    it('GET /health response body contains version matching pkg.version', async () => { ... });
});
```

**D-04 observable effect to assert:**
- HTTP 200 + JSON body has `version` field that matches `JSON.parse(readFileSync('package.json')).version`
- Optionally assert `body.version` matches `/^\d+\.\d+\.\d+/` (semver shape)

---

### Phase 10 partial-sell amount_out non-null harm-test (NEW describe in `test/unit/exitEngineSell.test.ts`)

**Analog:** `test/unit/exitEngineSell.test.ts` Describe `executePartialSell — receipt decoding integration` (line 206 onward). The mock matrix is the same as Phase 7 above; the assertion is on `executePartialSell` instead of `executeFullSell`.

**Existing partial-sell assertion shape** (`test/unit/exitEngineSell.test.ts:206-241`, see lines extracted above for `executeFullSell` — `executePartialSell` follows the same pattern):
```typescript
describe('executePartialSell — receipt decoding integration', () => {
    it('records non-null amountOut/gasCost/block when decodeReceipt returns data', async () => {
        sendTxWithRetryMock.mockResolvedValue('0xdeadbeef...');
        decodeReceiptMock.mockResolvedValue({
            amountOut: '500000000000000000',
            gasCost: '150000000000000',
            blockNumber: 67890,
        });

        const state = {
            tradeId: 2,
            entryPrice: 1000,
            highWaterMark: 2500,
            trailingActivated: true,
            // ... rest of state
        };
        // ... call executePartialSell + assert insertTradeRun called with action='partial_sell', non-null amount_out
    });
});
```

**Describe block convention:**
```typescript
describe('Phase 10 harm-prevention: partial-sell amount_out is non-null on receipt-decoded sell', () => {
    it('insertTrade run with action="partial_sell" includes non-null amountOut from decodeReceipt', async () => { ... });
});
```

**D-04 observable effect to assert:**
- `decodeReceipt` mock returns non-null `{ amountOut: '500000000000000000', ... }`
- `expect(insertTradeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'partial_sell', amountOut: '500000000000000000', gasCost: expect.any(String), block: expect.any(Number) }))` — DB row written with non-null amount_out

**Note for planner:** Phase 10 has near-perfect existing coverage (13 unit + integration tests in `test/unit/db.test.ts` and `test/unit/exitEngineSell.test.ts` per `10-VALIDATION.md` lines 50-67). The new harm-prevention test is the focused single-assertion claim "amount_out non-null on a receipt-decoded sell" stated explicitly under the `Phase 10 harm-prevention:` describe block. Planner can optionally just relabel an existing it via an outer describe wrapper.

---

### `src/telegramListener.ts` lines 55, 61 (verify-only at execution time, NO edit)

**Analog:** N/A — this is a verify-then-act item where verify already shows no action needed.

**Pre-scout finding** (CONTEXT.md `<domain>` lines 19-20):
```
- `src/telegramListener.ts:55,61` → no `console.log` (lines are env-parse
  expressions invoking structured `log.warn/info/debug`)
```

**Confirmed via Read** (`src/telegramListener.ts:53-58`):
```typescript
    const allowedSenders = new Set(
        (process.env.TELEGRAM_ALLOWED_SENDERS || '').split(',').map(s => s.trim()).filter(Boolean)
    );
    const allowedChannels = new Set(
        (process.env.TELEGRAM_ALLOWED_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean)
    );
```

Lines 55, 61 are env-parse list-comprehension expressions, NOT `console.log` calls. Pre-scout already confirmed `log.warn` is the structured-logging convention used throughout the file (line 48: `log.warn('Telegram env vars missing, running in factory-event-only mode')`).

**Action:** Wave-0 verification command at execution time (Plan 17-01):
```bash
grep -n 'console\.log\|console\.warn\|console\.error' src/telegramListener.ts
```
Expected output: empty. If empty, record `verified-resolved` in `v6.17-debt-baseline.md` against the v6.16-MILESTONE-AUDIT.md line 17 claim "Diagnostic console.log in telegramListener.ts (lines 55, 61) marked for removal". If non-empty (regression since pre-scout), the claim is acted on with `log.debug` replacement per DEBT-06 wording.

## Shared Patterns

### Authentication / Auth-Guard
**Source:** N/A for Phase 17 — Phase 17 modifies CI workflow + planning docs + tests; no auth-protected route surface created.

### Pino Structured Logging
**Source:** `src/utils/logger.ts` (singleton) → `log.warn`/`log.info`/`log.debug` invocations throughout `src/`
**Apply to:** All harm-prevention tests (Phase 1, 5, 6, 7, 10) that assert log emission as the observable effect
**Production call shape** (`src/riskManager.ts:87`):
```typescript
log.warn({ chain: chainName, reason: result.reason, details: result.details }, 'Risk check failed');
```

**Test mock pattern (canonical)** — present in nearly every existing test (e.g., `test/integration/exitMonitor.test.ts:17-24`):
```typescript
vi.doMock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(), warn: vi.fn(), debug: vi.fn(),
            error: vi.fn(), fatal: vi.fn(),
        }),
    },
}));
```

OR for top-level `vi.mock` (used in `test/unit/riskManager.test.ts:28-37` and `test/unit/configEnvVar.test.ts:17-31`):
```typescript
vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    },
}));
```

**Test assertion pattern (canonical)** — payload-shape with `expect.objectContaining`, from `test/unit/configEnvVar.test.ts:170-176`:
```typescript
expect(mockFatal).toHaveBeenCalled();
expect(mockFatal).toHaveBeenCalledWith(
    expect.objectContaining({
        missing: expect.arrayContaining([expect.stringContaining('DASHBOARD_API_KEY')])
    }),
    expect.any(String)
);
```

This is the canonical pattern for D-04 observable-effect rigor when the harm scenario is "structured pino log line emitted". `expect.objectContaining` for the payload + `expect.any(String)` for the message.

### Vitest Project Selection (D-03 — co-locate, no new project)
**Source:** `vitest.config.ts:7-39`
**Apply to:** All 7 new harm-prevention tests
- Phase 1 (FIX-01) → `integration` project (file already in `test/integration/`)
- Phase 3 (SQLite) → `unit` project (file already in `test/unit/`)
- Phase 5 (V3-02) → `integration` project (recommended; planner can choose `fork`)
- Phase 6 (RISK) → `unit` project
- Phase 7 (EXIT-01) → `unit` project
- Phase 8 (health) → `integration` project
- Phase 10 (partial-sell) → `unit` project

**Vitest projects config** (`vitest.config.ts:7-39`):
```typescript
projects: [
    {
        extends: true,
        test: {
            name: 'unit',
            include: ['test/unit/**/*.test.ts'],
            testTimeout: 5000,
            environment: 'node',
            mockReset: true,
        },
    },
    {
        extends: true,
        test: {
            name: 'integration',
            include: ['test/integration/**/*.test.ts'],
            testTimeout: 15000,
            environment: 'node',
            mockReset: true,
        },
    },
    {
        extends: true,
        test: {
            name: 'fork',
            include: ['test/fork/**/*.test.ts'],
            testTimeout: 120000,
            environment: 'node',
            globalSetup: ['test/fork/setup.ts'],
        },
    },
],
```

**Critical convention:** `mockReset: true` is set on unit and integration projects — tests must `mockReset()` mocks they need to preserve implementations on, OR re-establish implementations in `beforeEach` (see `test/unit/exitEngineSell.test.ts:121-134` for the pattern). Phase 17 new tests must follow this — DO NOT assume `vi.fn().mockReturnValue(...)` survives between `it`s without re-establishing.

### Describe-Block Discoverability Convention (D-03)
**Source:** Novel for v6.17 — establish the convention with these tests
**Apply to:** All 7 new harm-prevention tests
**Convention:** Each new test or test group wrapped in:
```typescript
describe('Phase N harm-prevention: <succinct harm scenario>', () => { ... });
```

Example:
- `describe('Phase 1 harm-prevention: FIX-01 exit-monitor sell-lock prevents double-sell race', () => { ... })`
- `describe('Phase 3 harm-prevention: SQLite transaction failure rolls back atomically', () => { ... })`
- `describe('Phase 5 harm-prevention: V3-02 liquidity wait drops snipe on Mint timeout', () => { ... })`
- `describe('Phase 6 harm-prevention: RISK daily-loss gate blocks the snipe with structured warn log', () => { ... })`
- `describe('Phase 7 harm-prevention: EXIT-01 stop-loss triggers executeFullSell with reason="stop-loss"', () => { ... })`
- `describe('Phase 8 harm-prevention: DASH/MON /health emits version from package.json', () => { ... })`
- `describe('Phase 10 harm-prevention: partial-sell amount_out non-null on receipt-decoded sell', () => { ... })`

**Audit query** that this convention enables (per D-03 — phase linkage stays in `N-VALIDATION.md`, but tests are discoverable via grep):
```bash
grep -rn "Phase [0-9]* harm-prevention:" test/
```

### Error Handling / Fail-Closed
**Source:** `require: true` env-var convention (FIX-06, Phase 1) per CONTEXT.md `<code_context>` line 256-258
**Apply to:** Both new CI guards in `.github/workflows/test.yml`
**Pattern:** Any guard violation `exit 1` (no warn-and-continue). The `.todo` ban guard exits 1 on any match. The `tsc --noEmit` step fails the workflow on any TS error (default `tsc` behavior). Three sequential `tsc -p <config>` steps (planner discretion vs single matrix step per D-10).

### Validation Doc Augmentation Format
**Source:** Novel for v6.17 — establish the convention with the 02 + 09 inline augmentations
**Apply to:** `02-VALIDATION.md` and `09-VALIDATION.md`
**Convention:** Append a new H2 section AFTER the existing `## Validation Audit YYYY-MM-DD` section. Section title format:
```markdown
## Harm-Prevention Assertion (Phase 17 / DEBT-05)
```
Section content includes:
1. **Harm scenario** (1-2 sentences) — what production bug would this catch?
2. **Pointer to existing tests / evidence** — file paths + line numbers (or test IDs)
3. **Pointer to v6.17 baseline doc** — `.planning/milestones/v6.17-debt-baseline.md` (cross-link)
4. **Frontmatter delta** — add `harm_prevention: inline` field (planner discretion)

**Section name:** "Harm-Prevention Assertion (Phase 17 / DEBT-05)" is the recommended fixed name to make grep-discoverability cheap; alternative names are planner-discretion per CONTEXT.md `<code_context>` line 263-266.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All 13 files have an exact or role-match analog in the existing codebase |

**Phase 17 is exceptionally well-served by existing analogs** because it is itself a cleanup/audit phase — every new artifact mirrors a sibling that already exists (CI workflow → existing CI workflow; baseline doc → existing audit doc; harm-prevention tests → existing same-project tests). No fresh greenfield patterns are introduced.

## Metadata

**Analog search scope:**
- `.github/workflows/` (CI workflow patterns)
- `.planning/milestones/` (audit doc patterns)
- `.planning/phases/*/N-VALIDATION.md` (validation doc patterns)
- `test/unit/`, `test/integration/`, `test/fork/` (test patterns)
- `src/utils/db.ts`, `src/exitEngine.ts`, `src/riskManager.ts`, `src/telegramListener.ts` (production code under harm-scenario)
- `vitest.config.ts`, `package.json`, `test/helpers/testDb.ts` (test infra)
- 3 tsconfig variants (`tsconfig.json`, `tsconfig.bot.json`, `dashboard/tsconfig.json`) — all confirmed present on disk

**Files scanned:** 23 files Read fully or in targeted ranges; 8 additional files Glob-matched and reference-only

**Pattern extraction date:** 2026-04-29

## PATTERN MAPPING COMPLETE
