---
phase: 21-exit-engine-live-runtime-hardening
plan: 02
subsystem: testing
tags: [fork-test, vitest, hardhat, ethers, chainId-guard, test-safety, EXIT-LIVE-08]

# Dependency graph
requires:
  - phase: 18-honeypot-checker
    provides: "test/fork/honeypotChecker.fork.test.ts:57-63 isHardhatFork predicate (the gate logic centralized here) + the Hardhat account #0 throwaway key"
  - phase: 09-testing-infra
    provides: "test/fork/setup.ts globalSetup harness (hardhat node --fork on :8545) that the tripwire augments"
provides:
  - "test/fork/helpers/realMainnetGate.ts: reusable requireRealMainnetGate() per-test decorator + isHardhatFork() predicate + FORK_ONLY_TEST_KEY (D-GATE-BOTH-LAYERS layer b)"
  - "Global chainId===1 tripwire in test/fork/setup.ts globalSetup (D-GATE-BOTH-LAYERS layer a) — aborts the whole fork run on real mainnet without ALLOW_REAL_MAINNET=1"
  - "Meta-test proving the gate throws at chainId 1 (gate unset) and resolves at 31337 / chainId 1 with opt-in"
  - ".env.example: ALLOW_REAL_MAINNET + TEST_WALLET_PRIVATE_KEY + CAPTURE_ARCHIVE_RPC_URL (D-ENV-EXAMPLE)"
affects: [21-03, 21-04, 21-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Centralized fork chainId guard imported by both globalSetup and per-test decorator (single source of truth, no duplicated predicate)"
    - "Provider-stub meta-test (fake getNetwork()) asserts a thrown Error vs resolved promise without a real network (D-04 observable)"

key-files:
  created:
    - test/fork/helpers/realMainnetGate.ts
    - test/fork/realMainnetGate.fork.test.ts
  modified:
    - test/fork/setup.ts
    - .env.example

key-decisions:
  - "Reused requireRealMainnetGate() inside setup.ts (call-and-catch) rather than re-implementing the chainId predicate, so layers (a) and (b) share one source of truth"
  - "Both new vars (ALLOW_REAL_MAINNET, TEST_WALLET_PRIVATE_KEY) ship as EMPTY placeholders — guard active, CI never sets them, no real key in any committed file"

patterns-established:
  - "Pattern 1: Fork test-safety gate as test-only infra (D-ROLLBACK) — global setup tripwire + per-test decorator, no production-code change, no bypass beyond explicit ALLOW_REAL_MAINNET=1"
  - "Pattern 2: FORK_ONLY_TEST_KEY const + do-NOT comment marks the prod PRIVATE_KEY as never-importable into tests (D-TEST-WALLET-FORKONLY)"

requirements-completed: [EXIT-LIVE-08]

# Metrics
duration: ~40min
completed: 2026-05-26
---

# Phase 21 Plan 02: EXIT-LIVE-08 Test-Safety Gate Summary

**Two-layer `chainId===1` / `ALLOW_REAL_MAINNET=1` guard as pure test infrastructure: a global fork-setup tripwire that aborts the whole run on real mainnet, plus a reusable `requireRealMainnetGate()` per-test decorator and `FORK_ONLY_TEST_KEY`, so the automated suite can never accidentally transact on mainnet or load the prod wallet.**

## Performance

- **Duration:** ~40 min (incl. repeated fork-suite diagnostic runs)
- **Started:** 2026-05-26T~18:50Z
- **Completed:** 2026-05-26T19:29Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified); 203 insertions, 0 deletions

## Accomplishments
- **Centralized the gate predicate** (`test/fork/helpers/realMainnetGate.ts`): `isHardhatFork(provider)` copied verbatim from `honeypotChecker.fork.test.ts:57-63`, plus `requireRealMainnetGate(provider)` (the layer-b per-test decorator) that throws loudly at chainId 1 unless `ALLOW_REAL_MAINNET==='1'`, plus the `FORK_ONLY_TEST_KEY` throwaway constant with a do-NOT comment guarding the prod `PRIVATE_KEY`.
- **Global tripwire** (`test/fork/setup.ts`, layer a): after the fork node boots, reads its chainId via `requireRealMainnetGate()` and aborts the entire `globalSetup` if it reports real-mainnet chainId 1 without the gate. Local `hardhat node --fork` reports 31337, so it never fires in CI; it guards a misconfigured `ETH_FORK_RPC_URL`/`ALCHEMY_URL`.
- **Meta-test** (`test/fork/realMainnetGate.fork.test.ts`): 8 assertions proving throw-vs-resolve across chainId 1/31337 × gate set/unset/non-"1", plus the `FORK_ONLY_TEST_KEY` value — all passing.
- **`.env.example`**: new `# === Test / Capture Safety (Phase 21) ===` section with `ALLOW_REAL_MAINNET`, `TEST_WALLET_PRIVATE_KEY`, `CAPTURE_ARCHIVE_RPC_URL` — empty placeholders, `[OPTIONAL]` descriptions, no real keys.

## Task Commits

Each task was committed atomically:

