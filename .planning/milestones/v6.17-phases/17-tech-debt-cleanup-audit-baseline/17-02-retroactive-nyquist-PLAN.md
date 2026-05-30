---
phase: 17
plan: 2
slug: retroactive-nyquist
type: execute
wave: 1
depends_on:
  - "17-01"
files_modified:
  - test/integration/exitMonitor.test.ts
  - test/unit/db.test.ts
  - test/integration/v3LiquidityWait.test.ts
  - test/unit/riskManager.test.ts
  - test/unit/exitEngineSell.test.ts
  - test/integration/api/health.test.ts
  - .planning/phases/02-ethers-v6-migration/02-VALIDATION.md
  - .planning/phases/09-testing-infrastructure/09-VALIDATION.md
  - .planning/phases/01-bug-fixes-hardening/01-VALIDATION.md
  - .planning/phases/03-sqlite-storage-code-quality/03-VALIDATION.md
  - .planning/phases/05-uniswap-v3-integration/05-VALIDATION.md
  - .planning/phases/06-risk-management/06-VALIDATION.md
  - .planning/phases/07-smart-exit-strategies/07-VALIDATION.md
  - .planning/phases/08-monitoring-web-dashboard/08-VALIDATION.md
  - .planning/phases/10-partial-sell-revenue-fix/10-VALIDATION.md
autonomous: true
requirements:
  - DEBT-05
must_haves:
  truths:
    - "Each of the 9 retroactively-validated phases (01, 02, 03, 05, 06, 07, 08, 09, 10) has ONE production-relevant harm-prevention assertion answering 'does this prevent the harm we said it would?' (ROADMAP.md SC-3)."
    - "7 new tests are committed in `test/{unit,integration}/` co-located with what they test (D-03 — no `test/validation/` directory, no new vitest project)."
    - "Each new test is wrapped in `describe('Phase N harm-prevention: <scenario>', ...)` so `grep -rn 'Phase [0-9]* harm-prevention:' test/` returns 7 matches (D-03 discoverability)."
    - "Each new test asserts at least one concrete observable effect — DB row inserted/absent, mock function called with specific args, structured pino log line emitted via `expect.objectContaining`, OR transaction submitted/blocked (D-04 rigor bar)."
    - "Phase 02 (ethers v6) and Phase 09 (testing infra) VALIDATION.md files have a new `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` H2 section appended documenting their inline disposition (D-02 inline-doc form for architectural phases)."
    - "All 9 phases (01, 02, 03, 05, 06, 07, 08, 09, 10) have their N-VALIDATION.md cross-referenced from the new tests or augmentation, closing DEBT-05 retroactively for all 9."
    - "Phase 1 work explicitly EXCLUDES FIX-04 (V2 sell-sim) and Phase 5 work explicitly EXCLUDES V3-03 (V3 sell-sim) — both deferred to Phase 18 HONEY-07/08 fresh-implementation validation per Pitfall #19 (D-02)."
    - "If any new test reveals a real production bug during execution, the executor STOPS the plan and surfaces to user immediately — D-07 stop-the-line. NOT fix-in-flight, NOT file-and-defer."
  artifacts:
    - path: test/integration/exitMonitor.test.ts
      provides: "Phase 1 FIX-01 exit-monitor sell-lock harm-prevention describe block (excludes FIX-04 per D-02)"
    - path: test/unit/db.test.ts
      provides: "Phase 3 SQLite atomicity harm-prevention describe block"
    - path: test/integration/v3LiquidityWait.test.ts
      provides: "Phase 5 V3-02 liquidity-wait harm-prevention test (NEW file; excludes V3-03 per D-02)"
    - path: test/unit/riskManager.test.ts
      provides: "Phase 6 RISK daily-loss gate harm-prevention describe block"
    - path: test/unit/exitEngineSell.test.ts
      provides: "Phase 7 EXIT-01 stop-loss-triggers-executeFullSell + Phase 10 partial-sell amount_out harm-prevention describe blocks"
    - path: test/integration/api/health.test.ts
      provides: "Phase 8 DASH/MON /health version harm-prevention describe block"
    - path: .planning/phases/02-ethers-v6-migration/02-VALIDATION.md
      provides: "Phase 2 inline harm-prevention augmentation (D-02 inline-doc form)"
      contains: "## Harm-Prevention Assertion (Phase 17 / DEBT-05)"
    - path: .planning/phases/09-testing-infrastructure/09-VALIDATION.md
      provides: "Phase 9 inline harm-prevention augmentation (D-02 inline-doc form)"
      contains: "## Harm-Prevention Assertion (Phase 17 / DEBT-05)"
  key_links:
    - from: test/{unit,integration}/*.test.ts (new describe blocks)
      to: .planning/phases/{01,03,05,06,07,08,10}-*/N-VALIDATION.md
      via: "describe-block prefix `Phase N harm-prevention:` keys phase linkage; N-VALIDATION.md cross-references the test file:line per D-03"
    - from: .planning/phases/{02,09}-*/N-VALIDATION.md (new H2 section)
      to: existing tests + tsc-clean baseline + CI exit-non-zero behavior
      via: "inline pointer per D-02; cross-link to .planning/milestones/v6.17-debt-baseline.md"
---

<objective>
Substantive plan for Phase 17. Closes DEBT-05 — retroactive Nyquist validation across 9 phases (01, 02, 03, 05, 06, 07, 08, 09, 10) with the hybrid 7+2 split locked by D-01/D-02:
- **7 NEW TESTS** (Phases 01, 03, 05, 06, 07, 08, 10) — each phase gets a `describe('Phase N harm-prevention: ...', ...)` block in the appropriate existing test file, asserting at least one concrete observable effect (D-04 rigor).
- **2 INLINE DOC** (Phases 02, 09) — appended `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` H2 section in their N-VALIDATION.md (D-02 — pure architectural / meta phases).

**Exclusions (locked):**
- Phase 1 work EXCLUDES FIX-04 (V2 sell-sim) — addressed in HONEY-07 (Phase 18)
- Phase 5 work EXCLUDES V3-03 (V3 sell-sim) — addressed in HONEY-08 (Phase 18)

**Stop-the-line protocol (D-07):** If ANY of the 7 new tests reveals a real production bug during execution (the test does not pass with the existing implementation, and investigation shows the implementation is buggy — not the test), the executor STOPS, surfaces to user, and BLOCKS Phase 17 close. Treat as DEBT-07 / decimal phase 17.1. Do NOT fix in-flight, do NOT file-and-defer.

Output: 7 test files modified (or 1 created — `test/integration/v3LiquidityWait.test.ts`), 2 VALIDATION.md files augmented, 9 phase-N-VALIDATION.md files cross-referenced from the new tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md
@.planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md
@.planning/research/PITFALLS.md
@.planning/milestones/v6.17-debt-baseline.md
@vitest.config.ts

<interfaces>
<!-- Mock matrices and assertion patterns extracted from existing tests; copy these verbatim. -->

From test/integration/exitMonitor.test.ts (lines 16-29 — canonical exitManager mock for Phase 1 work):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

From test/unit/db.test.ts (lines 1-7, 27-65 — canonical createTestDb + transactions describe pattern):
```typescript
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../helpers/testDb';
import { normalizeLegacyMainnetRows, makeIsTokenSnipedStmt } from '../../src/utils/db';

// transactions describe block at lines 27-65 — covers commit and rollback patterns
```

From test/unit/exitEngineSell.test.ts (lines 14-95 — canonical executeFullSell/executePartialSell mock matrix; reuse for Phases 7 and 10):
```typescript
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

const sendTxWithRetryMock = vi.fn();
vi.mock('../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
}));

const decodeReceiptMock = vi.fn();
vi.mock('../../src/utils/receiptDecoder', () => ({
    decodeReceipt: decodeReceiptMock,
}));
```

From test/unit/riskManager.test.ts (lines 1-37 — canonical riskManager mock for Phase 6):
```typescript
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
```

From test/integration/api/health.test.ts (lines 23-50 — canonical Express + http harness for Phase 8):
```typescript
const { healthRoutes } = await import('../../../src/api/routes/health');

async function requestHealth(app: express.Express): Promise<{ status: number; body: Record<string, unknown> }> {
    // Node http harness — see existing implementation lines 29-50
}
```

From test/unit/configEnvVar.test.ts (lines 170-176 — canonical pino-log assertion shape per PATTERNS.md "Pino Structured Logging"):
```typescript
expect(mockFatal).toHaveBeenCalledWith(
    expect.objectContaining({
        missing: expect.arrayContaining([expect.stringContaining('DASHBOARD_API_KEY')])
    }),
    expect.any(String)
);
```

This `expect.objectContaining({...payload}), expect.any(String)` shape is the D-04 observable-effect contract for "structured pino log line emitted" assertions.

From test/integration/wsReconnect.test.ts (lines 50-67 — MockWebSocketProvider pattern for Phase 5):
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

From src/bot.ts:86-121 (production code under Phase 5 V3-02 harm scenario — VERBATIM SIGNATURE; the function is module-internal, NOT exported):
```typescript
async function waitForLiquidity(
    ctx: ChainContext,
    poolAddress: string,
    blockNumber: number
): Promise<boolean> {
    const pool = new Contract(poolAddress, V3_POOL_ABI, ctx.httpProvider);

    // D-02: Same-block check first -- atomic launch scripts emit PoolCreated + Mint in one block
    try {
        const mintFilter = pool.filters.Mint();
        const existingMints = await pool.queryFilter(mintFilter, blockNumber, blockNumber);
        if (existingMints.length > 0) {
            ctx.log.info({ pool: poolAddress, block: blockNumber }, 'Mint found in same block as PoolCreated');
            return true;
        }
    } catch (e) {
        ctx.log.warn({ err: e, pool: poolAddress }, 'Error querying same-block Mints, falling through to subscription');
    }

    // D-01: Subscribe + timeout for future Mints (30 seconds)
    return new Promise<boolean>((resolve) => {
        const wsPool = new Contract(poolAddress, V3_POOL_ABI, ctx.wsProvider || ctx.httpProvider);
        const timeout = setTimeout(() => {
            wsPool.removeAllListeners('Mint');  // Pitfall 7: prevent stale callbacks
            ctx.log.info({ pool: poolAddress }, 'Mint timeout (30s), dropping opportunity');
            resolve(false);
        }, 30_000);

        wsPool.on('Mint', () => {
            clearTimeout(timeout);
            wsPool.removeAllListeners('Mint');
            ctx.log.info({ pool: poolAddress }, 'Mint event received, proceeding to snipe');
            resolve(true);
        });
    });
}
```

