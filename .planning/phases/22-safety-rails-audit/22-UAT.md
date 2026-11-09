---
status: testing
phase: 22-safety-rails-audit
source: [22-VERIFICATION.md]
started: 2026-11-09T07:14:24Z
updated: 2026-11-09T07:14:24Z
---

## Current Test

number: 1
name: Real fork run of the five rehearsed checks (UFV-01..UFV-05)
expected: |
  All five pass in a real Hardhat-backed npm run test:fork under the prod-untouched wrapper. Cannot run in Phase 22 by operator rule; the operator ruled accept-rehearsal-plus-obligation, and Phase 25 owns the run.
awaiting: user response

## Tests

### 1. Real fork run of the five rehearsed checks (UFV-01..UFV-05)
expected: All five pass in a real Hardhat-backed npm run test:fork under the prod-untouched wrapper. UFV-05 is the only check that confirms the HoneypotChecker contract exists on mainnet. Owned by Phase 25 (AUD-TESTQ-030..035).
result: [pending]

### 2. One outside assistant is enough for the money slices (D-14)
expected: Operator accepts that only codex reviewed the code (in Docker, no tools, code in the prompt), that agy was excluded by the ruling "codex a, agy c", and that the host containment probe sent package.json (dependency names and scripts only) to OpenAI.
result: [pending]

### 3. Earlier fork rehearsal runs and the real env file (AUD-REAUDIT-001)
expected: Operator accepts that the 11 fork rehearsal runs before commit a08d650 very likely read the real env file into the Vitest main process. Only VITE_-prefixed values pass on from there. Nobody observed the file being opened; the conclusion rests on the code path and fake-file runs.
result: [pending]

### 4. Process lock scope (SAFE-04, WR-02)
expected: Operator accepts that the lock is per OS user and follows HOME/USERPROFILE, so a second bot under another user or a changed HOME is not excluded. A machine-wide lock location is a Phase 24 design choice.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
