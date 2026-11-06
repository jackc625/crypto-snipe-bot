# Phase 22: Safety Rails & Audit - Research

**Researched:** 2026-11-06 (HEAD `3602e85`, branch `phase-22-safety-rails-audit`)
**Domain:** Test-isolation rails (Vitest 4.1.1 / Node), SQLite (better-sqlite3 12.8.0 / SQLite 3.51.3) locking + WAL forensics, backup integrity, secret scanning, ethers v6.16.0 semantics for the read-only audit
**Confidence:** HIGH for the rail mechanics (each one was tested in a sandbox outside the repo on this machine); MEDIUM for the betterleaks procedure (official docs and release metadata, but the binary was not run)

## STOP-THE-LINE

These items are listed first under D-STOP-THE-LINE. Each one either is S0/S1-class or proves a locked CONTEXT premise false. None of them needs a code change in this research. Each needs an operator acknowledgement, a plan adjustment, or both.

**STL-1: The active Node cannot load the installed `better-sqlite3`. This undercuts the premise of D-06, D-08, D-12, D-13, AC-24 and AC-26 as the environment stands today.**
- **Evidence.** `node --version` → `v24.18.0` (nvm-windows symlink `C:\nvm4w\nodejs`, ABI `137`). Loading the repo's native binary fails with: `NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137` (`ERR_DLOPEN_FAILED`). Node `v22.16.0` (ABI `127`) is installed at `C:\Users\jackc\AppData\Local\nvm\v22.16.0\node.exe`, and every experiment in this file ran on it. CI also pins `node-version: '22'` (`.github/workflows/test.yml:15`). [VERIFIED: ran it]
- **Impact.** With Node 24 active, `src/utils/db.ts`, the process lock (D-06), `db:init` (D-08), the forensic script (D-12) and every test that imports the DB all crash when better-sqlite3 loads. A pre-rail `vitest list` would also undercount, because any file that imports the DB at module scope fails to collect. That would corrupt the NAC-04 baseline.
- **Required plan action.** Every Phase 22 command runs on Node 22.16.0. Use either `nvm use 22.16.0`, which changes the global symlink and so needs the operator's OK, or the absolute path to `node.exe`. Every script asserts `process.versions.modules === '127'` and refuses otherwise. **Never "fix" this with `npm rebuild`.** That changes `node_modules` before the backup (SAFE-01 ordering, NAC-08) and diverges from CI.
- Note also that `npm` resolves to a global **npm 11.17.0** in `%APPDATA%\npm`, even when Node 22 is first on PATH (Node 22 bundles npm 10.9.2). The baseline header must record `node -v` and `npm -v`. [VERIFIED]

**STL-2: Vitest already ran in the main checkout today, at 2026-11-06 11:21:39 local, before this phase.**
- **Evidence.** `node_modules/.vite/vitest/da39a3ee…/results.json` has mtime `2026-11-06 11:21:39.32 -0500`. That is 20 minutes before commit `8a30611 docs: start milestone v7.0` (11:41). Its entries include `unit:test/unit/db.test.ts {"duration":0,"failed":true}`, `unit:test/unit/bot/twoStageSigint.test.ts {"duration":0,"failed":true}` and `unit:test/unit/anti-rug/dryRunTimestamp.test.ts {"duration":0,"failed":true}`. A duration-0 collection failure is what the STL-1 ABI crash produces. [VERIFIED: file read]
- **What did not change.** `data/bot.db` mtime is still `2026-05-29 17:33:56`, and `bot.db-wal`/`-shm` are still `2026-05-29 20:25:58`. `ignition/deployments/*` newest mtime is `2026-05-19`. The Hardhat `cache/` newest mtime is `2026-05-29 19:29`. So the live DB, the Ignition state and the Hardhat cache were not written. [VERIFIED: stat only]
- **Unknown.** `vitest.config.ts:2-4` loaded the real `.env`, so that run may have made non-loopback network calls with real credentials. Whether it did cannot be determined from disk.
- **Required action.** Escalate under D-16's immediate tier, as a rail finding. Ask the operator what ran at 11:21. Record it in the register. For NAC-08, the `node_modules` tree hash has to exclude `node_modules/.vite/**` and `node_modules/.vite-temp/**` (Vitest's own cache), or the baseline will never be stable.

**STL-3: D-12's in-memory forensic method fails as written. A WAL-mode image cannot be deserialized.** Decision survives with one adjustment.
- **Evidence.** I built a fixture WAL DB with uncheckpointed frames and force-killed the writer. In a throwaway copy W, recovery works: `user_version=7`, and the rows include the WAL-only row. But `W.serialize()` returns a buffer whose header bytes 18-19 are `2 2` (WAL), and `new Database(buffer)` then fails with **`SQLITE_CANTOPEN unable to open database file`**, both read-only and read-write. Deserializing `bot.db`'s bytes alone (the "17:33 image") fails the same way. [VERIFIED: ran it]
- **Fix (verified).** On the in-memory Buffer copy only, set bytes 18 and 19 to `1` (rollback mode) before `new Database(buf, { readonly: true })`. After that, the merged image gives `user_version= 7 rows= ["0xold","0xTESTTOKEN"] integrity= ok`, and the main-file-only image gives `user_version= 0 rows= ["0xold"] integrity= ok`. An equivalent route is `PRAGMA journal_mode=DELETE` on the throwaway W before `serialize()`; its pages are byte-identical to the patched buffer apart from the header. E's hashes are unchanged, and two independent merges are byte-identical. [VERIFIED]
- **Bonus fact confirming D-12's "never open the copy directly".** A `{ readonly: true }` open of a copy that has `-wal` but no `-shm` **creates `-shm`**. A read-only open with both files present **modifies `-shm`**. [VERIFIED] `immutable=1` is moot anyway. better-sqlite3 compiles with `SQLITE_USE_URI=0` and never passes `SQLITE_OPEN_URI` (`deps/defines.gypi`; `src/objects/database.cpp:159-161`), so a `file:…?immutable=1` name is not parsed as a URI. It fails with `SQLITE_CANTOPEN`. [VERIFIED]

**STL-4: D-05's stated code fact is wrong for this repo's config.** The decision survives. The epoch rule is still needed, but for a different reason.
- **Evidence.** With the repo's config (`isolate` default `true`, pool `forks`), Vitest 4.1.1 starts a **fresh worker process per test file**. A runner is reused only when `task.isolate === false` (`node_modules/vitest/dist/chunks/cli-api.BUXBO6jS.js:3460-3462`, `3502-3509`). In a sandbox with 9 test files I saw 9 distinct PIDs, both at default `maxWorkers` and with `--maxWorkers=1`, and `setupFiles` ran once per PID (`run#1` every time). [VERIFIED] The reset loop CONTEXT cites (`base.C9_VThnT.js:83-86`) only iterates more than one file per worker when `isolate:false`.
- **Consequence.** `globalThis` does not persist across test files. The epoch sentinel matters only for **in-file** `vi.resetModules()`/`vi.doMock()` re-imports. 37 files use those, and by grep 22 of them name a guarded module. That use is verified to work: reset then re-import gives a new epoch, so the reload is allowed.
- **Two classification corrections, verified in Vitest.**
  1. A `?query` re-import (`import('../src/guarded?x=1')`) re-evaluates the module with the **same** `__filename` and **same** `import.meta.url`, in the **same** epoch. It is therefore caught by the "same raw identity + same epoch → throw" rule, not by "different raw identity".
  2. **Automock (`vi.mock(path)` with no factory) plus `vi.importActual(path)` evaluates the real module twice: same raw identity, same epoch → the strict guard would throw.** The repo has 0 such sites today (no single-argument `vi.mock` calls), so AC-22 is not affected now. A future automock of a guarded module will throw. That is a correct, loud failure.
- **Casing alias is detected in both runtimes.** Under Vitest, importing `../src/Guarded` beside `../src/guarded` produced two evaluations with `__filename` `…\src\guarded.ts` and `…\src\Guarded.ts`. Under plain Node on Windows, `require('./sub/mod.js')` beside `require('./SUB/Mod.js')` gives `loads 2`, with two distinct `module.exports`. [VERIFIED]
- **Canonical key.** It must come from `fs.realpathSync.native`. The JS `fs.realpathSync` keeps the alias casing (`…\SUB\MOD.js`), while `.native` returns on-disk casing (`…\sub\mod.js`) and normalizes `c:` to `C:`. [VERIFIED]

**STL-5: D-06 has a fail-open trap. A garbage-collected lock handle silently releases the OS lock.** The decision survives, but the handle must be pinned.
- **Evidence.** A holder whose `Database` object is unreachable after acquire loses the lock on the next GC. With `--expose-gc` and `gc()` called, a second process acquired the "exclusive" lock **while the holder was alive**. When the same holder stored the handle on `globalThis`, the second process was refused. [VERIFIED]
- **How it showed up.** First as "an `ACQUIRED` log line to a piped stdout releases the lock". Allocating the stdout stream triggered the GC.
- **Required design.** Pin the lock handle for the process lifetime with a strong reference, e.g. `globalThis[Symbol.for('crypto-snipe-bot.processLock')]` or a module-level export that `main.ts` keeps. Add an AC-23/NAC-07 test that runs the holder with `--expose-gc`, forces `gc()`, and asserts that a second acquire is still refused.