**Critical observations for Task 4 planner-discretion:**
- `waitForLiquidity` at src/bot.ts:86 is **NOT exported** (no `export` keyword). It is module-internal to `src/bot.ts`.
- The call site is src/bot.ts:380 (`const hasLiquidity = await waitForLiquidity(ctx, poolAddress, blockNumber);`) inside `handleNewPairForChain`.
- The 30s timeout's "drop opportunity" log message at line 110 is `'Mint timeout (30s), dropping opportunity'` — NOT the bot.ts:382 message `'No Mint event within timeout, dropping V3 opportunity'`. The line 382 message is in the call-site's *minLiquidity* fallback, not in `waitForLiquidity` itself. Task 4 must assert against the line 110 message.
- Because `waitForLiquidity` is not exported, Task 4 must either (a) export it temporarily for testability (treat as a test-driven design improvement), (b) drive `handleNewPairForChain` from a higher level (heavier mock matrix), or (c) re-implement the timeout/subscribe logic in a new exported helper. Task 4's action documents (a) as the recommended path — surface to user via D-07 if option (a) is rejected.

From src/bot.ts:379-385 (the call-site that exercises waitForLiquidity in production):
```typescript
const hasLiquidity = await waitForLiquidity(ctx, poolAddress, blockNumber);
if (!hasLiquidity) {
    ctx.log.info({ token: targetToken, pool: poolAddress }, 'No Mint event within timeout, dropping V3 opportunity');
    await sendCtxAlert(ctx, `*V3 pool no liquidity (30s timeout)* \`${targetToken}\``);
    return;
}
```

From src/exitEngine.ts:531-540 (production code under Phase 10 partial-sell harm scenario — VERBATIM `executePartialSell` SIGNATURE):
```typescript
export async function executePartialSell(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    sellAmount: bigint,
    tiers: { tier: PartialTier; index: number }[],
    state: ExitStateData,
    currentMultiple: number,
): Promise<boolean>
```

8 parameters in this exact order: `ctx, dex, tokenAddress, feeTier, sellAmount, tiers, state, currentMultiple`. NOTE the differences from the Phase 7 `executeFullSell(ctx, dex, tokenAddress, feeTier, reason, tradeId, detail)` signature — `executePartialSell` has NO `reason` and NO `tradeId` parameter; instead it takes `sellAmount` (bigint), `tiers` (PartialTier[]), `state` (ExitStateData), and `currentMultiple` (number). The Task 9 action body MUST use this 8-parameter order verbatim.

The internal call shape at src/exitEngine.ts:703-706 (inside `pollExitStrategy`):
```typescript
const success = await executePartialSell(
    ctx, dex, tokenAddress, feeTier,
    sellAmount, unfilledTiers, state, priceMultiple,
);
```

From src/exitEngine.ts:747-760 (production code under Phase 7 EXIT-01 harm scenario):
```typescript
if (!state.trailingActivated) {
    const fixedStopPrice = state.entryPrice * (1 - exitConfig.stopLossPct / 100);
    if (currentPrice <= fixedStopPrice) {
        const detail = formatExitReason('stop-loss', { entryPrice: state.entryPrice, highWaterMark: state.highWaterMark, currentPrice, priceMultiple });
        ctx.log.info({ token: tokenAddress, detail }, 'Fixed stop-loss triggered');
        await executeFullSell(ctx, dex, tokenAddress, feeTier, 'stop-loss', state.tradeId, detail);
        return 'exited';
    }
}
```

From src/riskManager.ts:87 (production code under Phase 6 RISK harm scenario; also confirmed at 17-PATTERNS.md line 491):
```typescript
log.warn({ chain: chainName, reason: result.reason, details: result.details }, 'Risk check failed');
```

Critical convention: **vitest.config.ts has `mockReset: true` for unit and integration projects**, so `vi.fn().mockReturnValue(...)` does NOT survive between `it`s. Re-establish implementations in `beforeEach`. See test/unit/exitEngineSell.test.ts:121-134 for the canonical pattern:
```typescript
beforeEach(async () => {
    insertTradeRun.mockReset();
    sendTxWithRetryMock.mockReset();
    decodeReceiptMock.mockReset();
    tryAcquireSellLockMock.mockReset().mockReturnValue(true);
    const mod = await import('../../src/exitEngine');
    executeFullSell = mod.executeFullSell;
});
```
</interfaces>

<stop_the_line_protocol>
**For EVERY task in this plan (1-9), the executor MUST follow D-07 stop-the-line:**

1. Write the test/augmentation per the action below.
2. Run the test (`npx vitest run <file>` for new tests).
3. **If the test FAILS** because the production code is genuinely broken (not because the test is wrong):
   - STOP. Do NOT fix the production code.
   - Do NOT skip the test.
   - Do NOT mark it `.skip`.
   - Surface to user immediately with: file:line of failure, observed-vs-expected, and the production line(s) implicated.
   - BLOCK Phase 17 close until user decides disposition (DEBT-07 / phase 17.1 / abort).
4. **If the test PASSES** (the implementation actually prevents the harm), proceed.
5. **If the test fails because the test is wrong** (assertion misaligned with real implementation), fix the test and re-run — this is normal authoring iteration.

The distinction: testing what we believed was implemented vs what was actually implemented. A failing test that exposes a real bug is the v6.17 milestone-defining outcome of retroactive Nyquist (per Pitfall #19 FIX-04/V3-03 precedent). Don't quietly skip it.
</stop_the_line_protocol>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Phase 1 FIX-01 harm-prevention test (exit-monitor sell-lock cannot be double-acquired)</name>
  <files>test/integration/exitMonitor.test.ts</files>
  <read_first>
    - test/integration/exitMonitor.test.ts (CURRENT FILE — must understand existing 3 describe blocks before adding the 4th; NOTE the canonical `importExitManager()` helper at lines 16-29 and the `concurrent sell prevention` analog at lines 118-138)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 215-283 — the FIX-01 analog excerpt; D-04 observable effect requirement)
    - .planning/phases/01-bug-fixes-hardening/01-VALIDATION.md (existing per-task validation map; this task adds harm-prevention assertion alongside FIX-01)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md (D-02 line 54-56 — Phase 1 EXCLUDES FIX-04; D-04 rigor; D-07 stop-the-line)
    - src/utils/exitManager.ts (production code under harm — confirm `tryAcquireSellLock` and `releaseSellLock` exports)
  </read_first>
  <behavior>
    - Test 1 (lock-blocks-second-acquire): given thread A holds the sell lock for `(chain='eth', token='0xRaceToken')`, thread B calling `tryAcquireSellLock('eth', '0xRaceToken')` returns `false` AND a downstream sell-tx-submitter (mocked `sendTxWithRetry`) is NOT called.
    - Test 2 (release-allows-re-acquire): after `releaseSellLock('eth', '0xRaceToken')`, the next `tryAcquireSellLock` returns `true` (proves the lock isn't permanently sticky — distinct from a deadlock).
  </behavior>
  <action>
Append a new `describe` block to the END of `test/integration/exitMonitor.test.ts`. Use the EXACT describe-block name (D-03 discoverability):

```typescript
describe('Phase 1 harm-prevention: FIX-01 exit-monitor sell-lock prevents double-sell race', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('lock acquired by thread A blocks thread B from acquiring (no second sell-tx submitted)', async () => {
        const em = await importExitManager();
        em.clearAllTimers();

        // Thread A acquires
        expect(em.tryAcquireSellLock('eth', '0xRaceToken')).toBe(true);

        // Thread B blocked — observable effect: returns false
        expect(em.tryAcquireSellLock('eth', '0xRaceToken')).toBe(false);

        // Cleanup
        em.releaseSellLock('eth', '0xRaceToken');
    });

    it('release-then-re-acquire works (lock is not permanently sticky)', async () => {
        const em = await importExitManager();
        em.clearAllTimers();

        em.tryAcquireSellLock('eth', '0xRaceToken2');
        em.releaseSellLock('eth', '0xRaceToken2');

        // Observable effect: post-release, the next acquire succeeds
        expect(em.tryAcquireSellLock('eth', '0xRaceToken2')).toBe(true);

        em.releaseSellLock('eth', '0xRaceToken2');
    });
});
```

Note: the `importExitManager()` function is already defined at the file's top (lines 16-29 of the existing file) and uses `vi.doMock` + `vi.resetModules()`. The new describe block re-uses that closure-scoped helper directly — no re-import needed. (Confirm by reading the existing file structure first.)

**FIX-04 EXCLUSION (per D-02 line 54-56):** This describe block covers FIX-01 (sell-lock race) ONLY. Do NOT add a sell-sim test here — FIX-04 V2 sell-sim is addressed via fresh implementation in Phase 18 HONEY-07 and validated at fresh-implementation time per Pitfall #19. If you find yourself wanting to add a sell-sim assertion, STOP — that's HONEY-07 territory.

**After writing,** run `npx vitest run test/integration/exitMonitor.test.ts` and confirm both new `it` blocks pass. Then update `.planning/phases/01-bug-fixes-hardening/01-VALIDATION.md`: append a new H2 section after the last existing H2 titled `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` with body:

```markdown
## Harm-Prevention Assertion (Phase 17 / DEBT-05)

**Harm scenario:** Two concurrent timers each detect a sell-trigger condition for the same `(chain, token)` and both submit sell transactions, double-spending the position.

**Pointer to test:** `test/integration/exitMonitor.test.ts` describe block `Phase 1 harm-prevention: FIX-01 exit-monitor sell-lock prevents double-sell race` (the 2 `it` blocks at end of file).

**Excluded:** FIX-04 (V2 sell-sim) — addressed via fresh implementation in HONEY-07 and validated at fresh-implementation time per PITFALLS.md #19.

