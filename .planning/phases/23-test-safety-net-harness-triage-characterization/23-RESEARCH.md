# Phase 23: Test Safety Net (Harness, Triage, Characterization) - Research

**Researched:** 2026-11-09
**Domain:** Real-path test harness (real ethers, fake JSON-RPC, real SQLite), golden-master characterization, commit gating
**Confidence:** HIGH for the seven research flags (each was run against the installed packages). MEDIUM for the assembled end-to-end buy (see Open Question 1).

---

## Read this first: what the experiments overturned

Five things in CONTEXT.md or SPEC.md do not hold as written. Each was measured, not inferred. None blocks planning; each changes what the plans must say.

| # | Statement | What was measured | Consequence |
|---|-----------|-------------------|-------------|
| **F1** | **D-01:** "replaces the `WebSocket` property on the `ws` package, which ethers reads afresh at each connect" and `FetchRequest.registerGetUrl` reaches ethers' HTTP. | **Falsified as written, for two independent reasons.** (a) Under Vitest, `src/` receives ethers' **ESM** build, and `FetchRequest` is a different object from the CJS one the Flashbots library uses (`esmNs.FetchRequest===cjs.FetchRequest false`). (b) ethers pins its **own nested** `ws@8.17.1` at `node_modules/ethers/node_modules/ws`, so swapping the top-level `ws@8.20.0` reaches nothing. Fake constructed 0 times in both cases. | The mechanism works **only with both** corrections: alias `ethers` to its CJS build in the `realpath` project, and swap `WebSocket` on ethers' nested `ws`. Verified: fake constructed, subscription delivered a log. The CJS build is also what production loads under ts-node, so the alias makes tests *more* faithful. D-01's intent survives; its stated mechanism does not. **Recommend the operator is told at the first checkpoint.** |
| **F2** | **D-14** and Code Context: "The DB connection is not exported from `src/utils/db.ts`, so one new `...ForTesting` getter is needed" / "keeps its connection private". | **False.** `db` is in the export list at `src/utils/db.ts:554-555`, and `src/riskManager.ts:5` and `src/api/routes/controls.ts:8` already import it. | **No `src/` change is needed for D-14.** Do not add the getter. Phase 23's `src/` diff may be empty, which is the strongest possible reading of AC-45/AC-50. |
| **F3** | SPEC R7 / AC-33: "floor of 23 sites". | The census tool run on the working tree reports **N=25** (10 locked, 14 unlocked, **1 unknown**). The 23 in `signing-sites-head.json` includes two *auditor* exclusions from the manual inventory, both view calls the type analysis cannot classify: `scripts/addLiquidity.ts main contract.getPair` and `src/bot.ts maybeApproveForChain contract.allowance`. | The promoted census must carry those two exclusions with their evidence, or it reports 25. The exception list needs an "excluded (not a signing site)" class as well as the 13 "known unlocked" entries. An `unknown` must fail the check (never count as locked). |
| **F4** | **D-16:** "Phase 24's CAP-06 changes parsing on purpose, so that diff has to be readable." AC-27 scopes the snapshot to `src/config.ts` and `src/chainRegistry.ts`. | `MAX_OPEN_POSITIONS`, `MAX_TOTAL_EXPOSURE`, `DAILY_LOSS_PCT`, `SNIPE_COOLDOWN_MS` and `MAX_POSITION_SIZE` are parsed in **`src/riskManager.ts:28-32`** and read by neither named file. Measured read set of the two files: 101 variables, none of those five. | The snapshot as specified would **not cover the parsers CAP-06 and AUD-DB-001 are about**, and D-16's stated reason for it would not be met. **Needs a one-line operator ruling** (Open Question 2). Recommendation: add `src/riskManager.ts`. Cost is about 25 more cases (under 100 ms) because `loadRiskConfig()` runs at import. |
| **F5** | AC-07 (`createTestDb` returns `CURRENT_SCHEMA_VERSION`) with AC-49 (no test weakened). | Swapping the helper to the real migrations breaks exactly **2 of 61** consumer tests, both pinning the old value: `test/unit/db.test.ts:76-79` and `test/unit/helpers.smoke.test.ts:32-34`. | These two must change (expected value becomes `CURRENT_SCHEMA_VERSION`). That follows from AC-07 and is not a weakening, but the plan summary should name them under AC-49. |

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Fake chain and clock
- **D-01 (transport):** The fake blockchain runs **in-process** for both HTTP and WebSocket JSON-RPC, so event order is exact and runs are byte-identical (AC-12, AC-24). Real ethers still encodes, signs and decodes. HTTP goes through ethers' public `FetchRequest.registerGetUrl`. WebSocket replaces the `WebSocket` property on the `ws` package, which ethers reads afresh at each connect (`node_modules/ethers/lib.commonjs/providers/ws.js`). `vi.mock('ws')` cannot work: Vitest mocks do not reach inside packages it loads natively unless they are inlined. The swap counts as "the fake transport", so it needs no new entry on the AC-02 mock list.
- **D-02 (real-socket exception):** Tests of connection failure use the **real `ws` library on a loopback port**, because AUD-ANTIRUG-002 (a refused reconnect crashes the process) must be proven against the real library. These tests run on real time and never feed the recording.
- **D-03 (node model):** The fake is a **small simulated node**: it accepts the real signed transaction, enforces nonce and chain ID, computes the real hash, mines blocks on command, and returns real receipts. Contract reads (prices, reserves) come from a per-scenario table keyed by address and function, encoded by real ethers. A contract call not in the table fails loudly, matching AC-03 for unknown methods.
- **D-04 (fake data):** Chain data is **synthetic and built with real ethers encoders**. `test/fork/fixtures/realLaunches` holds only addresses and block numbers for a fork run, so there are no captured responses to replay.
- **D-05 (clock):** **All time is fake and stepped by the test**: the date and every timer, including ethers' 10 ms JSON-RPC batching timer. The fixed clock must also cover SQLite: `trades.timestamp` defaults to `unixepoch()` (`src/utils/dbSchema.ts:25`, `:75`), which a JavaScript fake clock cannot reach and which would break AC-24.
- **D-06 (scenario entry):** A recorded scenario enters at **the fake chain's event**: a real `PairCreated` or `PoolCreated` log goes through the real listener, then detection, safety, buy, arming and exits. Only the outer edge of the bot is named, so recordings survive the Phase 27 restructure. The AC-30 boot-order tests are separate and call `startMultiChainBot()` in-process against the fake chain, as 6 test files already do. This is not booting the bot as a program, and it never starts a real bot process.

### Known-bug tests
- **D-07 (proof rule):** An expected-fail test **marks the one assertion that shows the bug and stores the expected and actual values it saw**. Only that exact failure counts. A setup error, timeout, type error or changed value reports as a real failure (AC-09, AC-10). Vitest's `it.fails` is ruled out: the installed 4.1.1 runner turns any non-passing result into a pass.
- **D-08 (fix signal):** A marked test that starts passing **fails with a message saying the finding looks fixed and the marker should come off**. This is the Phase 24 signal.
- **D-09 (home):** Harness, known-bug and recorded-scenario tests live in a **new `realpath` Vitest project in its own folder, part of `npm test` and CI**, with the Phase 22 rails on. The mock-list check covers the whole folder with no exceptions. Its counts stay separate from the 932 and 262 baseline (AC-49).
- **D-10 (file split):** **One test file per root cause**, named after the lead finding, so parallel agents never edit the same file and Phase 24 can run one file for its before-and-after proof. Entries sharing a cause share a file and each is asserted separately (AC-11).
- **D-11 (operator batch):** Known S0/S1 findings return as **one plain-language report grouped by code area, generated from the recorded failures**, giving what was expected and what happened. The operator acknowledges the batch and rules individually only on S0/S1 NOT-A-BUG closures (AC-17) and unreproduced entries (AC-08). The SPEC's stop-at-once rule for new bugs, severity increases and overturned assumptions is unchanged.

### Recording format
- **D-12 (storage):** **One LF-only file per scenario, with its `KEEP` or `SUSPECT(<finding-id>)` tag inside the file.** The commit check reads git directly: a new file passes, and a changed or deleted one needs a `behavior:` commit. A tag flip therefore counts as a change. — **Reversibility:** costly — changing the layout re-records every scenario, and each change needs a `behavior:` commit citing an ID under D-18.
- **D-13 (shape):** Each recording is **one ordered timeline** of `op` logs, submitted transactions, relay bodies and DB writes, in the order they happened. Moving a DB write across a submit must fail the check (CAP-14 and CAP-04 depend on that order). — **Reversibility:** costly — same reason as D-12.
- **D-14 (DB capture):** DB writes are captured by **test-only SQL triggers generated from the migrated schema, calling a recording function** registered with better-sqlite3's `db.function()`. This records what actually landed, including values SQLite fills in, at the right place in the timeline. The DB connection is not exported from `src/utils/db.ts`, so one new `...ForTesting` getter is needed, within the SPEC's `src/` limit. The researcher must prove this works before planning relies on it. The API's existence was confirmed from the installed package, but it has not been run.
- **D-15 (no built-in snapshots):** The recording uses its own compare step and explicit update command, not Vitest snapshots. Outside CI, Vitest's default mode writes new snapshots on a normal run, which AC-25 forbids.
- **D-16 (env snapshot):** The env snapshot is **one full baseline with every variable valid, plus only what each case changes or the failure it caused**. At least about 90 variables times 5 values gives 450 or more cases, and full copies could not be reviewed. Phase 24's CAP-06 changes parsing on purpose, so that diff has to be readable.
- **D-17 (commit check also covers the env snapshot):** Changing or removing an existing env-snapshot case needs a `behavior:` commit citing an ID. Adding a new variable passes, the same as a new scenario. **This is an operator-approved addition to SPEC Requirement 9**, which names only recorded scenarios.

