---
phase: 22-safety-rails-audit
reviewed: 2026-11-09T05:34:28Z
depth: deep
files_reviewed: 48
files_reviewed_list:
  - .github/workflows/test.yml
  - scripts/backup-state.ts
  - scripts/capture-baselines.ts
  - scripts/check-vi-mock-paths.ts
  - scripts/db-init.ts
  - scripts/forensic-db.ts
  - scripts/nac01-exact-value-check.ts
  - scripts/pause.ts
  - scripts/preflight.ts
  - scripts/resume.ts
  - scripts/verify-prod-untouched.ts
  - src/anti-rug/detector.ts
  - src/bot.ts
  - src/config.ts
  - src/exitEngine.ts
  - src/guards/directEntry.ts
  - src/guards/epoch.ts
  - src/guards/singleton.ts
  - src/main.ts
  - src/utils/db.ts
  - src/utils/dbPath.ts
  - src/utils/dbSchema.ts
  - src/utils/exitManager.ts
  - src/utils/nonceAuthority.ts
  - src/utils/notifier.ts
  - src/utils/processLock.ts
  - src/utils/repoRoot.ts
  - test/fork/helpers/forkRpcUrl.ts
  - test/fork/helpers/hardhatChildEnv.ts
  - test/fork/setup.ts
  - test/rails/core.cjs
  - test/rails/ledgerRun.ts
  - test/rails/preload.cjs
  - test/rails/probes/childProbe.cjs
  - test/rails/probes/dotenvProbe.ts
  - test/rails/probes/duplicateLoadProbe.cjs
  - test/rails/probes/moduleScopeDb.cjs
  - test/rails/probes/notifierProdPathProbe.ts
  - test/rails/probes/tsProbe.ts
  - test/rails/selfcheck.cjs
  - test/rails/setup.cjs
  - test/rails/setup-fork.cjs
  - test/rails/spawnRailedChild.ts
  - test/rails/vitest.fork-rehearsal.config.ts
  - test/unit/guards/singleton.test.ts
  - test/unit/rails/forkShellOnly.test.ts
  - test/unit/rails/spawnSites.test.ts
  - vitest.config.ts
findings:
  critical: 0
  warning: 7
  info: 4
  total: 11
  necessity: 0
status: issues_found
---

# Phase 22: Code Review Report

**Reviewed:** 2026-11-09T05:34:28Z
**Depth:** deep
**Files Reviewed:** 48
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

This review covered the Phase 22 diff from `23a6461` to HEAD by reading code and running read-only git and grep commands. Nothing was executed, so no finding comes from a live run. Where a finding depends on behaviour outside this repository, it says so.

No Critical issue was found. The normal start path holds up: `npm start` runs `src/main.ts`, which takes the lock before anything stateful loads, and every lock error refuses the start. `import './guards/directEntry'` compiles to the first `require` in `bot.ts`. The wallet address used for the lock comes from the same `PRIVATE_KEY` that `src/chainRegistry.ts:1067` and `src/utils/provider.ts:59` sign with.

The most important findings are two ways around production guards (WR-01, WR-02) and one undeclared change to production behaviour (WR-03).

**Checks that passed:**
- **Schema move:** extracting `migrateSchema` from `db.ts` at `23a6461` and from `dbSchema.ts` shows one differing line, the signature. The `migrateSchema(db)` call stays straight after the pragmas.
- **Singleton placement:** each `registerSingleton` call runs before the state it protects. Nothing in `src/` loads a guarded module twice on a normal boot.
- **Windows and Linux:** the lock, the direct-entry check and the singleton keys all compare canonical paths. No platform difference was found on the normal path.

**Left out on purpose:** signing scripts that do not take the lock (`deliberate-buy`, `recover-sell-ladys`, `addLiquidity`, `deploySepoliaTest`). They are already recorded as S1 AUD-SCRIPTS-002 / ESC-SCRIPTS-01 for Phase 29.

**Necessity:** assessed, no findings. The repeated refusal at `src/bot.ts:2361` is a second safety layer, which the rubric excludes.

## Warnings

### WR-01: A set `VITEST` variable turns off production DB guards and Telegram alerts

**File:** `src/utils/db.ts:13`, `src/utils/dbPath.ts:7,32,219,246`, `src/utils/notifier.ts:45`, `src/main.ts:62`
**Issue:** `src/main.ts` never checks `VITEST`, and any non-empty value switches the live bot into test behaviour. The header of `dbPath.ts:7` says "no env var or flag relaxes any guard here", and that is not true for this variable.

The trigger is any non-empty `VITEST` in the bot's environment:
- a stray `VITEST=...` line in `.env`, which `main.ts:62` loads before `db.ts` reads it;
- a shell, launcher or parent Vitest process that exports it. In this case `.env` is skipped, so the bot only gets past the wallet check if `PRIVATE_KEY` and the other required values also come from that environment; otherwise it refuses safely.