**Cross-reference:** `.planning/milestones/v6.17-debt-baseline.md` for the v6.17 baseline anchor.
```

If either test FAILS because the production sell-lock is broken, STOP per D-07 stop-the-line protocol.
  </action>
  <verify>
    <automated>npx vitest run test/integration/exitMonitor.test.ts -t "Phase 1 harm-prevention" 2>&amp;1 | grep -E "Test Files\s+1 passed|2 passed"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Phase 1 harm-prevention: FIX-01" test/integration/exitMonitor.test.ts == 1` — describe block name present verbatim.
    - The new describe block contains exactly 2 `it(...)` blocks (verifiable: `awk '/^describe\(.Phase 1 harm-prevention/,/^\}\);/' test/integration/exitMonitor.test.ts | grep -c '    it('` returns `2`).
    - One `it` asserts `expect(em.tryAcquireSellLock('eth', '0xRaceToken')).toBe(false)` after a prior acquire (the harm-prevention observable per D-04).
    - One `it` asserts `expect(em.tryAcquireSellLock(..., ..., ...)).toBe(true)` AFTER `releaseSellLock` (proves non-sticky).
    - The new describe block contains NO references to `simulateSell`, `sellSimulation`, `simulateSellForChain`, or any V2 sell-sim symbol (FIX-04 exclusion verifiable via grep returning 0).
    - `.planning/phases/01-bug-fixes-hardening/01-VALIDATION.md` contains the literal H2 string `## Harm-Prevention Assertion (Phase 17 / DEBT-05)`.
    - `.planning/phases/01-bug-fixes-hardening/01-VALIDATION.md` contains the literal pointer string `test/integration/exitMonitor.test.ts`.
    - `npx vitest run test/integration/exitMonitor.test.ts -t "Phase 1 harm-prevention"` reports both `it`s passing.
  </acceptance_criteria>
  <done>
The describe block is present, both `it`s pass, and Phase 01's VALIDATION.md cross-references the new test. FIX-04 is verifiably excluded (no sell-sim symbols in the describe).
  </done>
</task>

<task type="auto">
  <name>Task 2: Phase 2 ethers v6 inline harm-prevention augmentation (architectural / type-system property)</name>
  <files>.planning/phases/02-ethers-v6-migration/02-VALIDATION.md</files>
  <read_first>
    - .planning/phases/02-ethers-v6-migration/02-VALIDATION.md (CURRENT FILE — must understand existing structure: H1 + 7 H2s ending in `## Validation Audit 2026-04-13`; new section appends AFTER that)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 171-194 — the 02-VALIDATION.md analog excerpt and inline-augmentation shape)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md (D-02 line 49-52 — Phase 02 chosen for INLINE DOC because the harm scenario is irreducibly architectural; doc augmentation does NOT count as rubber-stamp per D-01)
    - test/unit/ethersV5PatternsAbsent.test.ts (lines 1-30 — confirm the structural ban regex tests exist; this is the existing evidence the augmentation points to)
  </read_first>
  <action>
Read the existing `02-VALIDATION.md` end-to-end. Identify the line number of the LAST `##` H2 section (per pre-scout this is `## Validation Audit 2026-04-13` around line 77+). Append a new H2 section AFTER the last existing H2, separated by a blank line. The new section body MUST be:

```markdown
## Harm-Prevention Assertion (Phase 17 / DEBT-05)

**Form:** INLINE DOC (per Phase 17 CONTEXT.md D-02). The ethers v5→v6 migration's harm scenario is irreducibly architectural: did the migration preserve correct numerical behavior across every BigInt arithmetic path the v5 codebase used? This is a cross-cutting type-system property, not a single-test surface — single-test fabrication would be the rubber-stamp pattern Pitfall #19 warns against.

**Harm scenario:** A v5→v6 incomplete migration leaves residual `BigNumber` objects, `.callStatic` calls, or `@ethersproject/*` imports — runtime errors at first hit, or worse, silent numerical-precision corruption when v5/v6 BigInt semantics differ.

**Evidence (existing tests):**
- `test/unit/ethersV5PatternsAbsent.test.ts` — 12 tests; structural ban regex enforces zero v5 surface (`/@ethersproject\//`, `/BigNumber/`, `/\.callStatic\./`, etc.).
- `test/unit/ethersV6BigIntArithmetic.test.ts` — 9 tests; static + runtime numerical correctness across the BigInt paths the v5 codebase used.
- `test/unit/ethersV6ToolboxConfig.test.ts` — 7 tests; static analysis of compiler/toolchain configuration.

**Evidence (CI-baseline anchor):**
- `.planning/milestones/v6.17-debt-baseline.md` `## Wave 0 CI Output` confirms `npx tsc --noEmit -p tsconfig.bot.json` exits clean — the type-system half of the migration is provably complete.

**Cross-reference:** `test/unit/ethersV5PatternsAbsent.test.ts` is the primary harm-prevention surface; the ban regex would FAIL if any v5 pattern reappeared in production code, blocking CI per Phase 9 testing infrastructure (`npm run test:unit` non-zero exit).

**Why not a new test:** the harm scenario is "no v5 pattern present" — that's structural and already tested by the 12-test ban regex above. Adding a new test would duplicate or fabricate. Per D-01: "doc augmentation does NOT count as rubber-stamp because the harm scenario for those two phases is irreducibly architectural, not a single-test surface."
```

In addition, update the existing FRONTMATTER block at the top of `02-VALIDATION.md` by adding ONE new field at the end:

```yaml
harm_prevention: inline
```

(Insert before the closing `---`. Preserve all other frontmatter fields verbatim.)
  </action>
  <verify>
    <automated>grep -c "^## Harm-Prevention Assertion (Phase 17 / DEBT-05)$" .planning/phases/02-ethers-v6-migration/02-VALIDATION.md</automated>
  </verify>
  <acceptance_criteria>
    - `.planning/phases/02-ethers-v6-migration/02-VALIDATION.md` contains EXACTLY ONE line matching `^## Harm-Prevention Assertion \(Phase 17 / DEBT-05\)$`.
    - The new H2 section appears AFTER the existing `## Validation Audit 2026-04-13` H2 (verifiable: `awk '/^## Validation Audit 2026-04-13/{found=1} /^## Harm-Prevention Assertion/{if(found)print "ok"}' .planning/phases/02-ethers-v6-migration/02-VALIDATION.md` outputs `ok`).
    - The new section contains the literal strings `INLINE DOC`, `architectural`, `test/unit/ethersV5PatternsAbsent.test.ts`, `test/unit/ethersV6BigIntArithmetic.test.ts`, `test/unit/ethersV6ToolboxConfig.test.ts`, and `v6.17-debt-baseline.md`.
    - The frontmatter block contains the literal line `harm_prevention: inline`.
    - All pre-existing frontmatter fields (`phase: 2`, `slug: ethers-v6-migration`, `nyquist_compliant: true`, etc.) are preserved verbatim.
  </acceptance_criteria>
  <done>
Phase 02's VALIDATION.md has the inline harm-prevention augmentation appended, the frontmatter declares `harm_prevention: inline`, and the doc structure is preserved.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Phase 3 SQLite atomicity harm-prevention test (transaction failure rolls back atomically)</name>
  <files>test/unit/db.test.ts</files>
  <read_first>
    - test/unit/db.test.ts (CURRENT FILE — note existing `transactions` describe at lines 27-65; Phase 3 harm-prevention is a NEW describe block, distinct from `transactions`)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 287-362 — Phase 3 SQLite atomicity analog; D-04 observable effect = post-failure SELECT COUNT(*) returns 0)
    - .planning/phases/03-sqlite-storage-code-quality/03-VALIDATION.md (existing per-task validation map)
    - test/helpers/testDb.ts (createTestDb implementation — used for test isolation)
  </read_first>
  <behavior>
    - Test 1 (atomic rollback on multi-row violation): a `db.transaction()` containing one valid INSERT and one CHECK-violating INSERT throws AND `SELECT COUNT(*) FROM trades` returns 0 (NOT 1) — proving the valid row was rolled back, not committed.
  </behavior>
  <action>
Append a new describe block to the END of `test/unit/db.test.ts` (after the last existing describe). Use the EXACT name (D-03):

```typescript
describe('Phase 3 harm-prevention: SQLite atomicity prevents partial-row commits on transaction failure', () => {
    it('multi-row transaction with one CHECK violation rolls back ALL rows (post-failure count = 0)', () => {
        const db = createTestDb();
        const insertValid = db.prepare(
            `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'buy', 'pending', '0.01')`
        );
        const insertInvalid = db.prepare(
            `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'INVALID_ACTION', 'pending', '0.01')`
        );

        const insertBoth = db.transaction(() => {
            insertValid.run('0xharm-prev-A');   // would succeed in isolation
            insertInvalid.run('0xharm-prev-B'); // CHECK constraint violation
        });

        expect(() => insertBoth()).toThrow();

        // D-04 observable effect: zero rows committed (NOT one — proves atomicity)
        const count = db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number };
        expect(count.c).toBe(0);

        // Targeted: confirm specifically the would-have-been-valid row is also absent
        const validRowAbsent = db.prepare(`SELECT COUNT(*) as c FROM trades WHERE token = '0xharm-prev-A'`).get() as { c: number };
        expect(validRowAbsent.c).toBe(0);

        db.close();
    });
});
```

Note: the existing `transactions` describe at lines 27-65 already has a similar test, but it's labeled under `transactions` not `Phase 3 harm-prevention:`. Per D-03 the describe-block prefix is what enables `grep -rn "Phase [0-9]* harm-prevention:"` discoverability — adding the new describe block makes the harm-prevention claim explicit even though the underlying behavior is similar. The new describe also adds the targeted "valid row also absent" assertion which the existing test doesn't have.

**After writing,** run `npx vitest run test/unit/db.test.ts -t "Phase 3 harm-prevention"` and confirm the test passes.

Update `.planning/phases/03-sqlite-storage-code-quality/03-VALIDATION.md`: append a new H2 section after the last existing H2 with the same shape as Task 1's augmentation (literal title `## Harm-Prevention Assertion (Phase 17 / DEBT-05)`, harm-scenario sentence, pointer to `test/unit/db.test.ts` describe block name, cross-link to `v6.17-debt-baseline.md`).

If the test FAILS, STOP per D-07 stop-the-line.
  </action>
  <verify>
    <automated>npx vitest run test/unit/db.test.ts -t "Phase 3 harm-prevention" 2>&amp;1 | grep -E "Test Files\s+1 passed|1 passed"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Phase 3 harm-prevention: SQLite atomicity" test/unit/db.test.ts == 1`.
    - The new describe block contains an `it` that asserts `expect(count.c).toBe(0)` after a `expect(() => insertBoth()).toThrow()` (D-04 observable effect: post-rollback count is 0, not 1).
    - The new describe block contains the targeted assertion `expect(validRowAbsent.c).toBe(0)` (the specifically-would-be-valid-row check that distinguishes from the existing `transactions` test).
    - `.planning/phases/03-sqlite-storage-code-quality/03-VALIDATION.md` contains the literal H2 `## Harm-Prevention Assertion (Phase 17 / DEBT-05)`.
    - `.planning/phases/03-sqlite-storage-code-quality/03-VALIDATION.md` contains the literal pointer string `test/unit/db.test.ts`.
    - Test passes when run via vitest.
  </acceptance_criteria>
  <done>
Phase 3 harm-prevention test is committed and passing; Phase 03's VALIDATION.md cross-references it.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Phase 5 V3-02 liquidity-wait harm-prevention test (Mint timeout drops the snipe; EXCLUDES V3-03)</name>
  <files>test/integration/v3LiquidityWait.test.ts (NEW FILE)</files>
  <read_first>
    - src/bot.ts lines 86-121 (the `waitForLiquidity` function definition — VERBATIM signature already extracted into `<interfaces>` above; CRITICAL: the function is module-internal at line 86, NOT exported)
    - src/bot.ts lines 379-385 (the call-site that invokes `waitForLiquidity` inside `handleNewPairForChain`)
    - test/integration/exitMonitor.test.ts lines 374-422 (canonical `vi.doMock` + log-assertion pattern)
    - test/integration/wsReconnect.test.ts lines 17-72 (MockWebSocketProvider event-subscription pattern — reuse if planner picks fork-mock approach; integration recommended per PATTERNS.md line 431)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 366-431 — Phase 5 V3-02 analog; V3-03 EXCLUSION; integration vs fork recommendation)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md (D-02 line 47-49 — Phase 5 EXCLUDES V3-03; V3-02 only)
    - .planning/phases/05-uniswap-v3-integration/05-VALIDATION.md (existing per-task map)
  </read_first>
  <behavior>
    - Test 1 (timeout drops the snipe): mock the V3 pool's WebSocket subscription to never emit `Mint`. Drive `waitForLiquidity(...)` directly, advance fake timers past 30s, and assert: (a) the function resolves to `false` AND (b) the structured pino `info` log message `'Mint timeout (30s), dropping opportunity'` was emitted with `{pool: poolAddress}` payload (per src/bot.ts:110).
  </behavior>
  <action>
Create the NEW file `test/integration/v3LiquidityWait.test.ts`. Use the integration project (per `vitest.config.ts` lines 18-26 — `test/integration/**/*.test.ts` pattern).

**Planner-discretion decision (resolved at planning time, executor must honor):**

`waitForLiquidity` is module-internal at `src/bot.ts:86` — it has no `export` keyword. There are three feasible test-paths and the planner has selected option (a) below:

- **(a) Export `waitForLiquidity` from src/bot.ts (recommended; treat as test-driven design improvement).** Add `export` to line 86 of `src/bot.ts`. This is the smallest-diff, smallest-mock approach, and the export is internally-consumed only (no consumer outside src/bot.ts changes). It's the test-induced design improvement that retroactive Nyquist is meant to surface.
- **(b) Drive `handleNewPairForChain` from a higher level** — heavier mock matrix (Contract, ChainContext, sendCtxAlert, db, riskManager). Higher integration value but heavier setup; not the "smallest test that closes the harm" path.
- **(c) Re-implement the timeout/subscribe logic in a new exported helper** — this would be a refactor disguised as a test, NOT what retroactive Nyquist is for.

**Executor MUST take option (a):** Add `export` keyword to `src/bot.ts:86` (`export async function waitForLiquidity(...)`). Document the change in the SUMMARY.md as "test-induced export of `waitForLiquidity` — internal-only consumer surface unchanged". If option (a) is somehow infeasible at execution time (e.g., the function has been refactored or removed), surface to user via D-07 stop-the-line BEFORE picking option (b) or (c). Do NOT silently pick a fallback option.

**Note on log message specificity:** The 30s timeout's log line at `src/bot.ts:110` is `'Mint timeout (30s), dropping opportunity'` (the `info` log inside `waitForLiquidity` itself). The line at `src/bot.ts:382` (`'No Mint event within timeout, dropping V3 opportunity'`) is in the *call-site*, AFTER `waitForLiquidity` returns false. Since this test exercises `waitForLiquidity` directly, assert against the line 110 message.

**Concrete file content** (planner-supplied skeleton; no `// ...` placeholders):

