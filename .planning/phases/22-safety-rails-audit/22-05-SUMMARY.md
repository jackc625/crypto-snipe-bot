---
phase: 22-safety-rails-audit
plan: 05
subsystem: testing
tags: [safe-02, test-rails, vitest, env-scrub, db-tripwire, network-deny, rail-ledger, better-sqlite3, dotenv]

requires:
  - phase: 22-01
    provides: Node 22.16.0 pin and the phase-wide execution rules (no Vitest in the main checkout before SAFE-01 is VALID)
provides:
  - test/rails/core.cjs — one CommonJS rails module (env scrub + sentinels, .env block, data/ fs block, DB tripwire, TCP/DNS/UDP deny, per-run ledger, applyChildOverrides, FORK_SHELL_KEYS)
  - test/rails/preload.cjs, setup.cjs, setup-fork.cjs — the NODE_OPTIONS and Vitest setupFiles entries
  - test/rails/selfcheck.cjs — plain-Node 12-check end-to-end proof
  - test/rails/ledgerRun.ts — unit/integration globalSetup writing <tmp>/crypto-snipe-bot-rail-ledger/<runId>/summary.json
  - test/.env.test — committed inert sentinel env (146 keys == .env.example), via the one-path .gitignore negation
  - vitest.config.ts rewired (no dotenv, envDir false, per-project rails); npm test / test:coverage re-scoped to unit+integration
affects: [22-07, 22-08, 22-09, 22-10, 22-11, 22-15, 22-16, 22-29]

actuals:
  tokens: 29070
  tasks: 2
  commits: 2
plan_head_before: f9779b30f375809bda3d66eb4765478bb8094142
plan_head_after: 31b7854d0c1c049166bfc9e43457be115f50d94c

tech-stack:
  added: []
  patterns:
    - "Rails state on globalThis[Symbol.for('crypto-snipe-bot.rails')]; wrappers marked with a symbol and never stacked; strictest-wins re-install"
    - "Fail-closed install: any component that cannot be verified as wrapped throws; a failed install poisons later installs in the process"
    - "Rail ledger: JSON lines per pid under <tmp>/crypto-snipe-bot-rail-ledger/<runId>/, runId captured once per process"

key-files:
  created:
    - test/rails/core.cjs
    - test/rails/preload.cjs
    - test/rails/selfcheck.cjs
    - test/rails/setup.cjs
    - test/rails/setup-fork.cjs
    - test/rails/ledgerRun.ts
    - test/.env.test
  modified:
    - .gitignore
    - .env.example
    - vitest.config.ts
    - package.json

key-decisions:
  - "test/.env.test is committed through a one-path .gitignore negation (!test/.env.test after !.env.example), not git add -f; .env, .env.local and test/.env.other stay ignored (check-ignore proves both directions)"
  - "DNS deny passes IP literals (no network I/O; how bind/listen resolve 0.0.0.0/::) and checks them at the connect/send choke points instead, so local wildcard binds keep working"
  - "DB tripwire also checks SQL ATTACH / VACUUM INTO targets and Database.prototype.backup() destinations; a non-literal ATTACH/VACUUM INTO target is refused because it cannot be checked"
  - "railsStatus().forkShellKeys reports 'scrubbed' for both keys when the effective mode is full (the plan names 'preserved'|'absent' for fork mode); it never reports a value"
  - "ledgerRun.ts classifies net-allow hosts independently of core.cjs (second opinion on the ledger's class field) and resolves stack frames repo-relative against the Vitest main-process cwd"
  - "test:coverage previously ran every project, fork included, and therefore started Hardhat; it now runs unit+integration. test:all stays the one all-project command that starts Hardhat"

patterns-established:
  - "Rails are proven outside Vitest first: plain-Node self-check against a fake root in os.tmpdir() and TEST-NET-1 192.0.2.1, never the real data/ or network"
  - "Fork mode carries exactly the FORK_SHELL_KEYS code constant from the first capture of the inherited env; no env var selects the mode or widens the list (NAC-05)"

requirements-completed: [SAFE-02]

