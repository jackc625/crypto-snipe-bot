---
phase: 22-safety-rails-audit
plan: 11
subsystem: testing
tags: [safe-02, test-rails, child-process, fork-rpc, hardhat, ast-gate, red-proofs, typescript-compiler-api]

requires:
  - phase: 22-safety-rails-audit (22-05)
    provides: fork-mode rails and FORK_SHELL_KEYS, test/.env.test sentinels
  - phase: 22-safety-rails-audit (22-08)
    provides: spawnRailedChild, verify-prod-untouched wrapper, childProbe.cjs, fork rehearsal config
  - phase: 22-safety-rails-audit (22-10)
    provides: VITEST-gated dotenv sites the migrated CLI children rely on
provides:
  - test/unit/rails/spawnSites.test.ts — alias-aware AST gate that keeps spawnRailedChild the only spawner
  - test/fork/helpers/forkRpcUrl.ts — resolveForkRpcUrl(env) and hasForkRpcUrl(env), the one reader of ETH_FORK_RPC_URL
  - test/fork/helpers/hardhatChildEnv.ts — buildHardhatChildEnv(parentEnv), sanitized env for every Hardhat child
  - test/unit/rails/forkShellOnly.test.ts — AST scan of fork env reads and the Vitest main-process closure
  - .planning/audit/inputs/rails-test-edits.json — 11 test edits for 22-29 to register
  - UFV-04 in .planning/audit/inputs/unrun-fork-verifications.json (owner Phase 25)
  - red-proofs/22-11-1..4
affects: [22-15, 22-16, 22-29, phase-25, phase-28]

actuals:
  tokens: 70438
  tasks: 3
  commits: 7
plan_head_before: 2292639141573d626abe654500132a6f0d87ed64
plan_head_after: 361bd1bcc4e10e9cf82d463f319c37a45f7bafca

tech-stack:
  added: []
  patterns:
    - "A security source gate parses with the TypeScript compiler API and tracks local bindings of require and createRequire, so aliases and destructuring cannot slip past it"
    - "A RED edit is undone with git -c core.autocrlf=false checkout -- <file>, and each proof script fails unless the RED exit, the expected text, the restored sha256, an empty test/ status and the GREEN rerun all hold"

key-files:
  created:
    - test/fork/helpers/forkRpcUrl.ts
    - test/fork/helpers/hardhatChildEnv.ts
    - test/unit/rails/spawnSites.test.ts
    - test/unit/rails/forkRpcSource.test.ts
    - test/unit/rails/hardhatChildEnv.test.ts
    - test/unit/rails/forkShellOnly.test.ts
    - .planning/audit/inputs/rails-test-edits.json
    - .planning/phases/22-safety-rails-audit/red-proofs/22-11-1-spawn-gate.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-11-2-fork-rpc-source.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-11-3-hardhat-child-env.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-11-4-fork-inworker-rpc.txt
  modified:
    - test/integration/preflightCli.test.ts
    - test/integration/pauseCli.test.ts
    - test/fork/setup.ts
    - test/fork/antiRugDetector.fork.test.ts
    - test/fork/exitStatePersistence.fork.test.ts
    - test/fork/deliberateBuyReplay.fork.test.ts
    - test/fork/realLaunchReplay.fork.test.ts
    - test/fork/captureRehearsal.fork.test.ts
    - test/fork/honeypotChecker.fork.test.ts
    - test/rails/probes/notifierProdPathProbe.ts
    - test/unit/rails/envSentinel.test.ts
    - .planning/audit/inputs/unrun-fork-verifications.json

key-decisions:
  - "22-11: the spawn gate allows three exact files, not two: test/rails/selfcheck.cjs (the plain-Node rails proof, added in 22-05 after research counted the spawn sites) spawns one minimal-env child to hash and delete a temp fake root, and cannot use the TypeScript spawner. test/fork/setup.ts remains the only exemption outside test/rails/."
  - "22-11: a member call .exec() is accepted only on a RegExp literal or a named receiver (db, mockDb, fileDb, mem, w, attachRe, vacRe, entryRe), because about 55 better-sqlite3 and RegExp calls under test/ would otherwise fail the gate. An unknown receiver still fails."
  - "22-11: UFV-04 owner_phase stays the number 25, matching UFV-01..03 and the plan's verify. The string rule at check.ts:304 applies only to external_od_refs on findings."