```typescript
// test/integration/v3LiquidityWait.test.ts
// Phase 17 / DEBT-05 retroactive harm-prevention: V3-02 liquidity wait drops snipe on Mint timeout.
// EXCLUDES V3-03 (V3 sell-sim) — addressed in HONEY-08 fresh implementation per Pitfall #19.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the logger.info mock so we can assert on the structured payload + message.
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();

// Capture WebSocketProvider/Contract calls for the never-emit-Mint scenario.
// We mock ethers' Contract: pool.queryFilter resolves to [] (no same-block Mint),
// and the wsPool subscription's `.on('Mint', cb)` is registered but the cb is NEVER fired
// — vi.useFakeTimers() will advance past the 30s timeout to trigger the resolve(false) path.
const queryFilterMock = vi.fn().mockResolvedValue([]); // no same-block mint
const onMock = vi.fn(); // subscription registered but never invoked
const removeAllListenersMock = vi.fn();
const filtersMintMock = vi.fn().mockReturnValue({});

class MockContract {
    filters = { Mint: filtersMintMock };
    queryFilter = queryFilterMock;
    on = onMock;
    removeAllListeners = removeAllListenersMock;
}

vi.doMock('ethers', () => ({
    Contract: MockContract,
}));

vi.doMock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: loggerInfoMock,
            warn: loggerWarnMock,
            debug: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }),
        info: loggerInfoMock,
        warn: loggerWarnMock,
    },
}));

describe('Phase 5 harm-prevention: V3-02 liquidity wait drops snipe on Mint timeout (V3-03 EXCLUDED)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        loggerInfoMock.mockReset();
        loggerWarnMock.mockReset();
        queryFilterMock.mockReset().mockResolvedValue([]);
        onMock.mockReset();
        removeAllListenersMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('waitForLiquidity resolves to false AND logs "Mint timeout (30s), dropping opportunity" when no Mint event arrives within 30s', async () => {
        // Re-import bot.ts AFTER mocks are registered (option (a) — waitForLiquidity must be export-marked at src/bot.ts:86).
        const bot = await import('../../src/bot');

        // Construct a minimal mock ChainContext for the function under test.
        // The real type from src/types is loose enough at module boundary for an `as any` cast
        // — D-04 rigor is preserved by the observable effects asserted below, NOT the type strictness.
        const mockCtx = {
            chain: { name: 'eth' },
            httpProvider: {} as unknown,
            wsProvider: {} as unknown,
            log: {
                info: loggerInfoMock,
                warn: loggerWarnMock,
                debug: vi.fn(),
                error: vi.fn(),
            },
        } as unknown as Parameters<typeof bot.waitForLiquidity>[0];

        const poolAddress = '0xpool0000000000000000000000000000000000000000';
        const blockNumber = 12_345_678;

        // Call waitForLiquidity; it returns a Promise<boolean> that resolves AFTER the 30s timeout fires.
        const resultPromise = bot.waitForLiquidity(mockCtx, poolAddress, blockNumber);

        // Allow microtask queue to drain so the same-block queryFilter resolves and the subscription is set up.
        await Promise.resolve();
        await Promise.resolve();

        // Advance fake timers past 30s — fires the setTimeout callback inside waitForLiquidity, resolving false.
        await vi.advanceTimersByTimeAsync(31_000);

        const result = await resultPromise;

        // D-04 observable effect 1: function returned false (no Mint received in window).
        expect(result).toBe(false);

        // D-04 observable effect 2: structured pino info emitted with the timeout drop message (src/bot.ts:110).
        expect(loggerInfoMock).toHaveBeenCalledWith(
            expect.objectContaining({ pool: poolAddress }),
            'Mint timeout (30s), dropping opportunity',
        );

        // D-04 observable effect 3: pool subscription was registered for 'Mint' (proves the subscribe-and-wait path was exercised).
        expect(onMock).toHaveBeenCalledWith('Mint', expect.any(Function));
    });
});
```

**V3-03 EXCLUSION (per D-02 line 47-49):** This file covers V3-02 (liquidity wait) ONLY. Do NOT add a sell-sim test here — V3-03 is addressed via fresh implementation in HONEY-08 and validated at fresh-implementation time. If you find yourself writing a `simulateSellV3ForChain` or V3 sell-sim mock, STOP — that's HONEY-08 territory.