1. **Task 1: centralize the gate predicate as a reusable helper + per-test decorator** - `f331078` (test)
2. **Task 2: global chainId tripwire in setup.ts + .env.example vars** - `20147a1` (test)

_Both tasks are test-only (no `src/` production code). No TDD multi-commit split — these are infrastructure/meta-test additions, not behavior-adding source._

## Files Created/Modified
- `test/fork/helpers/realMainnetGate.ts` (created) - Exports `isHardhatFork`, `requireRealMainnetGate` (per-test decorator, layer b), and `FORK_ONLY_TEST_KEY`. Single source of truth for the gate logic.
- `test/fork/realMainnetGate.fork.test.ts` (created) - Meta-test: 8 provider-stub assertions proving the gate fires (throw) at chainId 1 and resolves at 31337 / opt-in.
- `test/fork/setup.ts` (modified) - Imports `ethers` + `requireRealMainnetGate`; after `'Started HTTP'` resolves, connects `new ethers.JsonRpcProvider('http://127.0.0.1:8545')`, calls the gate (call-and-catch), and aborts globalSetup with a clear message if chainId 1 without `ALLOW_REAL_MAINNET=1`. Provider destroyed in `finally`.
- `.env.example` (modified) - Phase 21 section with the 3 new vars (all empty/optional).

## Exact Helper Exports (for Plans 03/04/06)

Downstream fork tests import these from `test/fork/helpers/realMainnetGate`:

```ts
export const FORK_ONLY_TEST_KEY: string;                 // '0xac0974…ff80' (Hardhat acct #0, fork-only)
export function isHardhatFork(provider: ethers.JsonRpcProvider): Promise<boolean>;
export async function requireRealMainnetGate(provider: ethers.JsonRpcProvider): Promise<void>;
```

- `requireRealMainnetGate(provider)` — throws `Error('Refusing to run against chainId 1 (mainnet) without ALLOW_REAL_MAINNET=1 — this guard protects the prod wallet from accidental transactions')` when `Number(network.chainId) === 1 && process.env.ALLOW_REAL_MAINNET !== '1'`; otherwise resolves.
- `isHardhatFork(provider)` — resolves `true` when `Number(network.chainId) !== 1 || process.env.ALLOW_REAL_MAINNET === '1'`.

## Tripwire Insertion Point (setup.ts)

Inserted **after** the `'Started HTTP'` startup Promise resolves (i.e. after the node is confirmed up), before `setup()` returns. The local 31337 fork passes both layers naturally; existing fork tests run without the tripwire aborting setup (verified — see below).

## `.env.example` Entries (all empty placeholders, `[OPTIONAL]`)

```
ALLOW_REAL_MAINNET=                    # [OPTIONAL] Test-only tripwire. Set to 1 ONLY to deliberately run a real-mainnet (chainId 1) fork test. NEVER set in CI. Default unset = guard active.
TEST_WALLET_PRIVATE_KEY=               # [OPTIONAL] Fork-only throwaway key (zero real ETH) for fork-impersonation signing. NEVER reuse PRIVATE_KEY (prod wallet).
CAPTURE_ARCHIVE_RPC_URL=               # [OPTIONAL] Archive RPC for scripts/capture-launch.ts historical getLogs. Falls back to ALCHEMY_URL if unset.
```