### Register and seal
- **D-18 (non-behavior recording changes):** A recording change that is not a behavior change (a harness fix, a library upgrade altering how a value prints) needs **its own small register entry stating why**, cited by a `behavior:` commit. There is no standing blanket card and no exempt commit type.
- **D-19 (seal):** A **successor seal**. `SEAL.json` stays byte-unchanged as the Phase 22 record. After triage, a new seal record points back to it, lists what changed, and covers **only the audit folder**, so it can actually stay valid. `seal-verify.ts` is fixed to stop counting a merge commit's whole diff as changes, with new self-tests. This is the SPEC's required reconciliation.
- **D-20 (signing census home):** The census analysis is **promoted into `scripts/` with an npm command and a CI step**, beside `check:vi-mock`, keeping the type-aware analysis and bringing its self-tests. The original in `.planning/audit/tools/` stays as the audit record.
- **D-21 (register enforcement):** `check.ts` **mechanically enforces** that each of the 59 entries has exactly one outcome and its evidence: a test that exists and carries that finding's ID, a Phase 22 rail test for `fixed`, and a recorded ruling for any S0/S1 NOT-A-BUG. Tests are located **by finding ID, not file path**, so Phase 27 moves cannot leave stale pointers. Each new rule gets a self-test.

### Claude's Discretion

The operator was told these would go to the planner's judgment. They were not discussed, so nothing here is an operator decision.
- How each of the 11 source-text tests is converted, under the SPEC rule that each keeps protecting the same behavior (a removal is named with its reason, AC-38).
- The census exception format. Suggested: file plus enclosing function plus call, not line numbers, because the Phase 25 formatter alone would shift every line.
- Env-matrix mechanics. Suggested: in-process with a module reset per case and `process.exit` intercepted (`src/config.ts:241`, `:263`), since a child process for each of 450+ cases is too slow. A read-recorder on `process.env` could prove AC-27 coverage.
- Folder, file, field and command names.
- How the mock-list check is built. `scripts/check-vi-mock-paths.ts` already has an AST walker to reuse.
- Plan and wave breakdown, following the ROADMAP's three waves and the operator's preference for few large phases with risk isolated at plan and commit level.

### Deferred Ideas (OUT OF SCOPE)

None. Discussion stayed within phase scope. The one addition (D-17) was approved by the operator as part of the commit check.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAR-01 | Real-path harness: real ethers, fake JSON-RPC, real in-memory SQLite via real migrations, fixed clock; limited mock list | Flags 1, 2, 3 and E8 below; §Pattern 1-4 |
| CHAR-02 | Golden-master decision trace, known bugs tagged `SUSPECT` | Flag 4, §Pattern 5-6, determinism list in Pitfalls |
| CHAR-03 | Env-matrix snapshot for `{unset, '', '0', 'abc', valid}` | Flag 6, §Pattern 7, F4 |
| CHAR-04 | Boot/resume/arm ordering, listener counts, same-block order, singleton identity, signing census with floor | Flag 5, Flag 7, F3, Open Question 3 |
| CHAR-05 | Migration golden tests v0→v7 and v4→v7; test helper uses real migrations | E9, F5, Pitfall 9 |
| CHAR-06 | Source-text tests converted to behavioral checks | §Source-text search: 11 named files confirmed, no others in scope |
| AUDIT-02 | Candidates triaged to confirmed or NOT-A-BUG (extended to 59 entries) | §Triage work list; §Pattern 4 (D-07 marker prototyped) |
| AUDIT-06 | Commit taxonomy enforced | §Pattern 8, git mechanics proven on a throwaway repo |
</phase_requirements>

## Project Constraints

No `./CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/skills/` or `.agents/skills/` exists in this repository [VERIFIED: `ls`, this session]. The global `CLAUDE.md` covers only the graphify skill. `agent_skills` for this agent type is empty. Directives that bind this phase come from the SPEC and operator memory:

- Every command runs on **Node 22.16.0 by absolute path**. In Bash: `N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0; PATH="$N22:$PATH"`.
- The bot stays off. Never boot `src/bot.ts` or `src/main.ts` as a program. `npm run preflight` is the only read-only check.
- Rails stay on: no real `.env`, no `data/bot.db`, no non-loopback network, no Telegram.
- Every operator-run command is a **single line**. Operator-facing text names each tool by what it does.
- `src/` may gain only an added `export` on existing code or a new `...ForTesting` helper. Per F2, Phase 23 may not need either.
- A confirmed S0/S1 is re-surfaced, never auto-deferred (D-STOP-THE-LINE).
- An anomaly is diagnosed, never waved through as "non-blocking".

---

## Summary

The harness is viable on the installed stack, and all seven research flags now have a run behind them. The real Flashbots route (real `FlashbotsBundleProvider`, real bundle signing, simulate, four `eth_sendBundle` calls, receipt reconciliation) ran on a prototype fake node under a fixed clock and produced **byte-identical output on three consecutive runs**. Real ethers signing is deterministic, the 10 ms batching timer responds to the fake clock exactly (nothing at 9 ms, resolved at 10 ms), and `mockReset: true` does not disturb fake timers.

The principal correction is F1. Under Vitest, `src/` and the Flashbots library see **two different copies of ethers**, and ethers bundles a private copy of `ws`. Without two configuration lines the fake transport silently fails to attach: real sockets get opened instead, Flashbots traffic bypasses the fake, and tests would prove nothing while possibly still passing. The plan must include a loud self-check at harness start that these seams are attached.

The DB capture design (D-14) works, including for statements prepared at import before the triggers exist. The `unixepoch()` problem has a clean fix: override the function on the test connection, which even reaches a `DEFAULT (unixepoch())` through a statement prepared before the override. Two capture refinements matter: pass columns to the recording function as separate arguments, not through `json_object` (which rounded `0.30000000000000004` to `0.3` when measured), and know that a rolled-back write still appears in the timeline.