What happens on a real start:
- With `DB_PATH` unset, `resolveDbPath` returns a new empty file under the temp folder (`dbPath.ts:32-37`). The bot starts with no open positions, so nothing resumes exit monitoring, and the `pause_state` row is back to unpaused.
- With `DB_PATH` set, the missing, empty and uninitialised refusals and the write-boundary checks are skipped (`dbPath.ts:219,246`).
- Every Telegram alert is refused and only logged (`notifier.ts:45`), so the operator gets no alert.

The lock is still taken, so the bot trades normally in this state. Likelihood is low, but the failure is silent and affects funds.

**Fix:** refuse at the one production entry point, before `dotenv` runs and again after it:

```ts
function refuseVitest(): void {
    if (process.env.VITEST) {
        process.stderr.write('Refusing to start: VITEST is set in the bot environment.\n');
        process.exit(1);
    }
}
refuseVitest();
dotenv.config();
refuseVitest();
```

Put this inside the `require.main === module` block, replacing the `if (!process.env.VITEST) dotenv.config()` guard at `main.ts:62`. No test runs that block today: `test/unit/mainEntry.test.ts` calls `runMain` directly. Also correct the `dbPath.ts:7` header to name `VITEST` as the one selector.

### WR-02: The lock folder moves with `HOME` / `USERPROFILE`, so a second bot can run on the same wallet

**File:** `src/utils/processLock.ts:29,76-83`
**Issue:** `defaultLockDir()` builds the folder from `os.homedir()`, which reads `HOME` on POSIX and `USERPROFILE` on Windows. This repository relies on that: `spawnRailedChild`'s `homeOverride` sets both variables, and `test/integration/fixtures/lockHolder.ts:8` uses "defaultLockDir() under the child's home".

The header says the folder is "machine-global" and that no environment variable relocates the lock (also 22-13-PLAN line 80). Neither claim holds. Two processes for one wallet both get the lock if either condition is true:
- they have different `HOME` / `USERPROFILE` values, for example a service or launcher that sets its own;
- they run as different OS users, for example Task Scheduler as SYSTEM and an interactive terminal.

Each process then takes a different lock file, which is the double-signing case SAFE-04 exists to stop.

**Fix:** use `os.userInfo().homedir`, which comes from the account record and ignores the environment. The lock tests' fake home would then need the `lockDir` parameter instead. Correct the header to say the lock is per OS user, or move it to a truly machine-wide folder if two accounts running the bot is a case to block.

### WR-03: `LOG_LEVEL` from `.env` now takes effect on the live bot, which the phase did not declare

**File:** `src/main.ts:62`, `src/utils/logger.ts:7`
**Issue:** before this phase, `config.ts` imported `logger` before it called `dotenv.config()`, and nothing earlier in `bot.ts` loaded `.env`. `logger.ts:7` therefore read `LOG_LEVEL` before `.env` was loaded, so a value set only in `.env` was ignored. `main.ts:62` now loads `.env` before `require('./bot')`, so the value applies from the first module.

If the operator's `.env` sets `LOG_LEVEL` to anything but `info`, the first `npm start` behaves differently:
- `debug` or `trace` adds logging on the trading paths;
- `warn` or `error` removes `info` lines the operator relies on;
- a value pino does not know throws while the logger is built (`node_modules/pino/lib/levels.js:183,194`), so the bot prints "could not start" and exits.

The value in the real `.env` was not read, so whether this bites today is unconfirmed. The phase's plans describe the production path as unchanged, and this is a change.

**Fix:** have the operator check `LOG_LEVEL` in `.env` before the first start through `main.ts`. Then record the change as intended, since `docs/CONFIGURATION.md:142` already promises the setting works. Or preserve the old behaviour by reading `LOG_LEVEL` before `dotenv.config()` in `main.ts` and restoring it, if identical logging matters more until Phase 24.

### WR-04: A failed temp-folder cleanup in the DB probe stops the bot from starting

**File:** `src/utils/dbPath.ts:176-190`
**Issue:** every boot of a WAL-mode database goes through a private copy in `os.tmpdir()`, because `isWalMode` is true from the file header alone. The cleanup `fs.rmSync(dir, { recursive: true, force: true })` sits unguarded in `finally`. An exception there replaces the successful result, so a good probe becomes a raw error and the bot exits through "could not start".

`rmSync` has no retries by default. On Windows, an antivirus or indexer holding the just-closed `probe.db` can make it fail with `EBUSY` or `EPERM`. That Windows behaviour was not reproduced here. The file header treats this probe as a guard, but this failure says nothing about whether the database is safe to open.

A related limit: after a clean shutdown there is no `-wal` or `-shm`, so any copy failure, such as a full temp drive, also refuses the start with a raw error (`dbPath.ts:186-187`). Failing closed on that path is deliberate, but the message does not tell the operator what to fix.

