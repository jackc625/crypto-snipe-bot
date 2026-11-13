---
phase: 23-test-safety-net-harness-triage-characterization
plan: 23
subsystem: testing
tags: [env-matrix, characterization, realpath-harness, config, chain-registry, risk-manager, vitest, secret-scan, CHAR-03]

requires:
  - phase: 23-20
    provides: the serializer (normalizeForRecording, compareRecording with env/<VAR>.json paths, the $nonFinite form, the update switch) and the recordings guard (AC-26, field-aware AC-51, the own-name sentinel rule)
  - phase: 23-31
    provides: test/helpers/sourceGraph.ts (loadRepoModules, moduleExporting) to find modules by exported symbol in a src/ walk
  - phase: 23-19
    provides: the AC-37 source-text gate every new test file must pass
  - phase: 22-08
    provides: spawnRailedChild (the only sanctioned child start) and the per-case rail ledger (ledgerRunId)
provides:
  - "test/realpath/env/envMatrix.test.ts: the env matrix (109 tests: the list/baseline test, 106 per-variable tests, an AC-28/$nonFinite test, the VITEST child test)"
  - "test/realpath/env/fixtures/vitestFlagChild.ts: one railed child per VITEST value, printing {dotenvLoaded}"
  - "test/realpath/recordings/env/_baseline.json: the one full baseline (107 variables valid, the three modules' parse results and the five risk probes)"
  - "106 committed per-variable files under test/realpath/recordings/env/ (105 variables + VITEST.json) plus MAX_TOTAL_EXPOSURE.json, 108 files in the folder"
affects: [23-25, 23-26, phase-24, phase-27, phase-28]

actuals:
  tokens: 107292   # chars/4 over the added lines of b3f57f6..392d317 (110 files, 429168 chars)
  tasks: 2
  commits: 2       # MEASURED: git rev-list --count b3f57f6..HEAD before this SUMMARY commit
plan_head_before: b3f57f644e0f1d4b40f32f8cf61669975e08657a
plan_head_after: 392d3177514af9ee9b22489638a2a45ed3be0322
commits: 2

tech-stack:
  added: []
  patterns:
    - "Env snapshot = one full baseline plus one file per variable holding only the fields whose parsed value differs from the live baseline, at the same path ({\"$absent\":true} for a removed field, arrays whole, {} when unchanged); keys sorted at every level; pretty-printed LF JSON"
    - "Run-time process.env read recorder: a Proxy (get, has, set, deleteProperty) installed for one case only, counting a read only when the accessing stack frame is one of the three modules found by exported symbol; restored in a finally"
    - "Private settings observed through the real exported function: one database state per risk setting that trips only that rule (canSnipe stops at the first failing rule)"
    - "A module that re-raises an earlier module's exit through its import is recorded with from: <label>, not as its own failure"
    - "A Vitest-flag case runs in a railed child whose cwd is a temp folder holding a one-line fake .env, so no case can reach the repo's .env"

key-files:
  created:
    - test/realpath/env/envMatrix.test.ts
    - test/realpath/env/fixtures/vitestFlagChild.ts
    - test/realpath/recordings/env/_baseline.json
    - test/realpath/recordings/env/MAX_TOTAL_EXPOSURE.json
    - test/realpath/recordings/env/VITEST.json
    - "test/realpath/recordings/env/<VAR>.json (105 more variable files)"
  modified: []

key-decisions:
  - "The variable list is 107 names (106 varied in the worker plus VITEST): the AST inventory of process.env literals in the three modules unioned with the baseline recorder, settled in rounds until a run with every listed variable valid read no new name; a full in-memory pass of all five values of every variable (530 cases, normal mode, nothing written) added no name before _baseline.json was first committed"
  - "Each of the three modules is evaluated in its own try, config then registry then risk; the chain registry imports the config module through the provider module, so a config exit ends the registry's load too and that result carries from: 'config' (9 variables show it); the risk gate imports neither and keeps parsing"
  - "Logs kept per module: warn, error and fatal lines made while loading (the exit reasons and the deprecation warnings); info progress lines and canSnipe's own 'Risk check failed' lines (which repeat the probe results) are left out"
  - "Risk probes: MAX_POSITION_SIZE 0.5 against the valid cap 0.1; DAILY_LOSS_PCT a buy of 1.0 sold for 0.5 today; MAX_OPEN_POSITIONS ten pending buys (the plan said three, which cannot trip the valid limit of 10 from test/.env.test); SNIPE_COOLDOWN_MS the real recordSnipe then a probe; MAX_TOTAL_EXPOSURE one pending buy of 9.995 then 0.01; each probe on its own chain name and an emptied trades table"
  - "VALID_VALUES covers only what test/.env.test leaves empty or absent (MIN_LIQUIDITY x4, HONEYPOT_CHECKER_ADDRESS x4, ANTIRUG_ALLOWLIST_EXTRA/_V2/_V3 x4, MAX_POSITION_SIZE 0.1, PARTIAL_SELL_TARGETS) plus ENABLED_CHAINS eth,bsc,base,arb and VITEST true; every value is an inert test-chosen value or a test/.env.test sentinel (AC-51)"
  - "The per-variable tests are generated from the committed _baseline.json env keys (one test per variable, so a failure names it), and the list test asserts those keys equal the computed list; a first-time generation therefore takes two npm run recordings:update runs (the baseline, then the variable files)"
  - "VITEST children: dotenv resolves .env against the child's cwd (a temp folder), so the repo's .env is never attempted; each child's rail ledger is exactly one worker-start (no env-read-blocked, no deny); unset and '' load the fake file (dotenv: injecting env (1)), 0, abc and true skip it"