**Primary recommendation:** Build Wave 1 around one harness module whose first act is to prove its own seams attached, using a project-scoped alias to ethers' CJS build plus a swap on ethers' nested `ws`. Do not add the D-14 getter. Land recordings last, after the harness has settled, because every later format change costs a D-18 register entry.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fake HTTP JSON-RPC and relay transport | Test harness (`FetchRequest` hook on the CJS ethers copy) | — | Providers are built from URLs in `src/`; injection is unavailable |
| Fake WebSocket transport | Test harness (swap on ethers' nested `ws`) | — | Same reason; `.websocket.on/ping/terminate` are used directly by `src/` |
| Simulated node (nonce, chain ID, mining, receipts) | Test harness | Real ethers (`Transaction.from`) | D-03; real parsing of real signed bytes |
| Encoding, signing, receipt decoding | Real ethers | — | The mechanism under test; never mocked |
| Schema and migrations | Real `migrateSchema` | Test helper calls it | CHAR-05 |
| DB write capture | Test-only TEMP triggers + SQL function | Harness timeline | D-14; invisible to schema golden tests |
| Fixed clock in JS | Vitest fake timers | — | D-05 |
| Fixed clock in SQL | `unixepoch` override on the test connection | — | D-05; JS fakes cannot reach SQLite |
| Crash-class findings | Child process via `spawnRailedChild` | Real `ws` on loopback (D-02) | A worker cannot observe a real process death |
| Commit gating | `scripts/` command run in CI and locally | Git plumbing | AUDIT-06; demos in throwaway repos (AC-43) |
| Signing census | `scripts/` command (TypeScript type-checker) | CI step | D-20 |

## Standard Stack

**No new packages.** Everything is built on what is installed. Adding a library is out of scope, and each candidate would either hide the mechanism (msw, nock) or belong to Phase 28 (fast-check, testing-library).

### Core (installed, versions read from `node_modules` this session)
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| vitest | 4.1.1 | Runner, fake timers, module reset | Already the suite's runner |
| ethers | 6.16.0 | Real encoding, signing, decoding | The mechanism under test |
| ws (nested in ethers) | 8.17.1 | What ethers actually uses | Must be the swap target and the D-02 target |
| better-sqlite3 | 12.8.0 | Real SQLite, `db.function()` | Production engine |
| @flashbots/ethers-provider-bundle | 1.0.0 | Real bundle signing and relay calls | Production path; CJS |
| typescript | 5.8.3 | AST and type-checker for census, mock-list check | Already used by `check-vi-mock-paths.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Alias to CJS ethers | `server.deps.inline: ['ethers']` plus `vi.mock('ws')` | Rejected. Keeps two ethers copies (Flashbots stays CJS), and D-01 rules out `vi.mock('ws')`. |
| In-process fake | Real `ws.WebSocketServer` on loopback | Rejected for scenarios (socket I/O breaks exact event order). Required for D-02 only. |
| `json_object` in triggers | Separate SQL function arguments | `json_object` loses float precision (measured). Use arguments. |

**Installation:** none.

**Version verification:** installed versions were read from each package's `package.json` in `node_modules`. Nothing new is installed, so no registry lookup applies.

## Package Legitimacy Audit

This phase installs no external packages. `gsd-tools package-legitimacy` was therefore not run.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| none | — | — | — | — | — | Nothing to install |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Research Flags: what was run and what was observed

All experiments ran on Node 22.16.0, under the real Phase 22 rails (`test/rails/setup.cjs`, `ledgerRun.ts`) with `mockReset: true`, from a temporary untracked folder at the repo root (removed afterwards; `git status` clean). No `.env` was read, no real endpoint was contacted, and the bot was never started.

### Flag 1. Does the `ws.WebSocket` swap reach ethers under Vitest? Does anything call `lockConfig`?

**Answer: only with the alias and only on ethers' nested `ws`. Nothing calls `lockConfig`.** [VERIFIED: experiment, this session]

| Run | Output |
|-----|--------|
| Default Vitest resolution | `[E1a] esmNs.FetchRequest===cjs.FetchRequest false` / `[E1b] fake constructed count 0` |
| Alias only, swap on top-level `ws` | `[E1a] ...=== true` / `[E1b] fake constructed count 0` / `provider.websocket constructor name WebSocket` |
| Alias plus swap on `createRequire(require.resolve('ethers'))('ws')` | `[E1d] constructed 1 ctor Fake` / `blockNumber via fake socket 100` / `sent ["eth_blockNumber","eth_subscribe"]` / `log delivered count 1` |
| No alias, swap on nested `ws` | `constructed 0`, the test hung, and Vitest reported `connect ECONNREFUSED 127.0.0.1:1` |
| Alias scoped to one project, real `projects`/`extends: true` shape | `realpath sameAsCjs true` / `unit2 sameAsCjs false` (the alias does not leak) |

`lockConfig`: no call in `src/`, `scripts/`, `test/` or any `node_modules` JS outside ethers' own definition [VERIFIED: grep this session]. It is therefore safe to call `registerGetUrl` once per worker.

**Why it happens.** Vitest loads node_modules natively, and Node's `import` condition selects `lib.esm`. Its `export { WebSocket } from "ws"` binds through `ws/wrapper.mjs`, an immutable binding, so even the nested copy cannot be swapped there. The CJS build reads `ws_1.WebSocket` at each call, as D-01 assumed. Production uses CJS because the repo is `"type": "commonjs"` under ts-node.

### Flag 2. Does `@flashbots/ethers-provider-bundle` load a second ethers copy?

**Answer: yes under default Vitest, no with the alias.** [VERIFIED: experiment]

There is only one ethers *package* on disk (no nested copy; `npm ls`'s 6.16.0-vs-6.7.1 mismatch is only a peer-range warning). The second copy is the **ESM/CJS dual build of the same package**.

- Default: `[E1c] seen ["cjsCopy:http://127.0.0.1:1/relay"]`. A hook registered only on `src/`'s copy would have missed all relay traffic.
- With the alias: `[E1c] seen ["importCopy:http://127.0.0.1:1/relay"]`. One hook sees everything.

### Flag 3. Stepping helper for fake timers with batching, polling and `tx.wait()`, under `mockReset: true`

**Answer: works, and is deterministic.** [VERIFIED: experiment]

```
[E3] [["blockNumber",100,1,10],["sent","0xd31038e1...",0,5,50,"3000000000"],["pendingTimersBeforeMine",1],
      ["receipt",1,101,"0xd31038e1...",31,3100],["blocks",[102]], ...,["date","2026-01-01T00:00:16.360Z"]]
[E3] distinct outputs 1          (three runs)
[E3b] isFake true                (mockReset leaves fake timers installed)
[E3d] settled w/o timers false / settled after 9ms false / settled after 10ms true
[E3e] identical signature true
```

`performance` must be listed in `toFake` explicitly, because `src/exitEngine.ts:1918,2018` measures durations with it. Confirmed: `[M6] performance delta under fake 1234`.

### Flag 4. D-14: triggers calling a better-sqlite3 function inside the bot's transactions, and the `unixepoch()` fix

**Answer: both work. Three refinements are required.** [VERIFIED: experiment]

```
[E4a] exported db open true memory true user_version 7        (DB_PATH=:memory:, real src/utils/db.ts)
[E4a] trusted_schema 1 fk 1
[E4a temp=true] timeline [["marker","before-insert"],["db","trades","insert"],["marker","after-insert"],
                 ["db","exit_state","insert"],["db","exit_state","update"],["db","exit_state","update"],["db","exit_state","delete"]]
[E4b] recorded 1 rows actually in table 0                     (rolled-back write still recorded)
[E4c] real unixepoch() before override 1794248404 fake 1767225600
[E4c] DEFAULT via statement prepared BEFORE override 1767225600
```

- Statements prepared at import, before the triggers existed, still fire them. The write lands at its exact place between the markers.
- `ON CONFLICT DO UPDATE` is recorded as an `update`, so upserts read correctly.
- `TEMP` triggers and `main` triggers both work. **Use `TEMP`**: they stay out of `sqlite_master`, so the schema golden tests stay clean.
- `db.function('unixepoch', { varargs: true, deterministic: false }, ...)` overrides the built-in, including through `DEFAULT (unixepoch())` and through statements prepared before the override. Make it throw on any argument, so a future `unixepoch(x)` fails loudly. Only the two `DEFAULT` clauses use it today [VERIFIED: `src/utils/dbSchema.ts:25,75`, grep of `src/`].

**Refinement 1, rollback.** A write inside a transaction that rolls back is still recorded. Today only migrations and the JSON import use `db.transaction`, neither on a trading path, so no scenario is affected. Phase 24's CAP-14 intent row may change that (Open Question 5).

**Refinement 2, precision.** Measured directly:
```
["json","{\"r\":0.3,\"x\":\"1000000000000000000\",\"i\":9007199254740993}"],
["args",0.30000000000000004,"1000000000000000000",9007199254740992]
```
`json_object` rounds REAL values to 15 significant digits; separate arguments keep the exact double but lose precision on integers above 2^53 by default. Use separate arguments with `safeIntegers: true` on the function [CITED: better-sqlite3 docs `integer.md`, not run here], then print BigInt as whole-number text.

**Refinement 3, the gate.** `test/unit/rails/spawnSites.test.ts:41` accepts `.exec()` only on receivers named `db`, `mockDb`, `fileDb`, `mem`, `w`, `attachRe`, `vacRe`, `entryRe`. Name the handle `db` in harness code, or the gate fails.

### Flag 5. Whole-graph resets with the duplicate-load guard and `DB_PATH=:memory:`

**Answer: clean.** [VERIFIED: experiment; graph included real `src/bot.ts`, `exitEngine`, `anti-rug/detector`, `exitManager`, `nonceAuthority`, imported without calling `startMultiChainBot`]

```
[E5a] [{"i":0,"ms":1830,"regSize":4,"regNames":"antiRugDetector,exitEngine,exitManager,nonceAuthority","dbSame":false,"rowsAfterOneInsert":1,"nonceFnSame":false},
       {"i":1,"ms":27,...,"rowsAfterOneInsert":1,"nonceFnSame":false},{"i":2,"ms":21,...}]
[E5b] same-epoch re-register SINGLETON_DUPLICATE
[E5c] ethers FetchRequest same across resetModules true
```

- `vi.resetModules()` then dynamic import re-evaluates the whole graph: fresh DB per cycle (one row, never carried over), fresh lock functions, no `SINGLETON_DUPLICATE`. First load about 1.8 s, later resets about 25 ms.
- The guard still refuses a same-epoch duplicate, so AC-30's singleton-identity test has a real behavior to pin.
- ethers and `ws` are native and are **not** reset, which is what is wanted: the `registerGetUrl` hook and the `ws` swap survive resets. Install them once per worker. Point the hook at a mutable "current node" so each scenario gets a fresh node.
- Call `closeDb()` before each reset, or connections accumulate.

### Flag 6. `process.exit` in a Vitest worker, for the env matrix

**Answer: in-process is fine and very cheap.** [VERIFIED: experiment]

```
[E6a] default exit surfaces as "process.exit unexpectedly called with \"1\""
[E6b] result exit:1 calls 1
[E6c] after mockReset exit behaves as plain process.exit unexpectedly called with "7" isMock true
[E6d] per-case ms 1.87 for 5 values x 150 vars ~ 1401 ms
[E6e] result ok size=4 vars read by the two files 102 config 17 chainRegistry 87
```

- Install the `vi.spyOn(process, 'exit')` **per case**. `mockReset: true` strips its implementation before the next test.
- 101 variables (the 102 includes `VITEST`), times 5 values is 505 cases, about 1 second total.
- **A fully valid baseline is required before any read recording means anything:** a single `exit(1)` short-circuits every later read. With `ENABLED_CHAINS=eth,bsc,base,arb` the sentinels alone exit after `BSC` until `{BSC,BASE,ARB}_HONEYPOT_CHECKER_ADDRESS` are set.
- The read recorder must have its own `set` and `deleteProperty` traps, or assignment fails with `ERR_INVALID_OBJECT_DEFINE_PROPERTY`.
- The recorder also catches library reads (`WS_NO_BUFFER_UTIL`, `LIBC`, `NODE_V8_COVERAGE`, `ELECTRON_RUN_AS_NODE` and others). Filter by caller frame, as the measurement did, to get the true set.
- `REQUIRED_ENV_VARS` has 122 names, but only `required: true` ones are read by `validateEnvVars`. The list is not the read set. Use the recorder for AC-27.

### Flag 7. Running the census on the working tree, and its CI runtime

**Answer: 7.6 s with `--transpile-only`, 8.9 s type-checked, same output. It needs a code change first.** [VERIFIED: experiment]

- The tool refuses a real checkout: `signing-census.ts:1429-1430` throw if the root holds `.git`, `.env` or `data`. Working-tree use means removing those two refusals in the promoted copy.
- Keep the guarantee they gave: the census builds a TypeScript program and reads only `.ts` files, so `.env` and `data/` are still never opened. Add a self-test proving it.
- Self-test: `SELF-TEST PASS 31 of 31 cases` in 3.6 s.
- Result on the working tree: see F3. After the two auditor exclusions, the tx-signing set equals the committed 23 with no lock-status differences.
- **The suggested exception key is not unique.** The 23 sites reduce to **19** distinct `file|enclosing|call` keys (for example four `ContractFactory.deploy` in one `main`), and the 13 exceptions to 9 keys. Use `key + count` so an exception with a removed call fails (AC-35).

### Additional experiments

| ID | Purpose | Observed |
|----|---------|----------|
| **E8** | Real `FlashbotsMevStrategy.sendTransaction` on the fake | Resolved with the real hash; handle populated; relay calls `eth_callBundle, eth_sendBundle ×4, flashbots_getBundleStatsV2`; ops `flashbots.bundle.included`, `flashbots.bundle.stats`; 3 runs `distinct 1` |
| **E9** | Migrations | v0→v7 and helper-v4→v7 agree on every column and index; rows preserved; re-run idempotent; one difference only: whitespace in the `trades` SQL text (`fee_tier INTEGER , dex_name` vs `fee_tier INTEGER, dex_name`) |
| **E10** | D-07 marker | Bug present passes and records; setup crash, changed value and fixed bug all fail correctly; `it.fails` wrongly passes a setup crash; `meta` reaches the JSON reporter |
| **E3c** | AC-03 unknown method | Caller's `.catch` **swallowed** the error (`swallowed by caller true`); the fake's own record kept it |
| Git | Commit-check mechanics | See Pattern 8 |

---

## Architecture Patterns

### System Architecture Diagram

```
 Test step (advance clock / mine block / emit log)
        │
        ▼
 ┌──────────────────────────────── realpath test worker (one fork per file) ───────────────────────────────┐
 │                                                                                                          │
 │  Fake WS ──log──▶ real ethers WebSocketProvider ──▶ real listener (bot.ts) ──▶ detection ──▶ safety      │
 │    ▲                                                                                  │                  │
 │    │ eth_subscribe                                                                     ▼                  │
 │    │                                                       risk gate ◀── DB reads ── buy path             │
 │  ┌─┴───────────────┐                                                                   │                  │
 │  │ Simulated node  │◀── eth_* JSON-RPC ── real ethers JsonRpcProvider ◀── signing ─────┤                  │
 │  │ (nonce, chainId,│                                                                   │                  │
 │  │  blocks,receipts│◀── relay bodies ──── FetchRequest hook ◀── Flashbots route ───────┤                  │
 │  │  read table)    │                                                                   │                  │
 │  └─────────────────┘◀── axios mock ───── bloXroute / safety HTTP ◀───────────────────┘                  │
 │                                                                                                          │
 │  real SQLite(:memory:, real migrations) ──TEMP triggers──┐                                               │
 │  logger mock (op logs) ──────────────────────────────────┼──▶ ordered timeline ──▶ serializer            │
 │  node + relay submissions ───────────────────────────────┘                                │               │
 └──────────────────────────────────────────────────────────────────────────────────────────┼───────────────┘
                                                                                             ▼
                                              compare with committed LF recording ──▶ pass / fail
                                              (only the explicit update command writes)
```

### Recommended Project Structure

Names are at the planner's discretion. This is one coherent choice.

```
test/realpath/
├── harness/            # fakeNode, fakeWebSocket, relay + axios routers, clock, timeline, db capture, serializer, marker, seam self-check
├── harness.test.ts     # AC-01, AC-03, seam proofs
├── migrations/         # AC-04..06 golden tests and the frozen v4 fixture
├── triage/             # one file per root cause (D-10), named after the lead finding
├── scenarios/          # AC-19 recorded scenarios
├── recordings/         # one LF file per scenario, with its own .gitattributes
├── env/                # AC-27..29 matrix and snapshot
└── ordering/           # AC-30, AC-31
scripts/
├── check-realpath-mocks.ts   # AC-02
├── check-signing-census.ts   # D-20 (promoted), with --self-test
└── check-commit-taxonomy.ts  # AC-39..44, with --self-test
```

### Pattern 1: The `realpath` project and the seam self-check

**What:** a project-scoped alias, then an immediate proof that the fake transport really attached.
**When:** every worker, in harness setup. A silent miss here is the worst failure this harness can have.

```typescript
// vitest.config.ts, inside test.projects
// Source: measured this session (E1a-scope); values quoted in Verbatim Values below
{
    extends: true,
    resolve: { alias: [{ find: /^ethers$/, replacement: path.resolve(__dirname, 'node_modules/ethers/lib.commonjs/index.js') }] },
    test: {
        name: 'realpath',
        include: ['test/realpath/**/*.test.ts'],
        testTimeout: 15000,
        environment: 'node',
        mockReset: true,
        setupFiles: ['test/rails/setup.cjs'],
        globalSetup: ['test/rails/ledgerRun.ts'],
        env: { CSB_RAIL_PROJECT: 'realpath' },
    },
}
```

```typescript
// harness/seams.ts — run once per worker, before anything else
import { createRequire } from 'node:module';
import { ethers, FetchRequest } from 'ethers';

const req = createRequire(__filename);
const ethersCjs = req('ethers');
const ethersWs = createRequire(req.resolve('ethers'))('ws');

export function installSeams(FakeWebSocket: unknown, getUrl: unknown): void {
    if (FetchRequest !== ethersCjs.FetchRequest) throw new Error('harness: two ethers copies are loaded (the alias is missing)');
    ethersWs.WebSocket = FakeWebSocket;
    FetchRequest.registerGetUrl(getUrl as never);
    const probe = new ethers.WebSocketProvider('ws://127.0.0.1:1', 1);
    if (!(probe.websocket instanceof (FakeWebSocket as never))) throw new Error('harness: the WebSocket swap did not reach ethers');
    void probe.destroy();
}
```

The self-check also protects Phase 25: bumping ethers or `ws` may dedupe or move the nested copy, and this makes it fail loudly rather than quietly opening real sockets.

### Pattern 2: Stepping helper

```typescript
// Source: measured this session (E3, E8)
const TO_FAKE = ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'performance'];
vi.useFakeTimers({ now: FIXED_EPOCH_MS, toFake: TO_FAKE as never });