**STL-6: S1 evidence for research candidate #10 ("nonce lock … no timeout").** The candidate is already UNCONFIRMED S1. This is a concrete path that reaches it.
- **ethers 6.16.0 fact.** `TransactionResponse.wait(confirms, timeout)` uses `const timeout = (_timeout == null) ? 0 : _timeout;` (`node_modules/ethers/lib.commonjs/providers/provider.js:1045`). With timeout 0 it arms no timer and waits forever.
- **Where it bites.** `await stx.wait()` with no timeout runs **inside** `withNonceLock` at `src/bot.ts:750` (public-fallback buy), `src/exitEngine.ts:545` (approve) and `src/exitEngine.ts:556` (public-fallback sell). `withNonceLock` chains `prior.catch(() => {}).then(op)` (`src/utils/nonceAuthority.ts:65-71`), so an `op` that never settles blocks every later signing op for that wallet. Concrete trigger: a public-mempool tx that is never mined and never replaced, for example underpriced and then dropped. An outer `withTimeout` on the caller does not settle the inner `op`, so the chain stays blocked.
- **Disposition.** Escalate at the first S1 checkpoint. No fix in Phase 22 (NAC-13). Cite it in the register under RC-10 as sibling evidence. [VERIFIED: code read]

**User directive received during research: "betterleaks is preferred".** This supersedes the *tool* choice in D-17 (gitleaks). Everything else in D-17 carries over to betterleaks: a pinned exact version with checksum verification, kept outside the repo, `--redact`, full history, a JSON report, recording rule/file/commit/line/type only, scanning both backup copies (NAC-01) and the Phase 22 commits (NAC-11), and treating Hardhat #0 as known-public. The details are under Standard Stack and Code Examples. The planner should record the change against D-17 in the plan. Open question: SPEC's canon breadcrumb assigns a future gitleaks CI gate to Phase 31.

### Smaller CONTEXT corrections (not stop-the-line)
- **Child-process spawn sites under `test/` (D-03).** There are 3, not 4: `test/integration/preflightCli.test.ts:38`, `test/integration/pauseCli.test.ts:286`, and `test/fork/setup.ts:14,16,75` (the exempt globalSetup). `test/fork/exitStatePersistence.fork.test.ts` only *mentions* spawn in a comment at `:17`. `test/fork/helpers/realMainnetGate.ts` has no child_process at all. [VERIFIED: git grep]
- **Path correction.** The sell-lock module is `src/utils/exitManager.ts`, not `src/exitManager.ts`.
- **A second `.env` reader.** Vite reads the repo `.env` in the Vitest main process, even after `config()` is removed from `vitest.config.ts`. `loadEnv` reads `.env`, `.env.local`, `.env.test` and `.env.test.local` (Vitest mode is `test`) from the root (`node_modules/vite/dist/node/chunks/node.js:4944-4966`). It copies only `VITE_`-prefixed keys into `process.env` (`cli-api.BUXBO6jS.js:14102-14108`). **Set `envDir: false` in `vitest.config.ts`.** That is supported: `let envDir = config.envFile === false ? false : config.envDir;` at `node.js:34119`, and `getEnvFilesForMode` returns `[]` when `envDir === false` (`:4945-4951`). Keep `test/.env.test` inside `test/`, never at the repo root. [VERIFIED]
- **D-13 export writes into `node_modules`.** With `node_modules` as one directory junction, Vitest writes `node_modules/.vite/vitest/<hash>/results.json` and Vite writes `node_modules/.vite-temp/` *through the junction into the repo's `node_modules`*. I saw both directories created in my sandboxes. **Make the export's `node_modules` a real folder containing one junction per top-level entry of the repo's `node_modules`**, skipping `.vite`, `.vite-temp` and `.cache`. Node resolves dependencies from each package's real path, so this works. Alternatively, set `cacheDir` to a temp folder and treat `.vite-temp` the same way. [VERIFIED]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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
  - **SUPERSEDED IN PART by user directive during research (2026-11-06): "betterleaks is preferred."** Tool → betterleaks (stable v1.10.0); every other D-17 property carries over. See Standard Stack.

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

### Deferred Ideas (OUT OF SCOPE)
- **Encrypting the off-machine backup** — considered and declined for now (recoverability over privacy; no secrets in the set). Revisit if the backup set ever gains sensitive material.
- **Google Drive for desktop / automated Drive verification** — not chosen; manual web upload + download-back is the method this phase.
- **Second process-lock key on the DB path** (two bots with *different* wallets sharing one `data/bot.db`) — outside SAFE-04's "same wallet" scope; the audit should register it as a candidate if the code allows it.
- **Making `scripts/deliberate-buy.ts` / `scripts/recover-sell-ladys.ts` honor the lock and kill-switch** — Phase 29 (HYG-03); Phase 22 only provides the try-acquire query.
- **Fixing tests flagged by the rail ledger or the test-quality labels** — Phase 28 (TEST rewrites).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAFE-01 | Backup Ignition and `data/` with a verified manifest before any install, Hardhat run, sweep or relocation; then track `ignition/deployments/` | §Backup & OD-21: CR/LF facts, the `artifacts/` ignore interaction, `git add -f` and blob-hash verification, GNU tar 1.35, `#` in filenames, the Node 22 pin |
| SAFE-02 | Dummy env, prod-DB tripwire, net deny, notifier refusal; each RED-proven | §Pattern 1-4: verified setup-layer DB tripwire (native addon constructor patch), verified net deny on 10 transports, NODE_OPTIONS preload verified through `npx.cmd`→ts-node, Vite `.env` read + `envDir:false`, dotenv internals |
| SAFE-03 | Duplicate-load guards + `forceConsistentCasingInFileNames` | STL-4: worker-per-file fact, automock + importActual double-eval, `?query` classification, `realpathSync.native`; singleton line refs re-measured |
| SAFE-04 | Single-instance process lock | STL-5 + §Pattern 5: verified refuse, release after `taskkill /F`, exactly-one-winner with a correct harness, GC pitfall, in-process second handle refused |
| SAFE-05 | Newer-schema guard, repo-root anchoring, refuse-to-create | §Pattern 6: read-only probe semantics, read-only opens touching `-shm`, `fileMustExist`/readonly flags, `timeout` default 5000 |
| SAFE-06 | `vi.mock` specifier gate | §Pattern 7: 588 literal mock calls; bare specifiers in use (`ethers`, `@flashbots/ethers-provider-bundle`, `axios`, `dotenv`, `telegram`, `telegram/sessions`, `telegram/events`) |
| SAFE-07 | Baseline capture | §Baselines: `vitest list` runs globalSetup and setupFiles; per-project `--project` scoping; npm/node version capture; cache-dir exclusion |
| AUDIT-01 | Register + per-file ledger | §Audit slices: per-domain file lists with line counts at HEAD; ledger universe from `git ls-files` (825 tracked files) |
| AUDIT-03 | 20-class sweep, secret scan, signing census | §betterleaks procedure (933 commits on `--all`, 942 with `--reflog`, 5 stashes); ethers `wait()`/`getFeeData` facts; census method |
| AUDIT-04 | Thresholds inventory | §Audit: where the defaults live; `||`-default semantics; duplicated parsers |
| AUDIT-05 | Decision cards | No new tech; register/card tooling notes in §Architecture |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- There is no project `./CLAUDE.md` and no `.claude/skills/` or `.agents/skills/` (`.claude/` holds only `scratch/` and `worktrees/`). The user-global `~/.claude/CLAUDE.md` contains only the graphify skill trigger.
- Binding operator preferences from auto-memory, which the planner must honor:
  - **High-stakes ops.** Rehearse first, go step by step, verify each step, check addresses.
  - **Decision quality.** Choose the better or safer option. Never recommend "least code" as a virtue.
  - **Don't dismiss anomalies.** Diagnose any NOTOK or odd output before marking a step passed.
  - **Don't auto-defer confirmed findings.** Re-surface them (STL-1..6 above).
  - **No dry-run mode.** `npm run preflight` is the read-only cold-start check. Never boot `src/bot.ts`.
  - **Inline fixes.** Small, low-risk findings get an inline fix plus a commit. Note that Phase 22 forbids fixing audit findings, so this applies only to rail-implementation nits.
  - **Phase granularity.** Few large phases, with risk isolated at plan or commit level.
  - **Green suite misses money-path bugs.** Rely on real-path, RED-proven tests.
  - **Plain-language checkpoints.** Name every tool by what it does.
  - **GSD commit trailer.** Never amend GSD commits.

## Summary

The rails are buildable with installed tooling, and every mechanism was tested in a throwaway sandbox on this machine using the repo's own `node_modules` by absolute path. The DB tripwire can be enforced **without any env var**: the setup layer swaps the better-sqlite3 native addon's `Database` constructor (found through `require.cache`). That blocks a module-scope `src` import with `VITEST` deleted, and it blocks direct test-code opens of casing and `-wal` variants, while `:memory:`, temp-file and Buffer DBs keep working. A `net.Socket.prototype.connect` choke point denied **10 of 10** client paths before any DNS lookup, provided the pipe test copies Node's `!!options.path` (http agents pass `path: null`). Those paths were fetch over http and https, http.get, https.get, net.connect, net.createConnection, tls.connect, axios, ws over wss, and an ethers `JsonRpcProvider`. A `NODE_OPTIONS=--require` preload reaches the ts-node child through `npx.cmd` with `shell:true`, and also runs inside npm's own helper processes.

The SQLite exclusive lock is correct on Windows when the handle is pinned:
- a second acquire while the holder lives gets `SQLITE_BUSY`
- after `taskkill /F` of the holder, the next acquire succeeds
- 30 rounds of 6 simultaneous contenders produced **0 overlapping holds**
- an unpinned handle is silently released by GC (STL-5)