patterns-established:
  - "Separate closure safety from child safety: the main-process import scan cannot see what a spawned process reads, so the exempt child gets its own sanitized env and its own test"

requirements-completed: [SAFE-02]

coverage:
  - id: D1
    description: "preflightCli and pauseCli children run on the sentinel env through spawnRailedChild; no test builds a child from the parent environment (D-03, Pitfall 7)"
    requirement: SAFE-02
    verification:
      - kind: integration
        ref: "test/integration/preflightCli.test.ts + test/integration/pauseCli.test.ts (22 tests, wrapped, verdict untouched, manifest equal, ledger ok, run vpu-20261109T032101-24156-165f2b)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AST spawn gate: every script under test/ is scanned; ten seeded spawn forms and ten further forms are flagged, ordinary code is not"
    requirement: SAFE-02
    verification:
      - kind: unit
        ref: "test/unit/rails/spawnSites.test.ts (4 tests, wrapped, verdict untouched)"
        status: pass
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-11-1-spawn-gate.txt"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fork RPC URL is shell-only through one resolver, in globalSetup and in all seven in-worker sites (AC-17)"
    requirement: SAFE-02
    verification:
      - kind: unit
        ref: "test/unit/rails/forkRpcSource.test.ts (9 tests) and test/unit/rails/forkShellOnly.test.ts (9 tests), wrapped, verdict untouched"
        status: pass
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-11-2-fork-rpc-source.txt and 22-11-4-fork-inworker-rpc.txt"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every Hardhat child in test/fork/setup.ts gets the sanitized env; the same preload blocks a .env read in a railed child"
    requirement: SAFE-02
    verification:
      - kind: unit
        ref: "test/unit/rails/hardhatChildEnv.test.ts (6 tests, wrapped, verdict untouched)"
        status: pass
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-11-3-hardhat-child-env.txt"
        status: pass
    human_judgment: false
  - id: D5
    description: "A real Hardhat launch under the sanitized env, and a first execution of the six edited fork files, are dated obligations rather than Phase 22 evidence"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: ".planning/audit/inputs/unrun-fork-verifications.json UFV-04 (owner 25) and rails-test-edits.json first_execution_owner_phase 25"
        status: pass
    human_judgment: true
    rationale: "Phase 22 starts no Hardhat (AC-08), so the first real fork run has to confirm the fork still works with the sanitized child env"

duration: 14min
completed: 2026-11-09
status: complete
---

# Phase 22 Plan 11: Child-Process and Fork-RPC Rails Summary

**The two remaining CLI tests now spawn through `spawnRailedChild`, and an AST gate fails if any script under `test/` spawns any other way. The fork project reads its RPC URL only from the shell, through one resolver, at all eight read sites. Each Hardhat child is launched with fake settings and the fork rails loaded, so `hardhat.config.ts` can no longer pull the real deploy key from `.env`. Hardhat was never started, and the live `data/` matched the backup MANIFEST on every run.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-11-09T03:07:33Z
- **Completed:** 2026-11-09T03:21:49Z
- **Tasks:** 3/3
- **Files:** 23 (11 created, 12 modified)

## Accomplishments

