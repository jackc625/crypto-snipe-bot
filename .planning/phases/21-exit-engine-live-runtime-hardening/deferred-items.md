# Phase 21 — Deferred / Out-of-Scope Items

Items discovered during plan execution that are OUT OF SCOPE for the current
plan (pre-existing, not caused by the task's changes). Logged per the executor
SCOPE BOUNDARY rule; NOT fixed in-flight.

## Plan 21-02 (EXIT-LIVE-08 test-safety gate)

### Pre-existing fork-test failures (nonce-desync / fork-node state pollution)

**Discovered during:** Plan 21-02 Task 2 verification (`npm run test:fork`).

**Observed:** `npm run test:fork` reports 13 failed / 9 passed / 9 skipped.
The 9 passed include all 8 of this plan's new `realMainnetGate.fork.test.ts`
assertions plus the antiRug smoke test. The 13 failures are confined to two
PRE-EXISTING fork test files this plan does not touch:

- `test/fork/snipeLifecycle.test.ts` (Phase 09-04 / 11-06) — 7 failures
- `test/fork/antiRugDetector.fork.test.ts` (Phase 19-07) — 6 failures

**Root cause (diagnosed, not dismissed):** every transaction-issuing failure
shares the identical RPC error from the local Hardhat fork node:

```
Nonce too high. Expected nonce to be 550 but got 6426.
Note that transactions can't be queued when automining.
```

The Hardhat default account #0 (the fork-only deployer used by these tests) has
a desynchronized nonce. The mismatch (`Expected 550 but got 6426`) reproduces
DETERMINISTICALLY — it persists on a fully pristine run (all `node.exe` killed,
port 8545 confirmed free, no EADDRINUSE), so it is NOT merely orphaned-process
pollution from repeated runs (though that ALSO occurred separately on this
Windows host as recurring port-8545 EADDRINUSE between back-to-back runs). The
forked-mainnet state reports the real account #0's historical nonce (~550) while
the ethers v6 test path (providers configured with `cacheTimeout: -1`) computes
6426, and Hardhat rejects the deploy with "transactions can't be queued when
automining." This is a pre-existing incompatibility between these older fork
tests (Phase 09/11, 19-07) and the current forked-mainnet state / Hardhat 2.26 /
ethers 6.16 nonce handling. The subsequent `Cannot read properties of undefined
(reading 'getAddress')` errors are pure downstream cascades from the first
failed contract deploy (`fakeToken`/`rugPull` never gets assigned).

**Why this is NOT caused by Plan 21-02:** the only production-of-behavior change
in this plan is an additive, read-only `chainId` check in `test/fork/setup.ts`
that runs AFTER the fork node boots. It issues zero transactions and cannot
affect any wallet's nonce. The global tripwire did NOT abort globalSetup (grep
`"globalSetup aborted"` over the run = 0); all 31 tests reached execution, which
is exactly what Task 2 requires (the local 31337 fork passes the gate and
existing fork tests run). A pristine fork node (e.g. CI's single first run, or a
local run after killing all stray `node.exe` and clearing port 8545) starts the
deployer at the correct nonce and these tests are unaffected by this plan.

**Disposition:** OUT OF SCOPE for Plan 21-02 (test-only gate plan). Not a
production bug — a local fork-node state artifact. NOT fixed in-flight per the
executor SCOPE BOUNDARY + D-STOP-THE-LINE (this is not a real product bug
requiring a 21.1 escalation; it is environment flakiness). Suggested follow-up
(separate from this plan): the fork harness could reset the deployer nonce
between runs, or `test/fork/teardown.ts` could more robustly kill the spawned
Hardhat node on Windows so port 8545 / nonce state does not leak across runs.

### ✅ RESOLVED — orchestrator fork-harness hardening (2026-05-26)

Per operator direction ("even if pre-existing, if relevant to this phase, fix
it" — the fork suite is Phase 21's verification substrate and gates the 21-06
rehearsal before the real-capital 21-07 run), the full fork suite was driven
green: **4 failed files / 16 failed tests → 5 files / 31 tests passing**. Three
distinct root causes (all reproduced, none a production bug):

1. **Fork-file parallelism (the "nonce desync").** vitest ran the 5 fork files
   in parallel workers, all transacting as the SAME Hardhat account #0 against
   the ONE shared `globalSetup` node → the account's nonce raced across
   independent ethers providers ("nonce too high" / "nonce has already been
   used") and its shared ETH balance drained non-deterministically. Proven: each
   file passed in isolation; only the combined run failed. **Fix:**
   `fileParallelism: false` on the `fork` project in `vitest.config.ts` (files
   run serially; within-file tests were already serial). Dropped failures 16 → 1.

2. **Stale db mock in `antiRugDetector.fork.test.ts` (Phase 19-07).** Phase 20-03
   wired `startChainAntiRugListener` (`detector.ts:585`) to call
   `setAntirugDryRunStarted.run()`, but this older test's `src/utils/db` mock
   omitted it → `undefined.run()` crashed all 6 antiRug tests at registration.
   **Fix:** added `setAntirugDryRunStarted` / `getAntirugDryRunStarted` to the
   test's db mock. Same class as the Phase 20 `forceWalCheckpoint` /
   `getStaleTradesQuery` mock-debt items.

3. **V3 mode-3 test-mock gap (also `antiRugDetector.fork.test.ts`).** Once the
   crash was fixed, mode-3 reached `evaluateV3Signals`, whose WR-03 sell-sim
   probe reads `ctx.wallet.address` then `ERC20.balanceOf(...)`. The test's
   `buildCtx` had no `wallet` and the mock dispatcher had no `balanceOf` route →
   threw (non-revert) → `verdict='unknown'` instead of `'unsafe'`. **Fix:** added
   a `wallet` stub to `buildCtx` + a `balanceOf` route/mock (default 1e18 so the
   1e17 quote mock yields a 10% sell ratio → signal-3 trips). Production code is
   correct (always has `ctx.wallet`); test-only gap.

4. **Windows teardown leak (bonus).** `hardhatProcess.kill()` killed only the
   cmd.exe shell (from `spawn({shell:true})`), leaving the `hardhat node` child
   alive on port 8545 → EADDRINUSE / stale state on the NEXT run (reproduced:
   every run leaked a node). **Fix:** `taskkill /F /T /PID` (tree kill) on Win32
   in `setup.ts` teardown; `SIGTERM` elsewhere. Verified: port free after runs.

All fixes are TEST/config + test-harness only — zero `src/` production changes.
This also closes the long-standing **D-18-10-01** snipeLifecycle fork failure.
Verification: `npm run test:fork` → 5 files / 31 tests pass, exit 0; `tsc -p
tsconfig.json` clean.