The D-12 forensic method needs the header-byte patch (STL-3). The whole phase must run on Node 22.16.0 (STL-1).

The audit wave has a clean universe: 825 tracked files and 63 `src/` files in six domain slices. Two ethers 6.16.0 facts settle two research candidates:
- `getFeeData()` sets `maxFeePerGas = baseFeePerGas*2 + priority`, so `maxFeePerGas - maxPriorityFeePerGas` is exactly **2x the latest block's base fee** (RC-22).
- `wait()` with no timeout waits forever and throws `TRANSACTION_REPLACED` even for `reason:"repriced"` (RC-10 and the E6 class).

The secret scan moves to **betterleaks v1.10.0**. It is an immutable GitHub release with a sigstore-signed checksum file, so `gh release verify-asset` (gh 2.103.2 is installed) gives a cryptographic provenance check. Its default ruleset has **no generic Ethereum-private-key rule**, so NAC-01 and AC-35 need a custom rule plus an exact-value check.

**Primary recommendation:**
1. Pin Node 22.16.0 for every Phase 22 command.
2. Build a single plain-CommonJS rails module, loaded both as Vitest `setupFiles` and as `NODE_OPTIONS --require`.
3. Pin the lock handle, and RED-test the GC case.
4. Patch the WAL header in memory for the forensic images.
5. Run betterleaks v1.10.0 with explicit `--log-opts`, adding `--reflog`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Backup + manifest + Drive verify | Operator tooling (`scripts/backup-state.ts`, ts-node on Node 22) | Human checkpoint (Drive web UI) | Raw-byte file ops; never SQLite; off-machine proof needs a human |
| Forensic DB report | Operator tooling (temp dirs, in-memory SQLite) | — | Works on copy W and in-memory images only |
| Test rails (env, DB, net, notifier) | Test-setup layer (`setupFiles` + `NODE_OPTIONS` preload) | `src/` VITEST-gated guards (db.ts, notifier.ts, dotenv sites) | D-01: both layers; the setup layer needs no env, `src/` guards cover any entry point |
| Duplicate-load guard | `src/` module scope (each guarded module + `guards/` registry on `globalThis`) | Test (AC-20/22) | Must run at module evaluation in prod |
| Process lock | `src/main.ts` boot entry (before any stateful import) | OS file-lock (SQLite VFS: LockFileEx/fcntl) | Lock must precede config/db/notifier side effects |
| DB version/path guards | `src/utils/db.ts` import-time (before pragmas) | `scripts/db-init.ts` (explicit creation) | Guard must precede `journal_mode` + `migrateSchema()` writes |
| `vi.mock` gate | CI script (TS compiler API) | `.github/workflows/test.yml` step | Static analysis; no test execution |
| Baselines | Operator tooling + isolated export | — | Must never run Vitest in the main checkout pre-rail |
| Audit register/ledger/sweep | `.planning/audit/` data files + render/check tools | Claude agents, plus codex/agy run in an isolated export | AC-33: audit commits touch only `.planning/` |
| Secret scan | betterleaks binary outside the repo | `gh release verify-asset` | Tool and report live outside the repo; register stores metadata only |

## Standard Stack

### Core (all already installed; no dependency changes this phase)
| Tool | Version (verified) | Purpose | Why |
|------|-------------------|---------|-----|
| Node.js | **22.16.0** at `C:\Users\jackc\AppData\Local\nvm\v22.16.0\node.exe` | Runtime for everything that loads better-sqlite3 | ABI 127 matches the installed binary; CI uses 22 (STL-1) |
| vitest | 4.1.1 (`@vitest/runner` 4.1.1, vite 8.0.2) | Test runner, rails host | Installed |
| better-sqlite3 | 12.8.0, bundled SQLite **3.51.3** (`deps/sqlite3/sqlite3.h:149`) | Lock primitive, forensic images, version probe, db:init | Installed. `readonly`/`fileMustExist`/`timeout`/Buffer-construct/`serialize()` all present (`lib/database.js:16-69`, `lib/methods/serialize.js`) |
| typescript | 5.8.3 | AST for the `vi.mock` gate, signing census, `it`/`test` counts | Installed |
| ts-node | 10.9.2 | Runs `scripts/*.ts` | Installed |
| dotenv | 17.2.0 | Existing env loading; rails must account for its behavior | `configDotenv` resolves `path.resolve(process.cwd(), '.env')` (`lib/main.js:245`), swallows read errors (`:278-288`), and **logs `injecting env (N) from …` unless quiet** (`:297-310`) |
| ethers | 6.16.0 | Audit subject | Semantics below |
| GNU tar | 1.35 (Git Bash) | Backup archive | Installed (also bsdtar 3.8.9 as `C:\Windows\System32\tar.exe`) |
| sha256sum | GNU coreutils 8.32 | `SHA256SUMS -c` | Installed |
| gh | 2.103.2 | `gh release download` + `gh release verify-asset` for betterleaks | Installed at `C:\Program Files\GitHub CLI\gh` |

### Secret scanner (user directive: betterleaks)
| Item | Value | Source |
|------|-------|--------|
| Repo | `github.com/betterleaks/betterleaks`, MIT, org-owned, created 2026-02-03. Top contributor `zricethezav` (the gitleaks author), 276 commits. The old `AikidoSec/betterleaks` URL now returns 404. | [VERIFIED: GitHub API] |
| Version to pin | **v1.10.0** (stable, 2026-11-04T20:33:19Z, `immutable: true`). The `main` branch is v2 RC (`v2.0.0-rc.7`). **Do not use the RC.** | [VERIFIED: GitHub API] |
| Asset | `betterleaks_1.10.0_windows_x64.zip`, 10,559,121 B, sha256 `bafd52abcb440c2a06ea36d5e1fff217315db0aac517e60d74e64b2bb9f18468` (equal in `checksums.txt` and in the API asset digest) | [VERIFIED: checksums.txt + API] |
| Signature | `checksums.txt.sigstore.json`: sigstore bundle v0.3. Cert SAN `https://github.com/betterleaks/betterleaks/.github/workflows/release.yml@refs/tags/v1.10.0`, issuer `sigstore-intermediate` | [VERIFIED: parsed cert] |
| v1 CLI | `git` and `dir` subcommands; `--log-opts`; `--redact`; `--report-format json` with `--report-path`; `--max-archive-depth`; `-v` means verbose. Live credential validation is opt-in via `--validation`. | [CITED: raw.githubusercontent.com/betterleaks/betterleaks/v1.x/docs/scanning.md] |
| Default `git` scope | `--full-history --all --diff-filter=tuxdb`. **A custom `--log-opts` replaces it entirely.** Merge patches are skipped unless you pass `--diff-merges=first-parent`. A custom `--log-opts` forces a single history worker. | [CITED: same doc §git] |
| Safety default | Since v1.10.0, local git scans isolate repo config (`.git/config` hooks and textconv are not run) unless `--trust-local-git-config`. A repo `.betterleaks.toml`/`.gitleaks.toml` loads only with `--unsafe-auto-load-config`. | [CITED: v1.10.0 release notes] |
| Rule gap | The default v1 config has `private-key` (PEM), `telegram-bot-api-token`, `generic-api-key`, and an ETH-hex rule only for Polymarket (`keywords = ["poly"]`). It has **no generic EVM private-key rule** and no gramjs `StringSession` rule. | [VERIFIED: config/betterleaks.toml@v1.x lines 3558, 8613, 8729, 10126] |

**Alternatives considered:** gitleaks v8.30.1 (2026-03-21, asset `gitleaks_8.30.1_windows_x64.zip`, sha256 `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`) is superseded by the user directive. Docker was declined by the operator under D-17.

**Installation:** none. **No `npm install`, `npm ci`, or `npm rebuild` in this phase.**

## Package Legitimacy Audit

No npm, PyPI or crates packages are installed this phase, so the package-legitimacy seam does not apply. The one external artifact is a binary:

| Artifact | Registry | Age | Signals | Source Repo | Verdict | Disposition |
|----------|----------|-----|---------|-------------|---------|-------------|
| betterleaks v1.10.0 windows_x64 zip | GitHub Releases | repo 9 months; tag 2 days | Immutable release, sigstore-signed checksums from the repo's own release workflow, 2,826 stars, gitleaks author is top contributor | github.com/betterleaks/betterleaks | OK, conditional on verification | Approved. **Planner adds `checkpoint:human-verify`** before first execution: the operator confirms the download and the `gh release verify-asset` plus hash results in plain words |

**Packages removed:** none. **Packages flagged SUS:** none. The tag is 2 days old, so a fixed pinned hash is mandatory.

## Architecture Patterns

### System Architecture Diagram