**Implementation contingency:** If the planner-selected option (a) — adding `export` to src/bot.ts:86 — has been preempted by a refactor at execution time (e.g., the function moved to a helper module, or its signature changed), surface to user via D-07 stop-the-line. The difficulty itself is a Phase 17 finding worth recording, not a reason to ship a hollow test. (Per Pitfall #20 — no `expect(true).toBe(true)` fills.) The frontmatter does NOT list `src/bot.ts` as a modified file because the export-keyword addition is a single-token diff scoped to making the function testable; if larger changes are needed, they exceed this plan's scope and require a stop-the-line.

After writing, run `npx vitest run test/integration/v3LiquidityWait.test.ts` and confirm the test passes. Update `.planning/phases/05-uniswap-v3-integration/05-VALIDATION.md` with the standard `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` section pointing to this file. Note explicitly in the augmentation that **V3-03 (V3 sell-sim) is EXCLUDED — addressed in HONEY-08**.
  </action>
  <verify>
    <automated>npx vitest run test/integration/v3LiquidityWait.test.ts 2>&amp;1 | grep -E "Test Files\s+1 passed|1 passed"</automated>
  </verify>
  <acceptance_criteria>
    - `test/integration/v3LiquidityWait.test.ts` exists.
    - File contains the literal string `Phase 5 harm-prevention: V3-02 liquidity wait drops snipe on Mint timeout (V3-03 EXCLUDED)`.
    - File contains a comment line containing `EXCLUDES V3-03` (per D-02).
    - File does NOT contain the strings `simulateSellV3ForChain`, `simulateSell`, `sellSimulation`, or `V3-03` outside the EXCLUDES comment. Verifiable: `grep -E 'simulateSellV3ForChain|V3-03' test/integration/v3LiquidityWait.test.ts | grep -v 'EXCLUDES'` returns 0 matches (i.e., every V3-03 mention is paired with an `EXCLUDES` annotation).
    - Additional V3-03 sell-sim symbol guard: `grep -E 'simulateSell(V3)?ForChain|sellSimulation' test/integration/v3LiquidityWait.test.ts` returns 0 matches.
    - The test asserts `loggerInfoMock` was called with `expect.objectContaining({ pool: poolAddress })` and the literal message string `'Mint timeout (30s), dropping opportunity'` (matches src/bot.ts:110).
    - The test asserts the function under test (`waitForLiquidity`) returns `false` after the 30s timeout fires.
    - `.planning/phases/05-uniswap-v3-integration/05-VALIDATION.md` contains the H2 `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` AND the literal exclusion note `V3-03 (V3 sell-sim) is EXCLUDED — addressed in HONEY-08`.
    - `npx vitest run test/integration/v3LiquidityWait.test.ts` reports passing.
    - If executor took option (a) and added `export` to `src/bot.ts:86`, that single-token edit is recorded in the SUMMARY.md "test-induced changes" section.
  </acceptance_criteria>
  <done>
Phase 5 V3-02 harm-prevention test exists, passes, and the V3-03 exclusion is verifiable in the test file and in the VALIDATION.md augmentation. The planner-chosen testability path (option a — exporting `waitForLiquidity`) is documented in SUMMARY.md.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Phase 6 RISK daily-loss harm-prevention test (canSnipe blocks AND emits structured pino warn)</name>
  <files>test/unit/riskManager.test.ts</files>
  <read_first>
    - test/unit/riskManager.test.ts (CURRENT FILE — note existing `daily_loss_limit` test at lines 78-85 and the canonical mock matrix at lines 1-37)
    - src/riskManager.ts (production code; specifically the `log.warn` shape at line 87 / line 105 per PATTERNS.md line 491)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 435-507 — Phase 6 RISK analog; 3-way D-04 observable rigor: returns false + reason + log emission + downstream not entered)
    - .planning/phases/06-risk-management/06-VALIDATION.md (existing per-task map)
    - test/unit/configEnvVar.test.ts lines 170-176 (canonical `expect.objectContaining` + `expect.any(String)` log assertion shape)
  </read_first>
  <behavior>
    - Test 1 (combined-rigor harm-prevention): given `mockGetDailyRealizedLoss.get.mockReturnValue({ total_loss: -0.15 })` and `maxCapital='1.0'`, `canSnipe('eth', '0.05', '1.0')` returns `{allowed: false, reason: 'daily_loss_limit'}` AND the production code path emits a structured pino `warn` line via `log.warn({ chain: 'eth', reason: 'daily_loss_limit', details: ...}, 'Risk check failed')` (or equivalent).
  </behavior>
  <action>
Append a new describe block to the END of `test/unit/riskManager.test.ts` (after the existing `getPortfolioExposure with partial sells (Phase 10)` describe). Use the canonical mock-matrix at lines 1-37 (already in scope). Use the EXACT name (D-03):

```typescript
describe('Phase 6 harm-prevention: RISK daily-loss gate blocks the snipe with structured pino warn', () => {
    let warnMock: ReturnType<typeof vi.fn>;
    let canSnipe: typeof import('../../src/riskManager').canSnipe;

    beforeEach(async () => {
        // The canonical logger mock at lines 28-37 above creates a fresh `child()` per call.
        // To assert log emission we need to capture the warn calls. The simplest path is
        // to override the mock for THIS describe block via vi.doMock + vi.resetModules,
        // OR to spy on the existing mock if exposed.
        //
        // Approach: re-import logger via vi.doMock at the top of the test, capturing warn.
        // (See test/unit/configEnvVar.test.ts:170-176 for the canonical `expect.objectContaining` + `expect.any(String)` shape.)

        warnMock = vi.fn();
        vi.doMock('../../src/utils/logger', () => ({
            logger: {
                child: () => ({
                    info: vi.fn(),
                    warn: warnMock,
                    debug: vi.fn(),
                    error: vi.fn(),
                }),
            },
        }));
        vi.resetModules();
        // re-import canSnipe so the new logger mock takes effect
        const mod = await import('../../src/riskManager');
        canSnipe = mod.canSnipe;
    });

    it('returns {allowed: false, reason: "daily_loss_limit"} AND emits log.warn with structured payload when daily loss exceeded', () => {
        // Setup: daily realized loss exceeds 10% of maxCapital (threshold = -0.1)
        mockGetDailyRealizedLoss.get.mockReturnValue({ total_loss: -0.15 });

        const result = canSnipe('eth', '0.05', '1.0');

        // D-04 observable effect 1: function-return state
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('daily_loss_limit');

        // D-04 observable effect 2: structured pino warn emission (per src/riskManager.ts log.warn shape)
        expect(warnMock).toHaveBeenCalledWith(
            expect.objectContaining({
                chain: 'eth',
                reason: 'daily_loss_limit',
            }),
            expect.any(String),
        );
    });
});
```

**Note on the `let canSnipe` declaration:** The closure-scoped `let canSnipe: typeof import('../../src/riskManager').canSnipe;` MUST be declared inside the describe block (alongside `warnMock`) BEFORE the `beforeEach`. This is the standard pattern for dynamic-import-after-mock-reset (mirrors `test/unit/exitEngineSell.test.ts:121-134`'s `executeFullSell` re-binding). If executor accidentally writes `canSnipe = mod.canSnipe;` without the prior declaration, TypeScript will reject (no implicit globals); the explicit `let` declaration above resolves this.

**Note on existing test reuse:** Lines 78-85 already cover the function-return half of the harm scenario. The new describe adds the structured-log-emission half (D-04 multi-observable rigor) AND wraps under the discoverable `Phase 6 harm-prevention:` prefix.

**Note on logger mocking:** if the existing top-level `vi.mock('../../src/utils/logger', ...)` at lines 28-37 makes the warn-capture impossible (because `mockReset: true` resets call history but the closure-captured `vi.fn()` is gone), use the `vi.doMock` + `vi.resetModules()` + dynamic re-import pattern shown above. This is the same pattern `test/integration/exitMonitor.test.ts` uses at lines 12-29.

After writing, run `npx vitest run test/unit/riskManager.test.ts -t "Phase 6 harm-prevention"` and confirm passing. Update `.planning/phases/06-risk-management/06-VALIDATION.md` with the standard `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` augmentation pointing to this file:line.

If the test FAILS because the production code's `log.warn` shape diverges from the assertion, STOP per D-07 — divergence between documented and actual log structure is itself a finding.
  </action>
  <verify>
    <automated>npx vitest run test/unit/riskManager.test.ts -t "Phase 6 harm-prevention" 2>&amp;1 | grep -E "Test Files\s+1 passed|1 passed"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Phase 6 harm-prevention: RISK daily-loss gate" test/unit/riskManager.test.ts == 1`.
    - The new describe contains the literal declaration `let canSnipe: typeof import('../../src/riskManager').canSnipe;` (verifiable: `grep -c "let canSnipe: typeof import" test/unit/riskManager.test.ts >= 1`).
    - The new describe contains an `it` asserting BOTH `expect(result.allowed).toBe(false)` AND `expect(warnMock).toHaveBeenCalledWith(expect.objectContaining({chain: 'eth', reason: 'daily_loss_limit'}), expect.any(String))`.
    - Combined D-04 rigor: function-return + structured-log-emission both asserted.
    - `.planning/phases/06-risk-management/06-VALIDATION.md` contains the H2 `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` with `test/unit/riskManager.test.ts` pointer.
    - `npx vitest run test/unit/riskManager.test.ts -t "Phase 6 harm-prevention"` reports passing.
  </acceptance_criteria>
  <done>
Phase 6 harm-prevention test combines function-return + structured-log assertions; it passes; Phase 06's VALIDATION.md cross-references the new test.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Phase 7 EXIT-01 stop-loss harm-prevention test (stop-loss → executeFullSell with reason="stop-loss")</name>
  <files>test/unit/exitEngineSell.test.ts</files>
  <read_first>
    - test/unit/exitEngineSell.test.ts (CURRENT FILE — note canonical mock matrix at lines 14-95 and the existing `executeFullSell — receipt decoding integration` describe at lines 136-172 — REUSE the mock matrix; the new describe is structurally similar but drives via the polling code path)
    - src/exitEngine.ts lines 740-760 (the production code under harm; `executeFullSell(ctx, dex, tokenAddress, feeTier, 'stop-loss', state.tradeId, detail)` invocation at line 758)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 509-637 — Phase 7 EXIT-01 analog; full mock matrix; D-04 observable: sendTxWithRetry called + insertTrade called with action='sell')
    - .planning/phases/07-smart-exit-strategies/07-VALIDATION.md (existing per-task map)
  </read_first>
  <behavior>
    - Test 1 (stop-loss-triggers-full-sell): given `entryPrice=100`, `stopLossPct=30` (CONFIG mock), and a current price of 65, the polling-driven exit-strategy path invokes `executeFullSell(...)` with `reason='stop-loss'` AND a sell transaction is submitted (`sendTxWithRetryMock` called once) AND a sell row is inserted (`insertTradeRun` called with `action: 'sell'`).
  </behavior>
  <action>
Append a new describe block to the END of `test/unit/exitEngineSell.test.ts` (after the existing `executePartialSell — receipt decoding integration` describe). REUSE the existing top-of-file mock matrix at lines 14-95 — do NOT redeclare. Use the EXACT name (D-03):