## Decisions Made
- **Reused the gate helper inside `setup.ts`** (call `requireRealMainnetGate()` and re-throw a setup-context message) rather than re-implementing the chainId check — satisfies the acceptance criterion "imports the gate logic, no duplicated predicate."
- **Shipped both key/tripwire vars as empty placeholders.** `TEST_WALLET_PRIVATE_KEY` is intentionally blank (the suite signs with the Hardhat account #0 throwaway key baked into the helper, not an env value); `ALLOW_REAL_MAINNET` blank = guard active. No real private key in any committed file (KEY SAFETY constraint).

## Deviations from Plan

None — plan executed exactly as written. No `src/` production code touched (D-ROLLBACK honored: test-only plan). No Rule 1-4 deviations were required.

## Issues Encountered

**Pre-existing fork-test failures (out of scope) — diagnosed, not dismissed, logged to `deferred-items.md`.**

`npm run test:fork` reports **13 failed / 9 passed / 9 skipped**. The 9 passed include all 8 of this plan's `realMainnetGate.fork.test.ts` assertions. The 13 failures are confined to two PRE-EXISTING fork test files this plan does not touch — `test/fork/snipeLifecycle.test.ts` (Phase 09/11) and `test/fork/antiRugDetector.fork.test.ts` (Phase 19-07).

- **Root cause (diagnosed):** every transaction-issuing failure returns the identical RPC error `Nonce too high. Expected nonce to be 550 but got 6426. Note that transactions can't be queued when automining.` The Hardhat fork deployer (account #0) nonce is desynced — the forked-mainnet state reports the real account's historical nonce (~550) while the ethers v6 test path computes 6426. Reproduces **deterministically** on a fully pristine run (all `node.exe` killed, port 8545 confirmed free, no EADDRINUSE). The downstream `Cannot read properties of undefined (reading 'getAddress')` errors are cascades from the first failed contract deploy.
- **Why NOT caused by this plan:** the only behavior change here is an additive, read-only `chainId` check in `setup.ts` that runs AFTER node boot and issues zero transactions — it cannot affect any wallet nonce. **The global tripwire never aborted globalSetup** (grep `"globalSetup aborted"` over every run = 0), so all 31 tests reached execution — which is exactly what Task 2 requires (local 31337 fork passes the gate; existing fork tests run).
- **Secondary environment note:** on this Windows host, back-to-back fork runs left orphaned `hardhat node` processes on port 8545 ("something prevents the main process from exiting"), causing intermittent `EADDRINUSE`. Resolved between runs by killing stray `node.exe`; not a code defect.
- **Disposition:** OUT OF SCOPE per the executor SCOPE BOUNDARY. Not a product bug (a local fork-node state artifact), so no D-STOP-THE-LINE / phase-21.1 escalation. Suggested follow-up (separate work): reset the deployer nonce between fork runs and/or harden `test/fork/teardown.ts` to reliably kill the spawned node on Windows.

## Verification (actually run; honest results)

- `npx tsc --noEmit` (root tsconfig) → **exit 0** (baseline was also 0; no `src/` regression).
- `npx vitest run --project fork test/fork/realMainnetGate.fork.test.ts --reporter=verbose` → **8/8 passed**, exit 0.
- `npm run test:fork` → local 31337 fork **boots and the tripwire does NOT abort** globalSetup; all 31 tests execute (9 pass incl. this plan's 8; 13 pre-existing nonce-desync failures documented above; 9 skipped Wave-1 fixtures).
- `grep "process.env.PRIVATE_KEY" test/fork/` → **1 match, on `realMainnetGate.ts:28` inside a do-NOT comment only** (zero executable references; T-21-02-02 mitigation holds).
- `.env.example` contains all 3 new vars with `[OPTIONAL]` descriptions; no real key material.

### Note on the `tsc` acceptance criterion
The plan's criteria reference `npx tsc --noEmit` "(root tsconfig covering tests)". In this repo the root `tsconfig.json` `include` is `["src/**/*", "hardhat.config.ts"]` — it does **not** include `test/`, so the root `tsc` does not directly typecheck the new test files (it stays at exit 0 = no `src/` regression). The new test files are compiled+executed by vitest (8/8 pass = authoritative compile+run check), and the helper was additionally typechecked standalone with strict settings (`tsc --noEmit --strict … realMainnetGate.ts` → exit 0). This is a stale assumption in the plan text, not a defect; documented here for transparency.

## Threat Model Coverage
- **T-21-02-01** (a test transacting on real mainnet) → mitigated: both layers ship (global tripwire + per-test decorator); local fork = 31337 passes naturally.
- **T-21-02-02** (prod PRIVATE_KEY leaked into a test) → mitigated: `FORK_ONLY_TEST_KEY` provided; prod key referenced only in a do-NOT comment; grep proves zero executable references across `test/fork/`.
- **T-21-02-03** (a future test forgetting to opt in) → mitigated: the GLOBAL tripwire protects every test, including future ones.
- **T-21-02-04** (a bypass-in-prod-code path) → mitigated: D-ROLLBACK — gate lives only in `test/fork/`, no production-code change, no bypass beyond explicit `ALLOW_REAL_MAINNET=1`.
- **T-21-02-SC** (package installs) → mitigated: zero new packages (reused installed `ethers` 6.16 + `vitest`).

## User Setup Required
None — no external service configuration required. The new `.env.example` vars are all optional and default to the safe/guard-active state; CI must continue to leave `ALLOW_REAL_MAINNET` unset.

## Next Phase Readiness
- Plans 21-03 / 21-04 / 21-06 (fork tests) can now `import { requireRealMainnetGate, FORK_ONLY_TEST_KEY } from './helpers/realMainnetGate'` for the per-test gate marker and the fork-only signing key.
- The global tripwire now protects every present and future fork test from accidental real-mainnet transactions.
- **Concern (informational, not a blocker for this plan):** the pre-existing `snipeLifecycle`/`antiRug` fork tests fail on a deployer nonce-desync in this environment (`deferred-items.md`). Plans that extend fork lifecycle coverage (21-03/04/06) may hit the same nonce issue and should account for resetting the fork deployer nonce.

## Self-Check: PASSED

All claimed artifacts and commits verified on disk:
- FOUND: `test/fork/helpers/realMainnetGate.ts`
- FOUND: `test/fork/realMainnetGate.fork.test.ts`
- FOUND: `test/fork/setup.ts` (modified)
- FOUND: `.env.example` (modified)
- FOUND: `.planning/phases/21-exit-engine-live-runtime-hardening/21-02-SUMMARY.md`
- FOUND: `.planning/phases/21-exit-engine-live-runtime-hardening/deferred-items.md`
- FOUND commit `f331078` (Task 1)
- FOUND commit `20147a1` (Task 2)

---
*Phase: 21-exit-engine-live-runtime-hardening*
*Completed: 2026-05-26*