```
WAVE 1 (bot OFF, Node 22.16.0 pinned)
  live files (raw bytes only) ──► backup-state.ts ──► staging dir ──► hash-before == hash-after? ──no──► FAIL (torn)
       data/{bot.db,-wal,-shm,logs}       │                │yes
       ignition/deployments/**            │                ▼
                                          │       MANIFEST.json + SHA256SUMS ──verify──► dated dir (outside repo)
                                          │                                                  │
                                          └─► tar.gz + archive sha ──► [HUMAN] Drive upload ─► download-back ─► verify(downloaded) ─► SAFE-01 VALID
  SAFE-01 VALID ─► git add -f ignition/deployments ─► OD-21 commit ─► blob-hash == manifest (AC-07)
  SAFE-01 VALID ─► forensic: E(copy, hashed, never opened) ─► W(throwaway) ─open/recover─► serialize ─► patch hdr 18-19 ─► mem image A (20:25)
                                                         E/bot.db bytes ─► patch hdr ─────────────────────────────► mem image B (17:33)
                                                         A vs B row diff + test/ literal xref ─► report ─► register + D-16 escalation
WAVE 2 (rails)                                    WAVE 3 (audit, read-only, may start after SAFE-01 VALID)
  vitest main ─(envDir:false, no dotenv)─► worker per file                       slices ──► Claude agents ──► .planning/audit/findings/*.json
      worker: setupFiles rails.cjs ─► scrub env + load test/.env.test                       └─► isolated export ─► codex / agy (code only) ─► normalized union
              ├─ fs read <repo>/.env → blocked+ledger                                   betterleaks (outside repo) ─► JSON (redacted) ─► metadata-only register rows
              ├─ addon.Database wrapper → throw on <repo>/data/**                       render/check tools ─► AUDIT-FINDINGS.md / OPERATOR-DECISIONS.md / ledger / matrix
              ├─ Socket.prototype.connect → non-loopback → async E_RAIL_NET_DENIED      S0/rail/secret/test-row ─► immediate checkpoint; S1 ─► per-area checkpoint
              └─ ledger file per pid
      test spawns ─► spawnRailedChild(NODE_OPTIONS=--require rails.cjs, scrubbed env) ─► same rails in child
  src/: db.ts (VITEST tripwire + version probe + anchoring + refuse-create), notifier.ts (VITEST refusal), main.ts (lock → require('./bot'))
```

### Recommended Project Structure (new files)
```
src/main.ts                      # entry: env → wallet addr → acquire lock (pinned) → require('./bot').startMultiChainBot()
src/guards/epoch.ts              # tiny epoch module (object identity per module-graph evaluation)
src/guards/singleton.ts          # registerSingleton(canonicalKey, rawIdentity, epoch) on globalThis[Symbol.for(...)]
src/utils/processLock.ts         # acquire/tryAcquireThenRelease; lockDir is a PARAMETER (tests pass temp dir; main passes fixed path)
src/utils/repoRoot.ts            # walk up to package.json name==="crypto-snipe-bot"
test/rails/rails.cjs             # ONE plain-CommonJS module: env scrub+load, .env block, DB wrapper, net deny, ledger
test/rails/spawnRailedChild.ts   # the only sanctioned spawner
test/.env.test                   # inert sentinels, key set == .env.example
scripts/backup-state.ts  scripts/forensic-db.ts  scripts/db-init.ts  scripts/capture-baselines.ts  scripts/check-vi-mock-paths.ts
.planning/audit/{findings/,ledger/,sweep/,thresholds/,decisions/,tools/}
```

### Pattern 1: One rails module, loaded both ways (D-01/D-03)
**What:** `test/rails/rails.cjs` is plain CommonJS. That lets Node `--require` it, and Vitest loads `.cjs` setupFiles fine; this was verified with `setupFiles: ['./test/rails.cjs']`. It is idempotent through a `Symbol.for` flag on `globalThis`, and it does not depend on `process.env.VITEST`.
**Key verified facts:**
- `setupFiles` run in each worker before the test file is imported. Each file gets its own process (STL-4), so rails install once per file process.
- Vitest sets `process.env.VITEST = "true"` in the main process (`cli-api.BUXBO6jS.js:14520`), and forked workers inherit it. Child processes inherit it only if `spawnRailedChild` sets it.
- Vitest replaces `process.exit` in workers with a throw (`base.C9_VThnT.js:108`).

### Pattern 2: Setup-layer DB tripwire through the native addon (verified, env-independent)
better-sqlite3's constructor calls `new addon.Database(filename, …)` (`lib/database.js:69`). It resolves `addon` from its module-level `DEFAULT_ADDON`, which `bindings` loads, and the property is looked up at call time. The steps:
1. Construct one `:memory:` DB so the addon loads.
2. Find the `better_sqlite3.node` entry in `require.cache`.
3. Wrap its `Database` constructor.

An ESM-namespace swap through `require.cache[id].exports` does **not** work. I verified that it failed: the vite runner's externalized import kept the original. Calling `bindings` from the rails file also fails, because it resolves the module root from the caller's location. Verified results with `VITEST` deleted:
- `import('../src/db')`, which opens `data/bot.db` at module scope, rejects with `RAIL_DB_TRIPWIRE`.
- `new Database('DATA/BOT.DB')` and `'data/bot.db-wal'` throw.
- `:memory:`, temp-file, `serialize()` and Buffer DBs work.
- `data/` stayed empty.

Use canonical matching: resolve the *parent directory* with `fs.realpathSync.native`, because the file itself may not exist yet and `realpathSync.native` would then throw `ENOENT` (verified). Compare case-insensitively on win32.

### Pattern 3: Network deny at `net.Socket.prototype.connect` (verified on Node 22 and 24)
It denies before DNS. The pipe test **must** be `if (options.path)`, which is truthy, mirroring Node. http agents pass `path: null`, and treating `path !== undefined` as IPC let `http.get`, axios and ethers through to the real network in my first attempt. With the fix, all 10 transports produced `E_RAIL_NET_DENIED`, the only DNS lookups were `127.0.0.1` and `localhost`, and the loopback fetch and http.get succeeded. Normalize the arguments `[options, cb]` (array form from `net.connect`), `(port, host)`, and `(path)`. Destroy asynchronously with `process.nextTick(() => this.destroy(err))` and `return this`. Also deny non-loopback `dns.lookup`, `dns.promises.lookup` and `dns.resolve*`. **Not covered:** `worker_threads` realms (none in `src/`; pino has no transport configured) and UDP.

### Pattern 4: `spawnRailedChild` on Windows (verified)
- `NODE_OPTIONS="--require <path>"` through `spawnSync('npx.cmd', ['--no','ts-node',…], {shell:true})` loads the preload in **3 processes**: `npm-prefix.js`, `npx-cli.js` (the global npm 11.17.0) and `ts-node/dist/bin.js`. The target saw the rails installed. So the rails must be harmless inside npm itself. With `--no`, npx never contacts the registry.
- **Quoting.** An unquoted path containing a space is split. A double-quoted path with single backslashes is mangled, because NODE_OPTIONS treats `\` as an escape inside quotes. **Build it as `--require ${JSON.stringify(absPath)}` or use forward slashes inside quotes**; both verified.
- **Scrubbed env must keep Windows essentials.** Keep `SystemRoot`, `ComSpec`, `PATHEXT` and `PATH` (with the Node 22 dir first), plus `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `TEMP` and `TMP`. Without `PATHEXT` and `ComSpec`, cmd.exe reported `'npx.cmd' is not recognized`.
- Use `npx --no` in test spawns, so a missing local bin can never trigger a download.

### Pattern 5: Process lock (D-06), verified on Windows
```js
// Source: sandbox experiment (lock2/lock3/gcA), better-sqlite3 12.8.0 on Node 22.16.0
const db = new Database(lockFile, { timeout: 0 });     // better-sqlite3 default timeout is 5000 (lib/database.js:34)
db.pragma('locking_mode = EXCLUSIVE');
db.exec('BEGIN EXCLUSIVE');                             // SQLITE_BUSY immediately if held elsewhere
db.exec('CREATE TABLE IF NOT EXISTS holder (pid INTEGER, ts INTEGER)');
db.prepare('INSERT INTO holder VALUES (?, ?)').run(process.pid, Date.now());
db.exec('COMMIT');                                      // exclusive locking mode keeps the OS lock after COMMIT
globalThis[Symbol.for('crypto-snipe-bot.processLock')] = db;   // MANDATORY pin (STL-5)
```
**Verified behaviors:**
- Both "hold the transaction" and "commit" variants refuse a second process (`SQLITE_BUSY database is locked`) and release after `taskkill /F`; the next acquire succeeds with no cleanup.
- 30 rounds of 6 simultaneous contenders gave 0 overlapping holds.
- A second handle in the **same** process is refused, and so is a plain read.
- `fs.readFileSync` of the held lock file succeeds (8192 bytes).
- A leftover `-journal` file persists. That is harmless and recovers automatically.