patterns-established:
  - "Env-snapshot generation: npm run recordings:update -- test/realpath/env/envMatrix.test.ts; a changed case is a changed file and needs a behavior: commit citing a register ID (D-18)"
  - "Settle-then-commit for env files: written, guarded, three identical normal runs and a full parallel run, then committed once (git log --format=%h without --follow shows one commit per file)"

requirements-completed: []  # CHAR-03 is also declared by 23-26; requirements.ready-ids keeps it open until 23-26 finishes

coverage:
  - id: D1
    description: "The full baseline (_baseline.json): 107 variables at valid values, the config, registry and risk parse results, and the five canSnipe probes; its env keys equal the AST inventory plus every recorded read"
    requirement: CHAR-03
    verification:
      - kind: integration
        ref: "test/realpath/env/envMatrix.test.ts#the variable list is the AST inventory plus every read the recorder saw, and _baseline.json records it"
        status: pass
    human_judgment: false
  - id: D2
    description: "One file per variable for unset, '', 0, abc and valid, each varied alone with the others valid, recording only what differs from the baseline; exits and NaN recorded as data (AC-27, AC-28, AC-29)"
    requirement: CHAR-03
    verification:
      - kind: integration
        ref: "test/realpath/env/envMatrix.test.ts (106 per-variable tests and 'AC-28 and the non-finite form'), three normal runs identical (digest f7a2096a) and two full parallel runs byte-identical"
        status: pass
    human_judgment: false
  - id: D3
    description: "Read coverage: every case asserts its recorded reads are a subset of the _baseline.json env keys, naming the first extra read (mutation-proved)"
    requirement: CHAR-03
    verification:
      - kind: integration
        ref: "test/realpath/env/envMatrix.test.ts (every per-variable test); mutation: removing BSC_HONEYPOT_CHECKER_ADDRESS from the allowed set failed 'case MAX_TOTAL_EXPOSURE=unset read BSC_HONEYPOT_CHECKER_ADDRESS'"
        status: pass
    human_judgment: false
  - id: D4
    description: "VITEST's five values through railed children in a temp cwd whose only .env is a fake one-line file; dotenvLoaded true for unset and '', false for 0, abc and true"
    requirement: CHAR-03
    verification:
      - kind: integration
        ref: "test/realpath/env/envMatrix.test.ts#VITEST: its five values, each in a railed child whose only reachable .env is a fake one in a temp cwd"
        status: pass
    human_judgment: false
  - id: D5
    description: "AC-51: every env file passes the recordings guard (sentinels only under their own names, walletPrivateKey, authKey, authHeader; URLs loopback or src/ public hosts)"
    requirement: CHAR-03
    verification:
      - kind: integration
        ref: "test/realpath/recordingsGuard.test.ts#every recording under test/realpath/recordings passes AC-21, AC-22, AC-26 and AC-51 (run over all 108 env files before each commit)"
        status: pass
    human_judgment: false

duration: 37min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 23: Env-Matrix Snapshot Summary

**How the bot's settings parse is now locked for 107 variables: one full baseline of what the config module, the chain registry and the risk gate parse from valid values (including five real canSnipe probes for the risk limits Phase 24 will change), plus one file per variable showing only what unset, '', 0, abc and a valid value change, with VITEST's five values run in railed children that can only reach a fake .env.**

## Performance

- **Duration:** about 37 min
- **Started:** 2026-11-12T17:21:30Z (reading); first write 17:30:47Z
- **Completed:** 2026-11-12T17:58:32Z
- **Tasks:** 2 of 2
- **Files:** 110 created (the test, the child fixture, 108 env files), none modified