- **CLI tests moved (Task 1).** `preflightCli` and `pauseCli` no longer copy the parent environment or import `child_process`. Test 1 now runs against the sentinel env with the same exit-code contract. Test counts are unchanged (5 and 13). The tracer gate re-ran the verify after the commit: 22 tests, verdict `untouched`.
- **Spawn gate (Task 2).** The gate parses every `.ts`, `.cts`, `.mts`, `.js`, `.cjs` and `.mjs` file under `test/` and tracks local names bound to `require` and `createRequire`. All ten planted forms from the plan are flagged, and so are ten more (import-equals, aliased `createRequire`, `module.require`, `vi.importActual`, an unknown `.exec` receiver and others).
- **Shell-only fork RPC (Tasks 2 and 3).** `resolveForkRpcUrl` has no fallback and fails with an error naming `ETH_FORK_RPC_URL`. `setup()` calls it first. All seven in-worker reads use it or `hasForkRpcUrl`. Tracked `.ts` files under `test/fork` now mention the old fallback variable 0 times (baseline 11).
- **Sanitized Hardhat child.** `buildHardhatChildEnv` builds the env from scratch: sentinels, OS essentials, the two shell keys, then the fork rails preload. A TypeScript-AST check confirms every Hardhat or `npx` launch in `setup.ts` uses it.
- **Fork shell-only scan.** Outside `test/fork/rails/`, every `process.env.<KEY>` read is self-assigned or `ALLOW_REAL_MAINNET`. The Vitest main-process closure of both config files loads no `.env`, reaches nothing in `src/`, and imports no Hardhat.
- **Final wrapped runs.** Unit: 7 files, 75 tests. Integration: 22 tests. Fork rehearsal: 6 tests. Each had verdict `untouched`, manifest equal, ledger ok.
- **No Hardhat started.** `tasklist | grep -i hardhat` was empty after Task 2 and at the end of the plan.

### RED proofs (AC-18)

| # | Rail | Neutralised | Run | RED result | GREEN |
|---|------|-------------|-----|------------|-------|
| 1 | spawn-gate | `spawnSync` import and call added to `pauseCli.test.ts` | spawnSites | failed, naming `pauseCli.test.ts:373` and `:374` | 4 passed |
| 2 | fork-rpc-source | fallback restored in the resolver | forkRpcSource | "has no fallback" failed | 9 passed |
| 3 | hardhat-child-env | starts from `parentEnv`, no `NODE_OPTIONS` | hardhatChildEnv | case (a) failed, 3 tests | 6 passed |
| 4 | fork-inworker-rpc | fallback restored at `FORK_RPC` in `exitStatePersistence` | forkShellOnly | (a), (b) and (c) failed, naming the file at line 79 | 9 passed |

Every RED verdict was `untouched` with the manifest equal. Every restore matched its sha256, and `git status --porcelain test` was empty before each proof commit.

## Task Commits

1. **Task 1: CLI tests onto the railed spawner.** `be57bff` (test)
2. **Task 2 step A: spawn gate, resolver, Hardhat child env, UFV-04.** `069a30c` (feat)
3. **Task 2 RED proofs.** `c77f9f5`, `9cb076b`, `4a6d93a` (docs)
4. **Task 3 step A: six fork files and the shell-only scan.** `2672559` (test)
5. **Task 3 RED proof.** `361bd1b` (docs)

**Plan metadata:** the docs commit that follows this SUMMARY.

## Files Created/Modified

- `test/fork/helpers/forkRpcUrl.ts`: the one reader of `ETH_FORK_RPC_URL`.
- `test/fork/helpers/hardhatChildEnv.ts`: the sanitized Hardhat child env.
- `test/fork/setup.ts`: resolves the URL first, re-exports the resolver, sanitizes both Hardhat launches.
- `test/unit/rails/spawnSites.test.ts`, `forkRpcSource.test.ts`, `hardhatChildEnv.test.ts`, `forkShellOnly.test.ts`: the new gates and tests.
- `test/integration/preflightCli.test.ts`, `pauseCli.test.ts`: moved onto the spawner.
- Six `test/fork/*.fork.test.ts` files: each read routed through the resolver.
- `test/rails/probes/notifierProdPathProbe.ts`, `test/unit/rails/envSentinel.test.ts`: literal `require` specifiers (see Deviations).
- `.planning/audit/inputs/rails-test-edits.json`, `unrun-fork-verifications.json`: 11 edit records and UFV-04.
- `red-proofs/22-11-1..4`.

## Decisions Made

See `key-decisions`. The first two are the places where the gate differs from the plan's literal wording, and both are explained below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A third allowed file in the spawn gate: `test/rails/selfcheck.cjs`**
- **Found during:** Task 2.
- **Issue:** The plan allows two files, and its facts came from research done before 22-05 added this script. It is a plain-Node check run outside Vitest. It has one child, which hashes and deletes a temp fake root that the rails correctly refuse in-process. It cannot load the TypeScript spawner.
- **Fix:** Exact-path entry with its reason in `ALLOWED_FILES`. `test/fork/setup.ts` remains the only exemption outside `test/rails/`.
- **Worth a look at the phase review:** this child runs without the rails, by design. Its env is built from scratch from a short OS-only list, so no parent values reach it.
- **Committed in:** `069a30c`