**Fix:**

```ts
} finally {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
        // A leftover temp copy must not fail the probe; it holds no decision.
    }
}
```

Wrap a copy failure in a coded refusal that names the temp folder.

### WR-05: The Vitest DB tripwire misses a `data` folder that is a junction or symlink

**File:** `src/utils/dbPath.ts:97`
**Issue:** `assertNotProdDbUnderVitest` builds the protected folder as `join(canonicalDbPath(repoRoot), 'data')`, which never resolves `data` itself. The target is fully resolved. If `<repo>/data` is a junction to `D:\live`, the target becomes `d:\live\bot.db`, the protected form stays `c:\repo\data`, and the check passes. The header claims "every spelling" is covered. `core.cjs:316` resolves the same folder correctly, so the outer rail still catches this; the src layer is the independent one that fails. `data/` is not a link today, since `backup-state.ts` would refuse it.
**Fix:**

```ts
const dataDir = comparisonForm(canonicalDbPath(path.join(repoRoot, 'data')));
```

Compare against the lexical form as well, as `core.cjs` does.

### WR-06: A failed baseline collection is recorded as zero tests and passes the NAC-04 gate

**File:** `scripts/capture-baselines.ts:408-416,761-765,791-793`
**Issue:** the comment at line 408 says a collection error is "an anomaly to diagnose, never a zero count", but the function returns `count: 0` and nothing adds it to `failures`.

With `--phase before`, if the pre-rail `vitest list` fails for a project:
- the check at line 791 becomes `post >= 0`;
- the run exits 0 with `nac04.ok: true`;
- the `before` file then records `pre_rail: 0`, which every later `--phase after` loads as its floor, so NAC-04 can never fail for that project.

The same pass happens if both sides fail. The committed baseline is not affected: it holds 759 and 216 with empty error lists. The defect applies to any re-run.

**Fix:** after both collection loops, fail on any error:

```ts
for (const [label, errs] of [['pre_rail', preRailErrors], ['post_rail', postErrors]] as const) {
    for (const p of PROJECTS) {
        if ((errs[p] ?? []).length > 0) failures.push(`NAC-04: ${label} collection failed for ${p}`);
    }
}
```

### WR-07: The CI `test` job has no timeout

**File:** `.github/workflows/test.yml:9-10`
**Issue:** the `test` job has `runs-on` but no `timeout-minutes`, so a stuck child process holds the runner for GitHub's 6-hour default. The job existed before this phase, but the phase added a step to it and many tests that start child processes with timeouts up to 170 s. The sibling jobs at lines 92, 107 and 140 all set one.
**Fix:** add a job-level `timeout-minutes` sized from a recent CI run.

## Info

### IN-01: `process.loadEnvFile()` is not covered by the `.env` rail

**File:** `test/rails/core.cjs:21-23,38-41`
**Issue:** the block wraps JavaScript `fs` calls. As far as Node's documented implementation goes, `process.loadEnvFile()` reads the file natively and would bypass that wrapper, loading real values after the scrub. This was not confirmed by running it. `spawnRailedChild` already refuses the equivalent `--env-file` flag, but neither the residual-risk list nor the spawn gate names this API. `src/` has no call to it.
**Fix:** in `installFsBlocks`, replace `process.loadEnvFile` with a function that throws the same blocked error.

### IN-02: `spawnRailedChild`'s path limit does not resolve links

**File:** `test/rails/spawnRailedChild.ts:155-160`
**Issue:** `canonPath` only resolves a segment when `lstat` reports a real directory. A link is not one, so an argument through `<tmp>/alias -> <repo>/data` keeps its alias path and passes `[limit: path]`. The child's own rails still catch the open, so this only weakens the check made before the spawn.
**Fix:** call `fs.realpathSync.native` on the nearest segment that exists, including links.

### IN-03: `capture-baselines --out` with no value writes to the committed baseline folder

**File:** `scripts/capture-baselines.ts:660,664-665`
**Issue:** when `--out` is the last argument, `argv[++i]` is undefined. The check at line 664 only catches a blank string, so the run falls back to `.planning/baselines/<phase>` and overwrites it.
**Fix:** refuse when the flag is present without a value, as `verify-prod-untouched.ts:1034-1038` does.

### IN-04: The net-watch early-exit check cannot fire

**File:** `scripts/verify-prod-untouched.ts:518`
**Issue:** `proc.exitCode` is only updated from the event loop, and this loop blocks it with `Atomics.wait`. A sampler that dies early is therefore reported as the 60-second timeout. It still fails closed, but slowly and with the wrong message.
**Fix:** use `spawnSync` to probe the sampler first, or poll with `await` so exit events can arrive.

---

_Reviewed: 2026-11-09T05:34:28Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
