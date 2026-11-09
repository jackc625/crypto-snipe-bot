---
phase: 22-safety-rails-audit
plan: 10
subsystem: testing
tags: [safe-02, test-rails, notifier, telegram, dotenv, vitest, red-proofs, nac-06, ac-16, ac-18]

requires:
  - phase: 22-safety-rails-audit (22-08)
    provides: verify-prod-untouched wrapper, spawnRailedChild, the Hardhat-free fork rehearsal, the rail ledger hook
  - phase: 22-safety-rails-audit (22-05)
    provides: setup-layer .env block and Telegram/network deny (the layer the src layer is proven independent of)
  - phase: 22-safety-rails-audit (22-09)
    provides: src/utils/db.ts Vitest tripwire (preflight's DB reach goes to a per-worker temp file under VITEST)
provides:
  - src/utils/notifier.ts refuseUnderVitest(), error code RAIL_NOTIFIER_REFUSED, ledger kind notifier-refused
  - VITEST gates at src/config.ts, src/utils/notifier.ts, scripts/pause.ts, scripts/resume.ts, scripts/preflight.ts
  - test/unit/rails/notifierRefusal.test.ts, test/integration/rails/notifierRefusalIntegration.test.ts, test/unit/rails/dotenvSrcSkip.test.ts
  - test/rails/probes/dotenvProbe.ts (config | notifier; exit 4 on an import failure), test/rails/probes/notifierProdPathProbe.ts
  - spawnRailedChild option ledgerRunId (^case-[a-z0-9-]+$)
  - fork rail notifier case, rehearsed; UFV-03 in .planning/audit/inputs/unrun-fork-verifications.json
  - red-proofs/22-10-1..4
affects: [22-11, 22-15, 22-16, 22-29, phase-24, phase-25, phase-28]

actuals:
  tokens: 30824
  tasks: 3
  commits: 4
plan_head_before: 1a3dba88a577c326bd1ec828906cafda814f8329
plan_head_after: 576e011dadc569bdc9f208377720845b033275c7

tech-stack:
  added: []
  patterns:
    - "A src-layer refusal is raised as the first statement inside the existing try, so the existing catch handles it and the caller and the following broadcast are untouched"
    - "A child probe prints its number only after the target really loaded, and exits non-zero otherwise, so a broken probe can never read as zero attempts"
    - "Case-isolated ledger folders (ledgerRunId) are read by the test itself and carry the same safety assertions as the wrapper's gate, which cannot see them"

key-files:
  created:
    - test/unit/rails/notifierRefusal.test.ts
    - test/integration/rails/notifierRefusalIntegration.test.ts
    - test/unit/rails/dotenvSrcSkip.test.ts
    - test/rails/probes/dotenvProbe.ts
    - test/rails/probes/notifierProdPathProbe.ts
    - .planning/phases/22-safety-rails-audit/red-proofs/22-10-tdd-red-evidence.json
    - .planning/phases/22-safety-rails-audit/red-proofs/22-10-1-notifier-telegram.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-10-2-notifier-ctx.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-10-3-dotenv-config.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-10-4-dotenv-pause.txt
  modified:
    - src/utils/notifier.ts
    - src/config.ts
    - scripts/pause.ts
    - scripts/resume.ts
    - scripts/preflight.ts
    - test/rails/spawnRailedChild.ts
    - test/fork/rails/forkRails.fork.test.ts
    - .planning/audit/inputs/unrun-fork-verifications.json

key-decisions:
  - "22-10: the notifier refusal runs as the first statement inside the existing try of sendTelegramAlert and sendCtxAlert, so a refused send is caught by the existing log.warn, never reaches the caller, and the dashboard broadcast still runs (D-04 amended)"
  - "22-10: the production path is proven with a VITEST-unset railed child, cwd in a throwaway folder holding a fake .env, and axios.post redirected to a loopback fake; the real .env and Telegram are never involved"
  - "22-10: the preflight case keeps DASHBOARD_API_KEY at its sentinel, because the src/config module it imports requires that key and an early exit there would read as a false zero for this script's own dotenv site"
  - "22-10: the real fork-project run of the notifier refusal is UFV-03, owned by Phase 25; it passed in the Hardhat-free fork rehearsal"

patterns-established:
  - "Refuse inside the existing error path rather than adding a new one"
  - "A probe that cannot load its target must fail loudly, never report zero"

requirements-completed: [SAFE-02]

coverage:
  - id: D1
    description: "Under Vitest a Telegram send through sendTelegramAlert or sendCtxAlert is a recorded refusal through the existing catch path: axios.post is never called, the broadcast runs, the caller never sees a throw (AC-16, D-04 amended)"
    requirement: SAFE-02
    verification:
      - kind: unit
        ref: "test/unit/rails/notifierRefusal.test.ts (5 tests, wrapped, verdict untouched, manifest equal, ledger ok)"
        status: pass
      - kind: integration
        ref: "test/integration/rails/notifierRefusalIntegration.test.ts (3 tests, wrapped, verdict untouched)"
        status: pass
      - kind: integration
        ref: "vitest run --config test/rails/vitest.fork-rehearsal.config.ts (6 tests including the AC-16 case, wrapped, run vpu-20261109T021405-22636-8bff56)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Each of the five reachable dotenv sites skips the .env file under Vitest, proven by a child that actually loads it, and still attempts the read without VITEST (blocked by the setup layer)"
    requirement: SAFE-02
    verification:
      - kind: unit
        ref: "test/unit/rails/dotenvSrcSkip.test.ts cases (a) to (e) (wrapped, verdict untouched)"
        status: pass
      - kind: other
        ref: "node node_modules/typescript/bin/tsc --noEmit -p tsconfig.bot.json (exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Production path unchanged with VITEST unset: a fake .env is loaded by src/config and src/utils/notifier, the notifier builds the same Telegram URL and body, a failing send still resolves, and no refusal is recorded"
    requirement: SAFE-02
    verification:
      - kind: unit
        ref: "test/unit/rails/dotenvSrcSkip.test.ts#(f) production path without VITEST"
        status: pass
    human_judgment: true
    rationale: "NAC-06 and P6 are judgment items that 22-29 re-audits on the diff; the test proves the behaviour, the audit confirms the diff adds only VITEST-gated lines"
  - id: D4
    description: "AC-18 for the src notifier and dotenv layers: both send paths and two representative dotenv gates each shown RED once, restored byte-exact, and GREEN again"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-10-1..4 (diff, command, failing excerpt, verdict untouched, restore sha256, GREEN rerun)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The real fork-project run of the notifier refusal is a dated obligation, not Phase 22 evidence"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: ".planning/audit/inputs/unrun-fork-verifications.json UFV-03 (owner 25, rehearsal pass)"
        status: pass
    human_judgment: true
    rationale: "The real fork project starts Hardhat and is deliberately not run in Phase 22 (AC-08); whichever phase first runs npm run test:fork must check UFV-03 by name"

duration: 11min
completed: 2026-11-08
status: complete
---

# Phase 22 Plan 10: Notifier Refusal and Dotenv Gates (src layer) Summary

**Under Vitest the notifier now refuses every Telegram send through its existing catch path, so the caller never sees a throw and the dashboard broadcast still runs. The five dotenv sites a test can reach skip the `.env` file. Outside Vitest both behave as before, shown by a child process using a fake `.env` in a throwaway folder and a loopback fake instead of Telegram. The live `data/` matched the backup MANIFEST on every run.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-11-09T02:09:22Z
- **Completed:** 2026-11-09T02:20:48Z
- **Tasks:** 3/3
- **Files:** 10 created, 8 modified

## Accomplishments

- **Notifier refusal (D-04 amended).** `refuseUnderVitest()` is the first statement inside both existing `try` blocks. It appends `notifier-refused` to the rail ledger and throws `RAIL_NOTIFIER_REFUSED`, which the existing `catch` logs. The message never carries the token. The skipped branch, the broadcast payloads and `TELEGRAM_API` are unchanged.
- **Cannot throw into a money path.** A test calls both functions un-awaited, as the money paths do, and asserts no unhandled rejection. Both sends resolve in every project.
- **AC-16 in every project.** Unit 5 tests, integration 3, and the fork rehearsal 6 (including the new refusal case). `axios.post` was never called and the ledger gained one entry per send.
- **Dotenv gates.** Each of the five sites is now `if (!process.env.VITEST) dotenv.config();`. A child that really loads each site made zero read attempts with VITEST set. Without VITEST, config, notifier, pause and resume each attempted the read, and the setup layer blocked it. `preflight` was never run without VITEST.
- **Production path unchanged.** With VITEST unset and a fake `.env` in a throwaway folder, `src/config` and `src/utils/notifier` each loaded the fake key. The notifier built the production `api.telegram.org` URL and the same request bodies, a failing send still resolved, and no refusal was recorded. `axios.post` was redirected to a loopback fake, so no request went to Telegram.
- **Wrong-path defect closed (T-22-70).** With the old `../../src/config` path temporarily put back, the probe exited 4 with `Cannot find module`, not 0. The file was then restored and its blob hash matched HEAD.
- **Final wrapped runs.** `test/unit/rails` and `test/integration/rails`: 11 files, 106 tests, verdict `untouched`, manifest equal, ledger ok, `nonLoopbackAllowed` 0, `telegramAllowed` 0, no `telegram-deny`. Fork rehearsal: 6 tests, verdict `untouched`. `tsc --noEmit -p tsconfig.bot.json` is clean.
- **RED proofs (AC-18):**

| # | Rail neutralised | Run | RED result | GREEN |
|---|------------------|-----|------------|-------|
| 1 | refusal call in `sendTelegramAlert` | notifierRefusal -t "sendTelegramAlert" | spied post called once, test failed | 2 passed |
| 2 | refusal call in `sendCtxAlert` | notifierRefusal -t "sendCtxAlert" | spied post called once, test failed | 2 passed |
| 3 | VITEST gate at `src/config.ts` | dotenvSrcSkip -t "config" | probe reported 1 blocked read, case (a) failed | 2 passed |
| 4 | VITEST gate at `scripts/pause.ts` | dotenvSrcSkip -t "pause" | 1 blocked read, case (c) failed | 2 passed |

Every RED run's verdict was `untouched` with the manifest equal, and each file was restored byte-exact with its sha256 equal.

**TDD (Task 1).** RED `ccd1158`: classified `RED_EVIDENCE_OK` by `check tdd-red-evidence`. The target test ran and failed on its first planned assertion because the notifier still posted under Vitest (`red-proofs/22-10-tdd-red-evidence.json`). GREEN `03412cf`. No refactor was needed.

## Task Commits

1. **Task 1: notifier refusal with AC-16 tests.** `ccd1158` (test, RED), `03412cf` (feat, GREEN). The tracer gate re-ran the automated verify end-to-end after the commit: 8 tests and 6 rehearsal tests, verdict `untouched`.
2. **Task 2: dotenv gates and child probes.** `be3c572` (feat)
3. **Task 3: RED proofs.** `576e011` (docs)

**Plan metadata:** the docs commit that follows this SUMMARY.

## Files Created/Modified

- `src/utils/notifier.ts`: `refuseUnderVitest()`, its two call sites, the dotenv gate.
- `src/config.ts`, `scripts/pause.ts`, `scripts/resume.ts`, `scripts/preflight.ts`: the dotenv gate and one comment line each.
- `test/rails/spawnRailedChild.ts`: `ledgerRunId` option and limit.
- `test/rails/probes/dotenvProbe.ts`, `test/rails/probes/notifierProdPathProbe.ts`: child probes.
- `test/unit/rails/notifierRefusal.test.ts`, `test/integration/rails/notifierRefusalIntegration.test.ts`, `test/unit/rails/dotenvSrcSkip.test.ts`: the tests.
- `test/fork/rails/forkRails.fork.test.ts`: the AC-16 case.
- `.planning/audit/inputs/unrun-fork-verifications.json`: UFV-03.
- `red-proofs/22-10-*`: four RED proofs and the RED evidence record.

## Decisions Made

See `key-decisions`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Case-folder ledgers carry their own safety assertions**
- **Found during:** Task 2
- **Issue:** `ledgerRunId` sends a child's ledger to a `case-*` folder, which the wrapper's `--require-ledger` gate cannot see. A non-loopback connection or Telegram attempt in those children would have gone unchecked.
- **Fix:** every case asserts no `telegram-deny` and only loopback `net-allow` entries. It also requires at least one `worker-start`, so a wrong folder cannot read as zero attempts. Case folders are removed after reading.
- **Files modified:** `test/unit/rails/dotenvSrcSkip.test.ts`
- **Committed in:** `be3c572`

**2. [Rule 2 - Hardening] Probe exit 5 when its own ledger is empty**
- **Issue:** `readLedger` returns `[]` when the file is missing, which would print a false 0.
- **Fix:** the probe requires a `worker-start` entry before printing. `spawnRailedChild` limit refusals for `ledgerRunId` are also tested.
- **Committed in:** `be3c572`

**3. [Rule 1 - Test tooling] RED assertion made single-line**
- **Found during:** Task 1 RED
- **Issue:** `expect(spy).not.toHaveBeenCalled()` produces a multi-line failure message, including the call arguments, which is invalid TAP. The classifier returned `INVALID_RED`, and the classifier result was not bypassed.
- **Fix:** the tests assert `postSpy.mock.calls.length` is 0. This also keeps call arguments out of failure output.
- **Committed in:** `ccd1158`

### Requested additions and plan wording

**4. Production-path proof added (orchestrator note).** Case (f) and `test/rails/probes/notifierProdPathProbe.ts` are not in the plan's file list. The orchestrator required a proof that production behaviour is unchanged.

**5. Preflight case keeps `DASHBOARD_API_KEY` at its sentinel.** The plan says "run the same way". `src/config` requires that key at import, so blanking it would exit before the script's own dotenv site and give a false zero (see `key-decisions`).

**6. Process slip, recorded honestly.** While checking how tests are laid out, I ran `node_modules/.bin/vitest --version` once, unwrapped and on the global Node 24. It printed the version only; no config, test file or `src/` module was loaded. It still broke the "every Vitest invocation is wrapped, Node 22" rule. The next wrapped run showed `data/` equal to the MANIFEST.

---

**Total deviations:** 3 auto-fixed (2 missing-critical or hardening, 1 test tooling), 2 requested or wording notes, 1 process slip.
**Impact on plan:** the additions make the proofs harder to fool. No production behaviour changed outside the VITEST-gated lines, and no audit finding was fixed.

## Issues Encountered

- `--outputFile` was ignored for the `tap-flat` reporter, so the RED evidence report was taken from the run's stdout, with only the surrounding wrapper and rail-ledger lines left out.

## Known Stubs

None.

## Notes for 22-29 / Phase 24

- **AUD-DB-009 and AUD-DB-010 are untouched,** as instructed. The refusal's own error carries no token, but a real failed send outside Vitest still logs the whole axios error (Phase 24, card TX-04).
- **Ungated dotenv sites remain** in `scripts/addLiquidity.ts`, `audit-honeypot-checker.ts`, `capture-launch.ts`, `deliberate-buy.ts`, `deploy-honeypot-checker.ts`, `deploySepoliaTest.ts`, `recover-sell-ladys.ts` and `telegram-login.ts`. The plan's scope is the five sites tests can reach; any railed child that loaded one of these would still have the read blocked by the setup layer.
- **Rail-ledger triggering files:** `notifier-refused` entries from `test/*/rails/` are deliberate and should be excluded from test-quality findings, as 22-08 noted for the other kinds.
- **22-29 must register UFV-03** alongside UFV-01 and UFV-02.
- No new defect was found, so `rails-discoveries.json` was not created.

## User Setup Required

None.

## Next Phase Readiness

- Telegram and `.env` now have both layers (setup and src) proven separately for the notifier and the dotenv sites.
- Ready for the next Phase 22 plan.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-08*

## Self-Check: PASSED

- FOUND: all 18 created or modified files
- FOUND: ccd1158, 03412cf, be3c572, 576e011 (ancestors of HEAD); `git rev-list --count 1a3dba8..HEAD` = 4
- Re-run after the last task commit: unit and integration rail folders 11 files / 106 tests, fork rehearsal 6 tests, both wrapped with verdict untouched, manifest equal and ledger ok; `tsc` clean; 5 gated dotenv sites; UFV-03 present; `git status --porcelain src scripts test` empty
