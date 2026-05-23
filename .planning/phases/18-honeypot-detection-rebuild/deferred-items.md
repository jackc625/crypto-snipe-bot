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