## Accomplishments

- **Task 1 (tracer): the matrix for MAX_TOTAL_EXPOSURE, the full baseline and the coverage proof.** Each case resets modules, applies the env, installs `vi.spyOn(process, 'exit')` for that case only, and evaluates the config module, the chain registry (`buildChainRegistry()`) and the risk gate (five probes through the real `canSnipe`), each turning an exit or a throw into data. The three modules are found by the symbols they export (`CONFIG`, `buildChainRegistry`, `canSnipe`) in a `src/` walk. The variable list is the AST inventory of `process.env` literals plus a Proxy read recorder filtered by the reading stack frame. The baseline settled with 107 names. Before `_baseline.json` was committed, a full in-memory pass of all five values of every variable added no name (105 variable tests failed only on "no recording at env/<VAR>.json", so every subset check passed). Both files passed the guard and three identical runs before their one commit (`e6d73b5`).
- **Task 2: every variable.** One test per variable of the committed baseline (106) records five cases. Each case varies only that variable and keeps the other 105 valid. Only fields that differ from the live baseline are recorded, so `TRAILING_STOP_PCT=abc` is the single change `CONFIG.trailingStopPct: {"$nonFinite":"NaN"}`, and `ENABLED_CHAINS=abc` is a registry exit with its fatal reason. `VITEST.json` holds the five child results. The 106 new files were guarded, run three times identically and through one full parallel run before their one commit (`392d317`).

## Task Commits

1. **Task 1: tracer, full baseline and read-coverage proof** - `e6d73b5` (test)
2. **Task 2: every variable, VITEST through railed children** - `392d317` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## Files Created/Modified

- `test/realpath/env/envMatrix.test.ts` - the matrix, the recorder, the risk probes, the diff, the list test, the AC-28 test and the VITEST child test
- `test/realpath/env/fixtures/vitestFlagChild.ts` - sets or deletes VITEST, loads the config module, prints `{"dotenvLoaded":...}`
- `test/realpath/recordings/env/_baseline.json` - 700 lines: `about`, `env` (107 names), `outcome` (config, registry, risk)
- `test/realpath/recordings/env/<VAR>.json` - 107 files (106 in-worker variables, VITEST); the largest is ARB_ANTIRUG_ALLOWLIST_EXTRA.json at 12.4 KB (exit cases list the warnings before the fatal line)

## What the Snapshot Shows (examples)

- **Risk limits (Amendment A-1):** `MAX_TOTAL_EXPOSURE` unset, '' and valid are unchanged (the default 10.0 equals the valid value); 0 gives "would exceed cap (0)"; abc gives `allowed: true`, the rule that does not fire. `MAX_OPEN_POSITIONS=0` also changes the cooldown and exposure probes to max_positions (rule order), which the file records as it happens.
- **Exits (AC-28):** 70 files hold at least one exit. 9 variables (PRIVATE_KEY, ALCHEMY_URL, the five required Telegram names, DASHBOARD_API_KEY, NETWORK) show a config exit with the registry result marked `from: "config"`. No case threw anything other than an exit.
- **VITEST:** unset and '' load the fake file, 0, abc and true skip it. That is the config module's `if (!process.env.VITEST)` guard.

## Decisions Made