coverage:
  - id: D1
    description: "Setup-layer rails module: env scrub + sentinels, .env read block, data/ fs content block, better-sqlite3 DB tripwire, non-loopback TCP/DNS/UDP deny, per-run ledger, applyChildOverrides fail-closed"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: "env -u VITEST -u CSB_RAIL_RUN_ID TELEGRAM_BOT_TOKEN=planted-not-sentinel node --require ./test/rails/preload.cjs test/rails/selfcheck.cjs (12/12 PASS, run twice: before the Task 1 commit and after the Task 2 commit)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Committed inert test/.env.test (146 keys == .env.example, small-integer private keys, TEST-SENTINEL secrets at <= 3.0 bits/char) through a one-path .gitignore negation"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: "Task 1 verify 2 (dotenv key-set + entropy check, prints 'keys 146') and verify 3 (git check-ignore both directions + git ls-files test/.env.test)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fork shell keys: fork mode keeps planted ETH_FORK_RPC_URL / ALLOW_REAL_MAINNET and sentinels ALCHEMY_URL; full mode scrubs both; fork with both unset leaves ETH_FORK_RPC_URL absent and ALLOW_REAL_MAINNET empty"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: "Task 2 verify 2 (fork entry railsStatus) and verify 3 (three plain-Node fork-shell-key runs)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ledgerRun.ts globalSetup: creates or adopts CSB_RAIL_RUN_ID, writes projects/<name>.json and summary.json (projects, workersByProject, countsByKind, nonLoopbackAllowed, telegramAllowed, triggeringTestFiles)"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: "plain-Node drivers (scratchpad, no Vitest): transpiled ledgerRun.ts + two railed children -> one shared run id, workersByProject {unit,integration}, net-deny 2, nonLoopbackAllowed 0; synthetic stack frames -> triggeringTestFiles [test/integration/b.test.ts, test/unit/a.test.ts], unparseableLines 1; tsc --strict --noEmit clean"
        status: pass
    human_judgment: false
  - id: D5
    description: "Vitest wiring: setupFiles in all three projects, ledger globalSetup in unit+integration, envDir false, no dotenv, CSB_RAIL_PROJECT labels; npm test / test:coverage re-scoped"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: "Task 2 verify 1 (grep gates: dotenv 0, setupFiles 3, CSB_RAIL_PROJECT 3, envDir false, test / test:fork scripts)"
        status: pass
    human_judgment: true
    rationale: "Static gates only. Locked rule D-13/NAC-03 forbids running Vitest in this plan, so how Vitest 4.1.1 actually loads the .cjs setupFiles and calls ledgerRun.ts in real workers is first exercised by the sanctioned 22-08 run"

duration: 6min (this continuation; Task 1 was built in an earlier session that was not timed here)
completed: 2026-11-07
status: complete
---

# Phase 22 Plan 05: SAFE-02 Setup-Layer Test Rails Summary

**One CommonJS rails module (`test/rails/core.cjs`) is now loaded by every Vitest project and by the NODE_OPTIONS preload. It replaces the env with committed inert sentinels, blocks `.env` reads and all content access to `data/`, trips any better-sqlite3 open of the live DB (including ATTACH, VACUUM INTO and backup), denies non-loopback TCP, DNS and UDP, and records every block in a per-run ledger. It was proven by a plain-Node 12/12 self-check, and Vitest was never run.**

## Performance

- **Duration:** 6 min for this continuation (2026-11-07T02:43:58Z to 02:49:08Z). Task 1 was built and self-checked in an earlier session (not timed here); it was blocked at commit time by the secret-read guard (see Issues Encountered).
- **Started:** 2026-11-07T02:43:58Z (continuation)
- **Completed:** 2026-11-07T02:50Z
- **Tasks:** 2/2
- **Files modified:** 11 (7 created, 4 modified)

## Accomplishments

