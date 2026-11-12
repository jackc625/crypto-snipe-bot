---
phase: 23-test-safety-net-harness-triage-characterization
plan: 31
subsystem: testing
tags: [red-proof, in-memory-mutant, spawnRailedChild, require-cache, typescript-compiler-api, ts.createProgram, symbol-lookup, CHAR-06]

requires:
  - phase: 23 (plan 23-29)
    provides: runMutant, runGroup, the MUTANTS / CONVERTED_TESTS / CONVERTED_COUNTS / GUARD_MUTANTS tables, --check-manifest and --check-summaries
  - phase: 23 (plan 23-18)
    provides: the first conversion's patterns (describe titles kept; FORBIDDEN_IN_MESSAGE exported) and its 6 rows
  - phase: 23 (plan 23-14)
    provides: the AUD-TX-005 rail test in processLock.test.ts and the AUD-TESTI-011 rail test in spawnSites.test.ts, both kept with their titles and closes-finding markers
provides:
  - test/integration/preflightCli.test.ts, pauseCli.test.ts, processLock.test.ts and test/unit/mainEntry.test.ts read no named src/ or scripts/ file as text
  - test/integration/fixtures/loadedModulesProbe.ts (a railed child that loads one src/ or scripts/ module and records which repo modules that load pulled in, from require.cache)
  - test/helpers/sourceGraph.ts (ts.createProgram over a directory walk; modules found by the symbols they export; an import graph built with the compiler's own module resolution)
  - scripts/red-proof-conversions.ts groups cli-preflight (1 mutant), cli-pause (12), cli-lock (5), cli-entry (9); 17 CONVERTED_TESTS rows in 4 files; GUARD_MUTANTS row main-starts-before-lock
affects: [23-30, 23-19 (they extend the same tables; 23-19's AC-37 gate must accept the directory-walk reads used here), 23-26 (MANIFEST-OK rows 36 files 11 guards 1 counts these 17 rows and the guard; --check-summaries reads the RED-OK lines below; test-identity reads the 5 recorded renames), phase-27 (file moves: these tests find modules by symbol, not by path)]

actuals:
  tokens: 19166
  tasks: 3
  commits: 6
plan_head_before: ee52acb015e38b039d657691bd673e809e107a66
plan_head_after: a0811f02725ad3dd259050cfa3b5c9afe9ca7e8c

tech-stack:
  added: []
  patterns:
    - "Load check instead of a text check: a railed child loads a module under test/integration/fixtures/loadedModulesProbe.ts, which writes at exit only the repo modules that entered require.cache after it started. The preloaded rails, the env-overrides module and an in-memory mutant's hook are left out."
    - "Symbol lookup that names no file: a module is 'the one that exports X' in a directory walk of src/ (and scripts/). The test survives a file move and still fails when the behavior goes."
    - "Some behavior only a program start could show: the guard placement in the bot module, its direct-start block, console calls in the boot files, and where startBot requires the bot. These stay checks of the parsed module, found by symbol."
    - "A CLI is checked by what it dials and prints. The real script runs as a railed child (spawnRailedChildAsync, so a loopback server in the test can answer it) against closed loopback ports or a dashboard that refuses the login."

key-files:
  created:
    - test/integration/fixtures/loadedModulesProbe.ts
    - test/helpers/sourceGraph.ts
  modified:
    - test/integration/preflightCli.test.ts
    - test/integration/pauseCli.test.ts
    - test/integration/processLock.test.ts
    - test/unit/mainEntry.test.ts
    - test/unit/rails/spawnSites.test.ts
    - scripts/red-proof-conversions.ts
    - .planning/audit/inputs/rails-test-edits.json
    - .planning/audit/ledger/TESTI.json
    - .planning/audit/ledger/TESTU.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "Modules are found by the symbols they export, never by file name: the bot module (startMultiChainBot), the boot entry (runMain), the lock module (acquireProcessLock) and the guard (refuseIfDirectEntry), in a directory walk. The preflight, pause and resume commands are the files that package.json's npm scripts of those names run."
  - "Children run the real scripts through ts-node's transpile-only register, as the lock fixtures do, not through npx ts-node. That takes 0.4 to 1.0 s alone instead of 3 to 13 s. The type-checking start still runs in pauseCli Test 4, preflight Tests 1-4 and AC-23d."
  - "pauseCli plants a unique key value (csb-23-31-dashboard-key-5f0c2e9a) instead of the sentinel TEST-SENTINEL, which ten test/.env.test keys share. A key found in the output can then only be the key. The 401 test also asserts the login body carried that key."
  - "The plan's one sentence for the key tests ('on a closed port and again against a loopback server answering the login with 401') is split across two tests, so the mutants fail exactly the sets the plan names. The 401 case is the 'never prints the key' test (logs-key); the closed-port case is the connection-error test (conn-error-logs-key)."
  - "main-starts-before-lock keeps `only` = (1). Measured: it also fails (2) and (3), because startBot runs before their lock error. A guard row must expect exactly its guarded test."
  - "(4) keeps one check on the parsed entry, found by symbol: its one require() resolves to the module exporting startMultiChainBot and sits inside the function given as startBot. No run reaches startBot without starting the program, and dropping the check would leave that part unprotected."
  - "(6) adds a check that the guard's import specifiers are all Node built-ins. A record of repo modules cannot show a package import, and the old text check ('imports only fs and path') did cover that."
  - "Titles: 5 own-title renames are recorded in rails-test-edits.json (title_before / title_after). No describe title changed, because of 23-18's test-identity limit. test-identity reports 0 missing titles in all four files."

patterns-established:
  - "Load-record probe for any module-load invariant (no stateful import; a CLI that must not load X)"
  - "Directory-walk program plus symbol lookup for an import-graph invariant"

requirements-completed: [CHAR-06]

coverage:
  - id: D1
    description: "preflightCli.test.ts: a real run of scripts/preflight.ts in a railed child never loads the module that exports startMultiChainBot; preflight-imports-bot (reach child) fails exactly that test"
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --group cli-preflight (RED-OK preflight-imports-bot, x3, byte-identical)"
        status: pass
    human_judgment: false
  - id: D2
    description: "pauseCli.test.ts: 12 tests run scripts/pause.ts and resume.ts as railed children. The key is never printed on a refused login or a refused connection; an empty key is refused even with --api-key; the dialed address follows DASHBOARD_URL / HOST / PORT, defaults to 8080 and never uses 3000. Each of 12 mutants (reach child) fails exactly its expected tests."
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "scripts/red-proof-conversions.ts --group cli-pause (14 RED-OK lines, x3, byte-identical)"
        status: pass
    human_judgment: false
  - id: D3
    description: "processLock.test.ts: the AC-23d text scan is now its own import-graph test (ts.createProgram over a directory walk); every existing title, AUD-TX-005's rail test and its marker are unchanged; 5 mutants (reach worker) fail it"
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "scripts/red-proof-conversions.ts --group cli-lock (5 RED-OK lines, x3); Task 2 verify (the AUD-TX-005 rail test passed in the JSON report)"
        status: pass
    human_judgment: false
  - id: D4
    description: "mainEntry.test.ts: (4), (5) and (6) find modules by symbol and load them in railed children where a load can show the behavior; the 8 mutants on their rows and the guard main-starts-before-lock on (1) each fail exactly their expected test"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "scripts/red-proof-conversions.ts --group cli-entry (9 RED-OK lines, x3, byte-identical)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Manifest and summaries: 23 rows in 5 files and 1 guard; every required RED-OK line is present"
    requirement: CHAR-06
    verification:
      - kind: other
        ref: "scripts/red-proof-conversions.ts --check-manifest (MANIFEST-OK rows 23 files 5 guards 1); --check-summaries on this file"
        status: pass
    human_judgment: false

duration: 52min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 31: CLI, Lock and Entry-Point Conversions and Their RED Proofs Summary

**What the four test files check now:**
- **Preflight:** a real run of the CLI never loads the module that exports startMultiChainBot.
- **Pause and resume:** checked by what the real scripts do as railed children: what they dial, what they print, how they exit.
- **The lock scan:** now an import graph over a directory walk.
- **The boot-entry checks:** find each module by the symbol it exports and load it in a railed child.

27 in-memory mutants and one guard mutant each fail exactly their expected tests. Nothing under src/ was written.

## Performance

- **Duration:** 52 min
- **Started:** 2026-11-12T05:52:59Z
- **Completed:** 2026-11-12T06:45:00Z
- **Tasks:** 3, plus two fix commits and one register commit
- **Files:** 12 changed (2 created); src/ unchanged

## Accomplishments

- **preflightCli.test.ts (1 test):** the static OPS-LIVE-10 test now runs the real CLI in a railed child under the new load probe. It checks three things:
  - the run ended 0 or 1;
  - the preflight checks were loaded;
  - no loaded module exports startMultiChainBot.
- **pauseCli.test.ts (12 tests):** each test runs `scripts/pause.ts` or `scripts/resume.ts` as a railed child.
  - **Refused login (401):** the key value is in neither output stream, and the login body carried it.
  - **Empty key:** the script exits 1 with "DASHBOARD_API_KEY not set" even with `--api-key` on its command line.
  - **Nothing set:** with URL, host and port empty, it dials `http://127.0.0.1:8080` and nothing on port 3000.
  - **Host and port set:** it dials that host and port.
  - **DASHBOARD_URL set:** it dials that URL, even with a different DASHBOARD_PORT set.
  - **Refused connection:** it exits 2, names the address and DASHBOARD_PORT, and never prints the key.
- **processLock.test.ts:**
  - The AC-23d scan moved into a new test. ts.createProgram builds a program over a directory walk of src/ and scripts/. The commands are the files package.json runs as preflight, pause and resume. Nothing they reach through imports, at any depth, may export acquireProcessLock or runMain.
  - The AC-23d test and every other existing title are unchanged.
- **mainEntry.test.ts:**
  - **(4):** loads the boot entry in a railed child; exactly the entry and the lock module load with it. Its startBot require is checked on the parsed entry.
  - **(5):** checks the bot module found by symbol: its first statement is a side-effect import of the guard module, and its one require.main block exits 1, names the boot entry and starts nothing.
  - **(6):** loads the guard in a railed child (nothing else loads), checks that its specifiers are all built-ins, and checks that neither boot file calls console.
- **RED proofs:** 27 in-memory mutants and 1 guard mutant, each failing exactly its expected tests with an assertion. Every target hash was unchanged, and `git status --porcelain src` was empty after every run.

## Task Commits

1. **Task 1 (tracer): preflight conversion, the load probe and group cli-preflight:** `61e51da` (test). The tracer verify was re-run on the committed tree (TRACER-VERIFY-PASS) before Task 2 started.
2. **Task 2: pause/resume, lock and entry-point conversions, test/helpers/sourceGraph.ts and 10 rails-test-edits entries:** `fd154bd` (test).
3. **Task 3: groups cli-pause, cli-lock and cli-entry, 16 more rows and the guard row; probe records only modules the load added:** `12445c4` (test).
4. **Fix: list the probe on the spawn-site gate's COMPUTED_REQUIRE_FILES and narrow what it loads:** `bab9121` (fix).
5. **Fix: correct the it() count in that rails-test-edits entry (5, not 3):** `da3cfa2` (fix).
6. **Reviewed re_audit rows for the three Phase 22 test files, and the re-rendered AUDIT-FINDINGS.md:** `a0811f0` (docs).

## RED proofs

From `node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --group <name>`:
- Every group exited 0 in each of three rounds.
- The output of each group was byte-identical across the rounds (one md5 per group).
- Per round: cli-preflight 64 to 75 s, cli-pause 58 to 70 s, cli-lock 18 to 22 s, cli-entry 73 to 79 s.

```
RED-OK preflight-imports-bot :: test/integration/preflightCli.test.ts :: npm run preflight CLI (OPS-LIVE-10) > OPS-LIVE-10 invariant: a real run of scripts/preflight.ts never loads the module that exports startMultiChainBot
RED-OK pause-logs-key :: test/integration/pauseCli.test.ts :: T-20-05 mitigation: apiKey never logged in CLI scripts > scripts/pause.ts never prints the DASHBOARD_API_KEY value when the dashboard refuses the login
RED-OK pause-accepts-argv-key :: test/integration/pauseCli.test.ts :: T-20-05 mitigation: apiKey never logged in CLI scripts > scripts/pause.ts with an empty DASHBOARD_API_KEY exits 1 with "DASHBOARD_API_KEY not set", even when --api-key is passed
RED-OK pause-old-default :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/pause.ts no longer hardcodes the 'http://localhost:3000' default
RED-OK pause-old-default :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/pause.ts derives the default from DASHBOARD_PORT with an 8080 fallback
RED-OK pause-ignores-port :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/pause.ts derives the default from DASHBOARD_PORT with an 8080 fallback
RED-OK pause-ignores-url-override :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/pause.ts still honors an explicit DASHBOARD_URL override
RED-OK pause-conn-error-logs-key :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/pause.ts connection-error catch references host:port + DASHBOARD_PORT, never apiKey
RED-OK resume-logs-key :: test/integration/pauseCli.test.ts :: T-20-05 mitigation: apiKey never logged in CLI scripts > scripts/resume.ts never prints the DASHBOARD_API_KEY value when the dashboard refuses the login
RED-OK resume-accepts-argv-key :: test/integration/pauseCli.test.ts :: T-20-05 mitigation: apiKey never logged in CLI scripts > scripts/resume.ts with an empty DASHBOARD_API_KEY exits 1 with "DASHBOARD_API_KEY not set", even when --api-key is passed
RED-OK resume-old-default :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/resume.ts no longer hardcodes the 'http://localhost:3000' default
RED-OK resume-old-default :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/resume.ts derives the default from DASHBOARD_PORT with an 8080 fallback
RED-OK resume-ignores-port :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/resume.ts derives the default from DASHBOARD_PORT with an 8080 fallback
RED-OK resume-ignores-url-override :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/resume.ts still honors an explicit DASHBOARD_URL override
RED-OK resume-conn-error-logs-key :: test/integration/pauseCli.test.ts :: 20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT > scripts/resume.ts connection-error catch references host:port + DASHBOARD_PORT, never apiKey
RED-OK lock-import-pause :: test/integration/processLock.test.ts :: SAFE-04 single-instance process lock (real holder processes) > preflight, pause and resume reach neither the process lock nor the boot entry through their imports (AC-23d)
RED-OK lock-import-resume :: test/integration/processLock.test.ts :: SAFE-04 single-instance process lock (real holder processes) > preflight, pause and resume reach neither the process lock nor the boot entry through their imports (AC-23d)
RED-OK lock-import-preflight-cli :: test/integration/processLock.test.ts :: SAFE-04 single-instance process lock (real holder processes) > preflight, pause and resume reach neither the process lock nor the boot entry through their imports (AC-23d)
RED-OK lock-import-preflight-src :: test/integration/processLock.test.ts :: SAFE-04 single-instance process lock (real holder processes) > preflight, pause and resume reach neither the process lock nor the boot entry through their imports (AC-23d)
RED-OK lock-import-main :: test/integration/processLock.test.ts :: SAFE-04 single-instance process lock (real holder processes) > preflight, pause and resume reach neither the process lock nor the boot entry through their imports (AC-23d)
RED-OK main-imports-config :: test/unit/mainEntry.test.ts :: SAFE-04 boot entry > (4) the boot entry imports nothing stateful and loads the bot only inside startBot
RED-OK main-imports-db :: test/unit/mainEntry.test.ts :: SAFE-04 boot entry > (4) the boot entry imports nothing stateful and loads the bot only inside startBot
RED-OK main-imports-bot :: test/unit/mainEntry.test.ts :: SAFE-04 boot entry > (4) the boot entry imports nothing stateful and loads the bot only inside startBot
RED-OK main-starts-before-lock :: test/unit/mainEntry.test.ts :: SAFE-04 boot entry > (1) starts the bot exactly once, only after the lock is held
RED-OK bot-guard-not-first :: test/unit/mainEntry.test.ts :: SAFE-04 boot entry > (5) src/bot.ts: the first statement is the direct-entry guard and require.main refuses
RED-OK bot-direct-start-does-not-refuse :: test/unit/mainEntry.test.ts :: SAFE-04 boot entry > (5) src/bot.ts: the first statement is the direct-entry guard and require.main refuses
RED-OK guard-imports-config :: test/unit/mainEntry.test.ts :: SAFE-04 boot entry > (6) directEntry.ts imports only fs and path; neither boot file calls console
RED-OK guard-calls-console :: test/unit/mainEntry.test.ts :: SAFE-04 boot entry > (6) directEntry.ts imports only fs and path; neither boot file calls console
RED-OK main-calls-console :: test/unit/mainEntry.test.ts :: SAFE-04 boot entry > (6) directEntry.ts imports only fs and path; neither boot file calls console
```

**Reach markers:**
- Every cli-pause mutant and preflight-imports-bot left a `child` marker: the edit reached the real railed child that ran the script.
- The cli-lock mutants left `worker` markers: the import-graph program read the edited file.
- In cli-entry, main-starts-before-lock left a `vite` marker. main-imports-* and guard-imports-config left `child` markers. bot-*, guard-calls-console and main-calls-console left `worker` markers.

**Failure messages, each starting with AssertionError (from diagnostic runs of the same rows through runMutant):**
- **main-imports-config / -db / -bot:** `expected [ … ] to deeply equal [ 'src/main.ts', …(1) ]`. The load pulled in 4, 7 and 65 repo modules.
- **guard-imports-config:** `expected [ 'src/config.ts', …(2) ] to deeply equal [ 'src/guards/directEntry.ts' ]`.
- **main-starts-before-lock:** `expected 'ATTEMPT … ACQUIRED …' to contain 'REFUSED PROCESS_LOCK_HELD'`. Over the whole file (no `only`), (2) also failed with `expected 2 to be +0` and (3) with `expected 1 to be +0`.

The other rows were proven with the `messageIncludes` shown in their rows, for example `not to contain 'csb-23-31-dashboard-key-5f0c2e9a'` and `to be 'http://127.0.0.2:`.

**Guard row:** `GUARD_MUTANTS` holds one row:
- `mutant` main-starts-before-lock;
- `guardedTitle` the test (1) title;
- `convertedTitle` the test (4) row's currentTitle;
- `reason`: (4)'s source-text ordering assertion is now carried by what (1) observes.

**Removals (AC-38):** none. No test was removed, so this plan has no `AC-38 removed:` line. The it() counts compared with the phase start:

| File | it() at the phase start | it() now | Why |
|---|---|---|---|
| preflightCli | 5 | 5 | |
| pauseCli | 13 | 13 | |
| processLock | 7 | 8 | the plan's split |
| mainEntry | 9 | 9 | |

**Renamed tests (AC-38, recorded in rails-test-edits.json with title_before / title_after, honoured by test-identity):**
- preflightCli: "Static OPS-LIVE-10 invariant: scripts/preflight.ts does not import bot.ts / invoke startMultiChainBot" became "OPS-LIVE-10 invariant: a real run of scripts/preflight.ts never loads the module that exports startMultiChainBot". Reason: the test runs the CLI and no longer reads its text.
- pauseCli: "scripts/pause.ts contains no log call referencing apiKey" (and the resume.ts twin) became "scripts/pause.ts never prints the DASHBOARD_API_KEY value when the dashboard refuses the login". Reason: the old title described the text.
- pauseCli: 'scripts/pause.ts contains 1 "DASHBOARD_API_KEY not set" string + 0 CLI-arg references to apiKey' (and the resume.ts twin) became 'scripts/pause.ts with an empty DASHBOARD_API_KEY exits 1 with "DASHBOARD_API_KEY not set", even when --api-key is passed'. Reason: the same.
- mainEntry: "(4) src/main.ts imports nothing stateful and loads the bot only inside startBot, after the lock" became "(4) the boot entry imports nothing stateful and loads the bot only inside startBot". Reason: "after the lock" is now (1)'s, through the guard row.
- The four 20-09 loop titles, (5), (6) and the AC-23d title are unchanged. The new processLock test is a new title, not a rename.

## Files Created/Modified

- **`test/integration/fixtures/loadedModulesProbe.ts` (new):** the load probe.
  - Usage: `<outFile> <module> [--run]`.
  - It records only modules added after it started.
  - It refuses (exit 3) any target that is not a .ts module under src/ or scripts/.
  - The record is written from the 'exit' event, so a CLI that ends the process still produces one.
- **`test/helpers/sourceGraph.ts` (new):**
  - `loadRepoModules(dirs)`: ts.createProgram with noResolve over a directory walk, and a host with setParentNodes.
  - `resolveSpecifier`, `modulesExporting` / `moduleExporting`, `reachable` (an import closure with one path per module) and `consoleCallCount`.
- **The four converted test files:** as described above.
- **`test/unit/rails/spawnSites.test.ts`:** the probe joins `COMPUTED_REQUIRE_FILES`, with its reason.
- **`scripts/red-proof-conversions.ts`:** this plan's rows in the 23-29 tables:
  - MUTANTS: 1 + 12 + 5 + 9.
  - CONVERTED_TESTS: 17 rows, so CONVERTED_COUNTS adds preflightCli 1, pauseCli 12, processLock 1 and mainEntry 3.
  - GUARD_MUTANTS: 1 row.
- **`.planning/audit/inputs/rails-test-edits.json`:** 12 entries, 5 of them with title_before / title_after.
- **`.planning/audit/ledger/TESTI.json`, `TESTU.json`, `AUDIT-FINDINGS.md`:** 3 reviewed re_audit rows, and the render of those three ranges.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in my probe] A child-reach proof counted the mutant's own hook as a module loaded with the target**
- **Found during:** Task 3. The first cli-entry run refused main-imports-config as WRONG-SET: it failed (4) and also (6).
- **Issue:** under a child-reach proof, the runner preloads `scripts/in-memory-mutant-overlay.cjs` into every railed child. The probe recorded that repo file as loaded with the guard, so (6) saw 2 modules. In the no-mutant control the hook is absent. The extra failure was a measurement artifact, not the guard loading anything.
- **Fix:** the probe snapshots require.cache before the load and records only modules the load added. The diagnosis came first, as the plan requires; no `expected` was changed.
- **Verification:** all 9 cli-entry rows are RED-OK, and each main-imports-* run and guard-imports-config fails only its own test.
- **Committed in:** 12445c4.

**2. [Rule 3 - Blocking] The spawn-site gate flagged the probe's computed require**
- **Found during:** the first full railed run. It had 1 failure: `test/unit/rails/spawnSites.test.ts`, `test/integration/fixtures/loadedModulesProbe.ts:66 require with a non-literal specifier`.
- **Issue:** the probe has to load the module a test found by symbol, so its path is computed at run time (gate rule b).
- **Fix:** the probe joins `COMPUTED_REQUIRE_FILES`, the gate's own allowance for this case, beside the SAFE-03 duplicate-load probe. Only the plain computed require is relaxed: banned modules and spawn calls in the probe are still flagged. The probe now refuses any target that is not a .ts module under src/ or scripts/. The rail test's title and the AUD-TESTI-011 marker are unchanged. The change has its own rails-test-edits entry and a reviewed re_audit row.
- **Committed in:** bab9121 (da3cfa2 corrects that entry's it() count, which I first wrote as 3).

**3. [Rule 1 - Formatting] A diagnostic removal joined two lines in preflightCli.test.ts**
- **Issue:** removing my temporary diagnostic in Task 1 left a statement and the next comment on one line in 61e51da. The code was valid, but the formatting was wrong.
- **Fix:** split back into two lines in fd154bd.

**4. [Plan wording] The key tests' closed-port and 401 cases are in two different tests**
- **Issue:** the plan names both cases in one sentence. With both in one test, conn-error-logs-key would fail the "never prints" test as well as the connection-error test it expects.
- **Fix:** the 401 case is in the "never prints the key" test and the closed-port case in the connection-error test. Each mutant then fails exactly the set the plan names. See key-decisions.

**5. [Plan wording] main-starts-before-lock runs with `only` = (1)**
- **Issue:** the plan's expected set is (1). Over the whole file the mutant also fails (2) and (3), which is real extra protection, measured. A guard row must expect exactly its guarded test.
- **Fix:** the row selects (1), and its comment records the wider effect.

---

**Total deviations:** 5 (2 Rule 1, 1 Rule 3, 2 plan-wording choices recorded). **Impact:** every conversion protects what it protected before, and the probe is stricter than first written. No expected set was changed to fit a result.

## Severity changes and new findings

None. Every behavior the converted tests protect is intact on HEAD: each control run passed, and each mutant flipped only its own tests.
- The scripts never print the key.
- An empty key refuses even with `--api-key` passed.
- The dialed address follows the variables and never uses port 3000.
- The operator commands reach neither the lock nor the boot entry.
- The boot entry loads only itself and the lock module.
- The bot's guard is first, and its direct start refuses.

No register entry changed.

## Issues Encountered (all diagnosed)

- **A fast first run:** the converted preflight test passed in about 1 s alone, faster than I expected. A temporary diagnostic printed the record: exit 1 from real failing checks on the sentinel loopback RPCs, the full preflight module graph, and no bot module. The speed comes from transpile-only and instant loopback refusals. The diagnostic was removed.
- **Parent pointers:** a program built by `ts.createProgram` has no parent pointers unless its compiler host is created with setParentNodes. (4)'s scope walk threw a TypeError before I fixed the helper. Found before any commit.
- **A scratch diagnostic failed to compile:** the script outside the repo got no tsconfig (TS5109). It was re-run with `--project tsconfig.json`. This affected only the diagnostic.
- **Line endings:** git warns "LF will be replaced by CRLF" (`core.autocrlf=true`, AUD-OD21-001), as in 23-29 and 23-18. The overlay normalises text and finds to LF.
- **check.ts --stage final:** 118 FAILs. Four are new from this plan:
  - ledger rows for test/helpers/sourceGraph.ts and loadedModulesProbe.ts;
  - re_audit rows for pauseCli.test.ts and preflightCli.test.ts, which were present at audit_base_sha.

  These are the same out-of-scope bookkeeping kind every earlier Phase 23 plan leaves. The phase gates are partial, consolidation and triage.

## Verification (Node 22.16.0)

**Task verifies, as written:**
- **Task 1:**
  - Vitest on the file, `--group cli-preflight`, `--check-manifest` printed `MANIFEST-OK rows 7 files 2 guards 0`, and `git status --porcelain src` was empty: PASS.
  - Re-run on the committed tree as the tracer gate: PASS.
- **Task 2:**
  - The three integration files with the JSON report gave 30/30. mainEntry gave 9/9.
  - The exact AUD-TX-005 rail_test title (`SAFE-04 single-instance process lock (real holder processes) > a second acquire for the same wallet is refused while the holder lives (AC-23a)`) is present and passed: PASS.
- **Task 3:**
  - `--group cli-pause`, `--group cli-lock` and `--group cli-entry` each exited 0, and src was clean: PASS.
  - `--check-manifest` printed `MANIFEST-OK rows 23 files 5 guards 1`: PASS.

**Acceptance criteria:**
- **No named source reads:** the four files read only a temp load record and package.json. `ts.createProgram` runs over a directory walk, which names no file. 23-19's AST gate counts neither form as a named-file read.
- **AUD-TX-005:** its title passed. `git diff` of processLock.test.ts removes no `it(` title.
- **test-identity** (`--base ee52acb`, on the Task 2 report): 0 missing in all four files, with 1 + 4 + 1 renames honoured. The dynamic counts are equal (pauseCli 4 and 4).
- **Diffs:** `git diff --exit-code ee52acb HEAD -- test/rails vitest.config.ts` shows no change. `git status --porcelain src scripts` was empty after each task.

**Full railed suite** (`npm test`, rails run `run-20261112T062309-15792-0b7e08`, tree da3cfa2):
- 199 files, 1,397 tests: 1,397 passed, 0 failed, 0 skipped, 0 todo; wall 178 s.
- By project: unit 946, integration 264, realpath 187.
- Integration is +1 compared with 23-18's run: the split-out processLock test.
- Rail ledger: `nonLoopbackAllowed` 0, `telegramAllowed` 0.
- The three "unhandled" strings in the output are test titles (AUD-BUY-005 and notifierRefusal).
- The commit after da3cfa2 (a0811f0) changes only ledger JSON and the render.
- The first full run (12445c4 tree) had the one spawn-gate failure above, diagnosed and fixed. Its timings are listed with run 2's below.

**Timing against each test's real limit** (full run 2, with run 1 in brackets):

| Test | Run 2 (run 1) | Limit |
|---|---|---|
| pauseCli new tests | 1.8 to 2.6 s (1.8 to 2.8) | 120 s |
| preflight new test | 4.4 s (3.7) | 150 s (describe) |
| import-graph test | 4.1 s (3.5) | 60 s |
| mainEntry (4) | 5.3 s (3.9) | 120 s |
| mainEntry (6) | 1.8 s | 120 s |
| mainEntry (5) | 4 ms; its program is built in (4) first, 0.5 to 0.6 s alone | 60 s |
| mainEntry (1) | 2.8 s | 120 s |
| mainEntry (2) | 4.5 s | 120 s |
| AC-23c | 33.7 s (35.9) | 300 s |
| AC-23d | 42.2 s (34.6) | 300 s |

No test is at or near half its limit, so no limit changed. No hook does a cold import.

**Repeatability:**
- Three rounds, each covering the three integration files, mainEntry and the four groups.
- Each output was byte-identical across the rounds: one md5 each for the integration files, mainEntry, cli-preflight, cli-pause, cli-lock and cli-entry.
- No `csb-red-proof-*` temp folder was left.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- A strict scratch tsconfig over the four test files, the helper, the probe and red-proof-conversions.ts exits 0.
- `check-realpath-mocks`: 0 violations. `check-vi-mock-paths`: 593 calls in 269 files, 0 violations. `check-signing-census`: 23 sites, floor 23, 0 problems.
- `check.ts` partial, consolidation and triage: RESULT PASS, fail 0, pending 0, after a0811f0.
- `red-proof-conversions.ts`:
  - `--self-test`: SELF-TEST-OK cases 30.
  - `--check-manifest`: MANIFEST-OK rows 23 files 5 guards 1.
  - `--check-summaries` on this file and 23-18's: run before the SUMMARY commit (see Self-Check).
- `git status --porcelain src` is empty.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-23-51 is mitigated as planned:
- Each conversion keeps its behavior.
- Renames are recorded and honoured by test-identity.
- Each conversion is shown RED in memory, with every target hash unchanged.
- The guard row keeps the lock-before-start order on test (1).

On the new surface:
- The probe's computed require only accepts a .ts module under src/ or scripts/. It runs only as a railed child.
- The pauseCli loopback dashboard binds 127.0.0.1:0, and the rail ledger shows no non-loopback connection.

## User Setup Required

None.

## Next Phase Readiness

- Plans 23-30 and 23-19 can add their rows. `--check-manifest` now reads rows 23 files 5 guards 1. 23-30 requires rows 32 files 8 guards 1, and 23-26 requires 36 / 11 / 1.
- 23-19's AST gate must accept two forms here: `ts.createProgram` over a directory walk (test/helpers/sourceGraph.ts), and reads of a temp load record or package.json.
- The load probe and sourceGraph are available for later conversions. The probe's path rule and its COMPUTED_REQUIRE_FILES entry go together.

## Self-Check: PASSED

- **Files found:** test/integration/fixtures/loadedModulesProbe.ts, test/helpers/sourceGraph.ts, the four converted test files, scripts/red-proof-conversions.ts.
- **Commits on this branch:** 61e51da, fd154bd, 12445c4, bab9121, da3cfa2, a0811f0. `git rev-list --count ee52acb..HEAD` = 6 before this SUMMARY.
- **`--check-summaries` on this SUMMARY and 23-18's:** SUMMARIES-OK red-ok 39 removed 0 (23-18's 10 lines and this plan's 29), run before the SUMMARY commit.
- **Clean tree:** only the operator's own `.planning/config.json` and `.planning/state.json` changes remain, modified and unstaged.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