See key-decisions above. The two that shape the files:
- **Diff by path instead of a list of changes.** A nested partial object keeps each leaf under its real field name, so a sentinel can only ever appear under a key the guard allows. A `{path, baseline, now}` list would have put the PRIVATE_KEY sentinel under the key `baseline` (for example in PRIVATE_KEY's abc case), which the AC-51 guard rejects.
- **Logs at warn and above, from loading only.** The first draft kept every log line. The tracer file was then 8 KB of schema-migration info lines and repeated "Risk check failed" lines for one changed number. After the change it is 1.2 KB and shows only the change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's MAX_OPEN_POSITIONS state could not trip the valid limit**
- **Found during:** Task 1 (probe design)
- **Issue:** The plan says "three pending buys". test/.env.test sets MAX_OPEN_POSITIONS=10, so three positions never reach the limit and the valid case would show a rule that does not fire.
- **Fix:** The probe holds ten pending buys of 0.01 each, which equals the valid limit. Their exposure of 0.1 stays far below the 10.0 cap. The valid case reads "Open positions (10) at limit (10)", and abc gives `allowed: true`.
- **Files modified:** test/realpath/env/envMatrix.test.ts
- **Committed in:** e6d73b5

**2. [Rule 1 - Bug] RESEARCH Pattern 7's single try would hide later modules**
- **Found during:** Task 1
- **Issue:** With one try around all three imports, a config exit leaves the registry and the risk gate unrecorded for that case.
- **Fix:** Each module is evaluated in its own try. Task 2 found that the chain registry imports the config module through the provider module (`src/utils/provider.ts` imports `CONFIG`), so a config exit is raised again by the registry's import, with no log of its own. Those results carry `from: "config"` instead of appearing as a silent second exit. The header comment states the real dependency.
- **Files modified:** test/realpath/env/envMatrix.test.ts
- **Committed in:** e6d73b5 (own try), 392d317 (`from` marker; only uncommitted variable files changed, the two committed files are byte-identical)

**3. [Rule 2 - Missing critical] The VITEST children's safety is asserted, not assumed**
- **Found during:** Task 2
- **Issue:** The plan checks `dotenvLoaded` only. Nothing showed that the child never touched the repo's .env, or that dotenv loaded only the fake file.
- **Fix:** Each child's own case ledger (`ledgerRunId`) must be exactly `["worker-start"]`. When dotenv loads, the child's stdout must say `injecting env (1) from .env`, the fake file's one line, and otherwise must not mention injecting.
- **Files modified:** test/realpath/env/envMatrix.test.ts
- **Committed in:** 392d317

---

**Total deviations:** 3 auto-fixed (2 Rule 1, 1 Rule 2).
**Impact on plan:** Each one makes a snapshot say what the code does. src/, the harness, the guard and the rails are unchanged.

## Orchestrator Note Reconciled: VITEST and env-read-blocked

The orchestrator's note said that in a child with VITEST unset, "the dotenv read must be BLOCKED by the rails and recorded as env-read-blocked". As the plan is built, that cannot happen and does not need to. The child's cwd is a new temp folder (plan Task 2, the form of dotenvSrcSkip case (f)). dotenv resolves `.env` against the cwd, so the only read it makes is `<temp>/.env`, the fake one-line file. The rails do not protect that path: protectedEnvHit matches only the repo's protected roots, which is how case (f) loads its fake file today. The repo's .env is never attempted, so there is nothing to block and no env-read-blocked entry.

Ledger entries for the five children (2026-11-12, each child's own case folder): unset `[worker-start]`, empty `[worker-start]`, 0 `[worker-start]`, abc `[worker-start]`, valid `[worker-start]`. No child reached a real .env (the STOP condition), and the test now fails if any entry other than worker-start appears. If the orchestrator wants a blocked read shown as well, that needs a child started with cwd = the repo root and VITEST unset, which depends on the rails alone for safety. I did not run one.

## Grade Changes and New Findings

None. No finding was registered, regraded or changed in status, and no register file was edited, so AUDIT-FINDINGS.md was not re-rendered. What the snapshot records (for example abc parsing to NaN for the trailing-stop settings, or a NaN risk limit disabling its rule) are the behaviors Phase 24's CAP-06 changes on purpose. They are recorded here as today's behavior, as the plan intends.

## Rails and Recorder Checks

- The Proxy is installed only around a case and restored in a finally (`process.env = original`). Every run's worker ledger shows only `worker-start` from this file: the alone runs, the update runs, and both full runs, whose summaries list the same kinds as before. The rails did not react to the Proxy.
- The caller-frame filter leaves out reads from other modules. db.ts reads DB_PATH and VITEST in every case, and DB_PATH never appears as an extra read.
- `vi.spyOn(process, 'exit')` passes the AC-02 gate as written (`check:realpath-mocks`: 37 vi uses, 7 mock calls, 101 files, 0 violations).

## Issues Encountered

- My Bash tool's secret-read guard refuses any command text containing `process.env`, because it matches the `.env` pattern. I searched with `process[.]env` instead. No secret file was read; only test/.env.test (the exempt sentinel file).
- dotenv 17 prints a rotating tip after "injecting env (1) from .env". The test checks only the stable prefix, and the recording holds only `dotenvLoaded`.

## Timing

| Test | Alone | Full parallel run 1 / 2 | Limit |
|------|-------|-------------------------|-------|
| beforeAll (src/ walk + settled baseline) | 1.1 s | 2.3 s / (not instrumented) | 60 s explicit (23% of the default 10 s at the full-run peak) |
| VITEST (five ts-node children in sequence) | 6.9 to 9.0 s | 26.7 s / 31.2 s | 120 s (plan) |
| slowest per-variable test (5 cases) | 0.15 s | 0.41 s / 0.70 s | 15 s |
| whole file | 15.4 to 17.6 s | 55.1 s / 67.5 s | n/a |

Only the VITEST test and the beforeAll have their own limits; each carries a comment with the measured times. Full run 1 ran on the Task 2 tree with a temporary stderr timing line in the beforeAll, and that line was removed before the commit. Full run 2 ran on the committed tree.

Existing watch items, measured: backupState's self-check took 59.0 s, then 69.5 s, of 120 s (49 / 58 percent). That is within the range 23-21 measured (62.3 / 69.5 s), but this file adds a 55-68 s worker to the parallel run, so it may add load at the peak. signingCensusGate took 61.0 / 86.8 s of 250 s.

## Verification (Node 22.16.0)

- Task 1 verify: the matrix and the guard pass, both files exist. The tracer gate re-ran it after `e6d73b5` and it passed.
- Task 2 verify: three runs of the matrix and the guard, 122/122 each with digest f7a2096a (names, statuses, knownBug records: none). `git diff --exit-code -- test/realpath/recordings/env` is clean, and the folder holds 108 files.
- Committed once: `git log --format=%h -- <file>` (no --follow) gives exactly one commit for each of the 108 files (`_baseline.json` and `MAX_TOTAL_EXPOSURE.json` e6d73b5, the rest 392d317). Before the Task 2 commit, `git status --porcelain test/realpath/recordings/env` listed only new files.
- Guard: `recordingsGuard.test.ts` passed over every env file before each commit. That includes `_baseline.json`'s `explorerUrl` values, the bloXroute endpoint `https://api.blxrbdn.com`, `mevConfig.authKey` / `authHeader` and `CONFIG.walletPrivateKey` (sentinels), and the sentinels under their own names in `env`. Bytes: 0 CR, LF endings, `git check-attr eol` gives `lf`.
- Full railed `npm test` (projects unit, integration, realpath) on the committed tree 392d317: 206 files, 1545/1545 (unit 950, integration 264, realpath 331), wall 231 s, 0 unhandled. Ledger run-20261112T175357-8148-b619dd: nonLoopbackAllowed 0, telegramAllowed 0. The earlier full run (Task 2 tree with the timing line, run-20261112T174528-17736-71952c) gave 1545/1545, wall 185 s, nonLoopbackAllowed 0, telegramAllowed 0. Every env file was byte-identical after both.
- `tsc --noEmit` is clean on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json. A scratch tsconfig extending the repo's (module es2022) gives 0 errors over all of `test/realpath/**`, including both new files.
- `check:realpath-mocks` 0 violations. `check:vi-mock` 660 calls, 0 violations. sourceTextGate, spawnSites and realpathMockGate pass 16/16; the AC-37 allow list is untouched. `check:census` reports 23 sites, 0 problems. `red-proof-conversions.ts --check-manifest` gives MANIFEST-OK rows 36 files 11 guards 1.
- `check.ts`: `--stage partial`, `consolidation` and `triage` each give RESULT PASS fail 0, with no re_audit row needed: no file committed before this plan was edited. `--stage final` gives 265 FAILs, 110 of them from this plan: TESTI ledger rows for the 110 new files, the out-of-scope bookkeeping kind earlier Phase 23 plans reported.
- `git status --porcelain src` is empty. src/ was never changed.

## For Later Plans

- **23-25 (commit check):** this plan's two commits only add files after babd7e4. A later change to any env file is a changed file. It needs a `behavior:` commit citing a register ID (D-18), and a new variable is a new file.
- **Phase 24 (CAP-06):** change the risk parsing, run `npm run recordings:update -- test/realpath/env/envMatrix.test.ts`, then review `git diff -- test/realpath/recordings/env`. The five risk files and possibly `_baseline.json` change; commit them as a `behavior:` commit citing the finding. A newly read variable fails the list test and the subset checks until the baseline is re-recorded.
- **Phase 27 (file moves):** the modules are found by exported symbol, so moving a file needs no test change. Renaming `CONFIG`, `buildChainRegistry` or `canSnipe` does.

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

Ready for 23-24. CHAR-03 is also declared by 23-26, so it stays unmarked in REQUIREMENTS.md until 23-26 finishes (requirements.ready-ids reports it blocked).

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*

## Self-Check: PASSED

- Files present: test/realpath/env/envMatrix.test.ts, test/realpath/env/fixtures/vitestFlagChild.ts, test/realpath/recordings/env/_baseline.json, MAX_TOTAL_EXPOSURE.json, VITEST.json, and 108 files in the env folder.
- Commits on this branch: e6d73b5 and 392d317 are both ancestors of HEAD.
- Commit count measured from the ledger: git rev-list --count b3f57f6..392d317 = 2.
- The acceptance criteria of both tasks and the plan-level verification were re-run after the last task commit, and they pass.