- **Rails module (D-01):** `installRails({mode})`, `railsStatus`, `addProtectedRoot`, `classifyHost`, `isProtectedDbPath`, `isProtectedDataPath`, `ledgerAppend`, `readLedger`, `applyChildOverrides`, `FORK_SHELL_KEYS` (exactly `ETH_FORK_RPC_URL`, `ALLOW_REAL_MAINNET`). No rail decision reads any env var (`grep -c "process.env.VITEST" test/rails/core.cjs` is 0). Re-install is idempotent and strictest-wins.
- **Self-check, 12/12 PASS on Node 22.16.0 with VITEST unset.** It ran twice, after the Task 1 resume and after the Task 2 commit. Real `data/` files were unchanged by size and mtime before and after every run (`bot.db` 57344/1780090436, `bot.db-wal` 164832/1780100758, `bot.db-shm` 32768/1780100758, logs unchanged).
- **Committed sentinel env:** `test/.env.test` (146 keys, same set as `.env.example`, including the new `ETH_FORK_RPC_URL`) is tracked through the one-path negation `!test/.env.test`. The real `.env`, `.env.local` and `test/.env.other` stay ignored.
- **The rails commit (`31b7854`):** Vitest now loads no `.env` (dotenv import removed, `envDir: false`; Vite 8.0.2 `getEnvFilesForMode` returns `[]` when `envDir === false`). `setup.cjs` is wired into unit and integration, and `setup-fork.cjs` into fork. `ledgerRun.ts` is the globalSetup for unit and integration, and every project carries a `CSB_RAIL_PROJECT` label.
- **Re-scoped scripts:** `npm test` and `npm run test:coverage` now run `--project unit --project integration`. **`test:coverage` previously ran every project, fork included, and therefore started Hardhat.** `test:fork` is unchanged. `test:all` intentionally stays all-project and is the one command that starts Hardhat.

### Verify output lines (Task 2, plain Node)

```
fork entry ok
fork: shell keys kept, other keys sentinel
full: shell keys scrubbed
fork: absent shell keys stay absent / gate closed
```

`railsStatus()` after `setup-fork.cjs`: `{"mode":"fork","netDeny":false,"dnsDeny":false,"udpDeny":false,"telegramDeny":true,"data":true,"db":true,"envBlock":true,"env":true}`.

### ledgerRun.ts review and evidence

The plan asked for a static review. I also exercised it in plain Node, with no Vitest. `ledgerRun.ts` was transpiled with the repo's `typescript` into the session scratchpad and driven with `setup({name})` and the returned teardown closures (`setup` accepts the TestProject that `cli-api.BUXBO6jS.js:10725` passes; teardown is called without arguments, `:10733`). Two real railed child processes wrote ledger entries under a generated `run-YYYYMMDDTHHMMSS-<pid>-<6hex>` id.

Results:
- One shared run id across both projects.
- `workersByProject` lists `{integration, unit}` with one pid each.
- `countsByKind` is `{worker-start: 2, net-deny: 2}`.
- `nonLoopbackAllowed` and `telegramAllowed` are both 0.
- A second driver added synthetic stack frames (Windows path, `file://` URL, a `test/rails/` frame, an outside-repo path, a node internal). `triggeringTestFiles` came out as exactly `[test/integration/b.test.ts, test/unit/a.test.ts]`, with `unparseableLines: 1`.

`tsc --strict --noEmit` on the file is clean. Throwaway run folders were deleted.

### No Vitest ran

`node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json` mtime is still `2026-11-06 11:21:39 -0500` (16:21Z), before this plan started. `find node_modules/.vite -newer <plan-start marker>` found nothing. No `npm test`, `vitest run` or `vitest list` was run, and no Hardhat was started.

## Task Commits

1. **Task 1: rails module, preload, committed sentinel env, plain-Node self-check.** `6a254a1` (feat)
2. **Task 2: wire the rails into Vitest, per-run ledger globalSetup, re-scope npm test (the rails commit).** `31b7854` (feat)

**Plan metadata:** recorded in the docs commit that follows this SUMMARY.

## Files Created/Modified

