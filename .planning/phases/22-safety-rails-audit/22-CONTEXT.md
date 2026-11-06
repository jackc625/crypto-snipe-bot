# Phase 22: Safety Rails & Audit - Context

**Gathered:** 2026-11-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Back up the irreplaceable state (Ignition deployment records + the live `data/` DB) out-of-repo and off-machine under a verified SHA-256 manifest, then make it impossible for tests, tools, or a second bot process to reach production state (live DB, real `.env`, network, Telegram, wallet). In parallel, audit the whole codebase read-only from the code itself, producing a findings register with a per-file coverage ledger, the 20-class bug sweep (including a full-history secret scan and a signing-site census), a money-and-timing thresholds inventory, and an operator decision card for every behavior-changing recommendation. Nothing in this phase fixes an audit finding beyond the planned rails, and the bot stays OFF throughout.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**14 requirements are locked.** See `22-SPEC.md` for full requirements, boundaries, and acceptance criteria (AC-01..AC-40, NAC-01..NAC-13).

Downstream agents MUST read `22-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
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
- Audit areas: `src/`, `dashboard/`, `test/`, `scripts/`, and contracts tooling (`hardhat.config.ts`, `contracts/**`, `ignition/modules/**`, contract CI jobs, deploy/audit scripts), plus root tooling configs (`vitest.config.ts`, `eslint.config.mjs`, `tsconfig*.json`, `package.json`, `.github/workflows/*`) in the ledger

**Out of scope (from SPEC.md):**
- Fixing any audit finding other than the planned rails (which mitigate candidates #17, #18, #19, #25). Capital fixes are Phase 24, S2–S4 fixes Phase 29
- Triaging the 28 candidates to confirmed/NOT-A-BUG on a real-path harness (Phase 23, AUDIT-02); Phase 22 closes none as NOT-A-BUG
- Cleaning test-origin rows out of the live DB (inspect a copy and escalate only)
- Rotating credentials or rewriting git history after a secret-scan hit (becomes a decision card)
- Making out-of-process signing scripts honor the process lock or kill-switch (Phase 29, HYG-03)
- Commit-taxonomy enforcement and the decision trace (Phase 23, AUDIT-06, CHAR-03)
- Solidity logic review of `HoneypotChecker.sol` (Phase 30); `.sol` files appear in the ledger only
- Any `npm install`, dependency bump, Hardhat invocation, `.gitattributes`/Prettier, or repo-junk sweep — before the backup verifies, and at all in this phase (Phases 25/26)
- Booting `src/bot.ts` for any purpose
- Running ESLint/format gates as blocking (count only)

</spec_lock>

<decisions>
## Implementation Decisions

### Test-isolation rails (SAFE-02)
- **D-01 (rail layer):** Every rail is enforced at **both layers** (D-GATE-BOTH-LAYERS precedent from Phase 21): (a) a test-setup layer installed via `setupFiles` in every worker that does not depend on any env var and therefore catches test code, `node_modules`, and module-scope imports; plus (b) VITEST-gated checks inside `src/` (`src/utils/db.ts` tripwire, `src/utils/notifier.ts` refusal, `dotenv.config()` sites) that also cover child processes and other entry points. Each layer gets its own RED proof (deleting `process.env.VITEST` must not disable the setup layer).
- **D-02 (dummy env):** **Scrub then replace.** At setup, delete every app key from `process.env` (all `.env.example` keys plus `ETH_FORK_RPC_URL`, `ALLOW_REAL_MAINNET`, `TEST_WALLET_PRIVATE_KEY`, and any other key the code reads), then load a committed `test/.env.test` in which every key is an inert sentinel. A sync test fails if `test/.env.test` and `.env.example` key sets differ (enforces D-ENV-EXAMPLE automatically). Sentinels: a throwaway private key that is **not** Hardhat #0 (so it is distinguishable in scans), RPC/WS URLs on `127.0.0.1:1` (immediate refusal), an obvious `TEST-SENTINEL` Telegram token. The setup layer also blocks any read of `<repo>/.env` (dotenv swallows read errors — `node_modules/dotenv/lib/main.js:278-288` — so the block must be recorded to be observable).
- **D-03 (child processes):** A shared `spawnRailedChild()` helper is the only way tests spawn processes. It builds the child env from the scrubbed sentinel env (never `...process.env`), sets `VITEST`, and injects `NODE_OPTIONS=--require <rails preload>` so children get the same `.env` block, DB tripwire, network deny, and notifier refusal. The preload and the `setupFiles` rail must be the same module logic (one source, loaded both ways). A source-grep test fails if any test file calls `spawn`/`spawnSync`/`exec*`/`execFile*`/`fork` outside the helper; the fork `globalSetup` (`test/fork/setup.ts`, which spawns Hardhat and needs network) is the single documented exemption. Known current call sites: `test/integration/pauseCli.test.ts`, `test/integration/preflightCli.test.ts`, `test/fork/exitStatePersistence.fork.test.ts`, `test/fork/helpers/realMainnetGate.ts`.
- **D-04 (on block):** The DB tripwire **throws** (SPEC). The other rails **fail the way prod fails**: the notifier returns through its existing "skipped" path (never throws — a throw would turn un-awaited alert calls into unhandled rejections and change control flow under test); a denied non-loopback connect emits an async socket error (code e.g. `E_RAIL_NET_DENIED`) like a refused connection; a blocked `.env` read is swallowed by dotenv as today. Every block is appended to a per-worker **rail ledger**, printed in a run summary, and each test that triggered one is registered in `AUDIT-FINDINGS.md` as a test-quality finding (fixing those tests is Phase 28). The rail's own RED test — not a run-wide failure — proves each block.

### Boot guards (SAFE-03 / SAFE-04 / SAFE-05)
- **D-05 (duplicate-load guard):** **Strict guard with an epoch sentinel.** Each guarded module (`withNonceLock` module, sell lock, ExitWorker, anti-rug registry) registers in a `globalThis[Symbol.for(...)]` registry keyed by canonical real path, storing (a) the raw load identity (`__filename` / later `import.meta.url`, un-normalized) and (b) the identity of a tiny `guards/epoch` module object it imports. Rules: different raw identity for the same canonical file → **always throw** (casing alias, symlink, ESM/CJS double load, `?query` cache-busting); same raw identity + same epoch → **throw** (true duplicate, e.g. `delete require.cache`); same raw identity + new epoch → allowed (the whole module graph was reset). No Vitest internals are patched and no env var relaxes it. Code fact driving this: Vitest 4.1.1 reuses a worker across test files and resets the module graph between files while `globalThis` persists (`node_modules/vitest/dist/chunks/base.C9_VThnT.js:83-86`), so the guard re-evaluates at the start of every test file, not only in the 37 explicit-reset files (18 of which reload guarded modules). If a Vitest path re-evaluates one module without a full graph reset (e.g. `vi.importActual` beside an automock), the affected test gets a small edit — never a deletion/skip (AC-22, NAC-04).
- **D-06 (lock primitive):** **SQLite exclusive file lock** via the installed `better-sqlite3` (`locking_mode=EXCLUSIVE` + a held write transaction, `busy_timeout=0`): OS-released on death (`LockFileEx` / `fcntl`), atomic on a race (exactly one winner), synchronous, identical on Windows and ubuntu CI, no new dependency. The process holds exactly one handle to the lock file. Any lock-mechanism error refuses boot (NAC-07, fail closed). The query API for Phase 29 scripts is try-acquire-then-release.
- **D-07 (acquisition point):** A new entry **`src/main.ts`** loads env, derives the wallet address, acquires the lock synchronously, and only then `require`s `./bot` and calls `startMultiChainBot()`. `src/bot.ts` no longer self-starts: the `require.main === module` block (`src/bot.ts:2359-2361`) is replaced by a refusal that prints "start via src/main.ts" and exits non-zero, so the lock cannot be skipped. A source test asserts `main.ts` acquires the lock before importing anything stateful (`config`, `utils/db`, `notifier`). Tests that import `bot.ts` never touch the lock. `preflight`/`pause`/`resume` do not acquire it and run while it is held (AC-23d). The operator start command changes to `npx ts-node src/main.ts` — update the STATE.md operating note and README. — **Reversibility:** costly — reverting means moving the lock back into `bot.ts`'s import graph (where it would collide with tests) and re-documenting the start command across STATE.md, README, and the Phase 32 re-entry runbook.
- **D-08 (DB creation):** First-time DB creation is only via **`npm run db:init`** (`scripts/db-init.ts`): resolves the path exactly as `db.ts` does, prints the absolute target, creates + migrates to CURRENT, refuses an existing non-empty file; replacing a 0-byte / `user_version`-0 file requires `--replace-empty` plus confirmation of the printed path. Never part of boot; no bot flag, no env var (D-ROLLBACK / P5).

### Backup, forensics, baselines (SAFE-01 / R3 / SAFE-07)
- **D-09 (off-machine destination):** The operator does **not** use OneDrive. `C:\Users\jackc\OneDrive` exists only because Windows keeps Desktop/Documents there; OneDrive is not running and no account is signed in (verified 2026-11-06), so that folder is local-only and must never count as off-machine. The off-machine copy goes to **Google Drive**. The on-disk copy goes to a dated folder outside the repo and outside the OneDrive path, e.g. `C:\Users\jackc\crypto-snipe-bot-backups\<date>\`.
- **D-10 (Drive upload + verify):** The script builds **one dated archive** (`crypto-snipe-bot-state-<date>.tar.gz` via the installed `tar`) containing the files plus their manifest, and records the archive's SHA-256 beside it. Wave 1 hits a **human checkpoint**: the operator uploads the archive at drive.google.com, downloads it back into a fresh temp folder, and the script verifies the **downloaded** bytes (archive hash + every manifest entry). This proves the cloud copy itself, not a local cache. — **Reversibility:** one-way — the upload hands a copy of the trade history and wallet address (no keys/tokens, proven by the NAC-01 scan) to Google; deleting it later does not guarantee removal from their storage.
- **D-11 (backup tool + manifest):** A committed **`scripts/backup-state.ts`**, run with the already-installed ts-node. A **fixture self-check** proves AC-04..AC-06 on temp fixtures (missing `bot.db` or chain-1 `journal.jsonl` FAILS; torn snapshot FAILS; re-run creates a new dated folder and never overwrites) **before** the script touches real state. Builds in a staging folder; valid only once the manifest verifies. Outputs a sorted `MANIFEST.json` (relative path, PRESENT/ABSENT, size, sha256) and a standard `SHA256SUMS` verifiable with plain `sha256sum -c`. Live `data/` files are hashed and copied as raw bytes, never opened through SQLite. After the rails land, a Vitest test wraps the same fixture checks for regression. The self-check must not run through the Vitest suite pre-rail.
- **D-12 (forensic method):** **Two-image diff.** Copy E (from the backup, never the live files or the backup itself) is hashed and **never opened**. A throwaway working copy W is made from E's bytes in a temp dir, SQLite recovers W's WAL, and the result is `serialize()`d to memory; `bot.db` alone (the last-checkpoint image, mtime 17:33) is also loaded to memory. Every query runs read-only on the two in-memory images. The report holds the AC-09 contents for the merged (20:25) image **plus a row-level diff of 17:33 vs 20:25** across `trades`, `exit_state`, `pause_state`, `chain_state`, `lp_baseline`, cross-referenced against `token`/`tx_hash` literals under `test/`. E's hash is re-checked afterwards; two runs are byte-identical (AC-10). Do **not** use `immutable=1` (cannot be trusted to read WAL frames → false negative on exactly the suspect writes) and do not open the copy directly (a WAL reader may rewrite `-shm`).
- **D-13 (pre-rail collected count):** **Isolated pre-rail export.** `git archive <pre-rail SHA>` into a temp folder outside the repo, `node_modules` linked read-only (directory junction, never an install), no `.env`, no `data/`, scrubbed shell env; run `vitest list --json` for `unit` and `integration` there. The capture script refuses to run collection anywhere except such an export. Reason: in this checkout `vitest list` imports test files → `src/utils/db` → opens and migrates the live DB and loads the real `.env` (violates P3/NAC-03). Fork count: static or `N/A` with a reason (AC-30). **No `npm test` / `vitest` invocation in the main checkout until the rails land.**

### Audit method & register (AUDIT-01 / 03 / 04 / 05)
- **D-14 (agent strategy):** Claude agents audit **all** areas, split by domain slice (`src/` by domain — buy/detection, exit, anti-rug, nonce/MEV/tx, db/risk/config, api — plus dashboard, test, scripts, contracts tooling). On the **five money-handling slices** (buy, exit, anti-rug, nonce/MEV/tx, db/risk) the installed `codex` (OpenAI; config `review.models.codex = gpt-6.1-sol`, effort xhigh) and `agy` (Google/Gemini; config `review.models.agy = gemini-4-argon-high`) CLIs each run an **independent, code-only second opinion**: given only tracked source files and the 20-class list, never our findings, the research candidates, `.env`, or any `.planning` VERIFICATION/SUMMARY doc. Merge is a union: a finding reported by only one model becomes an entry (never dropped). Outputs are normalized into the register schema. — **Reversibility:** one-way — sends the repository's money-path source code to OpenAI and Google services, which cannot be recalled; send tracked source only, never `.env*`, `data/`, or backups.
- **D-15 (register storage):** **One data file per finding** under `.planning/audit/` (milestone-level, because Phases 23, 24, 29 consume it), plus a script that renders the readable `AUDIT-FINDINGS.md` and `OPERATOR-DECISIONS.md` and **mechanically checks** coverage and field completeness (AC-31/32/34, NAC-09/10/12). The per-file ledger and the sweep matrix are structured files alongside. Parallel agents never edit the same file. The render/check tooling must live inside `.planning/` (e.g. `.planning/audit/tools/`) or be committed in Wave 2, so audit-wave commits touch nothing outside `.planning/` (AC-33).
- **D-16 (escalation delivery):** **Tiered.** S0 findings, rail findings, test-origin DB rows, and non-public secret hits **stop the run immediately** at a blocking checkpoint. S1 entries are collected per code area and presented together at a blocking checkpoint as soon as that area finishes. Every item gets exactly one dated escalation record either way (AC-39); rediscoveries link to it. At each stop the operator acknowledges and may rule on a decimal phase; the phase then continues unless the operator rules otherwise, and any ruling is recorded in the register (AC-40). Fixes still wait for Phase 24/29.
- **D-17 (secret scan):** **gitleaks, downloaded Windows binary** (operator choice over Docker): official release pinned to an exact version with its release checksum verified, kept outside the repo (never committed), run with `--redact` and `--log-opts="--all"` for full history across all refs, JSON report. Hits recorded by rule ID, file, commit, line, and type only — never the value. The same binary scans both backup copies (NAC-01) and the Phase 22 commits (NAC-11). The Hardhat #0 default key is recorded as known-public and not escalated; every other hit is escalated (D-16 immediate tier).

### Audit scope details
- **D-18 (timing):** The audit wave runs **concurrently** with the rails wave as soon as the backup verifies. Files the rails change (expected ~8: `src/utils/db.ts`, `src/utils/notifier.ts`, `src/config.ts`, the four singleton modules, `src/bot.ts`, `vitest.config.ts`, the tsconfigs, `package.json`) are re-audited on their diff after they change (AC-32). That re-audit doubles as an independent review of the rail code.
- **D-19 (thresholds scope):** The AUDIT-04 inventory covers **every number that changes what the bot does with money or when**: trading parameters (sizes, capital caps, position limits, slippage, stop-loss/trailing %, tax bps, gas buffers) **plus** poll intervals, timeouts, confirm windows, retry/attempt counts, fee/gas multipliers, backoff, and anti-rug thresholds — env-tunable settings **and** hard-coded numeric constants on money paths. Cosmetic numbers (log sizes, dashboard page sizes, UI dimensions) are excluded. Each row carries the AC-37 fields.
- **D-20 (test-code audit):** `test/` gets the 20-class sweep **plus a per-test-file quality label**: what the file claims to test, whether it mocks/fakes that very mechanism, whether its assertions are hollow (only assert on its own mocks / no assertion), and whether it can reach real state. Each problem is a finding (severity per rubric); nothing is fixed in this phase. The output is the map Phase 23 (real-path triage) and Phase 28 (test rewrites) consume — it targets the pattern that let CR-01/CR-02/S-1/INT-NONCE-SELL pass a green suite.

### Claude's Discretion
- **DB tripwire scope:** under Vitest, any DB path canonically inside `<repo>/data/` throws (not just the three files), matched on canonical real path so casing variants and `-wal`/`-shm` are covered. Unset/`''` `DB_PATH` under Vitest → a fresh per-worker temp file, never the cwd default.
- **Network deny:** single choke point at `net.Socket.prototype.connect` (covers http, https, `ws`, axios, ethers, undici `fetch`, raw TCP, TLS). Loopback = `127.0.0.0/8`, `::1`, `localhost`. Non-loopback DNS lookups are also denied so hostnames never reach the resolver. Re-installing on each `setupFiles` run must be idempotent.
- **Lock key and location:** lowercase wallet address derived from `PRIVATE_KEY` (matches `nonceAuthority` keying); machine-global location such as `%LOCALAPPDATA%\crypto-snipe-bot\locks\<address>.lock` (blocks a second clone too; writes nothing new under `data/`).
- **Repo-root anchoring:** walk up from the DB module's own file to the nearest `package.json` whose `name` is `crypto-snipe-bot` (survives the Phase 27 restructure and Phase 26 ESM conversion; no `__dirname`-relative depth, no runtime `git`). Read `user_version` through a read-only open **before** any `journal_mode`/`synchronous` pragma or migration write, so a CURRENT+1 DB is refused with its hash unchanged (AC-24).
- **`vi.mock` gate (SAFE-06):** AST-based via the installed TypeScript 5.8.3 compiler API (no regex); covers `vi.mock` and `vi.doMock` literal specifiers (recommended to also cover `vi.unmock`/`vi.doUnmock`, which fail just as silently); relative specifiers resolved from the test file with TS-aware extension resolution, bare specifiers via Node resolution from the test file's directory; non-literal specifier fails. Ships as a script + npm script + CI step in `.github/workflows/test.yml`, committed in Wave 2.
- **Fork RPC variable:** keep the existing name `ETH_FORK_RPC_URL`, drop the `ALCHEMY_URL` fallback in `test/fork/setup.ts:8`, fail with a clear error naming the variable, and add it to `.env.example` (D-ENV-EXAMPLE) with a note that it is read from the shell only.
- **Finding IDs:** area-prefixed, never renumbered, unique by construction under parallel agents (e.g. `AUD-EXIT-007`); duplicates linked via `duplicate-of`; research candidates referenced as `RC-01..RC-28`.
- **Severity rubric / capital-impact classes:** S0–S4 and LOSS / STRAND / OVERSPEND / EXPOSURE / none, as used in `.planning/research/SUMMARY.md` §Audit Candidates; the rubric is written into the register header.
- **Baseline output location:** `.planning/baselines/before/` and `.planning/baselines/after/` (sorted, deterministic files per AC-29).
- **Plan/wave decomposition and commit granularity:** planner's call, following the operator's preference for few large phases with risk isolated at plan/commit level.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/phases/22-safety-rails-audit/22-SPEC.md` — Locked requirements R1–R14, AC-01..AC-40, NAC-01..NAC-13, edge coverage, prohibitions — MUST read before planning
- `.planning/ROADMAP.md` §"Phase 22: Safety Rails & Audit" — goal, success criteria, wave outline, conventions, research flag
- `.planning/REQUIREMENTS.md` §Safety Rails (SAFE-01..07), §Audit (AUDIT-01, 03, 04, 05) — requirement text and traceability

### Research inputs
- `.planning/research/SUMMARY.md` §"Audit Candidates Already Surfaced" (28 UNCONFIRMED candidates, §A 1–19 capital, §B 20–28, §C lower-priority) and §"Open Operator Decisions" (OD-1..OD-25) — every candidate must map to a register entry; cards for OD-6, 9, 10, 11, 14–18, 21, 25
- `.planning/research/PITFALLS.md` — Pitfall 1 (tests reach prod state, rails steps), Pitfall 2 / §"Two bot processes" (singleton guard, process lock), recovery table, "looks done but isn't" checklist
- `.planning/research/ARCHITECTURE.md` — C0 test tripwires, module/cycle map useful for slicing the audit
- `.planning/research/FEATURES.md` — candidate detail (D4 out-of-process signers, test-coverage floor ideas)
- `.planning/research/STACK.md` — tool/version facts (no new deps this phase)

### Project context and conventions
- `.planning/PROJECT.md` §"Current Milestone: v7.0", §Constraints, §"Key Decisions" — behavior-preservation contract, bot OFF
- `.planning/STATE.md` §"Operating Notes" — start command (changes to `src/main.ts` per D-07), preflight is the read-only check, green-suite caveat
- `.planning/milestones/v6.17-phases/21-exit-engine-live-runtime-hardening/21-CONTEXT.md` — D-GATE-BOTH-LAYERS, D-STOP-THE-LINE, D-ROLLBACK, D-ENV-EXAMPLE [USER-BINDING] definitions
- `.planning/milestones/v6.17-phases/21.2-calm-gas-sell-inclusion-exit-engine-robustness/21.2-CONTEXT.md` — D-NONCE-AUTHORITY-ALL, D-TEST-BOTH, D-QUALITY-FIRST definitions
- `.planning/codebase/TESTING.md`, `.planning/codebase/CONVENTIONS.md` — existing test conventions (may predate v6.17 close; verify against code)

### External docs (for research)
- Vitest `vi.resetModules` / module mocking — https://vitest.dev/api/vi , https://vitest.dev/guide/mocking/modules
- gitleaks CLI (`git` mode, `--redact`, `--log-opts`, report formats) — https://github.com/gitleaks/gitleaks
- SQLite WAL, `immutable` URI parameter, read-only WAL behavior — https://www.sqlite.org/wal.html , https://www.sqlite.org/uri.html

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/fork/helpers/realMainnetGate.ts` + its use in `test/fork/setup.ts:38-61`: the existing global-setup tripwire pattern (D-GATE-BOTH-LAYERS) to mirror for the rails.
- `better-sqlite3` (installed): `readonly`, `fileMustExist`, `serialize()`, construct-from-buffer — covers the read-only version probe (D-08 / AC-24), refuse-to-create (AC-26), the process lock (D-06), and the in-memory forensic images (D-12).
- TypeScript 5.8.3 compiler API (installed) for the `vi.mock` gate and any AST-based census (signing sites, `it`/`test` counts).
- Existing test-reset hooks: `_resetForTesting` (circuitBreaker.ts), `_resetRegistryForTesting` (anti-rug/detector.ts), and the nonceAuthority test hook — they reset state; they are not guard bypasses and must stay that way.
- Host tools: GNU `tar` (Git Bash) and Windows `tar.exe`, `sha256sum`, ts-node 10.9.2, Docker 29.9.2 (not used for gitleaks per D-17), `codex` and `agy` CLIs.

### Established Patterns
- Modules have import-time side effects: `src/utils/db.ts:9-17` opens/creates the DB from `DB_PATH || cwd/data/bot.db`, sets WAL (`:20-24`), runs `migrateSchema()` writing `user_version = 7` unconditionally (`:232`), then JSON-state migration (reads/renames cwd `.bot-state.json`) and legacy-row normalization. Guards must run before any of these.
- `src/config.ts:4` and `src/utils/notifier.ts:6` call `dotenv.config()` at import; every script under `scripts/` does the same. dotenv 17.2.0 never overwrites existing keys and swallows read errors.
- Singletons are plain module state: `src/utils/nonceAuthority.ts:43` (`const chains = new Map()`); sell lock `src/exitManager.ts`; ExitWorker `src/exitEngine.ts`; anti-rug registry `src/anti-rug/detector.ts` (research line refs at `c110201`: exitManager 14/53/104, exitEngine 1421, detector 192/197/247 — re-measure).
- Wallets are keyed by `address.toLowerCase()` across nonceAuthority, exitManager, and the detector registry.
- Relative-path `vi.mock` specifiers are the norm (`vi.mock('../../../src/utils/db')` in 36 files); 37 files use `vi.resetModules`/`vi.doMock`; 34 files `vi.mock` the notifier.
- `vitest.config.ts` projects use `extends: true` and `mockReset: true`; fork uses `globalSetup: ['test/fork/setup.ts']` and `fileParallelism: false`.

### Integration Points
- `vitest.config.ts`: remove `config()` (lines 2-4); add the rails `setupFiles` to unit, integration, and fork; `package.json` `test` → unit+integration only (fork stays `test:fork`).
- `package.json` scripts to add: `db:init`, the backup script, the baseline capture script, the `vi.mock` gate, and a start script for `src/main.ts`.
- `src/bot.ts:2359-2361` entry block → refusal; new `src/main.ts`.
- `src/utils/db.ts:9-27` path resolution, read-only version probe, refuse-to-create, Vitest tripwire.
- `src/utils/notifier.ts:10,37-50,73+`: VITEST refusal on the Telegram post path (dashboard `broadcast` unchanged).
- `test/fork/setup.ts:8-11`: shell-only `ETH_FORK_RPC_URL`; `.env.example` gains it.
- `tsconfig.bot.json`, `dashboard/tsconfig.json`: add `forceConsistentCasingInFileNames: true`.
- `.github/workflows/test.yml`: add the `vi.mock` gate step.
- `ignition/.gitignore` (`deployments/*/journal.jsonl`) and root `.gitignore` (`artifacts/`) block tracking — the OD-21 commit needs scoped un-ignore rules for `ignition/deployments/**` only (NAC-02).
- Live state on disk: `data/bot.db` 57,344 B (mtime 2026-05-29 17:33), `bot.db-wal` 164,832 B and `bot.db-shm` 32,768 B (20:25), three capture logs; `ignition/deployments/` 7.6 MB across `chain-1` and `chain-11155111`. Repo root also holds `.bot-state.json.bak` (89 B).

</code_context>

<specifics>
## Specific Ideas

- **Ordering hazard to enforce in the plan:** no `npm test`, `vitest run`, or `vitest list` in the main checkout before the rails land — the current suite opens/migrates the live DB and loads the real `.env`. The only pre-rail Vitest use is inside the isolated export (D-13).
- **Forensic attribution:** the 17:33 → 20:25 window ends three minutes before the INT-NONCE-SELL commit (2026-05-29 20:28); the two-image diff (D-12) shows exactly which rows changed in it. Expect test-origin rows; they trigger the immediate escalation tier (D-16) in Wave 1.
- **Operator-facing checkpoints in plain language.** The operator was confused by unexplained tool names and jargon in this session ("codex", "agy", "slices", "union merge") and by an unverified assumption about OneDrive. Every human checkpoint (Drive upload/download, escalations, the external-model send) must say in plain words what is happening and what the operator needs to do; name any tool by what it is.
- **Sentinel private key** must differ from the Hardhat #0 key so secret scans and logs can tell a test sentinel from the known-public fork key.
- **External-model second opinion (D-14)** sends only `git ls-files` content of the five money slices; the send list is printed for the operator before it goes out.
- **Research flags for the phase researcher:** (1) whether Vitest 4.1.1 re-evaluates a module without a graph reset (automock + `vi.importActual`, `vi.doMock` paths) — affects D-05; (2) `better-sqlite3` exclusive-lock behavior on Windows and Linux (`busy_timeout=0`, release on `taskkill /F`/SIGKILL, single-handle rule) — D-06; (3) whether `vitest list --json` runs `globalSetup`/`setupFiles` — D-13 and AC-30; (4) SQLite WAL recovery on a copy + `serialize()`, and `immutable=1` semantics with a WAL — D-12; (5) `NODE_OPTIONS=--require` through `npx`/`ts-node` with `shell: true` on Windows — D-03; (6) `net.Socket.prototype.connect` coverage of undici `fetch` and TLS — network deny; (7) gitleaks current release, checksum verification, and `--log-opts=--all` behavior on this repo (931 commits); (8) ethers v6 `getFeeData` base-fee derivation and `wait()` error semantics (`TRANSACTION_REPLACED`/`repriced`) for the audit wave (ROADMAP research flag).

</specifics>

<deferred>
## Deferred Ideas

- **Encrypting the off-machine backup** — considered and declined for now (recoverability over privacy; no secrets in the set). Revisit if the backup set ever gains sensitive material.
- **Google Drive for desktop / automated Drive verification** — not chosen; manual web upload + download-back is the method this phase.
- **Second process-lock key on the DB path** (two bots with *different* wallets sharing one `data/bot.db`) — outside SAFE-04's "same wallet" scope; the audit should register it as a candidate if the code allows it.
- **Making `scripts/deliberate-buy.ts` / `scripts/recover-sell-ladys.ts` honor the lock and kill-switch** — Phase 29 (HYG-03); Phase 22 only provides the try-acquire query.
- **Fixing tests flagged by the rail ledger or the test-quality labels** — Phase 28 (TEST rewrites).

</deferred>

---

*Phase: 22-safety-rails-audit*
*Context gathered: 2026-11-06*