export async function stepUntil<T>(p: Promise<T>, stepMs = 10, maxSteps = 5000): Promise<T> {
    let done = false; let value!: T; let err: unknown; let failed = false;
    p.then((v) => { done = true; value = v; }, (e) => { done = true; failed = true; err = e; });
    for (let i = 0; i < maxSteps && !done; i++) await vi.advanceTimersByTimeAsync(stepMs);
    if (!done) throw new Error(`stepUntil: not settled; pending timers ${vi.getTimerCount()}`);
    if (failed) throw err;
    return value;
}
```

Add a sibling for deadlock findings (AUD-TX-001, AUD-TX-002, AUD-BUY-025, AUD-EXIT-009): `expectStillPending(p, virtualMs)`. Fake time makes "this never settles" provable with no sleeps, which AC-12 requires.

Do not fake `nextTick` or `queueMicrotask`. Vitest leaves them real by default, and mocking `nextTick` is unsupported on the forks pool [CITED: vitest v4.1.6 `vi.md`].

### Pattern 3: Simulated node

Prototype: 100 lines. Required behaviors, from what E3 and E8 exercised:

| Method | Rule |
|--------|------|
| `eth_chainId`, `eth_blockNumber`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_getBalance`, `eth_estimateGas` | Scenario-driven |
| `eth_getTransactionCount` | From node state, advanced on acceptance |
| `eth_sendRawTransaction` | `Transaction.from(raw)` (real), reject bad chain ID, nonce too low or too high with the real node's message text, return the real hash |
| `eth_getBlockByNumber` | Real block shape, including `transactions` (the Flashbots library's inclusion wait reads it) |
| `eth_getTransactionReceipt`, `eth_getTransactionByHash` | `null` until mined, then a complete receipt |
| `eth_call` | Read table keyed by address + 4-byte selector; missing entry is recorded and fails (D-03) |
| Relay `eth_callBundle`, `eth_sendBundle`, `flashbots_getBundleStatsV2` | Routed by URL; decode each signed tx with `Transaction.from`; `eth_sendBundle` is sent four times per attempt with the same bytes, so **dedupe by hash** |
| Anything else | Record, return JSON-RPC `-32601`, **and fail in `afterEach`** |

**AC-03 needs the `afterEach`.** Returning an error is not enough: E3c shows a caller's `catch` hides it, and `src/` has many such catches. Failing on the recorded list is what makes unknown methods loud.

### Pattern 4: Known-bug marker (D-07, D-08)

Prototyped and proven (E10). It wraps exactly one assertion; nothing else in the test is caught.

```typescript
function knownBug<T>(ctx: { task: { meta: Record<string, unknown> } }, id: string, spec: { correct: T; observed: T; actual: T }): void {
    if (deepEqual(spec.actual, spec.correct)) throw new Error(`${id} now behaves correctly: remove this marker (it looks fixed)`);
    expect(spec.actual, `${id}: the failure changed from what was recorded`).toEqual(spec.observed);
    ctx.task.meta.knownBug = { id, expected: spec.correct, actual: spec.actual };
}
```

`task.meta` reaches the JSON reporter, which is how the D-11 report and the D-21 "test carries this finding's ID" check can be generated from runs instead of hand-kept files. Under AC-11, a shared-cause file calls this once per entry.

### Pattern 5: Timeline and DB capture

```typescript
// Source: measured this session (E4a, E4c, capture comparison)
function installDbCapture(db: Database.Database, record: (e: DbEntry) => void): void {
    db.function('unixepoch', { varargs: true, deterministic: false }, (...args: unknown[]) => {
        if (args.length) throw new Error(`harness unixepoch: arguments are not supported: ${JSON.stringify(args)}`);
        return Math.floor(Date.now() / 1000);
    });
    db.function('__rec', { varargs: true, safeIntegers: true }, (table: string, op: string, ...cols: unknown[]) => {
        record({ kind: 'db', table: String(table), op: String(op), cols });
        return null;
    });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name } of tables) {
        const cols = (db.prepare(`PRAGMA table_info('${name}')`).all() as { name: string }[]).map((c) => c.name);
        const args = (pfx: string) => cols.map((c) => `${pfx}."${c}"`).join(',');
        db.exec(`CREATE TEMP TRIGGER __rec_${name}_i AFTER INSERT ON main."${name}" BEGIN SELECT __rec('${name}','insert',${args('NEW')}); END;`);
        db.exec(`CREATE TEMP TRIGGER __rec_${name}_u AFTER UPDATE ON main."${name}" BEGIN SELECT __rec('${name}','update',${args('NEW')}); END;`);
        db.exec(`CREATE TEMP TRIGGER __rec_${name}_d AFTER DELETE ON main."${name}" BEGIN SELECT __rec('${name}','delete',${args('OLD')}); END;`);
    }
}
```

Tests obtain the connection through the existing `import { db } from '.../utils/db'` (F2). Install the capture after each whole-graph reset, because each reset creates a new connection.

### Pattern 6: Recording file

One LF file per scenario (D-12), a header line with the tag, then one line per event (D-13). Never sort (AC-23). AC-22's empty case is an explicit `{"submitted":[]}` line.

The compare step reads raw bytes. Writes happen only behind the update command, and a test proves that a normal run with a changed recording fails without writing (AC-25).

The recording folder needs its own `.gitattributes` with `* text=auto eol=lf`, as `.planning/audit/.gitattributes` does.

### Pattern 7: Env matrix

```typescript
// Source: measured this session (E6b, E6d, E6e)
async function evaluate(env: Record<string, string | undefined>): Promise<Outcome> {
    vi.resetModules();
    applyEnv(env);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((c: unknown) => { throw new ExitCalled(c); }) as never);
    try {
        const { CONFIG } = await import('../../src/config');
        const { buildChainRegistry } = await import('../../src/chainRegistry');
        return { kind: 'ok', value: normalize({ CONFIG, registry: buildChainRegistry() }) };
    } catch (e) {
        return e instanceof ExitCalled ? { kind: 'exit', code: e.code } : { kind: 'threw', message: scrub(e) };
    } finally {
        exit.mockRestore();
    }
}
```

Mock the logger and capture `fatal` so the snapshot records *why* a case exited. The baseline must set all four chains enabled plus the three honeypot addresses (Flag 6). Each case stores only its diff against the baseline (D-16). Values must stay inert (AC-51): the sentinel file is safe, but `CONFIG.walletPrivateKey` will appear, so the secret scan must run over this snapshot.

### Pattern 8: Commit check

Proven on a throwaway repo with `core.autocrlf=true`:

| Need | Mechanism | Observed |
|------|-----------|----------|
| Commits to judge | `git rev-list --no-merges --reverse <first>..HEAD` | Inner branch commit included; merge excluded |
| First recording commit | `git log --diff-filter=A --format=%H --reverse -- <dir>` then the first line | Correct on a full clone |
| Changed files per commit | `git diff-tree --no-commit-id -r --no-renames --name-status <c> -- <dir>` | `M` for edits, `A` for new, **`D` + `A` for a rename**, so a rename counts as a delete and needs a `behavior:` commit |
| Merge commit | Not judged | `diff-tree` without `-m` prints nothing |
| Line endings | `.gitattributes` in the folder | Blob and working copy both LF under `autocrlf=true` |

**Shallow clones must fail closed.** Measured in a `--depth 1` clone: `git rev-parse --is-shallow-repository` returned `true`, and the "first recording commit" resolved to the single fetched commit. The check would then judge nothing and pass. Exit non-zero if shallow, and set `fetch-depth: 0` in `.github/workflows/test.yml`.

Other requirements:
- Git calls must live in `scripts/`. `spawnRailedChild` allows only `node` or `npx`, and `spawnSites.test.ts` bans spawners under `test/`. Follow the `seal-verify.ts --self-test` model and have a test run that self-test via `spawnRailedChild`.
- Call git with an argument array, never a shell string, because commit messages are untrusted input.
- Accepted IDs come from the real register: `.planning/audit/findings/*.json` and `.planning/audit/decisions/OD-*.json`.
- A `pull_request` run checks out a synthetic merge commit; `--no-merges` already handles it.

### Source-text search (CHAR-06, AC-37)

A search for `readFile`/`readFileSync` near `src`/`scripts` returned 34 files. Reading each [VERIFIED: this session]:
- The **11 named files all match** and are in scope.
- The 3 dashboard files are the named Phase 28 exception.
- Reads of fixtures, artifacts, `package.json` or hashes: `health`, `dbGuards`, `dbInit`, `honeypotDeploy.eth`, `envSentinel`, and the fork tests. Not source-text tests.
- Repo-wide scanners naming no file (out of scope per SPEC): `codeQuality`, `db.test.ts:669` (`collectTsFiles(srcDir)`), `ethersV5PatternsAbsent`, `ethersV6BigIntArithmetic`, `forkShellOnly`, `spawnSites`.

**The planner should re-run an AST version for AC-37**, because this one was a text search with manual review.

Two cautions. `test/unit/rails/dotenvSrcSkip.test.ts` is a rail test, so only case (e) should change. `test/unit/mainEntry.test.ts` parses the AST of a named file rather than asserting on text, but AC-37's wording ("reads a named ... file as text and asserts on it") still catches it, and it is on the SPEC's list.

### Anti-Patterns to Avoid
- **Assuming a fake attached because tests pass.** Without the self-check, real ethers talks to `127.0.0.1:1` or the fake sees nothing while behavior-free tests stay green.
- **`vi.fn()` inside a `vi.mock` factory.** `mockReset: true` wipes the implementation before each test, so `logger.child()` returns `undefined`. Use plain functions.
- **Installing `process.exit` spies in `beforeAll`.** Same cause (E6c).
- **Sorting anything in a recording.** D-13 and AC-23 depend on order.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signing, encoding, decoding, hashing | Fixture blobs or byte builders | Real ethers `Interface`, `AbiCoder`, `Transaction.from` | D-03/D-04; AC-48 |
| Signing-site detection | Regex | Promoted type-aware census | Aliases and contract runners need type information |
| Mock-target resolution | String match | The existing resolver in `check-vi-mock-paths.ts` | Path aliasing and Windows case |
| Time in tests | Sleeps, polling | Fake timers with `stepUntil` | AC-12 forbids sleeps |
| Finding "the first commit" by date | Timestamps | `git log --diff-filter=A` | Dates can be rewritten |
| Mining a real chain state | A partial EVM | Per-scenario read table | D-03; fork proof belongs to Phase 25 |

**Key insight:** the fake's job is to be a faithful counterparty for what the bot sends, not to simulate the EVM. Anything that requires real contract semantics is a fork obligation (AC-16), not a bigger fake.

## Common Pitfalls

### Pitfall 1: Silent seam failure (see F1)
**What goes wrong:** the fake never attaches and tests still run. **Why:** dual ESM/CJS builds and a nested `ws`. **How to avoid:** Pattern 1's self-check. **Warning signs:** `net-allow` in the rail ledger, or an `ECONNREFUSED 127.0.0.1:1` unhandled error.

### Pitfall 2: Unknown methods swallowed
**What goes wrong:** code catches the error and takes a fallback path, so the test passes on a path a real node would not take. **How to avoid:** Pattern 3's `afterEach`. **Warning signs:** a scenario's recording shows a fallback op log nobody intended.

### Pitfall 3: Crash findings run in the worker
**What goes wrong:** a real unhandled error gets reported by Vitest as a run failure, unrelated to the assertion. Observed in E1: `Unhandled Errors ... connect ECONNREFUSED`. **How to avoid:** run AUD-ANTIRUG-002, AUD-API-008, AUD-TX-009 and AUD-BUY-005 as child processes through `spawnRailedChild` and assert exit behavior. The child loads CJS natively, like production. D-02's real socket must use ethers' nested `ws@8.17.1`, which is the copy production runs. **Note:** `spawnRailedChild` can run `node`/`npx` only.

### Pitfall 4: Timeline non-determinism (AC-24, AC-26)
These must be normalized in the serializer, not at each call site:
- Error objects: name, code and message only. No `stack`.
- Absolute paths and `file:line` fragments in messages.
- ethers' error text contains `version=6.16.0`. Strip it, or DEPS-02 (ethers 6.17) produces a recording diff in every error line, each costing a D-18 entry.
- BigInt to whole-number text. JSON-RPC IDs in bodies can stay, since each provider's counter is deterministic per scenario.

Sources of entropy on trading paths are already limited: `Math.random` appears only in `dbPath.ts:36` and `processLock.ts:171`, and `uuid` only in `api/middleware/auth.ts:61` [VERIFIED: grep this session].

### Pitfall 5: Reset without re-capture
**What goes wrong:** after `vi.resetModules()` a new connection exists with no triggers, so DB writes vanish from the recording and scenarios appear to do less. **How to avoid:** make the reset and the capture install one helper. **Warning signs:** a recording with no DB lines on a buy.

### Pitfall 6: Recording landed too early
**What goes wrong:** the commit check judges everything after the first recording commit (AC-44), so harness fixes turn into D-18 entries. **How to avoid:** recording is the final Wave 3 step.

### Pitfall 7: Rail gates reject harness code
`spawnSites.test.ts` limits `.exec()` receiver names (Flag 4) and bans spawners under `test/`. `check:vi-mock` scans the new folder automatically. `capture-baselines.ts:63` lists only `unit` and `integration`, which is right under D-09: leave it alone. `vitestEnvFile.test.ts` copies project definitions and is unaffected by the alias [VERIFIED: read, this session].

### Pitfall 8: Env recorder scope
Recording `process.env` on a run that exits early under-reports the variables, and without a caller filter it over-reports library reads. Assert AC-27 coverage only from a fully valid baseline.

### Pitfall 9: Comparing migration SQL text exactly
`ALTER TABLE ... ADD COLUMN` writes `INTEGER , dex_name` where a fresh definition writes `INTEGER, dex_name` (E9). Compare `PRAGMA table_info`, `index_list` and `foreign_key_list`, with SQL text compared after whitespace is removed. The v4 fixture in AC-05 stays as a frozen historic fixture, which does not conflict with AC-07 (that AC concerns the helper).

### Pitfall 10: Mock list is wider than it looks
AC-02's "relay HTTP" must mean mocking `axios`, because bloXroute uses it. But `axios` also serves `goplus`, `honeypotIs`, `mudra`, `unicrypt`, `tokenSafety` and `notifier`, and ETH's safety path uses those (`safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'unicrypt', tokenSecurity: 'goplus' }`). Route every axios call by URL and fail loudly on an unknown URL, exactly like an unknown RPC method. The Telegram entry must cover `telegram`, `telegram/sessions` and `telegram/events`.

## Code Examples

See Patterns 1, 2, 4, 5 and 7, each taken from a prototype that ran this session.

### Verbatim values used above

Quoted from files opened this session. Marker token fresh for this block.

```
DATA_x7Kq2Vmd_START
src/utils/db.ts:554-555              export {\n    db,
src/utils/dbSchema.ts:11             export const CURRENT_SCHEMA_VERSION = 7;
src/utils/dbSchema.ts:25             timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
vitest.config.ts:31-32               testTimeout: 15000,
                                     environment: 'node',
vitest.config.ts:20-23               mockReset: true,
                                     setupFiles: ['test/rails/setup.cjs'],
                                     globalSetup: ['test/rails/ledgerRun.ts'],
                                     env: { CSB_RAIL_PROJECT: 'unit' },
node_modules/ethers/package.json     "import": "./lib.esm/index.js",  "default": "./lib.commonjs/index.js"
node_modules/ethers/package.json:18  "ws": "8.17.1"
ethers lib.esm/providers/ws.js       export { WebSocket } from "ws";
ethers lib.commonjs/providers/ws.js  var ws_1 = require("ws");
                                     Object.defineProperty(exports, "WebSocket", { enumerable: true, get: function () { return ws_1.WebSocket; } });
.planning/audit/tools/signing-census.ts:1429  if (fs.existsSync(path.join(root, '.git'))) throw new UsageError('--root must be a git archive snapshot, not a checkout (it has .git)');
.planning/audit/tools/signing-census.ts:1430  for (const bad of ['.env', 'data']) if (fs.existsSync(path.join(root, bad))) throw new UsageError(`--root holds ${bad}; ...`);
.planning/audit/tools/seal-verify.ts:515      ...splitNul(gitText(repo, ['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-merges=first-parent', range])),
.planning/audit/tools/check.ts:320   if (rc.length && d.status === 'NOT-A-BUG') add('status', `NAC-10: research candidate ${rc.join(', ')} may not be closed as NOT-A-BUG in Phase 22`);
test/unit/rails/spawnSites.test.ts:41  const SAFE_EXEC_RECEIVERS = new Set(['db', 'mockDb', 'fileDb', 'mem', 'w', 'attachRe', 'vacRe', 'entryRe']);
scripts/capture-baselines.ts:63      const PROJECTS = Object.freeze(['unit', 'integration']);
src/riskManager.ts:28                maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '10', 10),
test/.env.test:83                    DASHBOARD_PORT=8080
@vitest/runner chunk-artifact.js:3029-3037  if (test.fails) { if (test.result.state === "pass") {...fail...} else { test.result.state = "pass"; test.result.errors = undefined; } }
vitest base chunk:108-109            process.exit = (code = process.exitCode || 0) => { throw new Error(`process.exit unexpectedly called with "${code}"`); };
DATA_x7Kq2Vmd_END
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vi.mock('ethers')` | Real ethers on a fake transport | This phase (CHAR-01); wider rewrite is Phase 28 | Money-path bugs stop hiding behind mocks |
| Hand-written `user_version = 4` test schema | Real migrations | This phase (CHAR-05) | Removes drift (RC-28) |
| Vitest `it.fails` | One-assertion marker | Installed runner flips any non-pass to pass | D-07 |

**Deprecated/outdated:** `.planning/codebase/TESTING.md`, `CONVENTIONS.md`, `STRUCTURE.md` are stale (per CONTEXT). Read the code.

---

## Triage Work List (59 entries)

Computed from `.planning/audit/findings/*.json`: 290 total, 287 canonical, 49 canonical S0/S1. Candidates with `rc` = 34, other S0/S1 = 25, union **59**, matching the SPEC. Status today: 48 `confirmed`, 9 `candidate`, 2 `fixed`.

**The "Route" column is a suggestion from each entry's title and evidence fields, not a verified fact** [ASSUMED]; the planner and executors should adjust it.

Routes: **H** real-path harness test · **H-race** harness with forced event order (AC-12) · **C** child process via `spawnRailedChild` · **S** static proof (census/AST) · **R** closes as `fixed` by a rail · **M** manual (AC-15) · **F?** may be unprovable without a fork, so check against AC-16.

| ID | Sev | Status | RC | Route | Note |
|----|-----|--------|----|-------|------|
| AUD-BUY-001 | S0 | confirmed | - | H/C | Deliberate-buy script arming; the only S0 |
| AUD-BUY-002 | S1 | confirmed | RC-01 | H | Landed buy with no or failed row; recommended first |
| AUD-BUY-003 | S1 | confirmed | RC-02 | H | minOut fails open |
| AUD-BUY-004 | S1 | confirmed | RC-04 | H-race | Double buy |
| AUD-BUY-005 | S1 | confirmed | RC-05 | C | Unhandled rejection exits the process |
| AUD-BUY-006 | S1 | confirmed | RC-09 | H | Fake Telegram client |
| AUD-BUY-007 | S1 | confirmed | RC-16 | H + S | Census exception |
| AUD-BUY-008 | S1 | candidate | RC-20 | H-race | Reconnect |
| AUD-BUY-009 | S3 | confirmed | RC-24 | H | Alert text via notifier mock |
| AUD-BUY-010 | S1 | confirmed | - | H-race | Risk checks before record |
| AUD-BUY-011 | S1 | confirmed | - | H | Stop-chain still buying |
| AUD-BUY-015 | S1 | candidate | - | H / F? | Quoter semantics |
| AUD-BUY-025 | S1 | confirmed | RC-10 | H | Never-settling wait under lock |
| AUD-BUY-027 | S1 | confirmed | - | H | Non-wrapped-native pairs |
| AUD-BUY-028 | S1 | confirmed | - | H | Provider response via axios route |
| AUD-BUY-030 | S1 | candidate | - | H | Public buy nonce pinning |
| AUD-BUY-033 | S1 | candidate | - | H / F? | Calldata provable; stuck funds on-chain |
| AUD-DB-001 | S1 | confirmed | RC-06 | H | See F4 |
| AUD-DB-002 | S1 | confirmed | - | H | Real SQL with mixed units |
| AUD-DB-003 | S1 | confirmed | - | H | Status semantics |
| AUD-DB-004 | S1 | confirmed | RC-14 | H-race | Submit-before-row order |
| AUD-DB-005 | S3 | confirmed | RC-23 | C | Import order |
| AUD-DB-006 | S2 | confirmed | RC-25 | H/C | AC-14 open half |
| AUD-DB-007 | S1 | confirmed | - | H | Rail 22-09 mitigated; verify what remains |
| AUD-DB-021 | S2 | confirmed | RC-14 | S / F? | Pragma value provable; power loss is not |
| AUD-EXIT-001 | S1 | confirmed | RC-03 | H | OD-14 decision |
| AUD-EXIT-002 | S1 | confirmed | RC-07 | H | Recommended early |
| AUD-EXIT-003 | S1 | confirmed | RC-08 | H | |
| AUD-EXIT-004 | S2 | confirmed | RC-15 | H | Approval route and fee |
| AUD-EXIT-005 | S2 | confirmed | RC-21 | H-race | Poll overlap |
| AUD-EXIT-007 | S1 | confirmed | - | H | |
| AUD-EXIT-008 | S1 | confirmed | - | H | Dashboard route |
| AUD-EXIT-009 | S1 | confirmed | RC-10 | H | Never-settling wait |
| AUD-EXIT-013 | S1 | confirmed | - | H | Recommended early |
| AUD-EXIT-014 | S1 | confirmed | - | H-race | Sell lock |
| AUD-EXIT-015 | S1 | confirmed | - | H | Recommended early |
| AUD-ANTIRUG-001 | S1 | confirmed | RC-13 | H-race | Fake WS close and reconnect |
| AUD-ANTIRUG-002 | S1 | confirmed | - | C | D-02 real socket |
| AUD-ANTIRUG-003 | S1 | candidate | - | H | Circuit-breaker counting |
| AUD-ANTIRUG-004 | S1 | confirmed | - | H | |
| AUD-ANTIRUG-005 | S1 | confirmed | - | H | Backfill |
| AUD-API-001 | S1 | confirmed | - | H | Dashboard route |
| AUD-API-002 | S1 | confirmed | RC-12 | H | Listener removal |
| AUD-API-008 | S1 | confirmed | - | C | Malformed Host header |
| AUD-TX-001 | S1 | confirmed | RC-10 | H-race | Real `withNonceLock`; deadlock via `expectStillPending` |
| AUD-TX-002 | S1 | confirmed | RC-10 | H | |
| AUD-TX-003 | S1 | confirmed | RC-11 | H-race | Head-of-line blocking |
| AUD-TX-004 | S1 | fixed | RC-17 | R | AC-13 |
| AUD-TX-005 | S1 | fixed | RC-18 | R | AC-13 |
| AUD-TX-006 | S3 | candidate | RC-26 | M | AC-15, operator approval first |
| AUD-TX-007 | S2 | confirmed | RC-22 | H | Note: the fake must return real fee fields |
| AUD-TX-009 | S1 | confirmed | - | C | Bundle-wait crash |
| AUD-RAIL-001 | S1 | confirmed | - | R | AC-13; past event |
| AUD-RAIL-002 | S1 | candidate | RC-19 | R | AC-13 |
| AUD-TESTI-011 | S1 | candidate | RC-19 | R | AC-13 |
| AUD-TESTU-001 | S1 | candidate | RC-19 | R | AC-13 |
| AUD-TESTI-001 | S2 | confirmed | RC-28 | R | Not in AC-13: the fix is this phase's CHAR-05 work, and the AC-07 test is the pointer |
| AUD-SCRIPTS-001 | S3 | confirmed | RC-27 | S | Module-resolution check |
| AUD-SCRIPTS-002 | S1 | confirmed | - | S | 12 census exceptions; card SCRIPTS-01 stays open |

**Suggested batches** by shared harness need, to reduce rework: (1) buy path, (2) exit path, (3) nonce and lock, (4) WebSocket lifecycle and anti-rug, (5) risk and DB SQL, (6) dashboard routes, (7) crash-class child probes, (8) closures and static proofs.

---

## Suggested Plan Shape

Operator preference is few large plans, with risk isolated at plan and commit level.

**Wave 1 (foundation; everything depends on it).**
1. Harness: project config, seams and self-check, fake node, fake WebSocket, relay and axios routers, clock, DB capture, marker, mock-list check. Prove AC-01 to AC-03.
2. Migrations and helper: real-migration `createTestDb`, golden tests, the two F5 edits (AC-04 to AC-07).

**Wave 2 (triage, parallel by batch; D-10 prevents file conflicts).**
3. Register tooling first: `check.ts:320` change and D-21 enforcement with self-tests.
4. Batched triage plans (see the batches above).
5. Candidate 26 manual request (operator approval first).
6. D-11 report, successor seal and the `seal-verify.ts:515` fix (D-19).

**Wave 3 (characterization).**
7. Census promotion (standalone, can run in parallel).
8. Source-text conversions.
9. Env matrix and ordering/identity tests.
10. Golden-master scenarios and recordings, **then** the commit check, which must be the last thing to land.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The per-entry Route in the triage table | Triage Work List | Low: a planner or executor adjusts; a few may need a different route |
| A2 | `DASHBOARD_PORT=0` gives an ephemeral port for boot tests | Open Question 3 | Low: otherwise serialize boot tests or use distinct ports |
| A3 | `safeIntegers: true` on `db.function` behaves as documented with trigger arguments | Pattern 5 | Low: the option is documented, but this exact combination was not run |
| A4 | The whole real buy path runs on this harness with only additive fake data | Open Question 1 | Medium: Wave 1 could surface extra RPC methods or fixtures; the architecture is proven, the full assembly is not |
| A5 | The ETH safety path can be driven by routed axios responses without further mocks | Pitfall 10 | Medium: an extra seam could be needed, which AC-02 would forbid |

## Open Questions (RESOLVED)

Resolved 2026-11-09 by the plan-phase orchestrator. Question 2 was ruled by the operator. The others adopt the recommendation given and fall under the planner's discretion in CONTEXT.md.

1. **The assembled buy has not been run.** RESOLVED: AC-01 is the first task of Wave 1, so any surprise appears before anything depends on it.
   - What we know: the real listener path (E1d) and the real Flashbots submission path (E8) each work on the fake.
   - What's unclear: the join through `bot.ts` safety checks, which need checker `eth_call` tables and routed axios responses.
   - Recommendation: make AC-01 the first task of Wave 1, so any surprise appears before anything depends on it.

2. **Should the env snapshot include `src/riskManager.ts`? (F4)** RESOLVED: yes, by operator ruling on 2026-11-09. See SPEC Amendment A-1.
   - What we know: AC-27 names two files, and neither reads the five risk variables behind AUD-DB-001 and CAP-06.
   - What's unclear: operator intent, since D-16 assumes coverage that AC-27 does not provide.
   - Recommendation: add it, by one-line operator ruling at the first checkpoint. Cost is negligible and it matches D-16's reason. Plain-language wording: "The bad-settings test covers two files. The risk limits are read in a third file. Include it?"

3. **How do AC-30 boot tests handle the dashboard server?** RESOLVED: bind `127.0.0.1` with `DASHBOARD_PORT=0`, keep the boot tests in one file, and verify the port behavior in that plan's first task (Assumption A2).
   - What we know: `startMultiChainBot` calls `startApiServer`, which listens at `src/api/server.ts:211` on `DASHBOARD_PORT` (sentinel `8080`). AC-02 does not allow mocking the API server. The 6 existing boot tests are outside this list's limit.
   - Recommendation: bind `127.0.0.1` with `DASHBOARD_PORT=0`, which the rails allow, and keep boot tests in one file. Verify in the plan's first task [ASSUMED].

4. **What should the exception list hold for the two non-signing sites? (F3)** RESOLVED: a separate `excluded` section with the auditor's evidence, kept apart from the 13 known unlocked entries.
   - Recommendation: a separate `excluded` section keyed by `file|enclosing|call` with the auditor's evidence, kept apart from the 13 `known unlocked` entries. AC-53 requires an operator ID only for unlocked exceptions, so the two auditor exclusions (already recorded in `manual-inventory-head.json`) should be carried with that reference.

5. **Rolled-back writes in recordings.** RESOLVED: capture `db.inTransaction`, and fail any scenario that records a write inside a transaction until the harness handles rollback.
   - What we know: they appear today but no trading path uses a transaction.
   - Recommendation: have the recording function capture `db.inTransaction`, and make any scenario that records a write inside a transaction fail until the harness handles rollback. That way Phase 24 cannot quietly introduce a phantom.

6. **Non-ETH routes are fail-closed.** RESOLVED: each non-ETH scenario sets its `*_HONEYPOT_CHECKER_ADDRESS` to a fake-table address as scenario configuration. AC-19 needs bloXroute and public-route scenarios, yet BSC, Base and Arbitrum have no default checker address. Each scenario must set `*_HONEYPOT_CHECKER_ADDRESS` to a fake-table address. This is scenario configuration and not a behavior change. Whoever builds it should confirm that the safety path then runs as it would for ETH.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22.16.0 (absolute path) | Everything; better-sqlite3 ABI 127 | ✓ | v22.16.0 | None needed |
| vitest | Tests | ✓ | 4.1.1 | — |
| TypeScript compiler API | Census, mock-list check | ✓ | 5.8.3 | — |
| git | Commit check | ✓ | system | — |
| Loopback TCP under rails | D-02, boot tests | ✓ | `net-allow` recorded in ledger | — |
| Hardhat / fork RPC | — | Not used | — | AC-16: fork run deferred to Phase 25 |

**Missing dependencies with no fallback:** none. **Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 |
| Config file | `vitest.config.ts`, add the `realpath` project (see Pattern 1) |
| Quick run command | `N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0; PATH="$N22:$PATH"; npx vitest run --project realpath` |
| Full suite command | `N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0; PATH="$N22:$PATH"; npm test` (after adding `--project realpath` to the script) |

The `realpath` project ran each prototype in 1 to 3 seconds. A full run of about 60 triage files plus 18 or more scenarios should stay well under a minute, based on E3 and E8 per-scenario timing and about 25 ms per whole-graph reset [ASSUMED: extrapolated].

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHAR-01 | AC-01 one buy decodes to expected swap | integration | `npx vitest run --project realpath harness` | ❌ Wave 1 |
| CHAR-01 | AC-02 forbidden mock fails the check | gate + self-test | `npx ts-node scripts/check-realpath-mocks.ts --self-test` | ❌ Wave 1 |
| CHAR-01 | AC-03 unknown method fails the test | integration | `npx vitest run --project realpath harness` | ❌ Wave 1 |
| CHAR-05 | AC-04..06 golden migrations | integration | `npx vitest run --project realpath migrations` | ❌ Wave 1 |
| CHAR-05 | AC-07 helper at current version | unit | `npx vitest run --project unit helpers.smoke db.test` | ✅ needs edit (F5) |
| AUDIT-02 | AC-08..18 outcomes | register + tests | `npx ts-node .planning/audit/tools/check.ts --stage final` and `npx vitest run --project realpath triage` | ❌ Wave 2 |
| CHAR-02 | AC-19..26 scenarios, determinism | integration | `npx vitest run --project realpath scenarios` (3 times for AC-24) | ❌ Wave 3 |
| CHAR-03 | AC-27..29 env matrix | integration | `npx vitest run --project realpath env` | ❌ Wave 3 |
| CHAR-04 | AC-30, AC-31 ordering | integration | `npx vitest run --project realpath ordering` | ❌ Wave 3 |
| CHAR-04 | AC-32..36 census | gate + self-test | `npx ts-node scripts/check-signing-census.ts --self-test` | ❌ Wave 3 |
| CHAR-06 | AC-37, AC-38 conversions | suite | `npx vitest run --project unit --project integration` | ✅ 11 files to convert |
| AUDIT-06 | AC-39..44 | gate + self-test | `npx ts-node scripts/check-commit-taxonomy.ts --self-test` | ❌ Wave 3 |
| Prohibitions | AC-46 to AC-53 | mixed | AC-49 count check, AC-51 secret scan named at plan time; the rest by review | ❌ |

Every automated command must be prefixed with the `N22` line above when run in Bash.

### Sampling Rate
- **Per task commit:** the `realpath` command for the touched folder.
- **Per wave merge:** `npm test`, plus `npm run check:vi-mock` and each new gate.
- **Phase gate:** full suite green, gates green, AC-24's three identical runs, and AC-10's three-run stability, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `vitest.config.ts`: `realpath` project with the alias
- [ ] `test/realpath/harness/`: seams, node, socket, clock, capture, serializer, marker
- [ ] `scripts/check-realpath-mocks.ts`
- [ ] `package.json`: `test` updated, plus `test:realpath` and the new check commands
- [ ] `.github/workflows/test.yml`: `fetch-depth: 0` and the new steps

No framework install is needed.

## Security Domain

Security enforcement is enabled (the key is absent, so it defaults on). This phase is test-only and adds no production surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface added |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Commit messages and paths in the commit check are untrusted: argument-array git calls, strict ID regex plus register lookup |
| V6 Cryptography | no | Real ethers used only with inert sentinel keys; no key generation added |
| V7 Error Handling and Logging | yes | Serializer strips stacks and paths; AC-51 secret scan over recordings and env snapshots |
| V14 Configuration | yes | Rails stay on; the update command is the only writer (AC-25) |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Real key or URL written into a recording | Information disclosure | Inert sentinels only, plus a secret scan gate (AC-51). `CONFIG.walletPrivateKey` appears in env output, so the scan must include snapshots |
| Candidate 26 manual request uses a real key | Spoofing / disclosure | Throwaway unfunded key, operator approval first, outside the test run (AC-15) |
| Fake responses a real node could not return | Tampering | Review of fake data (AC-48); real message text for nonce errors |
| Recording silently re-blessed | Tampering | Commit check; explicit update command; tag lives in the file so a flip is a diff |
| Commit-check bypass through a shallow clone | Elevation | Fail closed when shallow (Pattern 8) |
| Rail regression via harness code | Tampering | Rails remain in `setupFiles`; mock-list check covers the folder without exceptions |

## Sources

### Primary (HIGH confidence)
- Experiments run this session against the installed packages (E1 to E10, git mechanics, census): outputs quoted above.
- Source read this session: `src/utils/db.ts`, `dbSchema.ts`, `dbPath.ts`, `nonceAuthority.ts`, `provider.ts`, `config.ts`, `chainRegistry.ts`, `riskManager.ts`, `guards/*`, `mevStrategies/flashbots.ts`, `test/rails/core.cjs`, `spawnRailedChild.ts`, `spawnSites.test.ts`, audit tools, `node_modules` for ethers, ws, Flashbots bundle, Vitest runner.

### Secondary (MEDIUM confidence)
- Context7 `/vitest-dev/vitest/v4.1.6`: `vi.useFakeTimers`, `fakeTimers.toFake`, projects `extends`. https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/vi.md
- Context7 `/websites/ethers/v6`: `FetchRequest.registerGetUrl`, `lockConfig`. https://docs.ethers.org/v6/api/utils/fetching
- Context7 `/wiselibs/better-sqlite3/v12.6.2`: `.function()` options, `safeIntegers`. https://github.com/wiselibs/better-sqlite3/blob/v12.6.2/docs/api.md

### Tertiary (LOW confidence)
- None relied on.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. No additions; versions read from installed packages.
- Architecture: HIGH for each seam (run). MEDIUM for the assembled buy (not joined yet).
- Pitfalls: HIGH. Nearly all observed directly.
- Triage routes: LOW. Suggested from titles and evidence fields only.

**Research date:** 2026-11-09
**Valid until:** Phase 25's dependency upgrades (ethers, ws, better-sqlite3 13). The seams in F1 are version-sensitive, and the Pattern 1 self-check exists to catch that. Otherwise about 30 days.
