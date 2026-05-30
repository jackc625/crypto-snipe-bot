---
phase: 17-tech-debt-cleanup-audit-baseline
reviewed: 2026-04-30T00:54:30Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - .github/workflows/test.yml
  - src/bot.ts
  - src/utils/db.ts
  - test/integration/api/health.test.ts
  - test/integration/exitMonitor.test.ts
  - test/integration/v3LiquidityWait.test.ts
  - test/unit/db.test.ts
  - test/unit/exitEngineSell.test.ts
  - test/unit/riskManager.test.ts
findings_summary:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues
---

# Phase 17: Code Review Report

**Reviewed:** 2026-04-30T00:54:30Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 17 made minimal source-code changes (1 line in `src/bot.ts`, 4-line deletion in
`src/utils/db.ts`); the bulk of the diff is test files and CI workflow additions.
Both source-code changes verify clean.

The findings concentrate in the 7 retroactive Nyquist "harm-prevention" describe
blocks added across 6 test files. Two of them (Phase 7 EXIT-01 and Phase 10
partial-sell) **claim** to verify wired-through behavior but in practice only
re-test `executeFullSell`/`executePartialSell` in isolation — duplicating the
existing receipt-decoding tests and missing the wiring claim. The new V3 liquidity-wait
integration test imports `src/bot.ts`, which transitively opens the production
SQLite database (`data/bot.db`) as a side effect — an unexpected I/O contamination
for what should be a pure-function timeout test.

The CI workflow additions (`.todo` ban + 3-tsconfig `tsc --noEmit`) are sound and
introduce no runtime risk, but the `.todo` regex is over-broad (would match `.todo(`
on any unrelated method), and `find test/ -name '*.todo*'` would also flag
documentation-style filenames inside `test/`.

No critical security or correctness defects were found. All warnings are
quality / test-rigor issues that weaken the harm-prevention story without
breaking production behavior.

---

## Critical Issues

_None._

---

## Warnings

### WR-01: Phase 7 EXIT-01 harm-prevention test does not verify the claim it advertises

**File:** `test/unit/exitEngineSell.test.ts:258-296`
**Issue:**
The describe block header at line 254-256 claims:

> "Phase 7 EXIT-01: stop-loss must trigger executeFullSell with reason='stop-loss'
> — wired-through-to-executeFullSell invocation, not just threshold computation."

However, the test (line 274-282) directly invokes `executeFullSell(...,'stop-loss',...)`
itself. It never exercises `pollExitStrategy` at `src/exitEngine.ts:747-760`, which is
the only production code path that decides "current price <= entryPrice * (1 -
stopLossPct/100) → call executeFullSell with reason='stop-loss'". A regression that
swapped the literal at line 758 to `'trailing-stop'`, or removed the
`executeFullSell(...)` call entirely from Step 6, would still pass this test.

The two existing `executeFullSell — receipt decoding integration` tests at
lines 137-203 already cover the call shape and DB write. The new harm-prevention
test therefore verifies nothing the existing suite did not already verify, and
the claim "wired-through-to-executeFullSell invocation, not just threshold
computation" is materially false.

**Fix:**
Either:
1. Replace the direct `executeFullSell` call with an end-to-end exercise of
   `pollExitStrategy` driving a low price through the stop-loss threshold and
   asserting on `sendTxWithRetryMock` + `insertTradeRun` call args; OR