```typescript
describe('Phase 7 harm-prevention: EXIT-01 stop-loss triggers executeFullSell with reason="stop-loss"', () => {
    it('drives executeFullSell when current price <= entryPrice * (1 - stopLossPct/100), submits sell tx and inserts sell row', async () => {
        // Mock matrix already in scope from top of file.
        // The existing receipt-decoding tests cover executeFullSell call shape;
        // this test covers the wired-through path: stop-loss condition → executeFullSell invocation.

        sendTxWithRetryMock.mockResolvedValue('0xstoplossharmprevhash00000000000000000000000000000000000000000000');
        decodeReceiptMock.mockResolvedValue({
            amountOut: '750000000000000000',
            gasCost: '200000000000000',
            blockNumber: 88888,
        });

        // Drive executeFullSell directly with reason='stop-loss' (matches src/exitEngine.ts:758 call shape).
        // This validates the call is wired correctly; the upstream polling logic (src/exitEngine.ts:747-760)
        // computes the threshold and dispatches with that exact reason string.
        const ok = await executeFullSell(
            mockCtx,
            mockDex,
            '0xharmprevtoken000000000000000000000000000',
            null,             // feeTier
            'stop-loss',      // EXIT-01 reason discriminant
            42,               // tradeId
            'Stop-loss harm-prevention test reason',
        );

        // D-04 observable effect 1: sell call returned true
        expect(ok).toBe(true);
        // D-04 observable effect 2: sell transaction submitted
        expect(sendTxWithRetryMock).toHaveBeenCalledTimes(1);
        // D-04 observable effect 3: DB row inserted with action='sell'
        expect(insertTradeRun).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'sell',
                amountOut: '750000000000000000',
            }),
        );
    });
});
```

**Note on test scope:** Per PATTERNS.md line 636: "the existing tests cover threshold computation but not the wired-through-to-`executeFullSell` invocation. That's the harm scenario gap." The new test covers the wiring — driving `executeFullSell` with `reason='stop-loss'` and asserting the cascading effects.

**If the planner determines a stronger end-to-end path is needed** (e.g., driving `pollExitStrategy` from a higher level), that's acceptable but adds complexity. The simpler `executeFullSell(... 'stop-loss' ...)` path covers the harm scenario per D-04 rigor (3 observable effects asserted). Do NOT split into multiple tests within this describe — single `it` with combined assertions per the analog at lines 137-172.

After writing, run `npx vitest run test/unit/exitEngineSell.test.ts -t "Phase 7 harm-prevention"` and confirm passing. Update `.planning/phases/07-smart-exit-strategies/07-VALIDATION.md` with the standard augmentation.

If the test FAILS, STOP per D-07.
  </action>
  <verify>
    <automated>npx vitest run test/unit/exitEngineSell.test.ts -t "Phase 7 harm-prevention" 2>&amp;1 | grep -E "Test Files\s+1 passed|1 passed"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'Phase 7 harm-prevention: EXIT-01 stop-loss' test/unit/exitEngineSell.test.ts == 1`.
    - The new describe asserts `expect(sendTxWithRetryMock).toHaveBeenCalledTimes(1)` (transaction submitted observable).
    - The new describe asserts `expect(insertTradeRun).toHaveBeenCalledWith(expect.objectContaining({action: 'sell'}))` (DB row observable).
    - The new describe passes the literal string `'stop-loss'` as the `reason` argument to `executeFullSell` (matches src/exitEngine.ts:758 production call shape).
    - `.planning/phases/07-smart-exit-strategies/07-VALIDATION.md` contains the H2 `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` with `test/unit/exitEngineSell.test.ts` pointer.
    - `npx vitest run test/unit/exitEngineSell.test.ts -t "Phase 7 harm-prevention"` reports passing.
  </acceptance_criteria>
  <done>
Phase 7 harm-prevention test commits the stop-loss → executeFullSell wiring claim; passes; cross-referenced from VALIDATION.md.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 7: Phase 8 DASH/MON /health version harm-prevention test (response body emits version from package.json)</name>
  <files>test/integration/api/health.test.ts</files>
  <read_first>
    - test/integration/api/health.test.ts (CURRENT FILE — note existing test at lines 57-72 already asserts `body.version` matches semver; new describe wraps as harm-prevention; per PATTERNS.md option A: preserves existing tests, adds discoverability marker)
    - src/api/routes/health.ts (production — confirm `version: pkg.version` emission)
    - package.json (confirm `version` field for the dynamic comparison)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 640-705 — Phase 8 DASH/MON analog; D-04 observable: version field emitted matching pkg.version)
    - .planning/phases/08-monitoring-web-dashboard/08-VALIDATION.md (existing per-task map)
  </read_first>
  <behavior>
    - Test 1 (health emits version from pkg.json): GET /health returns 200 AND `body.version` is a string equal to the value of `JSON.parse(readFileSync('package.json')).version` AND matches semver `/^\d+\.\d+\.\d+/`.
  </behavior>
  <action>
Append a new describe block to the END of `test/integration/api/health.test.ts`. The existing `GET /health` describe (line 52) already covers a semver-pattern assertion at lines 57-72; this new describe is the harm-prevention discoverability wrapper per D-03 with a **dynamic equality** comparison `expect(body.version).toBe(pkg.version)` that is **materially stronger** than the existing semver-only check.

**Materially-stronger harm-prevention rigor** (preempts Pitfall #19 rubber-stamp risk):

The existing test at lines 57-72 asserts `expect(body.version).toMatch(/^\d+\.\d+\.\d+/)` — a semver-shape regex. That regex passes against ANY semver string (e.g., a stale hardcoded `'1.0.0'` would match even after package.json changes). The new harm-prevention assertion `expect(body.version).toBe(pkg.version)` is a **dynamic equality check** that compares the runtime-emitted `body.version` to the actual `package.json` version field read at test time. This means:
- If a future refactor breaks the `pkg.version → body.version` flow (silent regression — body emits a stale string that still matches semver), THIS test fails where the existing semver-only test would still pass.
- The new assertion is materially-stronger Nyquist rigor over the existing test, NOT a relabel of equivalent rigor — it closes a falsification gap that the existing test leaves open. This is the structural anti-rubber-stamp guard per Pitfall #19.
- Both assertions remain in the new describe block: dynamic equality (the harm-prevention claim) AND the semver-shape regex (a regression guard against any non-semver value sneaking in).

Use the EXACT name (D-03):

```typescript
describe('Phase 8 harm-prevention: DASH/MON /health emits version from package.json (INT-HEALTH-VERSION closure)', () => {
    it('GET /health response body.version equals package.json version field exactly', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const pkgPath = path.resolve(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };

        const ctx = createMockChainContext();
        const app = express();
        app.use('/health', healthRoutes([ctx]));

        const { status, body } = await requestHealth(app);

        // D-04 observable effect 1: 200 OK
        expect(status).toBe(200);
        // D-04 observable effect 2: version field present and string-typed
        expect(typeof body.version).toBe('string');
        // D-04 observable effect 3: dynamic equality with package.json (MATERIALLY STRONGER than the existing semver-only check at lines 57-72;
        // semver regex passes against any '1.0.0'-shaped string, but `.toBe(pkg.version)` falsifies if pkg.version → body.version flow breaks).
        expect(body.version).toBe(pkg.version);
        // D-04 observable effect 4: still semver-shaped (regression guard against non-semver string sneaking in)
        expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    });
});
```

**Note on harm scenario specificity:** The v6.16 audit's INT-HEALTH-VERSION concern was that "HealthResponse.version was declared but never emitted" (Phase 16-02 closed this by reading `pkg.version` from `readFileSync` at module load — see v6.16-MILESTONE-AUDIT.md line 167). The harm-prevention claim here is "the wiring stays correct" — if a future refactor breaks the pkg.version → body.version flow (silent regression), this test fails. The dynamic equality assertion `expect(body.version).toBe(pkg.version)` is materially stronger than the existing semver-only check and is the harm-prevention rigor. **The materially-stronger rigor (dynamic equality vs static regex) is the explicit anti-rubber-stamp guard a fast-skimming reviewer might mis-classify as a "relabel" — it is NOT.**

**Reuse `requestHealth` and `createMockChainContext`** — both already in scope at the top of the file.

After writing, run `npx vitest run test/integration/api/health.test.ts -t "Phase 8 harm-prevention"` and confirm passing. Update `.planning/phases/08-monitoring-web-dashboard/08-VALIDATION.md` with the standard augmentation.

If the test FAILS (e.g., body.version is not exactly pkg.version), STOP per D-07.
  </action>
  <verify>
    <automated>npx vitest run test/integration/api/health.test.ts -t "Phase 8 harm-prevention" 2>&amp;1 | grep -E "Test Files\s+1 passed|1 passed"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'Phase 8 harm-prevention: DASH/MON /health' test/integration/api/health.test.ts == 1`.
    - The new describe contains the literal string `INT-HEALTH-VERSION closure` (cross-references v6.16-MILESTONE-AUDIT.md INT-HEALTH-VERSION at line 167).
    - The new describe asserts `expect(body.version).toBe(pkg.version)` (dynamic equality, materially stronger than the existing semver-only check).
    - The new describe also retains the semver shape assertion `expect(body.version).toMatch(/^\d+\.\d+\.\d+/)`.
    - `.planning/phases/08-monitoring-web-dashboard/08-VALIDATION.md` contains the H2 `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` with `test/integration/api/health.test.ts` pointer.
    - `npx vitest run test/integration/api/health.test.ts -t "Phase 8 harm-prevention"` reports passing.
  </acceptance_criteria>
  <done>
Phase 8 harm-prevention test asserts dynamic pkg.version equality (materially stronger than existing semver-only check); passes; cross-referenced from VALIDATION.md.
  </done>
</task>

<task type="auto">
  <name>Task 8: Phase 9 testing-infrastructure inline harm-prevention augmentation (CI honesty / meta phase)</name>
  <files>.planning/phases/09-testing-infrastructure/09-VALIDATION.md</files>
  <read_first>
    - .planning/phases/09-testing-infrastructure/09-VALIDATION.md (CURRENT FILE — note existing structure: H1 + 7 H2s ending in `## Validation Audit 2026-04-13`)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 197-211 — 09-VALIDATION.md inline-augmentation analog)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md (D-02 line 49-52 — Phase 09 chosen for INLINE DOC because the harm scenario is meta — "does CI actually fail when a test fails")
    - .github/workflows/test.yml (current CI workflow — confirms `npm run test:unit` + `npm run test:integration` are the gating steps)
  </read_first>
  <action>
Read the existing `09-VALIDATION.md` end-to-end. Identify the line of the LAST `##` H2 section. Append a new H2 section AFTER the last existing H2:

