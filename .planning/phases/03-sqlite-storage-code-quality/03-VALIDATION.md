---
phase: 3
slug: sqlite-storage-code-quality
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Hardhat + Chai (via @nomicfoundation/hardhat-toolbox) -- already installed |
| **Config file** | hardhat.config.ts (Solidity only); no TypeScript unit test config yet |
| **Quick run command** | `npx hardhat test test/db.test.ts` |
| **Full suite command** | `npx hardhat test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx hardhat test test/db.test.ts --no-compile`
- **After every plan wave:** Run `npx hardhat test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | DB-01 | unit | `npx ts-node --eval "require('./src/utils/db')"` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 0 | DB-02 | unit | Verify storage.ts deleted, all reads go through db.ts | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 0 | DB-03 | unit | Insert buy/sell/fail, verify rows with timestamps | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 0 | DB-04 | unit | Insert buy+sell pair, verify P&L computation | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | INFRA-01 | unit+grep | `grep -r "console\." src/ --include="*.ts"` returns 0 | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 1 | INFRA-02 | unit | Call getProvider() twice, assert same instance | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 1 | INFRA-03 | grep | `grep -r "function.*view returns" src/ --include="*.ts"` only in abis.ts | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/db.test.ts` — stubs for DB-01, DB-02, DB-03, DB-04 (SQLite storage, audit trail, P&L query)
- [ ] `test/logger.test.ts` — stubs for INFRA-01 (structured logging output verification)
- [ ] `test/provider.test.ts` — stubs for INFRA-02 (singleton behavior)
- [ ] Test runner for pure TypeScript tests (Hardhat test runner works for .ts files via hardhat-toolbox)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Windows native module install | DB-01 | Platform-specific compilation | Run `npm install better-sqlite3 --legacy-peer-deps` and verify no errors |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