2. Downgrade the describe-block claim to match what the test actually verifies
   (e.g., "Phase 7 EXIT-01: executeFullSell accepts reason='stop-loss' discriminant
   and inserts an action='sell' row").

```ts
// Option 1 sketch (drives pollExitStrategy via the polling entry point):
//   await startExitMonitor(mockCtx, mockDex, token, null, '0.1', tradeId, 1000n);
//   queryPriceMock.mockResolvedValueOnce(65); // below 70 = stop-loss threshold
//   await vi.advanceTimersByTimeAsync(5000); // one poll interval
//   expect(sendTxWithRetryMock).toHaveBeenCalledTimes(1);
//   expect(insertTradeRun).toHaveBeenCalledWith(
//       expect.objectContaining({ action: 'sell' }),
//   );
```

---

### WR-02: Phase 10 partial-sell harm-prevention test has the same wiring gap as WR-01

**File:** `test/unit/exitEngineSell.test.ts:304-360`
**Issue:**
The describe block (line 299-302) frames the assertion as a Phase 10 "harm-prevention"
contract, but the test directly invokes `executePartialSell(...)` rather than
exercising the trigger path in `pollExitStrategy:697-717`. The existing
`executePartialSell — receipt decoding integration` test at line 206-249 already
asserts that `insertTrade` receives `action: 'partial_sell'` and `amountOut:
'500000000000000000'` from `decodeReceipt`. The new test asserts the same three
fields against the same mock with the same mock arguments — pure duplication.

If Step 3 (line 697-717) were broken so that `getUnfilledTiers` returned `[]`
when it should have returned a tier, or `executePartialSell` was never called
from the poll loop, this harm-prevention test would still pass.

**Fix:**
Same options as WR-01. Either drive a 2x price through `pollExitStrategy` and
assert that `executePartialSell`'s side effects fire, or downgrade the describe-block
claim to match what is actually verified ("partial_sell row insertion records
non-null amountOut from decodeReceipt").

---

### WR-03: Phase 5 V3-02 integration test imports `src/bot.ts`, opening the production SQLite DB

**File:** `test/integration/v3LiquidityWait.test.ts:66`
**Issue:**
Line 66: `const bot = await import('../../src/bot');`

`src/bot.ts` has top-level `import { db, insertTrade, isTokenSniped, ... } from
"./utils/db"` (line 32), and `src/utils/db.ts` has top-level `const db = new
Database(DB_PATH)` (line 17) plus calls to `migrateSchema()`, `migrateJsonState()`,
`normalizeLegacyMainnetRows()` at module-load time. Importing `bot.ts` therefore:

1. Opens `data/bot.db` (the production database; `DB_PATH` defaults to
   `path.join(process.cwd(), 'data', 'bot.db')` per `src/utils/db.ts:9`).
2. Runs schema migrations against that file.
3. Calls `normalizeLegacyMainnetRows(db)` which executes an `UPDATE trades SET
   chain = 'eth' WHERE chain = 'mainnet'` — touching real production rows if any
   exist.
4. Writes WAL and SHM files (`data/bot.db-wal`, `data/bot.db-shm`).

I confirmed this empirically: `npx vitest run test/integration/v3LiquidityWait.test.ts`
mtime-bumps `data/bot.db-wal` and `data/bot.db-shm`. The test claims to verify
a pure-function 30-second timeout — the production-DB I/O is incidental and
unintended.

This is a quality issue, not a correctness one (the test passes, no rows are
lost), but it does:
- Couple a unit-of-functionality test to the live database (hidden ordering risk
  if multiple integration tests run in parallel; vitest's project worker default
  is to fork processes, so each gets its own DB handle, but all hit the same
  file).
- Generate I/O on every CI run.
- Risk masking real bugs (e.g., if `migrateJsonState` were to throw, the test
  would fail for unrelated reasons).

**Fix:**
Either:
1. Mock `../../src/utils/db` in the test's top-level `vi.doMock` block alongside
   `ethers` and `logger` (matches the pattern already used in `exitMonitor.test.ts`
   describe blocks 1, 2, 3, e.g., `exitMonitor.test.ts:25-29`); OR
2. Move `waitForLiquidity` to a dedicated helper file (e.g., `src/utils/v3Liquidity.ts`)
   that has no transitive DB dependency, then import THAT from the test instead
   of `bot.ts`. This would also obviate the `export` widening flagged in IN-01.

```ts
// Fix option 1 (add to top-level mock block at v3LiquidityWait.test.ts:34):
vi.doMock('../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: vi.fn() },
    updateTradeStatus: { run: vi.fn() },
    isTokenSniped: { get: vi.fn().mockReturnValue(undefined) },
    getTradeIdForPendingToken: { get: vi.fn() },
}));
// Plus mocks for src/exitEngine, src/api/server, src/telegramListener, src/riskManager —
// all of which bot.ts imports at top-level.
```

---

### WR-04: CI `.todo` ban regex is over-broad and may flag unrelated `.todo(` calls

**File:** `.github/workflows/test.yml:28`
**Issue:**
The regex `\.todo\s*\(|it\.todo\s*\(|test\.todo\s*\(|describe\.todo\s*\(` includes
the bare `\.todo\s*\(` alternative, which matches ANY `.todo(` invocation regardless
of receiver. So a future test file containing `myObject.todo()` (or any property
named `todo` invoked as a function) would fail CI. The intent is to ban Vitest
stubs (`it.todo`, `test.todo`, `describe.todo`); the bare `\.todo` alternative is
redundant once the three specific alternatives are present.

This is a low-likelihood false positive (TypeScript convention rarely uses `.todo`
as a method name) but the broad catch undermines the precision the comment at
line 22 advertises.

**Fix:**
Drop the bare `\.todo\s*\(` alternative; keep only the three Vitest-specific patterns:

```yaml
if grep -rEn 'it\.todo\s*\(|test\.todo\s*\(|describe\.todo\s*\(' test/; then
  echo "ERROR: .todo() invocation(s) found in test/"
  exit 1
fi
```

---

### WR-05: `find test/ -name '*.todo*'` matches documentation-style files, not just .todo test stubs

**File:** `.github/workflows/test.yml:23`
**Issue:**
The pattern `'*.todo*'` matches any filename containing `.todo` — including
`test/ROADMAP.todo.md`, `test/notes.todo`, `test/feedback.todo.txt`, etc. Vitest's
`.todo` test-stub format is invoked via `it.todo(...)` calls, NOT via filenames.
There is no canonical "*.todo* file" in Vitest. The intent of this find is unclear:
either (a) to ban a hypothetical `.todo` filename convention not in the codebase,
or (b) to ban planning-document filenames that happen to contain `.todo`.

If the intent is (a), the line is dead code (Vitest never produces such files).
If the intent is (b), a `test/ROADMAP.todo.md` would correctly be flagged but the
error message ("ERROR: .todo file(s) found in test/") would be misleading.

**Fix:**
Either remove the find-based check entirely (the grep-based check below it covers
the actual `.todo()` invocation form), or change the pattern to match a documented
naming convention if one exists, with a clearer error message:

```yaml
# Option A: drop the find entirely; grep-based check is sufficient.
- name: Ban .todo test stubs
  run: |
      if grep -rEn 'it\.todo\s*\(|test\.todo\s*\(|describe\.todo\s*\(' test/; then
        echo "ERROR: .todo() test-stub invocation found in test/. Use it.skip('reason: ...') instead."
        exit 1
      fi
```

---

## Info

### IN-01: `waitForLiquidity` widened from internal to exported solely for test access

**File:** `src/bot.ts:86`
**Issue:**
The phase plan notes Plan 17-02 modified `bot.ts:86` to add `export` to
`waitForLiquidity`. I verified via `git diff ce21553^..HEAD -- src/bot.ts` that
this is the only source change to `bot.ts` — a pure visibility widening to support
the new test in `test/integration/v3LiquidityWait.test.ts`.

`waitForLiquidity` has only one production caller (`handleNewV3PoolForChain` at
`src/bot.ts:380`, same module). Exporting it for test access creates an unused
public API surface. While the function is pure (no internal state exposure;
takes already-public `ChainContext` and primitives, returns `Promise<boolean>`),
the export pattern signals "available for external use" without that being the
maintainer's intent. A cleaner approach is to extract it to a dedicated module
(e.g., `src/utils/v3Liquidity.ts`) where the export is part of that module's
public surface by design.

The export does NOT over-expose internal state — `waitForLiquidity` returns only
`Promise<boolean>` and accepts pre-existing public types. Per phase brief, this
investigation closes the "verify the export does not over-expose internal state"
concern.

**Fix:**
Extract to a dedicated module where export is intentional:

```ts
// src/utils/v3Liquidity.ts (new file)
import { Contract } from 'ethers';
import type { ChainContext } from '../chainRegistry';
import { V3_POOL_ABI } from './abis';

export async function waitForLiquidity(
    ctx: ChainContext, poolAddress: string, blockNumber: number,
): Promise<boolean> { /* moved from bot.ts:86 */ }

// src/bot.ts
import { waitForLiquidity } from './utils/v3Liquidity';
```

This also resolves WR-03 (the test could then import from `v3Liquidity.ts`,
avoiding the `bot.ts` → `db.ts` transitive import chain).

---

### IN-02: Pre-existing dead imports in `src/bot.ts` not addressed by Phase 17 cleanup

**File:** `src/bot.ts:30, 34`
**Issue:**
Phase 17 was scoped as a tech-debt cleanup phase. Three top-level imports are
unused per `grep` audit:
- Line 30: `import { sendTelegramAlert } from "./utils/notifier"` — no callsite in
  this file (only `sendCtxAlert` at line 31 is used).
- Line 34: `getProvider`, `getWallet` from `"./utils/provider"` — no callsite.
  Only `getWsProvider, removeWsProvider` are used (at lines 767, 615, 766, 574).

These pre-date Phase 17 (they're not in the diff) but were not picked up by the
DEBT-06 cleanup that did remove `getTradesByToken` from `db.ts:215`. Same baseline,
different file.

**Fix:**
Either add to the next cleanup pass or document in the v6.17 baseline ledger as
"acknowledged, deferred". Suggest:

```ts
// src/bot.ts
import { sendCtxAlert } from "./utils/notifier";  // remove sendTelegramAlert
import { getWsProvider, removeWsProvider } from "./utils/provider";  // remove getProvider, getWallet
```

---

### IN-03: Pre-existing unused locals in test/integration/exitMonitor.test.ts (lines 204, 210)

**File:** `test/integration/exitMonitor.test.ts:204, 210`
**Issue:**
In the existing "Exit trigger correctness" describe block (NOT Phase 17 additions):
- Line 204: `const entryPrice = 100;` declared, never read in the test body.
- Line 210: `const trailingActivated = true;` declared, never read.

These appear to be documentation-style declarations meant to clarify the test
scenario, but a TypeScript `noUnusedLocals` pass would flag them. Verified via
`git diff ce21553^..HEAD -- test/integration/exitMonitor.test.ts` that these are
pre-existing.

**Fix:**
If kept for documentation, prefix with underscore (`_entryPrice`, `_trailingActivated`)
to silence linters; otherwise delete and move clarifying comment-only documentation
to a `// Setup:` block.

---

### IN-04: Phase 1 harm-prevention `vi.doUnmock` comment is helpful but the doMock-persistence concern only applies to one neighbor describe

**File:** `test/integration/exitMonitor.test.ts:629-636`
**Issue:**
The `vi.doUnmock('../../src/utils/exitManager')` is correctly placed and the
explanatory comment (lines 629-635) is useful for future maintainers. But the
comment claims "Earlier describe blocks (Describe 2 'Exit trigger correctness',
Describe 3 'Connection failure in exit monitor') register `vi.doMock(...)` ...
Those mock registrations persist across describes". Verified:
- Describe 2 (`importExitEngine`) DOES `vi.doMock('../../src/utils/exitManager', ...)`
  at line 189-195.
- Describe 3 (each test) DOES `vi.doMock('../../src/utils/exitManager', ...)` at
  lines 416-422 and 498-504 and 581-587.

So the comment is factually correct. Minor: there's no need for the `clearAllTimers`
call inside the harm-prev `it` blocks (lines 655, 669) since `vi.resetModules()` in
`beforeEach` already gives a fresh module — but that pattern matches the rest of the
file and the redundancy is harmless.

**Fix:**
None required. Note for awareness only: keep the explanatory comment when adding
future describe blocks to this file; the `vi.doMock` registry persistence is a
known Vitest sharp edge and the comment captures the institutional knowledge.

---

_Reviewed: 2026-04-30T00:54:30Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
