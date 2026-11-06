---
phase: "22"
slug: "safety-rails-audit"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-06"
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `22-RESEARCH.md` §Validation Architecture. The per-task map is filled in once the PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1, on **Node 22.16.0 only** (D-21: absolute path `C:\Users\jackc\AppData\Local\nvm\v22.16.0\node.exe`, or that directory first on `PATH` for `npm`/`npx`; the global Node 24.18.0 cannot load `better-sqlite3`) |
| **Config file** | `vitest.config.ts`: drop `config()`, add `envDir: false`, add the rails `setupFiles` to unit, integration, and fork |
| **Quick run command** | `npm run test:unit -- <file>` (post-rail only) |
| **Full suite command** | `npm test` → `vitest run --project unit --project integration` (AC-12), wrapped by `scripts/verify-prod-untouched.ts`; `npm run test:fork` stays opt-in |
| **Pre-rail rule** | **No Vitest invocation in the main checkout until the rails commit lands.** Pre-rail collection runs only inside the D-13 isolated export (per-package junctions, Node 22) |
| **Estimated runtime** | measured at the first post-rail run |

---

## Sampling Rate

- **After every task commit (post-rail):** that rail's test file plus `test/rails/**`
- **After every plan wave:** `npm test` wrapped by `verify-prod-untouched.ts`, plus `npm run check:vi-mock`
- **Before `/gsd-verify-work`:** full suite green; NAC-03 live-DB hash equality against the backup manifest; `.planning/audit/tools/check.ts` green; betterleaks scan of the phase commits with 0 new hits
- **Max feedback latency:** one task commit

---

## Per-Task Verification Map

Requirement-level map from research; task IDs get bound when the plans exist.