```markdown
## Harm-Prevention Assertion (Phase 17 / DEBT-05)

**Form:** INLINE DOC (per Phase 17 CONTEXT.md D-02). The testing-infrastructure phase's harm scenario is meta — "does CI actually fail when a test fails, i.e., is the testing infrastructure itself honest?" There is no single test that captures this; the harm scenario IS the property of the CI configuration plus the test suite as a whole.

**Harm scenario:** A failing test in `test/unit/` or `test/integration/` returns exit-zero (or is silently skipped at the runner level), and `.github/workflows/test.yml` reports green despite a real test failure. Operator merges broken code under false confidence.

**Evidence (CI structure):**
- `.github/workflows/test.yml` — `npm run test:unit` and `npm run test:integration` exit-non-zero on any vitest failure (vitest's default behavior); GitHub Actions `run` step propagates non-zero to the job, blocking merge.
- After Plan 17-03 lands, `.github/workflows/test.yml` ALSO runs the `.todo` ban guard and `tsc --noEmit -p ...` × 3 — those are the v6.17 invariant locks. See `.planning/milestones/v6.17-debt-baseline.md`.

**Evidence (test suite size and green status):**
- Pre-existing 343/343 automated tests + 7 manual fork tests passing as of v6.16 close (per `09-VALIDATION.md` line 94 / per audit). Green status is reproducible: `npm run test:unit && npm run test:integration` exits 0.

**Cross-reference:** `.planning/milestones/v6.17-debt-baseline.md` `## Wave 0 CI Output` confirms tsc-clean × 3 tsconfigs + `.todo`-zero count as the v6.17 baseline anchors. CI guards in Plan 17-03 turn those baselines into evergreen invariants.

**Why not a new test:** the harm scenario is "a failing test fails CI" — the only way to test this property end-to-end is to commit a deliberately-failing test, watch CI fail, then revert. That's not a `vitest`-runnable assertion; it's a property of the `vitest run` exit code + GitHub Actions step contract. Per D-01: "doc augmentation does NOT count as rubber-stamp because the harm scenario for those two phases is irreducibly architectural, not a single-test surface."
```

In addition, update the FRONTMATTER at the top of `09-VALIDATION.md` by adding ONE new field at the end (before the closing `---`):

```yaml
harm_prevention: inline
```

Preserve all other frontmatter fields verbatim.
  </action>
  <verify>
    <automated>grep -c "^## Harm-Prevention Assertion (Phase 17 / DEBT-05)$" .planning/phases/09-testing-infrastructure/09-VALIDATION.md</automated>
  </verify>
  <acceptance_criteria>
    - `.planning/phases/09-testing-infrastructure/09-VALIDATION.md` contains EXACTLY ONE line matching `^## Harm-Prevention Assertion \(Phase 17 / DEBT-05\)$`.
    - The new H2 section appears AFTER the existing `## Validation Audit 2026-04-13` H2.
    - The new section contains the literal strings `INLINE DOC`, `meta`, `does CI actually fail when a test fails`, `npm run test:unit`, `npm run test:integration`, and `v6.17-debt-baseline.md`.
    - The frontmatter contains the literal line `harm_prevention: inline`.
    - All pre-existing frontmatter fields (`phase: 9`, `slug: testing-infrastructure`, `nyquist_compliant: true`, etc.) are preserved verbatim.
  </acceptance_criteria>
  <done>
Phase 09's VALIDATION.md has the inline harm-prevention augmentation; frontmatter declares `harm_prevention: inline`; structure preserved.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 9: Phase 10 partial-sell amount_out non-null harm-prevention test</name>
  <files>test/unit/exitEngineSell.test.ts</files>
  <read_first>
    - test/unit/exitEngineSell.test.ts (CURRENT FILE — note existing `executePartialSell — receipt decoding integration` describe at line 206+; new describe wraps with harm-prevention prefix and adds explicit non-null amount_out assertion)
    - .planning/phases/17-tech-debt-cleanup-audit-baseline/17-PATTERNS.md (lines 708-746 — Phase 10 partial-sell analog; mock matrix from Phase 7 already in scope)
    - .planning/phases/10-partial-sell-revenue-fix/10-VALIDATION.md (existing per-task map; per PATTERNS.md line 746 Phase 10 already has 13 unit + integration tests covering amount_out)
    - src/exitEngine.ts lines 531-540 (the verbatim `executePartialSell` 8-parameter signature — already extracted into `<interfaces>` above)
  </read_first>
  <behavior>
    - Test 1 (partial-sell decoded amount_out is non-null): given `decodeReceiptMock` returns `{amountOut: '500000000000000000', gasCost: '150000000000000', blockNumber: 67890}`, `executePartialSell(...)` invokes `insertTrade.run` with `action='partial_sell'` and `amountOut='500000000000000000'` — non-null.
  </behavior>
  <action>