- `test/rails/core.cjs`: the rails module (1,395 lines). The header records the residual risks: native addons, `process.binding`, worker_threads realms, modules that captured fs/net before install, and symlinks or junctions whose spelled path contains neither `data` nor `.env`.
- `test/rails/preload.cjs`: NODE_OPTIONS `--require` entry (full).
- `test/rails/setup.cjs` / `test/rails/setup-fork.cjs`: Vitest setupFiles entries (full / fork).
- `test/rails/selfcheck.cjs`: the 12-check plain-Node proof.
- `test/rails/ledgerRun.ts`: per-invocation run record and `summary.json`.
- `test/.env.test`: inert sentinels.
- `.gitignore`: `!test/.env.test` plus a one-line comment, directly after `!.env.example`.
- `.env.example`: adds `ETH_FORK_RPC_URL=` ("read from the shell only, never from .env"). The `ALLOW_REAL_MAINNET` trailing comment now also says shell only, and still says "NEVER set in CI" and "Default unset = guard active".
- `vitest.config.ts`: dotenv removed, `envDir: false`, per-project `setupFiles` / `globalSetup` / `env`. `extends`, `mockReset`, timeouts, fork `globalSetup` / `fileParallelism` / comment and the coverage block are unchanged.
- `package.json`: `test` and `test:coverage` re-scoped.

## Decisions Made

See `key-decisions` in the frontmatter. One more: `railsStatus().forkShellKeys` returns `'scrubbed'` for both keys in full mode. That state is outside the plan's `'preserved'|'absent'` vocabulary, which describes fork mode. It is a presence label only and never carries a value. 22-08's pinning test should expect it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DNS deny also blocked local wildcard binds**
- **Found during:** Task 1 (earlier session)
- **Issue:** Wrapping `dns.lookup` denied `0.0.0.0` / `::`, which `server.listen()` resolves through lookup, so loopback test servers could not bind.
- **Fix:** IP literals pass the DNS step (Node does no network I/O for them). The address is still checked at the `net.Socket.prototype.connect` and `dgram` send/connect choke points.
- **Files modified:** `test/rails/core.cjs`
- **Verification:** Self-check case 5 (loopback HTTP server on `127.0.0.1:0` answers `http.get` and `fetch`) and case 6 (16 transports to 192.0.2.1 / `.invalid` denied within 3 s).
- **Committed in:** `6a254a1`

**2. [Rule 2 - Missing critical] An in-memory DB could reach the live file through SQL or the backup API**
- **Found during:** Task 1 (earlier session)
- **Issue:** The constructor tripwire alone let a `:memory:` DB run `ATTACH '<repo>/data/bot.db'`, `VACUUM INTO '<repo>/data/...'` or `.backup('<repo>/data/...')`.
- **Fix:** Wrapped the addon `Database.prototype.exec`, `prepare` and `backup`. ATTACH and VACUUM INTO literal targets are checked (comments and quoted identifiers are stripped first). A non-literal target is refused.
- **Files modified:** `test/rails/core.cjs`
- **Verification:** Self-check case 4.
- **Committed in:** `6a254a1`