**Linux (CI ubuntu):** POSIX `fcntl` locks are process-scoped, and **any** `close()` of *any* descriptor for that file in the same process drops them. Nothing else in the bot process may open the lock file: no status probe, hash, or fs read. [CITED: https://www.sqlite.org/howtocorrupt.html §2.2] On Windows LockFileEx is per-handle, so this does not apply. The AC-23 tests run in CI on ubuntu and are the proof.

### Pattern 6: DB version probe and refuse-to-create (SAFE-05)
1. Resolve the path, anchored to the repo root.
2. Outside Vitest, if the file is missing or 0 bytes, refuse with the absolute path.
3. Run `new Database(p, { readonly: true, fileMustExist: true })`, then read `pragma('user_version', {simple:true})`, then close.
4. Refuse if the version is `0` or `> CURRENT_SCHEMA_VERSION`.
5. Only then open read-write and set `journal_mode`.

Reading `user_version` through SQLite, not the raw header bytes at offset 60, is required: in WAL mode the newest page 1 can live in the `-wal` (fixture: main header 0, WAL 7). Expect that a read-only open of a WAL DB may create or modify `-shm`. The main-file hash stays unchanged, which satisfies AC-24's "refused file SHA-256 unchanged" when measured on `bot.db`. Use a rollback-journal fixture for AC-24 to keep it simple.

### Pattern 7: `vi.mock` gate (SAFE-06)
- **Inventory.** 588 literal `vi.(mock|doMock|unmock|doUnmock)` specifiers. 55 files mock `utils/db`. Bare specifiers in use are `ethers` (42), `@flashbots/ethers-provider-bundle` (14), `axios` (7), `dotenv` (2) and `telegram`, `telegram/sessions`, `telegram/events` (1 each). [VERIFIED: git grep]
- **Resolution.** Resolve a bare specifier with `createRequire(testFile).resolve()`, falling back to an ESM `import.meta.resolve`-style check for packages whose `exports` only define `import`.
- **Relative specifiers.** Try exact, `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, then `/index.ts`.
- **Hoisting.** Mocks are hoisted, so resolve relative to the file that contains the call, which can be a helper.

### Anti-Patterns to Avoid
- **Running any Vitest command in the main checkout before the rails land.** STL-2 shows it already happened once today.
- **Running `vitest list` without `--project`.** It runs **every** project's globalSetup, and fork's spawns `npx hardhat compile` and `hardhat node --fork`. Verified: `list --project unit` did not run the other project's globalSetup, while plain `list` did.
- **An env var for the lock directory.** A different directory is a different lock, which means two bots. Pass the directory as a function parameter, used by tests only (NAC-05).
- **Static imports in `src/main.ts`.** TypeScript compiles `import` to top-of-file `require`, which runs before the lock. Use `require('./bot')` after acquiring.
- **RED-proving a rail against the real `data/` or the real network.** Use a temp fake repo root, meaning a folder with `package.json` named `crypto-snipe-bot`, and the unroutable `192.0.2.1`.
- **Counting `ACQUIRED` lines to prove "exactly one winner".** Slow process start on Windows makes sequential winners look parallel. Use a barrier and check that hold intervals overlap.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform single-instance lock | PID files, `mkdir` locks, port binding | SQLite `locking_mode=EXCLUSIVE` (installed) | Released by the OS on death; atomic; verified |
| WAL merge for forensics | Parsing `-wal` frames manually | Open a throwaway copy, then `serialize()`, then patch the header | SQLite's own recovery and checksum logic |
| Secret detection | Ad-hoc regex over history | betterleaks plus a custom EVM-key rule plus an exact-value check | Entropy filters, history walking, redaction |
| Mock-path resolution | Regex | TypeScript compiler API + Node resolution | Templates, comments, hoisting |
| Archive integrity | Custom hashing | `sha256sum -c SHA256SUMS` + MANIFEST.json | Operator-verifiable with standard tools |
| Release provenance | Trusting the download | `gh release verify-asset v1.10.0 <zip> -R betterleaks/betterleaks` + the pinned sha256 | Immutable-release attestation |

## Runtime State Inventory

SAFE-01, OD-21 and the `src/bot.ts` → `src/main.ts` entry change make this a state-touching phase.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `data/bot.db` 57,344 B (2026-05-29 17:33), `bot.db-wal` 164,832 B and `bot.db-shm` 32,768 B (20:25), plus 3 capture logs (35,995 / 10,236 / 109,395 B). Repo-root `.bot-state.json.bak` 89 B (2026-03-22) is evidence that `migrateJsonState` ran with cwd = repo root. | Backup raw bytes only; forensic copy only; NAC-03. Include `.bot-state.json.bak` in the backup set (recommended) |
| Live service config | Google Drive is the off-machine copy, uploaded by hand. Telegram is outbound only. Nothing in git. | Human checkpoint (D-10) |
| OS-registered state | New: `%LOCALAPPDATA%\crypto-snipe-bot\locks\<addr>.lock` (+ `-journal`), created by `main.ts`. None exists today. nvm-windows global symlink `C:\nvm4w\nodejs` → v24.18.0. | Document the lock path; operator decides on `nvm use 22.16.0` (STL-1) |
| Secrets/env vars | `.env` is unchanged. **Used but missing from `.env.example`:** `ETH_FORK_RPC_URL` (planned), `STOP_LOSS_PERCENT` (set only by `test/fork/realLaunchReplay.fork.test.ts:75` and read nowhere in `src/`, a hollow-config test finding) and `MEV_STRATEGY` (named only in `src/preflight.ts:715-716` comments and a test). Many keys are built dynamically, e.g. `` process.env[`${template.envPrefix}_SNIPE_AMOUNT`] `` at `src/chainRegistry.ts:663-674`, so the D-02 scrub needs prefix patterns (`ETH_|BSC_|BASE_|ARB_` × suffixes) plus `DOTENV_*`, not only a static key list. | D-02 scrub list = `.env.example` keys ∪ static `process.env.X` keys ∪ chain-prefix patterns ∪ `DOTENV_*`/`DOTENV_KEY` |
| Build artifacts | `node_modules/.vite/vitest/<hash>/results.json` (written today, STL-2); `artifacts/`, `cache/`, `typechain-types/` from 2026-05; `coverage/` from 2026-03. The start command changes to `src/main.ts`. | Exclude the `.vite*` folders from the NAC-08 tree hash with a documented reason. Update STATE.md and README for the start command |

**Ignition specifics (OD-21):** there are 10 files on disk. 4 are tracked (`build-info/*.json` and `deployed_addresses.json` for each chain), and 6 are ignored: `journal.jsonl` ×2 through `ignition/.gitignore:1` `deployments/*/journal.jsonl`, and `artifacts/*.json` ×4 through the root `.gitignore:36` `artifacts/`. **All 10 files are pure LF (0 CR bytes)**, and the tracked ones show `i/lf w/lf`. `core.autocrlf=true` (system and user). Two file names contain `#` (`HoneypotCheckerModule#HoneypotChecker.json`), so quote them in shell. [VERIFIED]
- **Recommendation.** Make the OD-21 commit with `git add -f ignition/deployments`, so it touches only that tree (NAC-02). Verify AC-07 against **blob** bytes (`git cat-file -p HEAD:<path> | sha256sum`), not the working tree.
- Put scoped un-ignore rules in a separate follow-up commit: `!ignition/deployments/*/artifacts/` in the root `.gitignore`, and remove or negate the journal rule. Add `ignition/deployments/** -text` in `.gitattributes`, so a future checkout with `autocrlf=true` cannot write CRLF copies whose bytes differ from the manifest. Verify with `git check-ignore -v`.

## Common Pitfalls

### Pitfall 1: Running anything on Node 24 (STL-1)
**What goes wrong:** Every better-sqlite3 path crashes, and test collection silently drops files. **How to avoid:** Pin Node 22.16.0 and assert ABI 127 in every script. **Warning sign:** `ERR_DLOPEN_FAILED`, or files with duration 0 in `results.json`.

### Pitfall 2: Unpinned lock handle (STL-5)
**What goes wrong:** Two bots end up trading one wallet. **How to avoid:** Keep a strong `globalThis` reference, and add a `--expose-gc` RED test.

### Pitfall 3: `http` agents pass `path: null`
**What goes wrong:** The network deny is bypassed for http, https, axios and ethers. **How to avoid:** Test `!!options.path`. Each transport gets its own AC-15 assertion.

### Pitfall 4: The dotenv log line and swallowed reads
**What goes wrong:** dotenv prints `[dotenv@17.2.0] injecting env (N) from .env` (`main.js:297-310`). A blocked read is silent, so a test cannot see it. **How to avoid:** Record blocked reads in the rails ledger, which is what D-02 requires. Assert on the ledger, not on dotenv output.

### Pitfall 5: The notifier "skipped" path is not uniform
**What goes wrong:** `sendTelegramAlert` returns early on missing credentials and **skips** the dashboard `broadcast` (`src/utils/notifier.ts:37-41`). `sendCtxAlert` still broadcasts (`:73-97`). With the sentinel token set, real prod behavior is "post fails, then warn, then broadcast". If the refusal reuses the early-return path, `sendTelegramAlert` stops broadcasting under test, which changes control flow. **Recommendation:** Refuse at the `axios.post` call (`:44` and `:80`) through the existing catch-and-warn path, so the broadcast is preserved, and add a ledger entry. This refines D-04's wording without contradicting its intent (no throw, no control-flow change). The planner should confirm it with the operator. Today every test that calls a notifier function mocks it (verified), so the risk is in indirect callers.

### Pitfall 6: `vitest list` side effects
It runs globalSetup and setupFiles and imports every collected test file at module scope (verified). Use `--project unit --project integration` only, inside the isolated export, on Node 22. Get the fork count statically.

### Pitfall 7: Existing CLI tests depend on the real env
`preflightCli` Test 1 is literally "run against current `.env`" (`test/integration/preflightCli.test.ts:52-57`). It spawns `npx ts-node scripts/preflight.ts` with `{ ...process.env }`, which means real mainnet RPC calls and a live DB open and migrate through `src/preflight.ts:49`. After the rails it runs against sentinels. That needs a small edit, not a deletion (NAC-04), plus a register entry as a test-quality finding. `pauseCli` Test 4 builds its env with `{ ...process.env }` (`:282`), which must move to `spawnRailedChild`.

### Pitfall 8: Secret scanners miss raw EVM keys
The default rules have no generic hex-key rule (see Standard Stack). Add a `--config` that extends the defaults with an `evm-private-key` rule anchored on keywords (`private.?key|signer|wallet|mnemonic|pk`), and skip a bare-64-hex rule, which would flood the results with tx hashes. Add an exact-value check for NAC-01 (open question Q2).

## Code Examples

### Forensic in-memory image (verified)
```js
// Source: sandbox forensic2.js — better-sqlite3 12.8.0 / SQLite 3.51.3
const toRollbackHeader = (b) => { const c = Buffer.from(b); if (c[18] === 2 && c[19] === 2) { c[18] = 1; c[19] = 1; } return c; };
// A (merged 20:25): open THROWAWAY copy W (with -wal/-shm) read-write → recovery → serialize → patch → readonly memory DB
const w = new Database(path.join(W, 'bot.db')); const merged = w.serialize(); w.close();   // W's -wal is checkpointed+deleted; W is disposable
const imgA = new Database(toRollbackHeader(merged), { readonly: true });
// B (17:33 last checkpoint): never open a file — bytes → patch → memory
const imgB = new Database(toRollbackHeader(fs.readFileSync(path.join(E, 'bot.db'))), { readonly: true });
```

### betterleaks procedure (D-17 as amended)
```bash
# Outside the repo, e.g. C:\Users\jackc\tools\betterleaks-1.10.0\  (never committed)
gh release download v1.10.0 -R betterleaks/betterleaks -p 'betterleaks_1.10.0_windows_x64.zip' -p checksums.txt -p checksums.txt.sigstore.json -D "$TOOLS"
gh release verify-asset v1.10.0 "$TOOLS/betterleaks_1.10.0_windows_x64.zip" -R betterleaks/betterleaks   # immutable-release attestation
(cd "$TOOLS" && grep ' betterleaks_1.10.0_windows_x64.zip$' checksums.txt | sha256sum -c -)            # expect bafd52ab…8468
# Full history: custom --log-opts REPLACES the default, so restate it; add merges + reflog (stashes/older amends)
HTTPS_PROXY=http://127.0.0.1:1 HTTP_PROXY=http://127.0.0.1:1 \
"$TOOLS/betterleaks.exe" git C:/Users/jackc/WebstormProjects/crypto-snipe-bot \
  --log-opts="--full-history --all --reflog --diff-filter=tuxdb --diff-merges=first-parent" \
  --redact --no-banner --config "$TOOLS/betterleaks-extended.toml" \
  --report-format json --report-path "$OUT/history-scan.json"
# Backup copies (NAC-01): extracted dated folder + the downloaded archive
"$TOOLS/betterleaks.exe" dir "<backup-dated-dir>" --max-archive-depth 2 --redact --report-format json --report-path "$OUT/backup-scan.json"
```
Repo facts: `git rev-list --all --count` = **933**. Adding `--reflog` gives **942**, which includes older stash entries: there are 5 stashes and `--all` reaches only `refs/stash`'s tip. Refs: 2 heads, 2 tags, 1 `refs/backup`, 3 remote refs. [VERIFIED] The proxy variables are a defense-in-depth assumption, since validation is already opt-in (A1). Do not pass `--validation`, and do not pass `--trust-local-git-config`.

### codex / agy isolation (D-14)
Both are agents that can read files and run shell commands. **Never start them with cwd = repo.**
1. `git archive HEAD -- <slice files>` into an export folder outside the repo, containing tracked source only.
2. Run `codex exec -C <export> --sandbox read-only --skip-git-repo-check --ephemeral -m gpt-6.1-sol -c model_reasoning_effort="xhigh" --output-schema <schema.json> -o <out.json> "<prompt>"` (flags from `codex exec --help`, codex-cli 0.163.0).
3. Run `agy --print "<prompt>" --model gemini-4-argon-high --output-format json --sandbox --json-schema <schema>` with cwd = export (flags from `agy --help`).
4. Print the send list for the operator and get approval before running either, because the send is one-way.

Model IDs come from `.planning/config.json` and were not validated (A6).

## State of the Art / Library Semantics (for the audit wave)

**ethers 6.16.0 `getFeeData()`** (`node_modules/ethers/lib.commonjs/providers/abstract-provider.js:597-637`):
```js
maxPriorityFeePerGas = (priorityFee != null) ? priorityFee : BigInt("1000000000");
maxFeePerGas = (block.baseFeePerGas * BN_2) + maxPriorityFeePerGas;
```
- `priorityFee` comes from `eth_maxPriorityFeePerGas`, falling back to 1 gwei on error. The block is `latest`.
- So `maxFeePerGas - maxPriorityFeePerGas === 2 × latest.baseFeePerGas` exactly. It is not next-block base fee, which can be up to +12.5%. **Settles the fact behind RC-22.**
- Sites: `src/utils/mevStrategies/flashbots.ts:167-172`, `src/utils/mevStrategies/passthrough.ts:63-66`, `src/preflight.ts:318-323` (`deriveFeeWei`), and the docstrings at `reconciliation.ts:234,255`. Effect direction: the affordability/ceiling inputs over-reserve. Whether that only refuses buys (safe) or can also clamp or refuse **exits** (STRAND) is the audit question.

**ethers 6.16.0 `TransactionResponse.wait()`** (`providers/provider.js:1043-1210`):
- confirms default 1; timeout default **0, meaning no timer** (`:1045`).
- A status-0 receipt **throws** `CALL_EXCEPTION` (`:1138`).
- `wait(0)` returns the receipt or `null` (`:1149`).
- Replacement detection runs only when `startBlock >= 0`, i.e. responses from `broadcastTransaction`/`sendTransaction` (`abstract-provider.js:757`, `provider-jsonrpc.js:145`). Responses from `getTransaction()` have `#startBlock = -1` (`:963`), so no detection.
- On replacement it **throws** `TRANSACTION_REPLACED` with `reason` `"repriced"` (same data/to/value), `"cancelled"` (0-value self-send) or `"replaced"`; `cancelled` is false only for repriced (`:1116-1127`). **Repriced still throws.** The caller must use `err.receipt` and check `err.receipt.status` itself, because `checkReceipt` is not applied on this path.
- A timeout (when given) throws `TIMEOUT` (`:1175`). Settles RC-10 (STL-6) and the E6 class.

**Other HEAD re-measurements:**
- `src/telegramListener.ts:77-80` is the `senderAllowed`/`channelAllowed` OR (RC-9; research said 74-79).
- `src/riskManager.ts:28-32` has the `parseInt(process.env.X || '10', 10)` defaults (RC-6). Note `||`: `''` falls back to the default; a non-numeric value gives `NaN`.
- `src/exitEngine.ts:363` encodes `swapExactTokensForETH` and `:395` sets `amountOutMinimum: 0n` (RC-3).
- `startExitMonitor` is at `src/exitEngine.ts:1857` (RC-7).
- `src/utils/tokenSafety.ts:269,277` is `simulateSell`, with a real `erc20.approve(CONFIG.routerAddress, balance)` (RC-16).
- There is no `unhandledRejection`/`uncaughtException` handler anywhere in `src/` (RC-5; `git grep` empty).

### Singleton line refs at HEAD (verbatim)
- `src/utils/nonceAuthority.ts:43`: `const chains = new Map<string, Promise<unknown>>();`. `withNonceLock` is at `:60`, and `_resetNonceChainsForTesting` at `:82`.
- `src/utils/exitManager.ts:14`: `const sellingTokens = new Map<string, boolean>();`. `:53`: `const queuedPositions = new Map<string, boolean>();`. `:104`: `const timerRegistry = new Map<string, TokenTimers>();`. `_resetSellLocksForTesting` is at `:86`.
- `src/exitEngine.ts:1284`: `class ExitWorker {`. `:1421`: `const exitWorker = new ExitWorker();`. Also `:644`: `const routinePausedPositions = new Set<string>();`.
- `src/anti-rug/detector.ts:192`: `const positionRegistry = new Map<`. `:197`: `const chainState = new Map<string, ChainAntiRugState>();`. `:247`: `const pendingV3Burn = new Map<string, PendingV3Burn>();`. `_resetRegistryForTesting` is at `:301`.
- These match the research refs at `c110201`, apart from the `utils/` path. [VERIFIED: Read]

### Import-time side effects (`src/utils/db.ts`, verbatim)
- `:9` `const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'bot.db');`
- `:13-15` `mkdirSync(dbDir, { recursive: true })`
- `:17` `const db = new Database(DB_PATH);`
- `:20` `db.pragma('journal_mode = WAL');`, `:22` `synchronous = NORMAL`, `:24` `busy_timeout = 5000`
- `:27` `const CURRENT_SCHEMA_VERSION = 7;`
- `:232` `` db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`); ``
- `:235` `migrateSchema();`
- `:241-286` `migrateJsonState()`: reads `cwd/.bot-state.json` and renames it to `.bak`
- `:315-316` `migrateJsonState(); normalizeLegacyMainnetRows();`
- `:738-740` `forceWalCheckpoint()`: `wal_checkpoint(FULL)`, used by pause/resume
- `db.ts` imports only `./logger` (pino, no dotenv), so the guard can run before line 17.

### `dotenv.config()` call sites (verbatim lines)
- `src/config.ts:4`, `src/utils/notifier.ts:6`, `hardhat.config.ts:9`, and `vitest.config.ts:2-4` (`import { config } from 'dotenv'; … config();`).
- Scripts: `scripts/{addLiquidity:11, capture-launch:68, deliberate-buy:43, deploy-honeypot-checker:38, deploySepoliaTest:12, pause:32, preflight:26, recover-sell-ladys:18, resume:29, telegram-login:21}.ts`.
- `scripts/audit-honeypot-checker.ts:11` uses `import 'dotenv/config'`, which also honors `DOTENV_CONFIG_PATH`.

## Audit Slices (file lists at HEAD; lines from `wc -l`)

`git ls-files` gives 825 tracked files. `src/` has 63 files and 17,917 lines.
- **BUY/detection:**
  - `src/bot.ts` (2361; also holds boot, listeners and shutdown, which the EXIT, ANTIRUG and TX slices cross-read by function name)
  - `src/telegramListener.ts` 136, `src/alphaDrop.ts` 59, `src/utils/tokenSafety.ts` 527
  - `src/utils/honeypot/*` (abi 23, bytecodeScan 113, checkerContract 439, index 90, sanitize 58, simulator 26, types 76)
  - `src/utils/safetyProviders/*` (goplus 75, honeypotIs 35, mudra 39, types 15, unicrypt 52)
  - `src/utils/{pairDiscovery 19, blocklist 8, abis 82}.ts`
- **EXIT:** `src/exitEngine.ts` 2045, `src/utils/exitManager.ts` 226, `src/utils/exitWatchdog.ts` 89, `src/utils/withTimeout.ts` 56.
- **ANTIRUG:** `src/anti-rug/{allowlist 164, circuitBreaker 232, detector 2295, events 110, exitTrigger 322, lpBaseline 242, raceTelemetry 251, types 227}.ts`.
- **TX (nonce/MEV/tx):** `src/utils/{nonceAuthority 84, txManager 320, gasManager 48, provider 60, retry 25, receiptDecoder 111}.ts`, `src/utils/mevStrategies/{bloxroute 209, flashbots 392, passthrough 167, reconciliation 701, types 65}.ts`.
- **DB/RISK/CONFIG:** `src/utils/db.ts` 773, `src/riskManager.ts` 181, `src/config.ts` 309, `src/chainRegistry.ts` 1089, `src/preflight.ts` 1011, `src/utils/logger.ts` 10, `src/utils/notifier.ts` 98.
- **API:** `src/api/server.ts` 224, `middleware/{auth 110, errorHandler 41}`, `routes/{antiRug 99, auth 15, chains 227, controls 320, health 95, positions 31, risk 118, trades 200}`, `helpers/positions 175`, `ws/{broadcaster 50, handler 67}`.
- **dashboard:** 45 tracked files: 26 components, 5 pages, 3 hooks, plus `vite.config.ts`, `tsconfig.json`, `package.json` and its lockfile.
- **test:** 146 files: 84 unit, 27 integration and 9 fork `.test.ts` files, plus fixtures and helpers.
- **scripts:** 13 files, 1,768 lines. The signing scripts are `deliberate-buy.ts`, `recover-sell-ladys.ts`, `addLiquidity.ts` and `deploySepoliaTest.ts`.
- **contracts tooling:** `hardhat.config.ts`, `contracts/FakeToken.sol`, `contracts/honeypot/HoneypotChecker.sol` (ledger only), `ignition/modules/HoneypotChecker.ts`, `.github/workflows/test.yml` (jobs `test`, `detect-contract-changes`, hardhat-compile/slither/mythril), `scripts/{deploy-honeypot-checker, audit-honeypot-checker, check-mythril-report}.ts`.
- **root configs (ledger):** `vitest.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `tsconfig.bot.json`, `package.json`, `package-lock.json`, `.gitignore`, `.gitattributes`, `.npmrc`, `.graphifyignore`, `.env.example`, `README.md`. A tracked **`.DS_Store`** sits at the root; it is a hygiene finding.
- **Casing flag:** `forceConsistentCasingInFileNames` appears only at `tsconfig.json:9`. [VERIFIED]
- **Signing census:** a grep pre-count found ≈21 call-expression sites across `src/{bot, exitEngine, tokenSafety}.ts`, `mevStrategies/{flashbots, passthrough, bloxroute}.ts`, `txManager.ts` and `scripts/{addLiquidity, deploySepoliaTest, recover-sell-ladys}.ts`. `deliberate-buy.ts` signs through helpers that grep cannot see. **The authoritative census must use the TypeScript type-checker:** take call expressions whose receiver type is `ethers.Wallet`/`Signer`, or a `Contract`/`BaseContract` whose runner is a Signer, plus `sendBundle`/`signBundle`. Grep gives only the floor. `withNonceLock(` occurs textually in `bot.ts` ×6, `exitEngine.ts` ×10 and `detector.ts` ×1.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | betterleaks v1 makes no credential-validation network calls unless `--validation` is given; the `HTTPS_PROXY=127.0.0.1:1` belt also blocks its Go HTTP client | Code Examples | A secret could be sent to a provider during the scan. Mitigated by the proxy belt and by not passing the flag |
| A2 | On Linux, the fcntl-based exclusive lock behaves like the Windows result (released on SIGKILL; one winner) | Pattern 5 | AC-23 fails on CI; the CI run proves it either way |
| A3 | betterleaks `dir` mode skips binary files such as `bot.db` and `-wal` | Pitfall 8 | NAC-01 false negative. Mitigated by the exact-value check (Q2) |
| A4 | `fs.realpathSync.native` also normalizes 8.3 short names (`DOCUME~1`) | STL-4 | Only an alias via short name escapes the guard. Low |
| A5 | Google Drive web upload and download preserve bytes exactly | D-10 | Detected anyway by the download-back verify |
| A6 | The codex model `gpt-6.1-sol` and the agy model `gemini-4-argon-high` IDs are valid | Code Examples | The second-opinion run fails, which is loud |
| A7 | The 11:21 Vitest run was on Node 24, inferred from duration-0 failures of the DB-importing files | STL-2 | If it ran on Node 22, the live DB was not opened anyway: data/ mtimes are unchanged |

## Open Questions

1. **Q1: Node pin method.** `nvm use 22.16.0` changes the global default for all the operator's tools. Absolute paths per command change nothing global. *Recommendation:* use absolute paths plus an ABI assert in every script; ask the operator.
2. **Q2: NAC-01 exact-value check.** A script reads `.env` in-process and asserts that no backup byte sequence contains the `PRIVATE_KEY` (hex, with and without `0x`), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SESSION`, `TELEGRAM_API_HASH`, `FLASHBOTS_AUTH_KEY` or `DASHBOARD_API_KEY` values. It prints only booleans. This is the only reliable check for a raw EVM key, but it reads `.env`. *Recommendation:* offer it to the operator as an opt-in.
3. **Q3: Notifier refusal path** (Pitfall 5). Use the catch path, which preserves the broadcast, or the literal "skipped" path. *Recommendation:* the catch path. Confirm with the operator, because D-04 is locked wording.
4. **Q4: Future CI secret gate.** SPEC's breadcrumb names a "Phase 31 gitleaks CI gate". With betterleaks preferred, Phase 31 should probably follow suit. This is out of scope here; record it as a note.
5. **Q5: What ran at 11:21 today** (STL-2). Only the operator knows. Record the answer in the register.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 (ABI 127) | everything touching better-sqlite3 | ✓ (not active) | 22.16.0 via nvm | none; Node 24 is unusable (STL-1) |
| Node 24 (active) | — | ✓ | 24.18.0 | do not use for this phase |
| npm | npm ls/audit baselines | ✓ | 11.17.0 (global, overrides Node 22's 10.9.2) | record the version |
| GNU tar / bsdtar | backup archive | ✓ | 1.35 / 3.8.9 | — |
| sha256sum | manifest verify | ✓ | 8.32 | Node crypto |
| gh | betterleaks download and verify | ✓ | 2.103.2 | manual download plus `sha256sum -c` |
| cosign | verifying the sigstore bundle | ✗ | — | `gh release verify-asset` (immutable release) |
| betterleaks | secret scan | ✗ (to download) | pin 1.10.0 | — |
| codex / agy CLIs | D-14 second opinion | ✓ | codex-cli 0.163.0; agy (version not queried) | Claude-only audit if the operator declines the send |
| Docker | — | ✓ 29.9.2 | not used | — |

**Missing with no fallback:** none. **Blocking precondition:** run on Node 22.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 on Node 22.16.0 |
| Config file | `vitest.config.ts`. Changes: drop `config()`; add `envDir: false`; add `setupFiles: ['test/rails/rails.cjs']` to all 3 projects; network deny is off for fork (enforced inside rails by project name) |
| Quick run command | `npm run test:unit -- <file>` (only **after** the rails commit) |
| Full suite command | `npm test` → `vitest run --project unit --project integration` (AC-12); `npm run test:fork` stays opt-in |
| Pre-rail rule | No Vitest in the main checkout. Pre-rail collection only through the D-13 export, on Node 22, with the per-entry-junction `node_modules` |

### Phase Requirements → Test Map
| Req | Behavior | Type | Automated Command / Method | RED proof (how) | File Exists? |
|-----|----------|------|---------------------------|-----------------|-------------|
| SAFE-01 AC-04..06 | missing file, torn snapshot and re-run overwrite all FAIL | script self-check, later a Vitest test | `ts-node scripts/backup-state.ts --self-check` (fixtures in temp) | fixture with `bot.db` removed → FAIL; a write between the two hashes → FAIL | ❌ Wave 0 |
| SAFE-01 AC-03/07 | manifest re-verifies; committed blobs equal the manifest | script | `sha256sum -c SHA256SUMS` in both copies; `git cat-file -p HEAD:<p> \| sha256sum` loop | flip one byte in a fixture copy → mismatch | ❌ |
| SAFE-01 D-10 | downloaded archive verifies | **manual** + script | operator uploads and downloads; `backup-state.ts --verify <downloaded>` | n/a (human) | — |
| R3 AC-09/10 | forensic report deterministic; E unchanged | script | `forensic-db.ts` ×2 → `cmp`; E hash before and after | fixture WAL DB with a known WAL-only row must appear in the A−B diff | ❌ |
| SAFE-02 AC-13 | env comes from sentinels; `.env` blocked | unit (every project) | `test/rails/env.test.ts` | child spawned **without** the preload, with a planted env → the planted value survives (RED) | ❌ |
| SAFE-02 AC-14 | DB tripwire, both layers | unit | `test/rails/dbTripwire.test.ts` | fake repo root in temp: without rails, `data/bot.db` gets created; with rails it throws. Plus `delete process.env.VITEST` and still blocked | ❌ |
| SAFE-02 AC-15 | 10 transports denied, loopback ok | unit | `test/rails/netDeny.test.ts` (192.0.2.1 + local server) | child without the preload → `ETIMEDOUT`/`ECONNREFUSED` instead of `E_RAIL_NET_DENIED` | ❌ |
| SAFE-02 AC-16 | notifier refuses | unit | spy on `axios.post`; assert not called, ledger entry, broadcast unchanged | remove the refusal → spy called | ❌ |
| SAFE-02 AC-17 | fork RPC var is shell-only | unit (no Hardhat) | import `setup.ts` `setup()` with the var unset → error names `ETH_FORK_RPC_URL` | restore the `ALCHEMY_URL` fallback → no error | ❌ |
| SAFE-02 AC-19 | `npm test` leaves data/ untouched | script wrapper | `scripts/verify-prod-untouched.ts`: hash + mtime before and after `npm test`, ledger shows 0 successful non-loopback connects | n/a (aggregate) | ❌ |
| D-03 | no spawn outside the helper | unit (source scan, TS AST) | `test/rails/spawnSites.test.ts` | add a fixture file with `spawnSync` → fails | ❌ |
| SAFE-03 AC-20 | second load throws (casing alias) | unit | `test/guards/singleton.test.ts` (Vitest casing import + child `node -r ts-node/register` with a `require` casing alias) | remove the guard → loads 2 | ❌ |
| SAFE-03 AC-21 | casing flag in 3 tsconfigs | unit (JSON read) | `test/guards/tsconfigCasing.test.ts` | — | ❌ |
| SAFE-03 AC-22 | suite green; counts ≥ pre-rail | suite + baseline diff | `npm test`; compare against `.planning/baselines/before/test-counts.json` | — | — |
| SAFE-04 AC-23a-d, NAC-07 | refuse; release after kill; one winner; preflight/pause/resume ok; mechanism error refuses; **GC case** | integration (child processes, temp lockDir param) | `test/integration/processLock.test.ts` | unpinned handle + `--expose-gc` → second acquire succeeds (RED); barrier race checks interval overlap | ❌ |
| SAFE-05 AC-24..26 | v7 opens, v8 refuses (hash unchanged); repo-root anchoring; refuse missing/0-byte/v0 outside Vitest | integration (child process without VITEST, temp fake repo) | `test/integration/dbGuards.test.ts`, `scripts/db-init.ts --replace-empty` path | remove the probe → v8 gets downgraded (hash changes) | ❌ |
| SAFE-06 AC-27 | gate fails on broken or non-literal specifiers | unit + CI | `npm run check:vi-mock` on `test/fixtures/viMockGate/*` and on the real suite | broken fixture must fail | ❌ |
| SAFE-07 AC-28..30, NAC-08 | deterministic baselines | script ×2 | `capture-baselines.ts` twice → `diff -r` (ignore documented time-varying fields) | — | ❌ |
| AUDIT-01/03/04/05 | register completeness, ledger == `git ls-files`, 20×5 matrix no blanks, NAC-09/10/12 | script | `.planning/audit/tools/check.ts` | remove one ledger row → fails | ❌ |

### Sampling Rate
- **Per task commit (post-rail):** that rail's test file plus `test/rails/**`.
- **Per wave merge:** `npm test` wrapped by `verify-prod-untouched.ts`, plus `npm run check:vi-mock`.
- **Phase gate:** full suite green, NAC-03 hash equality against the manifest, audit `check.ts` green, betterleaks phase-commit scan with 0 new hits.

### Wave 0 Gaps
`test/rails/rails.cjs`, `test/rails/spawnRailedChild.ts`, `test/.env.test` (+ sync test), the rail RED tests listed above, `test/fixtures/viMockGate/`, a temp fake-repo-root helper, the lock child-process harness (barrier + `--expose-gc`), and `scripts/verify-prod-untouched.ts`. No framework install is needed.

### Manual-only checks (with justification)
- **Google Drive upload and download-back.** Requires the operator's account (D-10).
- **External-model send approval.** A one-way disclosure (D-14).
- **Escalation acknowledgements.** D-16 and AC-40 need the operator.
- **First betterleaks run** after `gh release verify-asset`, a `checkpoint:human-verify`.
- **Operator answer on STL-2.**

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no auth changes) | — |
| V4 Access Control | yes (process lock = single writer per wallet) | OS file lock, fail closed (NAC-07) |
| V5 Input Validation | yes (env parsing audited; DB version input) | read-only version probe; audit flags `||`/NaN parsing |
| V6 Cryptography | yes (hash integrity only) | Node `crypto` SHA-256 / `sha256sum`; never hand-roll |
| V7 Errors/Logging | yes (secret redaction) | betterleaks `--redact`; register stores metadata only; ledger never stores values |
| V14 Config | yes (test vs prod separation) | rails + `envDir:false` + sentinel env |

| Threat Pattern | STRIDE | Mitigation |
|----------------|--------|-----------|
| Test reaches prod DB, `.env`, network or Telegram | Tampering / Info disclosure | Two-layer rails, RED-proven |
| Two bot processes on one wallet | Tampering (double-spend/nonce) | Pinned SQLite exclusive lock |
| Duplicate module instance → second nonce authority | Tampering | `Symbol.for` registry keyed by `realpathSync.native` |
| Malicious scanner binary | Elevation | Immutable-release attestation + pinned sha256 + human verify |
| Repo `.git/config` hooks run by the scanner | Elevation | betterleaks ≥1.10.0 isolates repo config by default; never pass `--trust-local-git-config` |
| Source exfiltration to external models | Info disclosure | Export of tracked slice files only; send list approved by the operator |
| Secret in backup or upload | Info disclosure | NAC-01 scan + exact-value check (Q2) |

## Sources

### Primary (HIGH: tested or read this session)
- Sandbox experiments in `C:\Users\jackc\AppData\Local\Temp\claude\…\scratchpad\` (vt1, vt2, nodecase, sqllock, wal, np, net) using the repo `node_modules` by absolute path, with no `.env` and no `data/`.
- Installed sources:
  - Vitest: `vitest/dist/chunks/{base.C9_VThnT.js, cli-api.BUXBO6jS.js, utils.BX5Fg8C4.js}`
  - Vite: `vite/dist/node/chunks/node.js`
  - better-sqlite3: `better-sqlite3/{lib/database.js, src/objects/database.cpp, deps/defines.gypi, deps/sqlite3/sqlite3.h}`
  - dotenv: `dotenv/lib/main.js`
  - ethers: `ethers/lib.commonjs/providers/{abstract-provider.js, provider.js, provider-jsonrpc.js}`
- Repo files read at HEAD `3602e85` (paths and lines cited inline).
- GitHub API: betterleaks/betterleaks repo, releases and v1.10.0 assets/digests/`immutable`; gitleaks/gitleaks releases; `checksums.txt` for both tools; the sigstore bundle certificate.

### Secondary (MEDIUM: official docs)
- https://raw.githubusercontent.com/betterleaks/betterleaks/v1.x/README.md and `/docs/scanning.md` (CLI flags, default log-opts, validation opt-in)
- https://raw.githubusercontent.com/betterleaks/betterleaks/v1.x/config/betterleaks.toml (rule inventory)
- https://www.sqlite.org/howtocorrupt.html §2.2 (POSIX lock dropped on close)

### Tertiary (LOW)
- News coverage of the betterleaks launch, used only to identify the project: [BleepingComputer](https://bleepingcomputer.com/news/security/betterleaks-a-new-open-source-secrets-scanner-to-replace-gitleaks), [Cyber Security News](https://cybersecuritynews.com/betterleaks-tool/amp/), [Canadian Web Hosting blog](https://blog.canadianwebhosting.com/betterleaks-gitleaks-secret-scanner-bpe/). Facts were taken from GitHub instead.

## Metadata

**Confidence breakdown:**
- **Rails mechanics:** HIGH. Each was executed.
- **Lock:** HIGH on Windows, MEDIUM on Linux, where only the cited doc backs it; the CI test will prove it.
- **Forensics:** HIGH, from a fixture reproduction.
- **betterleaks procedure:** MEDIUM, from docs and metadata; the binary was not run.
- **ethers semantics:** HIGH, from source reading.
- **Audit slicing:** HIGH, from `git ls-files` and `wc`.

**Research note.** My first network-deny attempt had the `path: null` bug. Before I fixed it, that attempt made one real HTTPS request to `api.telegram.org/botX/sendMessage`, with a fake token and no repo data. It also made DNS lookups for `.invalid` names. Nothing in the repo was involved.

**Research date:** 2026-11-06. **Valid until:** 2026-11-20 for betterleaks (fast-moving, with a v2 GA pending); 30 days for the rest.