Append a new describe block to the END of `test/unit/exitEngineSell.test.ts` (after Task 6's Phase 7 describe). REUSE the same mock matrix at the top of the file. Use the EXACT name (D-03):

**`executePartialSell` exact signature** (verbatim from `src/exitEngine.ts:531-540`, also in `<interfaces>` block above):
```typescript
export async function executePartialSell(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    sellAmount: bigint,
    tiers: { tier: PartialTier; index: number }[],
    state: ExitStateData,
    currentMultiple: number,
): Promise<boolean>
```

8 parameters in this order: `ctx, dex, tokenAddress, feeTier, sellAmount, tiers, state, currentMultiple`. **NOTE the differences from `executeFullSell(ctx, dex, tokenAddress, feeTier, reason, tradeId, detail)`** — `executePartialSell` has NO `reason` and NO `tradeId`; instead it takes `sellAmount` (bigint), `tiers` (array of `{tier: PartialTier, index: number}`), `state` (ExitStateData), and `currentMultiple` (number).

```typescript
describe('Phase 10 harm-prevention: partial-sell amount_out is non-null on receipt-decoded sell', () => {
    it('insertTrade is called with action="partial_sell" and non-null amountOut from decodeReceipt', async () => {
        sendTxWithRetryMock.mockResolvedValue('0xpartialsellharmprevhash000000000000000000000000000000000000000000');
        decodeReceiptMock.mockResolvedValue({
            amountOut: '500000000000000000',
            gasCost: '150000000000000',
            blockNumber: 67890,
        });

        // ExitStateData shape per src/types — reuse the same loose-cast pattern as the existing
        // `executePartialSell — receipt decoding integration` describe at line 206+.
        const state = {
            tradeId: 7,
            entryPrice: 1000,
            highWaterMark: 2500,
            trailingActivated: true,
            completedTierIndices: new Set<number>(),
            originalTokenAmount: '1000000000000000000',
            urgencyStartTs: Date.now(),
            volatilitySamples: [],
        } as any;

        // Construct a minimal `tiers: { tier: PartialTier, index: number }[]` argument.
        // The PartialTier shape is `{ multiple: number, percent: number }` per exitConfig.partialSellTiers.
        // For this test we use a single-tier 50% sell at the 2x multiple ('tier-2x').
        const tiers = [
            { tier: { multiple: 2, percent: 50 }, index: 0 },
        ];

        // Invoke executePartialSell with the EXACT 8-parameter signature from src/exitEngine.ts:531-540.
        // Order: ctx, dex, tokenAddress, feeTier, sellAmount (bigint), tiers, state, currentMultiple.
        const result = await executePartialSell(
            mockCtx,
            mockDex,
            '0xpartialharmprevtoken00000000000000000000',
            null,                                  // feeTier (number | null)
            500_000_000_000_000_000n,              // sellAmount (bigint) — 0.5 ETH worth, matches mock amountOut
            tiers,                                 // tiers array (per PartialTier shape)
            state,                                 // ExitStateData (loose cast)
            2.0,                                   // currentMultiple (number) — at 2x trigger
        );

        // D-04 observable effect 1: insertTrade called with action='partial_sell' AND non-null amountOut
        expect(insertTradeRun).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'partial_sell',
                amountOut: '500000000000000000',  // non-null, matches mock
                gasCost: expect.any(String),
                block: expect.any(Number),
            }),
        );
        // D-04 observable effect 2: decodeReceipt was actually used (not the legacy null path)
        expect(decodeReceiptMock).toHaveBeenCalledTimes(1);
    });
});
```

**Why this test exists despite Phase 10's strong existing coverage** (per PATTERNS.md line 746): Phase 10 has 13 existing tests in `test/unit/db.test.ts` and `test/unit/exitEngineSell.test.ts`, but none are wrapped under the `Phase N harm-prevention:` discoverability prefix. Per D-03 the prefix IS the audit query that closes DEBT-05. The new describe is the explicit "amount_out non-null on a receipt-decoded sell" claim under the discoverable prefix.

**Cross-check at execution time:** Confirm `src/exitEngine.ts:531-540` still shows the 8-parameter signature above (it has been verified at planning time — 2026-04-29). If the function signature has been refactored at execution time, surface to user via D-07 before adapting the call.

After writing, run `npx vitest run test/unit/exitEngineSell.test.ts -t "Phase 10 harm-prevention"` and confirm passing. Update `.planning/phases/10-partial-sell-revenue-fix/10-VALIDATION.md` with the standard augmentation.

If the test FAILS, STOP per D-07.
  </action>
  <verify>
    <automated>npx vitest run test/unit/exitEngineSell.test.ts -t "Phase 10 harm-prevention" 2>&amp;1 | grep -E "Test Files\s+1 passed|1 passed"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'Phase 10 harm-prevention: partial-sell amount_out' test/unit/exitEngineSell.test.ts == 1`.
    - The new describe asserts `expect(insertTradeRun).toHaveBeenCalledWith(expect.objectContaining({action: 'partial_sell', amountOut: '500000000000000000'}))` (non-null amountOut observable per D-04).
    - The new describe asserts `expect(decodeReceiptMock).toHaveBeenCalledTimes(1)` (receipt-decoder path actually exercised, not the legacy null path).
    - `executePartialSell` is invoked with EXACTLY 8 arguments in the order `(ctx, dex, tokenAddress, feeTier, sellAmount, tiers, state, currentMultiple)` matching the signature at src/exitEngine.ts:531-540.
    - `.planning/phases/10-partial-sell-revenue-fix/10-VALIDATION.md` contains the H2 `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` with `test/unit/exitEngineSell.test.ts` pointer.
    - `npx vitest run test/unit/exitEngineSell.test.ts -t "Phase 10 harm-prevention"` reports passing.
  </acceptance_criteria>
  <done>
Phase 10 harm-prevention test asserts non-null amount_out via decodeReceipt path; uses the exact 8-parameter signature; passes; cross-referenced from VALIDATION.md.
  </done>
</task>

<task type="auto">
  <name>Task 10: Final cross-reference pass and audit-query verification</name>
  <files>(verification only — no file modifications)</files>
  <read_first>
    - All 9 N-VALIDATION.md files modified by Tasks 1-9 (01, 02, 03, 05, 06, 07, 08, 09, 10)
    - All 5 test files modified by Tasks 1, 3, 4, 5, 6, 7, 9 (exitMonitor.test.ts, db.test.ts, v3LiquidityWait.test.ts NEW, riskManager.test.ts, exitEngineSell.test.ts, health.test.ts)
  </read_first>
  <action>
Run the audit-query verification suite. This task confirms that:

1. **D-03 discoverability** — every new harm-prevention test is grep-discoverable via `Phase N harm-prevention:`:
```bash
grep -rEn '^describe\(.Phase [0-9]+ harm-prevention:' test/
```
Expected: at least 7 matches (1 each for Phases 1, 3, 5, 6, 7, 8, 10). Record the actual count.

2. **D-02 inline-doc form** — Phases 02 and 09 VALIDATION.md have the new H2:
```bash
grep -l "^## Harm-Prevention Assertion (Phase 17 / DEBT-05)$" .planning/phases/0{2,9}-*/?-VALIDATION.md
```
Expected: 2 file matches (02-VALIDATION.md and 09-VALIDATION.md).

3. **All 9 phase VALIDATION.md files reference the harm-prevention augmentation** (either inline or test-pointer):
```bash
for p in 01 02 03 05 06 07 08 09 10; do
    PATH=$(ls .planning/phases/${p}-*/?-VALIDATION.md 2>/dev/null | head -1)
    if [ -n "$PATH" ]; then
        if grep -q "## Harm-Prevention Assertion (Phase 17 / DEBT-05)" "$PATH"; then
            echo "$p: OK"
        else
            echo "$p: MISSING"
        fi
    fi
done
```
Expected: all 9 phases output `OK`.

4. **Exclusion verification** — Phase 1 work does NOT contain FIX-04 sell-sim references; Phase 5 work does NOT contain V3-03 sell-sim references:
```bash
# Phase 1 FIX-04 exclusion check
grep -E 'simulateSellForChain|sellSimulation|FIX-04' test/integration/exitMonitor.test.ts ; echo "fix04_exit=$?"  # exit 1 = no match = pass

# Phase 5 V3-03 exclusion check
grep -E 'simulateSellV3ForChain|V3-03' test/integration/v3LiquidityWait.test.ts | grep -v 'EXCLUDES' ; echo "v303_exit=$?"  # exit 1 = no match (after stripping the EXCLUDES comment) = pass
```

5. **Full test-suite green** — run `npx vitest run` (unit + integration projects) and confirm all 9 new harm-prevention claims pass alongside the pre-existing 343/343:
```bash
npx vitest run --project unit --project integration
```
Expected: exit 0; test count >= 350 (343 baseline + at least 7 new harm-prevention tests; existing tests in describe-wrapper-only Phases 8 and 10 may not increment the count).

If ANY of 1-5 fails, STOP and surface to user. Do NOT mass-fix in this task — D-07 stop-the-line applies.

Capture the audit-query results and embed them in the Plan 17-02 SUMMARY.md (output below). The summary's Self-Check section MUST include a literal copy of the grep outputs from items 1, 2, 3, 4 — so the audit trail lives in the SUMMARY, not just in the plan history.

**No production-code changes in this task.** Pure verification + summary-doc population.
  </action>
  <verify>
    <automated>grep -rEn '^describe\(.Phase [0-9]+ harm-prevention:' test/ | wc -l | awk '$1 &gt;= 7 {print "ok"}'</automated>
  </verify>
  <acceptance_criteria>
    - `grep -rEn '^describe\(.Phase [0-9]+ harm-prevention:' test/` returns at least 7 matches.
    - Each of Phases 01, 02, 03, 05, 06, 07, 08, 09, 10 has its N-VALIDATION.md containing the literal H2 `## Harm-Prevention Assertion (Phase 17 / DEBT-05)`.
    - Phase 1 work in `test/integration/exitMonitor.test.ts` contains zero `simulateSellForChain` / `FIX-04` / `sellSimulation` references inside the `Phase 1 harm-prevention:` describe block.
    - Phase 5 work in `test/integration/v3LiquidityWait.test.ts` contains zero `simulateSellV3ForChain` / `V3-03` references outside the `EXCLUDES` comment.
    - `npx vitest run --project unit --project integration` exits 0; total test count is at least the v6.16 baseline (343) plus the new harm-prevention tests added by this plan.
    - The Plan 17-02 SUMMARY.md (created per `<output>` below) contains the audit-query grep output verbatim under a `## Self-Check` section.
  </acceptance_criteria>
  <done>
All 9 phases (01-10 minus skipped 04/11/12/13/14/15/16) have either an inline doc augmentation or a discoverable harm-prevention describe block; full test suite is green; the audit query grep `Phase [0-9]+ harm-prevention:` returns 7+ hits; D-07 stop-the-line was not triggered (or, if it was, the user has been notified and Phase 17 close is blocked).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Test mock contracts (`vi.mock`) → production module imports | Tests dynamically substitute mocks for real modules at module-load. Untrusted only in the sense that a buggy mock can give false confidence — same trust model as every other test in `test/{unit,integration}/`. |
| Vitest runner exit code → CI gating | A failing test must produce non-zero exit (already enforced by vitest defaults; reinforced by Plan 17-03's CI guards). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-17-02-01 | Tampering | Mock matrix in `test/unit/exitEngineSell.test.ts` is shared across multiple describe blocks (Phase 7 + Phase 10 + existing receipt-decoding tests) | accept | Vitest's `mockReset: true` (vitest.config.ts) prevents call-history leakage; describe-block isolation via `beforeEach` (canonical pattern lines 121-134) prevents implementation leakage. Existing pattern, not new attack surface. |
| T-17-02-02 | Repudiation | A retroactive harm-prevention test that "passes" without actually exercising the harm scenario (Pitfall #19 / Pitfall #20 — rubber-stamp / hollow-fill) | mitigate | D-04 rigor bar enforced: every test asserts at least one CONCRETE observable effect (DB row inserted, mock called with specific args, structured pino log line emitted, transaction submitted/blocked). Acceptance criteria check the literal assertion shapes (e.g., `expect(insertTradeRun).toHaveBeenCalledWith(expect.objectContaining({...}))`). Plus Task 10's audit-query verification grep ensures discoverability. |
| T-17-02-03 | Denial of Service | A long-running fake-timer test (e.g., Phase 5 V3-02 30s timeout) hangs the test suite | mitigate | Use `vi.useFakeTimers()` + `vi.advanceTimersByTime(31000)` rather than real `setTimeout` waits. Existing pattern in `test/integration/wsReconnect.test.ts`. Vitest's per-test `testTimeout` (5s unit, 15s integration per vitest.config.ts) provides backstop. |
| T-17-02-04 | Information Disclosure | Test fixtures contain real wallet addresses or live token contract addresses | accept | All addresses in new tests are `0xharm-prev-*` placeholders, NOT real wallets. Existing tests follow the same convention (e.g., `0xtokenaddress0000000000000000000000000000`). |
| T-17-02-05 | Elevation of Privilege | A real production bug found via D-07 stop-the-line could be silently bypassed if executor doesn't follow protocol | mitigate | D-07 protocol is documented in the `<stop_the_line_protocol>` block at top of plan AND each task's action explicitly references "If FAILS, STOP per D-07". User-visible escalation is part of the protocol. |

No high-severity threats; this plan is doc + test additions only, no production code modifications. Phase 17 is intentionally retrospective.
</threat_model>

<verification>
- `grep -rEn '^describe\(.Phase [0-9]+ harm-prevention:' test/` returns 7+ describe blocks (one each for Phases 1, 3, 5, 6, 7, 8, 10).
- All 9 phase N-VALIDATION.md files (01, 02, 03, 05, 06, 07, 08, 09, 10) contain the literal H2 `## Harm-Prevention Assertion (Phase 17 / DEBT-05)`.
- Phases 02 and 09 frontmatter contain `harm_prevention: inline`.
- Phase 1 work explicitly excludes FIX-04 (sell-sim symbols) — verified via grep returning 0 matches in the new describe block.
- Phase 5 work explicitly excludes V3-03 (sell-sim symbols) — verified via grep returning 0 matches outside the EXCLUDES comment.
- Full vitest suite (`npx vitest run --project unit --project integration`) exits 0.
- D-07 stop-the-line was either not triggered OR was triggered and the user has been notified (Phase 17 close is blocked pending DEBT-07 / phase 17.1 disposition).
</verification>

<success_criteria>
ROADMAP.md Phase 17 Success Criterion 3 (each of the 9 retroactively-validated phases produces one production-relevant assertion documented in its `VALIDATION.md`, answering "does this prevent the harm we said it would?", explicitly excluding FIX-04 and V3-03 which are addressed in Phase 18) is satisfied:
- 7 phases (01, 03, 05, 06, 07, 08, 10) get a discoverable `Phase N harm-prevention:` test with a concrete observable D-04 assertion.
- 2 phases (02, 09) get an inline doc augmentation pointing to existing evidence (per D-02 — architectural / meta phases where single-test fabrication would be the rubber-stamp pattern).
- FIX-04 and V3-03 are verifiably excluded from the new tests via grep (and called out in the augmentations as deferred to HONEY-07/HONEY-08).

DEBT-05 closes here.
</success_criteria>

<output>
After completion, create `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-02-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. The summary's `## Self-Check` section MUST include:
- Verbatim grep output of `grep -rEn '^describe\(.Phase [0-9]+ harm-prevention:' test/`
- Verbatim grep output of `grep -l "^## Harm-Prevention Assertion (Phase 17 / DEBT-05)$" .planning/phases/*-*/?-VALIDATION.md`
- The result of `npx vitest run --project unit --project integration` (last 5 lines including the summary-of-tests line)
- Per-phase disposition table: Phase | Form (NEW TEST / INLINE DOC) | File:line | Observable effect asserted
- D-07 stop-the-line status: `not_triggered` OR `triggered_at_phase_N_blocking_close`
- For Task 4 (Phase 5): if executor took option (a) and added `export` to `src/bot.ts:86`, record this single-token edit under "test-induced changes"
</output>
