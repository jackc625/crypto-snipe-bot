# Phase 18 — Deferred Items

Out-of-scope discoveries logged during plan execution. Per the SCOPE BOUNDARY
rule, the executor logs but does NOT fix issues that are not directly caused
by the current task's changes.

## D-18-09-01: Pre-existing test/unit/chainRegistry.test.ts Test 1 failure

**Discovered:** 2026-05-22 during plan 18-09 GREEN-phase verification
**Caused by:** plan 18-07 (`ae768f4`) — added the ETH literal default
`defaultHoneypotCheckerAddress: '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD'`
to `CHAIN_TEMPLATES.eth` but did NOT update the existing chainRegistry test
to expect this default.

**Symptom:** `test/unit/chainRegistry.test.ts:170` asserts that with no env
vars set, `registry.get('eth')!.honeypotChecker.deployedAddress` is `null`.
With plan 18-07's literal default committed, the field now resolves to the
canonical ETH HoneypotChecker address — the test fails.

**Why deferred:** Pre-existing failure (committed before plan 18-09 started).
Out of scope per SCOPE BOUNDARY rule. Should be fixed in plan 18-10 or in a
dedicated plan-18-07 follow-up commit.

**Suggested fix:** Either (a) the test should iterate `['bsc', 'base', 'arb']`
(the chains without a committed literal default), or (b) the ETH branch should
expect the canonical literal instead of `null`. Plan 18-07's intent (per its
key-decisions and key-files sections) was option (b) — the canonical literal
IS the new default, env overlay remains as override.

**Impact on plan 18-09:** None. The full unit suite ran 275/276 (1 pre-existing
failure unrelated to plan 18-09). All 7 plan-18-09 unit tests + 6 plan-18-09
integration tests pass cleanly.

**Status: Resolved by plan 18-10** — fix-along applied per the executor's
extra_scope direction. The test now asserts per-chain expected defaults
(ETH literal for the `eth` row; null for `bsc` / `base` / `arb` until
plan 18-08 commits their literals). Aligned with plan 18-07's intent per
its key-decisions — the canonical literal IS the new default. Resolved
in commit `8badd7b` (fix(18-10): resolve D-18-09-01...).

---

## D-18-10-01: Pre-existing test/fork/snipeLifecycle.test.ts setup failure

**Discovered:** 2026-05-22 during plan 18-10 post-merge full-suite gate
**Caused by:** Phase 11 fix `aa70c8b` is the last touch; the failure appears
to be a fork-test infrastructure issue unrelated to phase 18 work.

**Symptom:** test/fork/snipeLifecycle.test.ts beforeAll hook fails to
deploy/initialize `fakeToken` — 7 tests then throw `TypeError: Cannot
read properties of undefined (reading 'getAddress' / 'balanceOf')` at
test/fork/setup.ts:31 socket boundary.

**Why deferred:** Verified pre-existing — reverting the file to commit
`1c77e85` (BEFORE plan 18-10 wiring) reproduces the exact same socket
error. Plan 18-10's wiring did NOT introduce this failure. Out of scope
per SCOPE BOUNDARY rule.

**Suggested fix:** Investigate test/fork/setup.ts:31 socket boundary and
the `fakeToken` deployment lifecycle. Likely either (a) a missing hardhat
node prerequisite under modern vitest, (b) an ethers v6 migration debt
item in setup.ts, or (c) a port collision when both the safety-bank
audit job and the snipeLifecycle test try to connect. The remaining 425
unit + integration tests pass cleanly; only this one fork file is
affected. Open a dedicated phase 19+ tech-debt item.

**Impact on plan 18-10:** None — plan 18-10 ships 6 new integration tests
(v2HoneypotIntegration + v3HoneypotIntegration) which all pass. Full
test count: 425 pass / 7 fail (all 7 in this one pre-existing snipeLifecycle
file). 51/52 test files pass.
