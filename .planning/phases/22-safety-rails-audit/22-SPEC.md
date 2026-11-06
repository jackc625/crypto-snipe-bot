# Phase 22: Safety Rails & Audit — Specification

**Created:** 2026-11-06
**Ambiguity score:** 0.15 (gate: ≤ 0.20)
**Requirements:** 14 locked

## Goal

Irreplaceable state (Ignition deployment records and the live `data/` DB) goes from "only on this laptop, partly gitignored" to backed up out-of-repo and off-machine under a verified SHA-256 manifest. The test suite goes from "opens and writes the live DB and loads the real `.env`" to "provably cannot reach any production state." Then the whole codebase is audited read-only from the code itself, producing a findings register, a 20-class bug sweep, a thresholds inventory, and an operator decision card for every behavior-changing recommendation.

## Background

Grounded in the code at `1b260ca` (scouted 2026-11-06, bot OFF since 2026-05-29):

- **Ignition state is partly untracked.** `ignition/.gitignore` ignores `deployments/*/journal.jsonl`, and the root `.gitignore` pattern `artifacts/` also matches `ignition/deployments/chain-*/artifacts/`. Only `build-info/*.json` and `deployed_addresses.json` are tracked, for `chain-1` and `chain-11155111`. The journals and per-future artifacts exist only on this laptop.
- **The live DB is `./data/bot.db`** (confirmed by the operator: `.env` has `DB_PATH=./data/bot.db`, a cwd-relative path). `data/` holds `bot.db` (57,344 B, mtime 2026-05-29 17:33), `bot.db-wal` (164,832 B, uncheckpointed) and `bot.db-shm` (both mtime 2026-05-29 20:25), plus three capture logs.
- **Tests already reach the live DB (research candidate #19, now near-certain from code reading).** `vitest.config.ts:2-4` calls dotenv `config()`, so every test process loads the real `.env`. `src/utils/db.ts:9-17` opens `DB_PATH`, defaulting to `path.join(process.cwd(),'data','bot.db')`, at import time. It sets WAL, runs `migrateSchema()`, which writes `user_version = 7` unconditionally (`db.ts:232`), and runs import-time JSON-state migration and normalization. 17 unit/integration test files import modules that transitively import `src/utils/db` without mocking it, for example `test/unit/bot/twoStageSigint.test.ts`, `test/integration/killswitchCheckpoints.test.ts`, and `test/integration/api/chains.test.ts`. The `-wal`/`-shm` mtime (20:25) is three minutes before the INT-NONCE-SELL commit (`2026-05-29 20:28`), which is consistent with a pre-commit test run writing to the live DB. This was escalated to the operator during the spec interview (D-STOP-THE-LINE).
- **`npm test` runs all three Vitest projects, fork included.** The fork `globalSetup` (`test/fork/setup.ts`) spawns `npx hardhat node --fork <ETH_FORK_RPC_URL|ALCHEMY_URL>` from the real `.env`.
- **The notifier has no test guard.** `src/utils/notifier.ts` posts to `api.telegram.org` via axios, and `process.env.VITEST` is never checked anywhere in `src/` or `test/`.
- **Lock singletons are plain module state.** For example `src/utils/nonceAuthority.ts:43` declares `const chains = new Map()`, and the same holds for the sell lock (`exitManager.ts`), ExitWorker (`exitEngine.ts`), and the anti-rug registry (`detector.ts`). There is no duplicate-load guard, and no single-instance process lock exists anywhere in `src/`. Only `tsconfig.json` has `forceConsistentCasingInFileNames`; `tsconfig.bot.json` and `dashboard/tsconfig.json` do not.
- **No newer-schema guard and no refuse-to-create.** `db.ts` silently `mkdirSync`s the data dir and creates a fresh DB.
- **`vi.mock` usage:** 37 test files use `vi.resetModules`/`vi.doMock`/`vi.isolateModules`, and 23 test files bind loopback servers. Relative-path `vi.mock` specifiers are the norm (e.g. `vi.mock('../../../src/utils/db')` appears in 36 files).
- **Signing scripts exist:** `scripts/deliberate-buy.ts` and `scripts/recover-sell-ladys.ts`. The well-known Hardhat account #0 private key appears in tracked files (`test/fork/antiRugDetector.fork.test.ts` and archived `.planning` docs), which is a known-public false positive for the secret scan.
- **Research inputs:** `.planning/research/SUMMARY.md` lists 28 UNCONFIRMED audit candidates (§A 1–19 capital, §B 20–28 other, §C lower-priority) and OD-1..OD-25.

## Requirements

1. **Verified out-of-repo + off-machine backup (SAFE-01)**: Ignition deployment state and `data/` are backed up under a SHA-256 manifest before any `npm install`, Hardhat invocation, sweep, or relocation.
   - Current: no backup exists; the `chain-1`/`chain-11155111` `journal.jsonl` and `artifacts/` exist only on this disk.
   - Target: a dated folder outside the repo, plus a second off-machine copy (cloud drive or USB). Both contain `ignition/deployments/` (all chains: `journal.jsonl`, `artifacts/`, `build-info/`, `deployed_addresses.json`) and `data/` (`bot.db`, `bot.db-wal`, `bot.db-shm` copied together as one set, plus the logs). A manifest sorted by path re-verifies against both copies.
   - Acceptance: AC-01 to AC-06.

2. **Ignition deployments tracked in git (SAFE-01 / OD-21, ruled 2026-11-06: track)**: once the manifest verifies, `ignition/deployments/` is committed in full.
   - Current: journals and per-future artifacts are gitignored.
   - Target: every file under `ignition/deployments/` (both chains) is tracked, and the committed set equals the manifest's Ignition subset with matching hashes, before any Hardhat invocation this milestone.
   - Acceptance: AC-07, AC-08.

3. **Read-only forensic check of the live DB (new, from interview)**: a copy of the backed-up DB is inspected for test-origin rows and state.
   - Current: unknown whether test runs inserted or modified rows in `trades`, `exit_state`, `pause_state` (kill-switch), `chain_state`, or `lp_baseline`.
   - Target: a deterministic report on a read-only copy, registered as a finding. Any test-origin row is escalated to the operator before Phase 23.
   - Acceptance: AC-09 to AC-11.

4. **Test-isolation rails (SAFE-02)**: unit and integration runs cannot read the real `.env`, open the production DB, reach the non-loopback network, or send Telegram. The fork project gets partial rails.
   - Current: the real `.env` is loaded, the live DB is opened at import, there is no network deny, the notifier is unguarded, and `npm test` includes fork.
   - Target: unit+integration get a dummy env, a prod-DB tripwire that throws under Vitest, an outbound non-loopback network deny, and a notifier that refuses under Vitest. Fork gets the dummy env, tripwire, and notifier refusal, is exempt from the network deny, and reads its RPC URL only from an explicit shell variable (never `.env`). `npm test` runs unit+integration; fork stays opt-in via `test:fork`. Each rail is RED-proven.
   - Acceptance: AC-12 to AC-19.

5. **Duplicate-load singleton guards (SAFE-03)**: the `withNonceLock` module, sell lock, ExitWorker, and anti-rug registry throw when loaded twice in one process, and every tsconfig enforces casing.
   - Current: plain module-level state with no guard; casing is enforced only in `tsconfig.json`.
   - Target: a second load, including through a Windows path-casing alias, throws. `forceConsistentCasingInFileNames: true` is set in `tsconfig.json`, `tsconfig.bot.json`, and `dashboard/tsconfig.json`. The suite, including all 37 reset/doMock files, still passes with no test removed.
   - Acceptance: AC-20 to AC-22.

6. **Single-instance process lock (SAFE-04)**: a second bot process for the same wallet refuses to start.
   - Current: no process lock exists; two processes can trade one wallet.
   - Target: the lock is acquired at boot and held by the live process. The OS releases it automatically when the process dies, so the next boot after a force-kill needs no manual cleanup. It blocks only a second bot process, never `preflight`/`pause`/`resume`. It is proven without booting `src/bot.ts`.
   - Acceptance: AC-23.

7. **DB version and path guards (SAFE-05)**: the DB layer refuses a newer-schema DB, resolves a relative `DB_PATH` against the repo root, and refuses to silently create a DB outside Vitest.
   - Current: `user_version = 7` is written unconditionally; `DB_PATH` resolves against cwd; a missing DB is silently created.
   - Target: `user_version` 7 (CURRENT) opens and CURRENT+1 refuses, with no write. `./data/bot.db` resolves to `<repo>/data/bot.db` from any cwd. Outside Vitest, a missing, 0-byte, or version-0 DB refuses boot with an error naming the resolved absolute path. First-time creation happens only via an explicit operator action.
   - Acceptance: AC-24 to AC-26.

8. **`vi.mock` path gate (SAFE-06)**: CI fails if any mock specifier does not resolve.
   - Current: no gate. A moved file silently turns its mocks into no-ops.
   - Target: a CI step resolves every `vi.mock`/`vi.doMock` literal specifier, relative and bare. An unresolvable or non-literal specifier fails the step.
   - Acceptance: AC-27.

9. **Re-runnable baseline capture (SAFE-07)**: one committed script captures and commits the before-baselines and later produces the after-baselines.
   - Current: baselines exist only as prose in STATE.md.
   - Target: the script captures `npm ls`, `npm audit`, ESLint counts by rule and by file, per-project test counts (a pre-rail collected count, plus the official count taken after the rails land), the coverage file list, and raw-byte SHA-256 of the three DB files. Output is deterministic and sorted.
   - Acceptance: AC-28 to AC-30.

10. **Findings register with checkable coverage (AUDIT-01)**: `AUDIT-FINDINGS.md` covers every audited area, with a per-file ledger.
    - Current: none; only the 28 UNCONFIRMED research candidates exist.
    - Target: every entry has severity S0–S4, a capital-impact class, code evidence, sibling-sites-checked, and lifecycle status. All 28 candidates are mapped. A per-file coverage ledger is checked against `git ls-files`. The audit wave changes no source file.
    - Acceptance: AC-31 to AC-33.

11. **20-class bug sweep, secret scan, signing census (AUDIT-03)**: the sweep is a class × area matrix with no blank cells.
    - Current: none.
    - Target: the AUDIT-03 matrix of 20 classes × 5 areas. A one-time full-history secret scan records hits by location, commit, and type only. A census of every signing call site (D-NONCE-AUTHORITY-ALL), scripts included, establishes the positive count N that Phase 23 asserts.
    - Acceptance: AC-34 to AC-36.

12. **Thresholds / magic-number inventory (AUDIT-04)**: every trading parameter is inventoried with its exact semantics.
    - Current: parameters are scattered, with defaults parsed in several places (candidate #6).
    - Target: one inventory row per parameter. It holds the value, every definition site, the comparison operator, units and representation, the effective value for unset/''/non-numeric env, and a rationale, and covers the OD-25 risk defaults. Questionable items are flagged with a recommendation.
    - Acceptance: AC-37.

13. **Operator decision cards (AUDIT-05)**: `OPERATOR-DECISIONS.md` holds an ID'd card for every behavior-changing recommendation.
    - Current: ODs exist only as a table in research SUMMARY.md / ROADMAP.md.
    - Target: cards for OD-6, OD-9, OD-10, OD-11, OD-14..OD-18, OD-25, OD-21 (recorded as decided), and every new recommendation (OD-26+). Capital cards are grouped by area for the Phase 24 discussion.
    - Acceptance: AC-38.

14. **Immediate escalation, never deferred (D-STOP-THE-LINE)**: S0/S1 entries, rail findings, non-public secret hits, and test-origin DB rows are re-surfaced at once.
    - Current: convention only.
    - Target: exactly one dated escalation record per such item, made in the session it is found. The phase continues afterwards, since the audit is read-only and the rails only add guards, while the operator decides on a decimal phase.
    - Acceptance: AC-39, AC-40.

## Boundaries

**In scope:**
- SAFE-01 backup (out-of-repo + off-machine, SHA-256 manifest) as the very first action of the milestone
- OD-21: committing all of `ignition/deployments/` after the backup verifies
- Read-only forensic inspection of a copy of the live DB, with its result registered and escalated
- Test-isolation rails for unit/integration (full) and fork (partial); `npm test` re-scoped to unit+integration
- `Symbol.for`-style duplicate-load guards on the four lock/registry singletons; `forceConsistentCasingInFileNames` in all three tsconfigs
- Single-instance process lock at boot (OS-released on death)
- Newer-schema guard, repo-root `DB_PATH` anchoring, refuse-to-create outside Vitest, and the explicit operator DB-creation path
- `vi.mock`/`vi.doMock` specifier-resolution CI gate
- Baseline capture script plus committed before-baselines
- `AUDIT-FINDINGS.md` (register + per-file ledger), the 20-class sweep matrix, the one-time full-history secret scan, the signing-site census, the thresholds inventory, and `OPERATOR-DECISIONS.md`
- Audit areas: `src/`, `dashboard/`, `test/`, `scripts/`, and contracts tooling. Contracts tooling means `hardhat.config.ts`, `contracts/**`, `ignition/modules/**`, the contract CI jobs, and the deploy/audit scripts. Root tooling configs (`vitest.config.ts`, `eslint.config.mjs`, `tsconfig*.json`, `package.json`, `.github/workflows/*`) are also in the ledger.

**Out of scope:**
- Fixing any audit finding other than the planned rails (which mitigate candidates #17, #18, #19, #25). Capital fixes are Phase 24, S2–S4 fixes Phase 29 (D-STOP-THE-LINE: never fixed in flight).
- Triaging the 28 candidates to confirmed/NOT-A-BUG on a real-path harness, which is Phase 23 (AUDIT-02). Phase 22 closes none of them as NOT-A-BUG.
- Cleaning test-origin rows out of the live DB. Phase 22 only inspects a copy and escalates; any cleanup is an operator decision for a later phase.
- Rotating credentials or rewriting git history after a secret-scan hit. That becomes a decision card; Phase 22 does neither.
- Making out-of-process signing scripts honor the process lock or kill-switch, which is Phase 29 (HYG-03). Phase 22 only provides the lock they will query.
- Commit-taxonomy enforcement and the decision trace, which are Phase 23 (AUDIT-06, CHAR-03).
- Solidity logic review of `HoneypotChecker.sol`. That is the Phase 30 contractual re-audit; Phase 22 audits contracts *tooling*, and the `.sol` files appear in the ledger.
- Any `npm install`, dependency bump, Hardhat invocation, `.gitattributes`/Prettier, or repo-junk sweep before the backup verifies. After it, these still belong to Phases 25/26 and are not done here.
- Booting `src/bot.ts` for any purpose (no dry-run mode exists).
- Running ESLint/format gates as blocking. Phase 22 only counts them.

## Constraints

- **Bot OFF** for the whole phase; `ENABLED_CHAINS=eth` is unchanged.
- **Ordering:** the backup (R1) verifies before any `npm install`, Hardhat invocation (including `test:fork` and `hardhat compile`), sweep, `git clean`, or relocation. The OD-21 commit (R2) lands before any Hardhat invocation. The audit wave (R10–R13) may start once R1 verifies and may overlap the rails wave. Per-project official test counts (R9) are taken only after the rails (R4) land.
- **Never touch the live DB through SQLite.** Live `data/` files are hashed and copied as raw bytes. Inspection uses a copy opened read-only.
- **Secrets:** `.env` is never read into the conversation, logs, register, or backup. Secret-scan output records type and location only.
- **Windows host** (Git Bash + PowerShell): path-casing aliases, force-kill via `taskkill /F`, and `npx` swallowing Ctrl+C are real conditions the rails and lock must handle.
- **Behavior preservation:** Wave 2 `src/` changes add only refuse/throw guards and path anchoring. No trading decision, tx construction, or signing path changes.
- **Conventions cited:** D-STOP-THE-LINE, D-NONCE-AUTHORITY-ALL, D-ROLLBACK (no bypass flags), D-TEST-BOTH (RED-proven rails, no hollow assertions), D-ENV-EXAMPLE [USER-BINDING] (any new env var, e.g. the fork RPC shell var, lands in `.env.example` with a default and a one-line description).

## Acceptance Criteria

**Backup (R1)**
- [ ] AC-01: Two backup copies exist, one in a dated folder outside the repo on this disk and one off-machine. Each contains `ignition/deployments/chain-1/` and `chain-11155111/` (`journal.jsonl`, `artifacts/`, `build-info/`, `deployed_addresses.json`) and `data/` (`bot.db`, `bot.db-wal`, `bot.db-shm`, logs).
- [ ] AC-02: The manifest timestamp precedes the first v7.0 `npm install`/`npm ci`, Hardhat invocation, sweep, or relocation, as shown by the executor log and by no commit touching `package-lock.json` or Hardhat config before it.
- [ ] AC-03: The SHA-256 manifest is sorted by relative path, lists every expected file as PRESENT or ABSENT, and re-verifies with zero mismatches against BOTH copies.
- [ ] AC-04: Backing up a fixture source tree that lacks `bot.db` or the `chain-1` `journal.jsonl` FAILS.
- [ ] AC-05: The source `bot.db`/`-wal`/`-shm` are hashed before and after the copy and are equal. A simulated write between the two hashes on a fixture makes the backup FAIL (torn snapshot).
- [ ] AC-06: The backup is built in a staging folder and counts as valid only once its manifest verifies. A re-run creates a new dated folder and never overwrites an existing backup (demonstrated on a fixture).

**Ignition tracking (R2)**
- [ ] AC-07: After AC-03 passes, the set of git-tracked files under `ignition/deployments/` equals the manifest's Ignition subset (set equality), and every committed file's SHA-256 equals its manifest entry.
- [ ] AC-08: The OD-21 commit precedes every Hardhat invocation in v7.0.

**Forensic DB check (R3)**
- [ ] AC-09: A forensic report exists covering `trades`, `exit_state`, `pause_state`, `chain_state`, and `lp_baseline`. It includes per-table row counts, every row whose `token` or `tx_hash` literal appears anywhere under `test/`, and the full `pause_state` and `chain_state` rows.
- [ ] AC-10: The inspection runs on a copy opened read-only. The copy's SHA-256 is unchanged afterwards, and two runs produce byte-identical reports.
- [ ] AC-11: The result is registered in `AUDIT-FINDINGS.md`. If any test-origin row exists, its escalation record is dated before Phase 23 starts.

**Test-isolation rails (R4)**
- [ ] AC-12: `npm test` runs exactly the `unit` and `integration` projects; `npm run test:fork` still runs fork.
- [ ] AC-13: Under every Vitest project, a test asserts that env values come from the dummy test env (e.g. the Telegram token equals the dummy sentinel) and that the repo `.env` was not loaded.
- [ ] AC-14: Under Vitest, opening the prod DB throws for `./data/bot.db`, its absolute path, an upper-cased path variant, and the `-wal` path. Unset or `''` `DB_PATH` never opens `data/bot.db`. A test that imports `src/utils/db` at module scope is still blocked.
- [ ] AC-15: Under unit/integration, http, https, ws/wss, and raw TCP connections to a non-loopback host fail, while loopback connections (local test servers, `127.0.0.1:8545`) succeed.
- [ ] AC-16: Under every Vitest project, the notifier refuses to send. A send attempt is observable as a refusal, not a network call.
- [ ] AC-17: The fork project reads its RPC URL only from an explicit shell variable and fails with a clear error naming that variable when it is absent, rather than falling back to `.env`. The variable is documented in `.env.example`.
- [ ] AC-18: Each rail (dummy env, tripwire, network deny, notifier refusal, fork RPC source) has a test that goes RED when that rail is removed. Each RED is demonstrated once and recorded.
- [ ] AC-19: After a full `npm test`, the SHA-256 and mtime of `data/bot.db`, `bot.db-wal`, and `bot.db-shm` equal their pre-run values, no Telegram message was sent, and no non-loopback connection succeeded.

**Singleton guards (R5)**
- [ ] AC-20: Loading the `withNonceLock` module, sell lock, ExitWorker, or anti-rug registry a second time in one process throws. This is shown by a test that includes a path-casing alias on Windows.
- [ ] AC-21: `forceConsistentCasingInFileNames: true` is present in `tsconfig.json`, `tsconfig.bot.json`, and `dashboard/tsconfig.json`.
- [ ] AC-22: The full unit+integration suite passes with no test deleted, skipped, or converted to `.todo` to accommodate the guards. All 37 reset/doMock files still execute.

**Process lock (R6)**
- [ ] AC-23: Using an entry point that acquires the real lock, without booting `src/bot.ts`, four behaviors are shown. (a) A second acquire for the same wallet refuses while the first holder is alive. (b) After the holder is force-killed (`taskkill /F` / SIGKILL), the next acquire succeeds with no manual cleanup. (c) Two simultaneous acquires result in exactly one winner. (d) `preflight`, `pause`, and `resume` run while the lock is held.

**DB guards (R7)**
- [ ] AC-24: A DB at `user_version` 7 (CURRENT) opens. A DB at 8 (CURRENT+1) refuses with an error, and the refused file's SHA-256 is unchanged.
- [ ] AC-25: Launched from a cwd other than the repo root, `DB_PATH=./data/bot.db` resolves to `<repo>/data/bot.db`.
- [ ] AC-26: Outside Vitest, a missing, 0-byte, or `user_version`-0 DB refuses boot with an error naming the resolved absolute path. First-time creation works only through the documented explicit operator action.

**vi.mock gate (R8)**
- [ ] AC-27: A CI step fails when any `vi.mock`/`vi.doMock` literal specifier, relative or bare, does not resolve, and fails on a non-literal specifier. This is demonstrated with a deliberately broken fixture and passes on the real suite.

**Baselines (R9)**
- [ ] AC-28: The capture script is committed, and its committed outputs contain `npm ls`, `npm audit`, ESLint counts by rule and by file (files with ≥1 problem, plus the grand total), per-project test counts (pre-rail collected and post-rail official), the coverage file list, and raw-byte SHA-256 of the three DB files.
- [ ] AC-29: All outputs are sorted deterministically. Two consecutive runs on an unchanged tree produce identical files, apart from fields documented as time-varying (npm advisory data, timestamps).
- [ ] AC-30: The fork test count comes from static collection without spawning Hardhat or touching the network. If that is not possible, it is recorded as `N/A` with a reason.

**Register (R10)**
- [ ] AC-31: Every `AUDIT-FINDINGS.md` entry has a unique, never-renumbered ID, severity S0–S4, a capital-impact class, evidence (code `file:line@SHA` or command output), a non-empty sibling-sites-checked field, and a lifecycle status. All 28 research candidate numbers map to an entry, with duplicates merged via `duplicate-of` links.
- [ ] AC-32: The per-file coverage ledger lists every file returned by `git ls-files` for the in-scope areas at the phase-end commit (zero missing). Each file shows its audited SHA and finding IDs or `none`. Any file changed after its audited SHA, such as by the Wave 2 rails, is re-audited on the diff.
- [ ] AC-33: Audit-wave commits change no file outside `.planning/`.

**Sweep (R11)**
- [ ] AC-34: The sweep matrix has all 20 AUDIT-03 classes × 5 areas. Every cell holds finding IDs or `checked, none` together with the search performed (patterns/files), and a cross-class finding appears in every relevant cell under the same ID.
- [ ] AC-35: The full-history secret scan ran once, with tool, commit range, and hit count recorded. Each hit records location, commit, and secret type, never the value. Known-public Hardhat default keys are recorded as public and not escalated; every other hit is escalated.
- [ ] AC-36: The signing-site census lists every signing call site in `src/`, `scripts/`, and the dashboard API, each with `file:line` and whether it runs under `withNonceLock`, and records the total N.

**Thresholds (R12)**
- [ ] AC-37: Every inventory row records the current value, every definition site (`file:line`), the exact comparison (`>=` vs `>`), units and representation (wei/ether/%/bps, float vs bigint), the effective value when the env is unset, `''`, or non-numeric (read from code), the rationale, and whether interval/timeout cycles can overlap. Differing defaults across sites and float math on money values are flagged. The OD-25 risk defaults are included, and every flagged row has a recommendation.

**Decision cards (R13)**
- [ ] AC-38: `OPERATOR-DECISIONS.md` has cards for OD-6, OD-9, OD-10, OD-11, OD-14..OD-18, and OD-25, plus OD-21 recorded as decided (2026-11-06, track after backup). Every new behavior-changing recommendation gets a card numbered OD-26 or higher. Each card has options, a recommendation, a default, and behavior impact. A finding that overlaps an existing OD links to it rather than creating a duplicate. The capital cards (OD-6, OD-11, OD-14..18, and any new capital card) are grouped by area for the Phase 24 discussion.

**Escalation (R14)**
- [ ] AC-39: Every S0/S1 entry, rail finding, non-public secret hit, and test-origin DB row has exactly one escalation record, dated the same session it was found. Rediscoveries link to that record, and none has status `deferred`.
- [ ] AC-40: After an escalation the phase continued, unless the operator ruled otherwise, and any such ruling is recorded in the register.

**Negative criteria (must-NOT) — see Prohibitions**
- [ ] NAC-01 (P1): No backup copy contains `.env*` (other than `.env.example`), a private key, or Telegram session material. A secret scan over both copies finds zero hits beyond known-public keys.
- [ ] NAC-02 (P2): The OD-21 commit tracks nothing outside `ignition/deployments/`. After it, `git ls-files data .env .env.*` lists only `.env.example`.
- [ ] NAC-03 (P3): At phase end, the live `data/bot.db`, `-wal`, and `-shm` SHA-256 equal the backup manifest entries, so nothing in Phase 22 wrote, repaired, checkpointed, or deleted them.
- [ ] NAC-04 (P4): Per-project test counts after the rails are ≥ the pre-rail collected counts. No test was deleted, skipped, or `.todo`'d to make a rail pass.
- [ ] NAC-05 (P5): No rail can be disabled by an env var or flag (judgment review).
- [ ] NAC-06 (P6): Wave 2 `src/` diffs add only refuse/throw guards and path anchoring. No trading decision, tx construction, or signing path changed (judgment review).
- [ ] NAC-07 (P7): When the process lock cannot be acquired, or the lock mechanism itself errors, boot refuses. This is demonstrated by a test.
- [ ] NAC-08 (P8): Running the capture script leaves `package.json`, `package-lock.json`, and the `node_modules` tree hash unchanged and never boots `src/bot.ts`.
- [ ] NAC-09 (P9): No register evidence field cites a `.planning/` VERIFICATION or SUMMARY doc (mechanical scan of evidence fields).
- [ ] NAC-10 (P10): No research candidate has status NOT-A-BUG at phase end, and every capital candidate whose severity is below the research suggestion carries a written rationale.
- [ ] NAC-11 (P11): A secret scan over all Phase 22 commits finds zero new hits, and the phase-start SHA is an ancestor of HEAD (no history rewrite).
- [ ] NAC-12 (P12): Every decision card lists ≥2 options, including "keep current behavior" with its risk stated. No card is marked decided except OD-21 and the previously resolved OD-1, OD-2, and OD-7.
- [ ] NAC-13 (P13): No Phase 22 commit fixes a capital candidate other than through the planned rails for #17, #18, #19, and #25 (judgment review).

## Edge Coverage

**Coverage:** 49/49 applicable edges resolved (42 covered, 7 dismissed) · 0 unresolved

| Category | Requirement | Status | Resolution / Reason |
|----------|-------------|--------|---------------------|
| adjacency | R1 | ✅ covered | AC-05: source DB set hashed before/after copy; torn snapshot fails |
| empty | R1 | ✅ covered | AC-03/AC-04: PRESENT/ABSENT per file; missing `bot.db` or chain-1 journal fails |
| ordering | R1 | ✅ covered | AC-03: manifest sorted by relative path |
| concurrency | R1 | ✅ covered | AC-06: staging dir, valid only once verified; re-run never overwrites |
| adjacency | R2 | ✅ covered | AC-07: committed set == manifest Ignition subset (set equality) |
| empty | R2 | ⛔ dismissed | Both chain dirs are non-empty today; AC-07 set equality catches any missing file |
| ordering | R2 | ⛔ dismissed | A git file set has no order semantics |
| concurrency | R2 | ✅ covered | AC-08: commit precedes any Hardhat invocation |
| idempotency | R3 | ✅ covered | AC-10: read-only copy, hash unchanged, identical reports on re-run |
| concurrency | R3 | ⛔ dismissed | Single run over a static copy; no parallel writer exists |
| test-origin definition (added) | R3 | ✅ covered | AC-09: row counts + `test/`-literal cross-reference + full pause/chain state |
| adjacency | R4 | ✅ covered | AC-14: canonical-path match incl. relative/absolute/upper-case/`-wal` |
| empty | R4 | ✅ covered | AC-14: unset/`''` `DB_PATH` never opens `data/bot.db` |
| ordering | R4 | ✅ covered | AC-14: rails active before the first module-scope `src` import |
| concurrency | R4 | ✅ covered | AC-19: every worker railed; full parallel run leaves `data/` unchanged |
| coverage of transports (added) | R4 | ✅ covered | AC-15: http/https/ws/wss/raw TCP denied; loopback allowed |
| unclassified → module reset | R5 | ✅ covered | AC-22: 37 reset/doMock files pass with no test removed; AC-20 prod-path duplicate throws |
| unclassified → scope + race | R6 | ✅ covered | AC-23 (c)(d): exactly one winner on a race; non-bot commands unaffected |
| concurrency | R7 | ⛔ dismissed | Boot is single-threaded, and R6 prevents a second concurrent boot |
| boundary (added) | R7 | ✅ covered | AC-24: version 7 opens, 8 refuses, no downgrade write |
| empty (added) | R7 | ✅ covered | AC-26: 0-byte / version-0 file treated as missing outside Vitest |
| cwd (added) | R7 | ✅ covered | AC-25: repo-root anchoring from another cwd |
| unclassified → specifier forms | R8 | ✅ covered | AC-27: `vi.mock` + `vi.doMock`, relative + bare, non-literal fails |
| adjacency | R9 | ✅ covered | AC-28: DB files hashed as raw bytes, never opened via SQLite |
| empty | R9 | ✅ covered | AC-28: per-file table = files with ≥1 problem + total |
| ordering | R9 | ✅ covered | AC-29: deterministic sorted output |
| concurrency | R9 | ⛔ dismissed | One manual run per baseline; no concurrent capture |
| fork count (added) | R9 | ✅ covered | AC-30: static collection or `N/A` + reason |
| adjacency | R10 | ✅ covered | AC-31: duplicates merged with `duplicate-of`; all 28 numbers mapped |
| empty | R10 | ✅ covered | AC-32: zero-finding files listed as `none`, never omitted |
| ordering | R10 | ✅ covered | AC-31: IDs stable, never renumbered |
| concurrency | R10 | ✅ covered | AC-31: no two entries share an ID under parallel area audits |
| SHA drift (added) | R10 | ✅ covered | AC-32: files changed after their audited SHA are re-audited |
| adjacency | R11 | ✅ covered | AC-34: cross-class finding in every relevant cell, same ID |
| empty | R11 | ✅ covered | AC-34: `checked, none` names the search performed |
| ordering | R11 | ⛔ dismissed | Matrix order is fixed by the AUDIT-03 class list |
| signing census (added) | R11 | ✅ covered | AC-36: file:line, under-lock y/n, total N |
| secret false positives (added) | R11 | ✅ covered | AC-35: known-public Hardhat keys recorded, not escalated |
| boundary | R12 | ✅ covered | AC-37: exact comparison operator + units |
| adjacency | R12 | ✅ covered | AC-37: every definition site; differing defaults flagged |
| empty | R12 | ✅ covered | AC-37: effective value for unset/`''`/non-numeric |
| ordering | R12 | ⛔ dismissed | Grouping by domain carries no semantics |
| precision | R12 | ✅ covered | AC-37: representation per row; float money math flagged |
| concurrency | R12 | ✅ covered | AC-37: interval/timeout overlap stated |
| adjacency | R13 | ✅ covered | AC-38: overlaps link to existing OD; new IDs from OD-26 |
| empty | R13 | ✅ covered | AC-38 + NAC-12: every card has a recommendation and a default |
| ordering | R13 | ✅ covered | AC-38: IDs never renumbered; capital cards grouped by area |
| idempotency | R14 | ✅ covered | AC-39: exactly one escalation record per finding; rediscovery links |
| concurrency | R14 | ✅ covered | AC-40: escalation is same-session and does not auto-halt the phase (operator ruling) |

Totals: 40 engine-proposed rows + 9 added = 49 applicable. 42 are covered (explicit). 7 are dismissed: R2-empty, R2-ordering, R3-concurrency, R7-concurrency, R9-concurrency, R11-ordering, R12-ordering. 0 are unresolved, and there are no backstop rows.

## Prohibitions (must-NOT)

**Coverage:** 13/13 applicable prohibitions resolved · 0 unresolved

| Prohibition (must-NOT statement) | Requirement | Status | Verification / Reason |
|----------------------------------|-------------|--------|------------------------|
| P1: The backup MUST NOT contain `.env*` (except `.env.example`), private keys, or Telegram session material | R1 | resolved | test — NAC-01 (secret scan over both copies; descriptor captured at plan time) |
| P2: The OD-21 commit MUST NOT track anything outside `ignition/deployments/` | R2 | resolved | test — NAC-02 (`git ls-files data .env .env.*`) |
| P3: Phase 22 MUST NOT write, repair, checkpoint, or delete the live DB files, even if test-origin rows are found | R3 | resolved | test — NAC-03 (live hashes == manifest at phase end) |
| P4: Rails MUST NOT be achieved by deleting, skipping, or `.todo`-ing tests | R4, R5 | resolved | test — NAC-04 (post-rail counts ≥ pre-rail collected counts) |
| P5: Rails MUST NOT have a bypass env var or flag (D-ROLLBACK) | R4 | resolved | judgment — NAC-05 |
| P6: Wave 2 `src/` changes MUST NOT alter trading decisions, tx construction, or signing | R4–R7 | resolved | judgment — NAC-06 |
| P7: The process lock MUST NOT fail open | R6 | resolved | test — NAC-07 |
| P8: The capture script MUST NOT modify `package.json`/lockfile/`node_modules` or boot `src/bot.ts` | R9 | resolved | test — NAC-08 (hash before/after) |
| P9: Register evidence MUST NOT cite prior `.planning` VERIFICATION/SUMMARY docs (anti-anchoring) | R10 | resolved | test — NAC-09 (evidence-field scan) |
| P10: Phase 22 MUST NOT close any research candidate as NOT-A-BUG, nor lower a capital candidate's severity without written rationale | R10 | resolved | test — NAC-10 (status/rationale fields) |
| P11: Secret values MUST NOT appear in the register, output, or commits; history MUST NOT be rewritten | R11 | resolved | test — NAC-11 (scan of phase commits; ancestor check) |
| P12: Decision cards MUST NOT steer or pre-decide | R13 | resolved | test — NAC-12 (≥2 options incl. keep-current; decided-status check) |
| P13: Phase 22 MUST NOT fix any capital candidate in flight beyond the planned rails | R14 | resolved | judgment — NAC-13 |

Canon breadcrumbs (not minted here): generic key/log redaction across `src/` (candidate I1) is canon and is owned by `/gsd-secure-phase` and the Phase 31 gitleaks CI gate. "Must not change thresholds" is already enforced by AC-33 (audit changes no source file).

`test`-tier descriptors (`check_kind`/`check_target`/fixtures) are intentionally left empty. The wired checks do not exist yet; plan-phase names them. Until then the items stay fail-closed downstream.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                        |
|--------------------|-------|------|--------|--------------------------------------------------------------|
| Goal Clarity       | 0.88  | 0.75 | ✓      | Two-part goal (rails, then read-only audit), each measurable |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | Fork rails, forensic-only DB handling, no NOT-A-BUG closures, secret-hit scope locked |
| Constraint Clarity | 0.80  | 0.65 | ✓      | Backup destination, DB path anchoring, lock release semantics, ordering locked |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 40 positive + 13 negative pass/fail criteria                 |
| **Ambiguity**      | 0.15  | ≤0.20| ✓      |                                                              |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

| Round | Perspective     | Question summary                                                | Decision locked |
|-------|-----------------|-----------------------------------------------------------------|-----------------|
| 1     | Researcher      | Tests appear to have written to the live DB (D-STOP-THE-LINE raised); how to handle its contents? | Forensic check on a read-only copy; any test-origin row is escalated before Phase 23 |
| 1     | Researcher      | Is `data/bot.db` the production DB?                             | Yes. `.env` sets `DB_PATH=./data/bot.db` (relative), which feeds R7 |
| 1     | Researcher      | How do the rails treat the fork project?                        | Partial rails: dummy env + tripwire + notifier refusal, net-deny exempt, RPC from explicit shell var only; `npm test` = unit+integration |
| 2     | Researcher      | Where does the backup live?                                     | Out-of-repo dated folder + an off-machine copy; manifest verified on both |
| 2     | Simplifier      | How is audit coverage made checkable?                           | Per-file ledger checked against `git ls-files` + 20-class × area matrix |
| 2     | Simplifier      | Process-lock behavior after a force-kill?                       | Held by the live process and OS-released on death; no manual cleanup |
| 3     | Boundary Keeper | Relative `DB_PATH` semantics?                                   | Anchor to repo root; refuse a missing DB outside Vitest; explicit operator creation only |
| 3     | Boundary Keeper | Scope when the secret scan hits?                                | Register (type/location, never value) + immediate escalation; no rotation or history rewrite in Phase 22 |
| 3     | Boundary Keeper | Rule OD-21 now?                                                 | Yes: track all of `ignition/deployments/` after the backup verifies |
| Edge  | Failure Analyst | 49 edge rows (40 engine + 9 added) across R1–R14                | All accepted as proposed: 42 covered, 7 dismissed with reasons |
| Edge  | Failure Analyst | S0/S1 found mid-phase?                                          | Escalate in the same session; the phase continues (audit read-only) |
| Prohib| Failure Analyst | 13 must-NOTs                                                    | All kept; P10 = no NOT-A-BUG closures in Phase 22 |

---

*Phase: 22-safety-rails-audit*
*Spec created: 2026-11-06*
*Next step: /gsd-discuss-phase 22 — implementation decisions (backup tooling, rail mechanics, lock primitive, register format)*