**2. [Rule 3 - Blocking] The gate's `.exec` rule needed a receiver check**
- **Found during:** Task 2.
- **Issue:** Flagging every member call named `exec`, as written, would flag about 55 harmless `db.exec(...)` and `regex.exec(...)` calls, so the gate could never pass.
- **Fix:** `.exec` is accepted only on a RegExp literal or one of eight named receivers. An unknown receiver still fails, and a test proves it. Every other spawn name stays flagged on any receiver.
- **Committed in:** `069a30c`

**3. [Rule 3 - Blocking] Two non-literal `require` calls made literal**
- **Found during:** Task 2, reported by the new gate.
- **Fix:** `notifierProdPathProbe.ts` now takes a loader function and keeps its exit 4 on a failed import. `envSentinel.test.ts` requires its literal path. Neither file was in the plan's list. `dotenvSrcSkip` and `envSentinel` pass.
- **Committed in:** `069a30c`

**4. [Rule 3 - Blocking] `ETH_WS_RPC_URL` corrected to `ETH_WS_URL` in `preflightCli`**
- **Found during:** Task 1.
- **Issue:** The code reads `ETH_WS_URL` (`src/chainRegistry.ts:211`), so the old override never did anything, and `spawnRailedChild` refuses a key that is not in `test/.env.test`.
- **Fix:** Corrected at all three sites and recorded in `rails-test-edits.json` as test-quality.
- **Committed in:** `be57bff`

**5. [Hardening] Gate slightly wider than the plan list**
- **What:** Also scans `.mjs`, and also catches import-equals, `module.require`, aliased `createRequire` and `vi.importActual` / `vi.importMock`.
- **Committed in:** `069a30c`

---

**Total deviations:** 4 auto-fixed (all blocking) and 1 small hardening.
**Impact on plan:** All were needed for the gate to be correct and able to pass. No test was deleted, skipped or `.todo`'d, and no production code changed.

## Issues Encountered

- `preflightCli` Test 4 still names its first run `passResult`, but on sentinels every RPC is refused, so that run is now a failing preflight too. Its assertion still holds. The loss of a real all-pass observation is recorded in `rails-test-edits.json` for Phase 28.
- The secret-read guard refuses the plan's parent-env-spread grep on the command line, so those acceptance checks ran with the Grep tool (0 matches in all four files), as in 22-08.

## Known Stubs

None.

## Notes for 22-29 / Phase 25

- **UFV-04:** the Hardhat child env carries no `CSB_RAIL_RUN_ID`, as the plan requires, so its ledger entries land under `<tmp>/crypto-snipe-bot-rail-ledger/no-run`. The UFV-04 assertion says so.
- **The six edited fork files have never executed.** Module-scope `resolveForkRpcUrl()` throws if the variable is absent, but `setup()` throws first in a real fork run, so workers never reach it unset.
- **22-29:** 11 `rails-test-edits.json` entries to register. No `rails-discoveries.json` was needed, and no capital-safety defect was found.

## User Setup Required

None.

## Next Phase Readiness

Ready for the next Phase 22 plan. The rails now cover every spawn path under `test/` and the fork project's RPC source.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-09*

## Self-Check: PASSED

- FOUND: all 11 created and 12 modified files listed in key-files
- FOUND: be57bff, 069a30c, c77f9f5, 9cb076b, 4a6d93a, 2672559, 361bd1b (`git rev-list --count 2292639..HEAD` = 7 at SUMMARY time)
- Re-run after the last task commit: unit 7 files / 75 tests, integration 22 tests, fork rehearsal 6 tests, all wrapped with verdict `untouched`, manifest equal, ledger ok; zero fallback mentions in tracked `test/fork` `.ts` files; `git status --porcelain test` empty; no Hardhat process