**3. [Rule 2 - Hardening, Task 1 code as found on disk] Wider fs coverage than the plan's list**
- **What:** Also wrapped `openAsBlob`, `mkdtemp`, `lutimes`, `lchmod`, `chown`, `lchown`, and the `fs.ReadStream` / `fs.WriteStream` constructors, which bypass `createXStream`. Added Windows path normalisation (`\\?\` prefixes, trailing dots and spaces, `::$DATA` streams, 8.3 short names) and a `.env` write block, ledgered as `env-write-blocked`.
- **Note for 22-08 / 22-29:** `env-write-blocked` is a ledger kind beyond the plan's artifact list.
- **Committed in:** `6a254a1`

### Blocker resolution (operator decision)

**4. Secret-read guard exception for `test/.env.test`**
- The operator's GSD hook `C:/Users/jackc/.claude/hooks/gsd-secret-read-guard.js` refused any command that named `test/.env.test`, which blocked the Task 1 commit. The operator chose option 2 (decision 2026-11-07). The orchestrator added an exception for exactly this repo's `test/.env.test` (absolute, `/c/...`, backslash and repo-relative forms, plus `<ref>:test/.env.test` object paths), marked `LOCAL OPERATOR EXEMPTION` in the hook. Every other `.env*` name is still blocked, which a 30-case harness verified.
- **The exception is a LOCAL edit to a GSD-managed hook.** A GSD update will remove it, and the guard will then block this file again (fail closed). Later plans that name the file are 22-07, 22-08, 22-11, 22-16 and 22-29, and they will need the exception re-applied if it is lost.
- The exception was used only for `git add`, `git ls-files`, `git check-ignore` and the plan's key/entropy check. No real `.env` or other secret file was read, printed or committed.

**5. Task 1 verify 2 ran as written**
- In the earlier session this check had been folded into self-check case 2 because the file could not be named. With the exception in place, the plan's command ran verbatim. It prints only `keys 146` (on failure it prints key names, never values), so both the original check and the substitute now pass.

---

**Total deviations:** 3 auto-fixed (1 bug, 2 missing-critical/hardening) and 1 operator-approved blocker resolution.
**Impact on plan:** Every auto-fix closes a real bypass or keeps loopback tests working. No scope creep beyond the rails.

## Issues Encountered

- **Task 2 verify 1 failed on the first try because of my own comment.** The new header comment in `vitest.config.ts` named `dotenv`, `setupFiles` and `CSB_RAIL_PROJECT`, so the exact-count gates read 1, 4 and 4 instead of 0, 3 and 3. I reworded the comment, keeping its meaning, and the gate passed before the commit.
- **Stack-frame attribution in `ledgerRun.ts` was fixed before the commit.** The first version took the first `test/` segment anywhere in an absolute path, which mislabels files when the checkout sits under a folder named `test`. Frames are now parsed (`(file:L:C)`, bare and `file://` forms) and made relative to the Vitest main-process cwd. The synthetic-frame driver proves it.
- **Line endings:** `core.autocrlf=true` on this machine. All 22-05 files are stored as LF in the index (git printed "LF will be replaced by CRLF" warnings for the working copies). None of these files is hash-pinned or byte-compared, and dotenv parses CRLF and LF the same way. If a later plan pins a hash of `test/.env.test` or `test/rails/*`, it should pin the index blob or add a `.gitattributes` LF rule like 22-04's.

## Known Stubs

None.

## Open Risks for 22-08 (first sanctioned Vitest run)

- Vitest 4.1.1 runs `.cjs` setupFiles through its module runner. `require('./core.cjs')` inside them is assumed to resolve to Node's native `require`, sharing `globalThis` with the worker. That is first exercised in 22-08.
- The Vitest main process does not install rails itself (only workers, the preload in children, and `ledgerRun.ts`). The 22-08 wrapper decides whether it also preloads the main process.
- Fork workers write to `<tmp>/.../no-run/` unless `CSB_RAIL_RUN_ID` is set in the shell, because `ledgerRun.ts` is wired to unit and integration only, per the plan.
- `STATIC_SOURCE_ENV_KEYS` includes `X` (an artifact of a comment at `src/preflight.ts:63`) and `NODE_ENV`, which is never deleted because it is essential. Both are kept verbatim so the 22-08 re-grep test matches.

## User Setup Required

None. Optional: to run fork tests later, set `ETH_FORK_RPC_URL` (and `ALLOW_REAL_MAINNET=1` only for a deliberate real-mainnet run) in the shell. A value in `.env` is now ignored by design, as `.env.example` says.

## Next Phase Readiness

- The rails commit has landed. Once SAFE-01 is VALID (22-03), 22-08 can make the first railed Vitest run.
- Re-apply the `test/.env.test` secret-read-guard exception if a GSD update removes it, before 22-07, 22-08, 22-11, 22-16 or 22-29.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*

## Self-Check: PASSED

- FOUND: test/rails/core.cjs, test/rails/preload.cjs, test/rails/selfcheck.cjs, test/rails/setup.cjs, test/rails/setup-fork.cjs, test/rails/ledgerRun.ts, test/.env.test, .gitignore, .env.example, vitest.config.ts, package.json
- FOUND: 6a254a1, 31b7854 (both ancestors of HEAD); `git rev-list --count f9779b3..HEAD` = 2
- Re-run after the final task commit: selfcheck 12/12 PASS; Task 1 verify 2/3 PASS; Task 2 verify 1/2/3 PASS; `.gitignore` diff = 1 comment + 1 negation; `.env.example` diff = the 1 reworded line + 1 added line; VITEST grep 0; `railsStatus` carries `forkShellKeys`, `dataBlockInstalled`, `udpDenyInstalled`; data/ unchanged; no Vitest results.json change