| Requirement | Behavior | Test Type | Automated Command / Method | RED proof | File Exists | Status |
|-------------|----------|-----------|----------------------------|-----------|-------------|--------|
| SAFE-01 AC-04..06 | missing file / torn snapshot / overwrite all FAIL | script self-check → later Vitest | `scripts/backup-state.ts --self-check` (temp fixtures) | fixture without `bot.db` → FAIL; write between hashes → FAIL | ❌ W0 | ⬜ pending |
| SAFE-01 AC-03/07 | manifest re-verifies; committed blobs equal manifest | script | `sha256sum -c SHA256SUMS` in both copies; `git cat-file -p HEAD:<p> \| sha256sum` loop | flipped byte in fixture copy → mismatch | ❌ W0 | ⬜ pending |
| R3 AC-09/10 | forensic report deterministic; copy E unchanged | script | `forensic-db.ts` ×2 → `cmp`; E hash before/after | fixture WAL-only row must appear in diff | ❌ W0 | ⬜ pending |
| SAFE-02 AC-13 | env from sentinels; `.env` blocked | unit (all projects) | `test/rails/env.test.ts` | child without preload keeps planted value | ❌ W0 | ⬜ pending |
| SAFE-02 AC-14 | DB tripwire, both layers | unit | `test/rails/dbTripwire.test.ts` | fake repo root: without rails `data/bot.db` is created; `delete process.env.VITEST` still blocked | ❌ W0 | ⬜ pending |
| SAFE-02 AC-15 | non-loopback transports denied; loopback OK | unit | `test/rails/netDeny.test.ts` | child without preload → not `E_RAIL_NET_DENIED` | ❌ W0 | ⬜ pending |
| SAFE-02 AC-16 | notifier refuses via catch/error path (D-04 amended); broadcast unchanged | unit | spy on `axios.post`: not called; ledger entry; broadcast called | remove refusal → spy called | ❌ W0 | ⬜ pending |
| SAFE-02 AC-17 | fork RPC var shell-only | unit (no Hardhat) | call fork `setup()` with var unset → error names `ETH_FORK_RPC_URL` | restore `ALCHEMY_URL` fallback → no error | ❌ W0 | ⬜ pending |
| SAFE-02 AC-19 | `npm test` leaves `data/` untouched | script wrapper | `scripts/verify-prod-untouched.ts` (hash + mtime, ledger 0 non-loopback connects) | aggregate | ❌ W0 | ⬜ pending |
| D-03 | no spawn outside helper | unit (TS AST scan) | `test/rails/spawnSites.test.ts` | fixture with `spawnSync` → fails | ❌ W0 | ⬜ pending |
| SAFE-03 AC-20 | second load throws (casing alias) | unit + child | `test/guards/singleton.test.ts` | remove guard → loads twice | ❌ W0 | ⬜ pending |
| SAFE-03 AC-21 | casing flag in 3 tsconfigs | unit | `test/guards/tsconfigCasing.test.ts` | — | ❌ W0 | ⬜ pending |
| SAFE-03 AC-22 / NAC-04 | suite green, counts ≥ pre-rail | suite + baseline diff | `npm test` vs `.planning/baselines/before/test-counts.json` | — | — | ⬜ pending |
| SAFE-04 AC-23a-d / NAC-07 | refuse; release after kill; one winner; preflight/pause/resume OK; mechanism error refuses; GC case | integration (child processes) | `test/integration/processLock.test.ts` | unpinned handle + `--expose-gc` → second acquire succeeds | ❌ W0 | ⬜ pending |
| SAFE-05 AC-24..26 | v7 opens, v8 refuses (hash unchanged); repo-root anchoring; refuse missing/0-byte/v0 | integration (child without VITEST) | `test/integration/dbGuards.test.ts` | remove probe → v8 downgraded | ❌ W0 | ⬜ pending |
| SAFE-06 AC-27 | gate fails on broken / non-literal specifiers | unit + CI | `npm run check:vi-mock` on `test/fixtures/viMockGate/*` and real suite | broken fixture must fail | ❌ W0 | ⬜ pending |
| SAFE-07 AC-28..30 / NAC-08 | deterministic baselines; no package/lock/node_modules change | script ×2 | `capture-baselines.ts` twice → `diff -r` | — | ❌ W0 | ⬜ pending |
| AUDIT-01/03/04/05 | register complete; ledger == `git ls-files`; 20×5 matrix no blanks; NAC-09/10/12 | script | `.planning/audit/tools/check.ts` | remove one ledger row → fails | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/rails/rails.cjs`: one source loaded both as `setupFiles` and as the `NODE_OPTIONS=--require` preload
- [ ] `test/rails/spawnRailedChild.ts`: the only sanctioned spawn path
- [ ] `test/.env.test` plus the `.env.example` key-set sync test
- [ ] Rail RED tests listed above
- [ ] `test/fixtures/viMockGate/`
- [ ] Temp fake-repo-root helper
- [ ] Process-lock child-process harness (barrier + `--expose-gc`)
- [ ] `scripts/verify-prod-untouched.ts`

No framework install is needed (Vitest 4.1.1 is already installed; no `npm install` this phase).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Off-machine copy proven from downloaded bytes | SAFE-01 / D-10 | needs the operator's Google account | operator uploads the archive at drive.google.com, downloads it into a fresh temp folder, then runs `backup-state.ts --verify <downloaded>` |
| No `.env` secret value in either backup copy | NAC-01 / D-22 | reads `.env`, so only the operator may run it | operator runs the exact-value check and pastes back only its per-key yes/no lines |
| External-model second opinion send | AUDIT-01 / D-14 | one-way disclosure of source to OpenAI / Google | operator reviews the printed send list (tracked slice files only) and approves or declines |
| First betterleaks run | AUDIT-03 / D-17 amended | trust decision on a downloaded binary | operator confirms the `gh release verify-asset` result and SHA-256 match, explained in plain words |
| Escalation acknowledgements | R14 / D-16 / AC-40 | operator rulings | blocking checkpoint per escalation tier; ruling recorded in the register |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < one task commit
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
