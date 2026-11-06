# Pitfalls Research

**Domain:** Audit + deep restructure + lint burn-down + all-majors toolchain upgrade of a live, real-money TypeScript MEV sniper bot (ethers v6 BigInt, Flashbots private submission, better-sqlite3 WAL, Express 5, gramjs, Hardhat-deployed checker)
**Researched:** 2026-11-06
**Confidence:** HIGH for repo-grounded pitfalls (each one was checked by grep, by reading the code, or by running it on this Windows box). MEDIUM-HIGH for upgrade pitfalls. Each upgrade claim was checked against the official release notes or migration guide and against the npm registry (`npm view`). The research-seam rating for web-sourced findings that were cross-checked is MEDIUM.

> **How to read this.** Every pitfall gives a concrete example from this repo (file:line as of commit `c110201`), a prevention that is a *check, test, rule, or ordering*, and the phase that owns it. Phase names are descriptive (the roadmapper assigns numbers):
>
> | Tag | Suggested phase |
> |-----|-----------------|
> | **[RAILS]** | Safety rails & baseline: test isolation, env/DB guards, singleton guards, lint/format infra *without* fixes |
> | **[AUDIT]** | Adversarial audit → findings register |
> | **[CHAR]** | Characterization tests (behavior lock) |
> | **[LINT]** | ESLint burn-down (mechanical) |
> | **[RESTRUCT]** | Split bot.ts / detector.ts / exitEngine.ts, reorganize src/ by domain, dissolve utils/ |
> | **[DEPS-RT]** | Runtime dependency upgrades (ethers, better-sqlite3, dotenv, uuid, express/audit) |
> | **[TOOLCHAIN]** | TS 6→7, ESLint 10, Vitest 5, formatter, ts-node replacement, (optional) ESM |
> | **[HH3]** | Hardhat 3 / Ignition / contracts tooling |
> | **[FIX]** | Bug fixes (capital-safety ones get D-STOP-THE-LINE treatment) |
> | **[TESTQ]** | Test-suite quality: rewrite mock-the-mechanism tests |
> | **[CI]** | CI hardening gates |
> | **[HYGIENE]** | Dashboard / scripts / repo hygiene / docs |
> | **[REENTRY]** | Fork rehearsal + live ETH roundtrip re-entry gate |

---

## Critical Pitfalls

### Pitfall 1: Test runs reach production state (real `.env`, real DB, real Telegram, real key)

**What goes wrong:**
A test that thinks it is mocked actually runs the real module. It opens and migrates `data/bot.db` (the live-proven prod DB), sends real Telegram alerts to the operator's phone, or holds a provider wired to the real `PRIVATE_KEY`. The usual trigger is a restructure: a file moves, and the `vi.mock('../../../src/utils/db')` string literal no longer matches the import the code under test now uses.

**Why it happens (this repo, verified):**
- `vitest.config.ts:2-4` calls `dotenv.config()`, so **every test process loads the real `.env`**: `PRIVATE_KEY`, RPC URLs, `TELEGRAM_BOT_TOKEN`, `DB_PATH`.
- `src/utils/db.ts:9,17` opens `process.env.DB_PATH || ./data/bot.db` **at import time**. It runs `migrateSchema()` (db.ts:235) and the JSON-state migration, which renames `.bot-state.json` to `.bak`, also at import time.
- `src/utils/notifier.ts:6,10` loads dotenv and builds the Telegram URL from the real token at import time.
- 44 test files mock `utils/db` and 34 mock `utils/notifier` (per-path counts: 36+8 and 31+3), all **by relative path string**. Vitest does not warn when a `vi.mock` path matches nothing, so after a move the mock silently stops applying. Vitest also never intercepts `require()` (official docs), and `bot.ts:2344` does `require('./utils/db')` inside shutdown cleanup.
- `data/bot.db-wal` (164 KB, newer than `bot.db`) holds un-checkpointed live-roundtrip state. A test that opens this DB, or a migration a test triggers, mutates it.

**How to avoid:**
1. **[RAILS]** Stop loading `.env` in `vitest.config.ts`. Add a `test/setup/env.ts` (`setupFiles`) that sets known dummy values: a throwaway `PRIVATE_KEY`, `DB_PATH=:memory:` or a per-worker temp file, `TELEGRAM_BOT_TOKEN=test`.
2. **[RAILS]** Add a production-DB tripwire to the DB module: if `process.env.VITEST` is set and the resolved DB path equals the real `data/bot.db`, throw.
3. **[RAILS]** Block outbound network in unit and integration tests. Allow only `127.0.0.1` (for example an undici `MockAgent` with `disableNetConnect`, plus an axios adapter guard). Real Telegram/RPC traffic then fails loudly.
4. **[CI]** Add a gate script that parses every `vi.mock('<relative path>')` in `test/**`, resolves it against the test file, and fails if no `.ts` exists at that path. This catches vacuous mocks the day of the move.
5. **[RESTRUCT]** Convert the inline `require('./utils/db')` in shutdown to a static import (or an injected `closeDb`), so mocks apply to it.

**Warning signs:** Tests still green right after a file move. `data/bot.db` mtime changes after `npm test`. Telegram messages arrive during a test run. `user_version` on the prod DB changes without a boot.

**Phase to address:** [RAILS] (must land before [CHAR] and [RESTRUCT]); vi.mock-path gate in [CI].

---

### Pitfall 2: "Fixing" floating promises changes concurrency, ordering, and the single-listener invariant

**What goes wrong:**
The 26 `no-floating-promises` and 16 `no-misused-promises` sites are mostly **deliberate fire-and-forget calls inside event listeners and poll loops**. Adding `await` to satisfy the rule silently serializes work that was concurrent, re-orders state mutation behind an `await`, or opens a re-entrancy window.

**Concrete sites (verified with `npx eslint src -f json`):**
- `bot.ts:1583,1586,1644,1669`: `handleNewPairForChain(...)` and `handleNewV3PoolForChain(...)` are fired per event inside WS listeners and inside `for (const event of events)` in the HTTP-polling `setInterval(async …)`.
  - Awaiting them serializes snipes: the 2nd pair in a block waits for the 1st snipe's entire Flashbots inclusion ladder.
  - In the polling loop, `lastBlock = currentBlock` runs *after* the loop. With `await` inside, the next 2 s tick re-queries the same block range, so the same pairs are handled twice (dedup becomes the only defense).
- `detector.ts:644,655`: `ctx.wsProvider.off(state.activeFilter, …)` and `ctx.wsProvider.on(filter, dispatcher)`. In ethers v6, `on` and `off` are `async` and return Promises (verified in `node_modules/ethers/lib.commonjs/providers/abstract-provider.js:1063,1140`). If someone writes `await …on()`, then `state.activeDispatcher = dispatcher` moves after an await. A concurrent re-install (reconnect plus a new position registration) passes the `if (state.activeDispatcher)` check before either side assigns. Result: two dispatchers, every Burn/Sync dispatched twice. That **breaks the "single anti-rug listener per chain" invariant** and double-fires exit triggers.
- `detector.ts:2101+` (`handleV3BurnArrival`) and the 1850 block handler: `ctx.httpProvider.off('block', blockHandler)` is followed by `pendingV3Burn.delete(poolKey)` and then `await evaluateV3MultiSignal(…)`. If an `await` is placed before the delete, a second block tick can see the pending entry and evaluate twice.
- `bot.ts:2360`: `startMultiChainBot()` floats at top level. There is **no `process.on('unhandledRejection')` handler anywhere in `src/`** (verified), so a startup rejection currently crashes the process (fail-stop).

**How to avoid:**
- **[LINT]** Before touching any site, classify it in the findings register:
  - (a) *intentional concurrency* → `void p.catch(handleFailure)`, with no `await`.
  - (b) *must complete before continuing* → `await`, and only with a characterization test of the ordering.
- Rule: **never introduce `await` into an event handler, dispatcher, or poll loop in a lint commit.** That is a behavior change and needs a `behavior:` commit plus an operator decision.
- Rule: **all state mutation that guards re-entry (`activeDispatcher =`, `pendingV3Burn.delete`, lock acquire) happens synchronously before the first `await`.** Add an inline comment naming the invariant.
- `.catch(log)` is not automatically safe. For *startup* promises (listener installation, anti-rug arming, `startMultiChainBot`), log-and-continue is **fail-open**: the bot runs with an unmonitored position or a dead listener. The catch must escalate (log fatal, set `process.exitCode = 1`, run shutdown).
- **[CHAR]** Add an ordering test: two `PairCreated` events in the same block must both reach the snipe gate concurrently (observable as two in-flight submits). Add a listener test: after N re-installs, `provider.listenerCount(filter) === 1`.

**Warning signs:** The fix diff contains `await` inside `.on(` callbacks or `setInterval` bodies. Anti-rug logs show the same `tx_hash` evaluated twice. Snipe latency for the second pair in a block grows to match the first pair's inclusion time.

**Phase to address:** [LINT] (classification is a prerequisite) with [CHAR] ordering tests first.

---

### Pitfall 3: Wrapping listeners for `no-misused-promises` breaks `.off()` by identity

**What goes wrong:**
The standard fix is `emitter.on('x', (a) => void handler(a))`. The new arrow is a *different function*, so every later `emitter.off('x', handler)` silently does nothing.

**Concrete sites:**
- `detector.ts:1850,1909,2119,2133,2138,2167,2189`: block handlers are registered with `ctx.httpProvider.on('block', blockHandler)` and removed later by reference. `pendingV3Burn` even **stores** `blockHandler` (detector.ts ~2150) so that `handleV3CollectArrival` can `off()` it.
  - Wrap at the `.on` site and the WR-06 "LAST-WINS" cleanup stops working. The handler runs on every block forever and re-runs `evaluateV3MultiSignal`: repeated RPC load, and possibly repeated anti-rug exits.
- `bot.ts:1568,1607`: `(newWsProvider.websocket as any).on('close', handleWsClose)`. Also `telegramListener.ts:72` (`client.addEventHandler(async …)`).

**How to avoid:**
- **[LINT]** Fix at the **definition**, not the registration: `const blockHandler = (n: number): void => { void run(n).catch(onErr); };`. The same reference is then registered, stored, and removed.
- **[CHAR]/[TESTQ]** Add a real-path test: Burn → Collect → assert `provider.listenerCount('block')` returns to baseline. Burn → Burn (LAST-WINS) → assert exactly one block listener.

**Warning signs:** `listenerCount('block')` grows with open positions. RPC usage creeps up per block. The `antirug.v3-burn-grace-window` op logs repeat for a pool that was already resolved.

**Phase to address:** [LINT], with the listener-count test written in [CHAR].

---

### Pitfall 4: Duplicate module instances silently break mutual exclusion (nonce lock, exit mutex, anti-rug registry)

**What goes wrong:**
Every capital-safety invariant here is a **module-level singleton**:
- `nonceAuthority.ts:43`: `chains` Map (withNonceLock)
- `exitManager.ts:14,53,104`: `sellingTokens`, `queuedPositions`, `timerRegistry`
- `exitEngine.ts:1421`: `const exitWorker = new ExitWorker()`
- `detector.ts:192,197,247`: `positionRegistry`, `chainState`, `pendingV3Burn`
- `circuitBreaker.ts:73-83`, `riskManager.ts:40`

A second copy of any of these modules gives two independent locks. Two sells for one wallet can then run concurrently, which is exactly the nonce-collision/double-spend class Phase 21.2 eliminated.

**Ways it happens here (verified on this machine):**
1. **Windows path-case aliasing.** NTFS is case-insensitive and `core.ignorecase=true`. Requiring `./lock.js` and then `./LOCK.js` gives **two different instances in both CJS and ESM** (tested on Node v24.18.0). A restructure that renames `utils/` → `Execution/`, or a hand-typed import with the wrong case, creates a second lock that works fine locally.
2. A "compat shim" left at the old path that **re-declares** instead of re-exporting (`export const chains = new Map()` copied, rather than `export * from '../execution/nonceAuthority'`).
3. Splitting `exitEngine.ts` so two modules each `new ExitWorker()`, for example one for the poll loop and one for the dashboard emergency-sell route (`api/routes/controls.ts`).
4. ESM/CJS dual loading. See Pitfall 13: this is verified for ethers itself.
5. **Two bot processes.** `withNonceLock` is per-process. If npx swallows Ctrl+C on Windows (a known issue for this operator) the old bot is still alive; starting a new one gives two processes trading the same wallet. **There is no single-instance guard in `src/` today** (verified: no pid/lockfile logic).

**How to avoid:**
- **[RAILS]** Add a runtime singleton guard to each lock module: `const KEY = Symbol.for('csb.nonceAuthority'); if (globalThis[KEY]) throw new Error('duplicate nonceAuthority instance'); globalThis[KEY] = true;`. This fails closed on any duplicate load.
- **[RAILS]** Add a single-instance process lock at boot: an exclusive lock file with PID liveness, or an exclusive SQLite lock row. A second bot refuses to start. This guards the live roundtrip directly.
- **[RAILS]/[CI]** Set `forceConsistentCasingInFileNames: true` explicitly in **all three** tsconfigs (today it is only in `tsconfig.bot.json`). Run CI on Linux, which is already the case and catches case mismatches.
- **[RESTRUCT]** Shims must be pure re-exports, enforced by a test: `import * as a from old; import * as b from new; expect(a.withNonceLock).toBe(b.withNonceLock)`.
- **[RESTRUCT]** Use `git mv` for case-only renames and do it in two steps (`a → tmp → A`); `core.ignorecase` otherwise drops the change.

**Warning signs:** The singleton guard throws. Two `op: 'boot'` log lines without a shutdown between them. "nonce too low" or "replacement underpriced" errors on a quiet wallet.

**Phase to address:** [RAILS] for the guards; [RESTRUCT] for shims and renames.

---

### Pitfall 5: Init order and import-time side effects shift when files are split, barreled, or converted

**What goes wrong:**
Several modules read `process.env` or perform I/O **at import time**, so their behavior depends on which module is evaluated first:
- `config.ts:2-4` imports `logger` **before** calling `dotenv.config()`. `logger.ts:7` reads `process.env.LOG_LEVEL` when it is evaluated, so **`LOG_LEVEL` in `.env` is currently ignored** unless it is also set in the shell. This is a latent bug, found by inspecting CJS require order.
- `db.ts:9,17,235` reads `DB_PATH`, opens the DB, and migrates at import. `notifier.ts:6,10` builds the Telegram URL at import.
- `preflight.ts:59-64` *deliberately* type-only-imports `chainRegistry` to avoid a mid-test `dotenv.config()` re-injection.
- `alphaDrop.ts:35,46` uses `await import('./bot')`, a lazy cycle-breaker. `bot.ts:2344` lazily requires db.

What can change the order:
- A new barrel (`src/execution/index.ts`) imported above `./config` in the entry causes `db.ts` to evaluate first. It then opens the default `./data/bot.db` instead of the `.env` `DB_PATH`.
- Turning on `verbatimModuleSyntax`, which native TS stripping and modern ESM setups need, **stops TypeScript from eliding unused imports**. Today's 15 unused imports in `bot.ts:3-17` are elided at compile time. Under verbatim syntax, any of them that point to side-effecting modules start executing, at a new point in the order.
- ESM evaluates all static imports before any module body, and lazy `require`/`import()` cycle-breakers tend to become static imports during cleanup.

**How to avoid:**
- **[RAILS]/[RESTRUCT]** Load env once, explicitly, first. A single `src/env.ts` is the first import of every entry (`bot`, `preflight`, `pause`, `resume`, scripts). No other module calls `dotenv.config()`; remove it from `notifier.ts` and `config.ts`.
- **[RESTRUCT]** Replace import-time side effects with explicit `init()` functions called by the composition root in a documented order (env → logger → db(open, migrate) → providers → registries → listeners). Keep `db.ts` free of top-level `new Database()`.
- **[RESTRUCT]** Add an import-graph gate: `madge --circular src` must report zero cycles, which also flags new cycles created by splitting. Add a boot-order test: import the entry with spies on `init()` functions and assert the call order.
- **[CHAR]** Before fixing the `LOG_LEVEL` ordering bug, log it in the findings register. "Fixing" it changes log volume and may log more sensitive fields at `debug`, so it is a `behavior:` change.

**Warning signs:** `madge` reports a cycle that didn't exist before. A fresh `data/bot.db` appears in an unexpected cwd. The log level changes after a refactor-only commit.

**Phase to address:** [RAILS] (env loader) → [RESTRUCT] (init functions, cycle gate).

---

### Pitfall 6: `||` → `??` (prefer-nullish-coalescing) changes env-default and numeric semantics

**What goes wrong:**
`prefer-nullish-coalescing` is not in the current `recommendedTypeChecked` preset. It arrives the moment the "modern quality bar" adopts `strictTypeChecked`/`stylisticTypeChecked`. It treats `''`, `0`, and `NaN` differently from `||`, and this repo has **30 `process.env.X || default` sites**.

**Concrete, verified failure modes (each run under Node):**
- `preflight.ts:837-838`: `Number(process.env.STALE_WARN_SEC) || 120`. With `??`, an unset var gives `NaN ?? 120 = NaN`, so every comparison is false and **the stale-data check never fires**. An empty var gives `Number('') ?? 120 = 0`, so it always fires.
- `api/server.ts:208`: `process.env.DASHBOARD_HOST || '127.0.0.1'`. With `??`, an empty `DASHBOARD_HOST=` line gives `listen(port, '')`, which **binds `::` (all interfaces)** (verified). The controls/emergency-sell API is then exposed to the LAN.
- `chainRegistry.ts:644` (`ENABLED_CHAINS || 'eth'`), `:663` (`<PREFIX>_SNIPE_AMOUNT || default`), and `:694` (`<PREFIX>_HONEYPOT_CHECKER_ADDRESS || default`). With `??`, an empty `.env` value becomes `''`: an empty chain list, a `parseEther('')` throw, or a `''` checker address.
- The inverse risk on BigInt: `0n` is falsy, so `bal || fallback` replaces a legitimate zero balance. Current money code mostly uses `?? 0n` correctly (`flashbots.ts:166-178`, `passthrough.ts:62-78`). Keep it that way.

**How to avoid:**
- **[RESTRUCT]/[FIX]** Move all env parsing into one typed module with explicit rules: `''` = unset, numeric parse failure = **boot error** (fail-closed), addresses validated with `getAddress`. After that, `||` vs `??` stops mattering at call sites.
- **[CHAR]** Snapshot-test the resolved `buildChainRegistry()` plus risk/exit config for an env matrix of `{unset, '', '0', 'abc', valid}` on every money-relevant var. Any drift fails.
- **[LINT]** If `prefer-nullish-coalescing` is enabled, set `ignorePrimitives: { string: true, number: true }` until the env module lands. Never accept its suggestions in bulk.

**Warning signs:** A lint commit touches `process.env` lines. The dashboard is reachable from another LAN machine. Preflight stops reporting stale data.

**Phase to address:** [CHAR] (config snapshot) before [LINT]; env module in [RESTRUCT].

---

### Pitfall 7: Mechanical type fixes that lie about runtime types (no-unsafe-*, assertions, strict presets)

**What goes wrong:**
The 102 `no-unsafe-assignment`, 78 member-access, and 33 call errors come mostly from ethers `Contract` methods, which return `any`. The fastest "fix" is `as number` or `as bigint`. That silences the linter and encodes a lie.

**Concrete examples:**
- `bot.ts:988-994` (and 1322-1327): `let decimals = 18` is a `number`, but `tokenContract.decimals()` for `uint8` (`abis.ts:28`) returns a **`bigint` in ethers v6**. Casting `as number` hides it; any later `10 ** decimals` or mixed arithmetic throws `TypeError: Cannot mix BigInt`.
- `restrict-template-expressions` (in strict presets) rejects bigint in templates. The tempting fix `${Number(wei)}` **loses precision above 2^53 wei (≈0.009 ETH)**. If the same habit reaches DB writes (`amount_in`/`amount_out` are TEXT columns) it corrupts P&L. Use `String(x)` or `formatUnits`.
- `no-unnecessary-condition` (strict) flags fail-closed defensive branches as unreachable: the `never` default in `utils/honeypot/index.ts:70-77`, `feeTier ?? 3000`, `if (!v3Dex)`. Types say impossible, but RPC/DB/env values violate types at runtime. Deleting these removes fail-closed guards (the vacuous-pass lesson from Phase 18).
- `no-unnecessary-type-assertion` (15 sites, e.g. `flashbots.ts:178`, `passthrough.ts:76,78`, `txManager.ts:98`) is judged under whichever tsconfig ESLint's project service picks. With three tsconfigs (root, bot, dashboard) and TS 6/7 default changes, "unnecessary" can flip.

**How to avoid:**
- **[LINT]** Type contracts at the boundary with typed ABIs (TypeChain-generated or a typed-ABI interface). Add **runtime** shape asserts where the value crosses into money math (`if (typeof d !== 'bigint') throw`). Ban `as <primitive>` on values returned by `Contract` calls (custom rule or code-review checklist).
- **[LINT]** Rule: a bigint wei value is never passed through `Number()`; only through `formatUnits`/`String`. Add a lint test (a regex for `Number\(` near `Wei|amount|balance`) or rely on `restrict-plus-operands` (already configured, eslint.config.mjs:17).
- **Policy decision (operator):** "zero baseline, no allowlists" collides with justified fail-closed branches. Decide up front whether *justified inline disables that carry a finding ID* are allowed, or whether these rules (`no-unnecessary-condition`) are left out of the preset. Don't let an agent resolve it by deleting guards.

**Warning signs:** A diff adds `as number`/`as bigint` on contract results. `Number(` gets wrapped around wei values. `default:` / `?? fallback` branches disappear in a lint commit.

**Phase to address:** [LINT], with the policy decision recorded before it starts.

---

### Pitfall 8: `require-await` and unused-var fixes delete load-bearing code

**What goes wrong:**
1. **Removing `async` changes the error channel.** A throw becomes synchronous and escapes `.catch()` / `void p.catch()`:
   - `utils/honeypot/simulator.ts:16`: its contract is literally "MUST return — never throw".
   - `detector.ts:2101` `handleV3BurnArrival` is called from a fire-and-forget dispatcher.
   - `preflight.ts:628,836`: checks run inside `Promise.all`. A sync throw aborts the array build, so other checks never run and the preflight report changes.
   - `flashbots.ts:125` and `passthrough.ts:37` `healthCheck` implement a Promise interface. `exitEngine.ts:359,387` tx builders are typed `() => Promise<TransactionRequest>`.
2. **Deleting "unused" things that are used by arity or position:**
   - `api/middleware/errorHandler.ts:29` `_next`: **Express identifies error middleware by `fn.length === 4`.** Remove it and errors fall through to Express's default HTML handler, and the WR-02 4xx/5xx split is lost.
   - Positional event-listener params such as `_tickSpacing` in the V3 `PoolCreated` listener (`bot.ts:1539`). Remove it and `pool` receives the tickSpacing value.
   - `const _exhaustive: never` guards.
   - Unused names from metadata destructuring (`bot.ts:990,1324` `name`/`decimals`): the `Promise.all` RPC call itself must stay.

**How to avoid:**
- **[LINT]** Configure `no-unused-vars` with `argsIgnorePattern: '^_'`, `varsIgnorePattern: '^_'`, and `caughtErrors: 'all'` + `caughtErrorsIgnorePattern: '^_'`. Rename instead of delete; never remove a positional parameter.
- **[LINT]** For `require-await`, either keep `async` and add an `await` where there is real async work, or disable the rule with a documented rationale ("async marks the rejection error channel"). That is a config decision, not a per-site allowlist, so get operator sign-off. Never strip `async` from a function whose callers use `.catch` or `void … .catch`.
- **[CHAR]** Add tests: `expect(errorMiddleware.length).toBe(4)` plus a behavioral 403-JSON test; a test that the V3 listener passes the pool address (not tickSpacing) to `handleNewV3PoolForChain`.

**Phase to address:** [LINT] (config before fixes); guard tests in [CHAR].

---

### Pitfall 9: Characterization tests that lock in bugs, assert on mocks, or go vacuous on split

**What goes wrong:**
Characterization tests become false confidence in three ways: they snapshot nondeterminism, they bless current bugs as "expected", or they pass because the code they grep moved away.

**Concrete hazards in this repo:**
- **Bugs that a naive characterization would bless:**
  - `const isHoneypot = false` is hardcoded and printed as "Honeypot: No" in every New-Token alert (`bot.ts:984,1000,1319`).
  - `LOG_LEVEL` from `.env` is ignored (Pitfall 5).
  - `amountOutMin = 0` in `buildV2SellTx` (`exitEngine.ts:366`).
  - `db.ts:232` unconditionally writes `user_version = 7` with **no `version > CURRENT` guard**. An older build silently downgrades a newer DB (see Pitfall 14).
- **Nondeterminism:** `deadline = Math.floor(Date.now()/1000) + 60` inside tx builders (`exitEngine.ts:365`), gas/fee data, timestamps, uuids. Snapshots of calldata are flaky unless the clock is injected.
- **Source-text tests go vacuous when code moves out of `bot.ts`:** `test/integration/anti-rug/botWiring.test.ts:340`, `test/unit/bot/twoStageSigint.test.ts:133`, `mevStrategies/inclusionReconciliation.test.ts:871`, and `exitEngine/antiRugReason.test.ts:266` all `readFileSync('src/bot.ts' | 'src/exitEngine.ts')` and regex the text. Once `bot.ts` becomes a thin composition root, `not.toMatch(/…/)` passes trivially. Negative existence tests (`db.test.ts:642`) prove nothing.
- **Tests that re-implement the mechanism:** the migration tests "mirror src/utils/db.ts exactly" instead of executing it (`db/exitFailedHeldMigration.test.ts:175`, `db/lpBaselineMigration.test.ts:116`, `db/pauseStateMigration.test.ts:150`). `test/helpers/testDb.ts:11` carries a duplicated schema. All of these drift silently from the real code.
- **Mock-the-mechanism:** 7 files `vi.mock('…/utils/nonceAuthority')` and 30 mock `ethers` wholesale. This is exactly the pattern behind 21.1 CR-01, 21.2 S-1/CR-01/CR-02, and INT-NONCE-SELL.

**How to avoid:**
- **[CHAR]** Characterize at the **I/O boundary**, not internals. The "decision trace" for a fixed fixture is the ordered list of:
  - dotted `op` log events (capture pino with a test destination; the v6.17 `op` taxonomy is the ideal seam),
  - tx requests handed to the MEV strategy's submit (normalized via an injected fixed clock),
  - DB writes.

  Drive it from the existing real-launch fixtures (`test/fork/fixtures/realLaunches`). Refactor commits must produce **byte-identical traces**.
- **[CHAR]** Tag every characterized behavior `KEEP` or `SUSPECT(<finding-id>)`. A SUSPECT assertion is expected to change by operator decision, never by accident.
- **[TESTQ]** Replace source-grep tests with symbol-level checks (an AST or import-graph query for "every call to X is inside withNonceLock", see Pitfall 15). Every grep-style test must include a **positive** "found ≥ N sites" assertion so it cannot pass on an empty file.
- **[TESTQ]** Migration tests open a temp DB and run the **real** db module (after the db module exposes an explicit `open(path)`/`migrate()`). Delete the mirrored copies.
- **[TESTQ]/[CI]** Run mutation testing (Stryker with the vitest runner) on `nonceAuthority`, `exitManager`, honeypot dispatch, and `riskManager`. This proves the tests can fail; coverage cannot.

**Phase to address:** [CHAR] (before [LINT] on money paths and before [RESTRUCT]); [TESTQ] for the rewrites.

---

### Pitfall 10: TypeScript 7 breaks type-aware linting and ts-node; TS 6 deprecations are hard errors

**What goes wrong:**
- `typescript@7.0.2` (released 2026-07-08) **ships no JS API**. Its package `exports` contains only `./lib/version.cjs` and `./unstable/*` (verified with `npm view`).
- `typescript-eslint@8.72.1` declares `peer typescript ">=4.8.4 <6.1.0"` (verified). With TS 7 it fails `npm ci` with ERESOLVE, or crashes in `typescript-estree` (`Cannot read properties of undefined (reading 'Cjs')`, typescript-eslint issue #12518).
- `ts-node` and anything else that calls `require('typescript')` breaks the same way. ts-node 10.9.2 was last modified in 2025.
- TS 7 adopts TS 6.0's new defaults and turns every 6.0 deprecation into a hard error. For this repo:
  - **Both** `tsconfig.json` and `tsconfig.bot.json` use `"moduleResolution": "node"` (node10). That is deprecated in 6.0 and an error in 7.
  - The root `tsconfig.json` has **no `types`**. The 6.0 default is `[]`, which produces "Cannot find name 'process'/'Buffer'" floods.
  - `rootDir` now defaults to the tsconfig directory, so emit shifts to `dist/src/...`.
  - `noUncheckedSideEffectImports` now defaults to true.
  - `stableTypeOrdering` is always on in 7, and can surface or hide inference errors.
- `dashboard/` has its own `typescript ^5.8` and builds with `tsc -b`.

**How to avoid:**
- **[TOOLCHAIN]** Go 5.8 → **6.0 first**. Fix the deprecations with no `ignoreDeprecations`, and turn on `--stableTypeOrdering` to preview TS 7 ordering. Then move to 7.
- **[TOOLCHAIN]** Use the official side-by-side layout (TypeScript 7.0 announcement): `"typescript": "npm:@typescript/typescript6@^6.0.x"` for typescript-eslint and other API consumers, plus `"@typescript/native": "npm:typescript@^7.0.2"` so `npx tsc` is TS 7. CI must run **both** `tsc` (7) for types and ESLint (on the TS 6 API).
- **[TOOLCHAIN]** Set `types: ["node"]` plus `rootDir` explicitly in every tsconfig. Pick `module`/`moduleResolution` as `nodenext` (Node app). Changing `module` is linked to the ESM decision (Pitfall 13).
- **[TOOLCHAIN]** Replace ts-node **before or together with** the TS 6 bump. Update `package.json` scripts (`preflight`, `pause`, `resume`), the usage comments in `scripts/`, `STATE.md` Operating Notes, and the operator memory note "Bot start: npx ts-node src/bot.ts".

**Warning signs:** `npm ci` ERESOLVE on typescript-eslint. ESLint crashes with an internal TypeError. Thousands of new "Cannot find name 'process'" errors.

**Phase to address:** [TOOLCHAIN] (ordered: ts-node replacement + TS 6 → lint on TS 6 → TS 7 side-by-side).

---

### Pitfall 11: Hardhat 3 forces ESM, rewrites artifacts, and can endanger the deployed-checker record

**What goes wrong (official migration guide plus repo):**
- Hardhat 3 (3.21.2, `"type": "module"`, Node ≥ 22.13): "Hardhat 3 requires your project to be an ES module." Done in place, it **drags the whole bot into an ESM conversion** in the same phase.
- `hardhat.config.ts` overrides `subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS)` to compile `test/fixtures/contracts/Honeypot.sol`. Subtask overriding is **removed** in HH3 (replaced by hooks).
  - If this is lost silently, the fixture stops compiling. Fork tests then fail, or worse, read a **stale HH2 artifact** still sitting in `artifacts/`.
  - The fork tests hard-code `artifacts/contracts/honeypot/HoneypotChecker.sol/HoneypotChecker.json` (5 files).
- HH3 artifacts use `_format: "hh3-artifact-1"`, and `inputSourceName` is prefixed with `project/`. Build-info is split into `.json` + `.output.json`.
  - Recompiled bytecode metadata **will not byte-match** the deployed ETH checker `0x8243dBeA…13eD`. Do not treat this as tampering, and do not "fix" it by redeploying (HONEY-04 owns redeploy).
  - Slither/Mythril (the CI contracts gate) consume build-info through crytic-compile, which needed explicit HH3 support (crytic-compile issue #629).
- Ignition: HH3 tasks **throw on v2-format deployment artifacts**. `npx hardhat ignition migrate <deploymentId>` rewrites `ignition/deployments/chain-1/{artifacts,build-info}` in place. That mutates the committed record of a live, Etherscan-verified mainnet deployment.
- `hardhat.config.ts` defines `mainnet`/`bsc`/`base`/`arbitrum` networks keyed off `DEPLOY_PRIVATE_KEY`, read from `.env` by `dotenv.config()`. One mistyped `ignition deploy --network mainnet` while debugging the migration is a real mainnet deploy.
- The fork harness (`test/fork/setup.ts`) spawns `npx hardhat node --fork <url> --port 8545`, waits for stdout `Started HTTP`, and relies on the node reporting **chainId 31337**. The `ALLOW_REAL_MAINNET` tripwire (`realMainnetGate.ts:52`) fires on chainId 1.
  - HH3 forks are config-driven (`type: "edr-simulated"`, `forking: {url}`) and the node task's flag set changed.
  - If the chainId or flags differ, the tempting "fix" is `ALLOW_REAL_MAINNET=1`, which disables the guard that protects the prod wallet.

**How to avoid:**
- **[HH3]** **Isolate contracts tooling in a sub-package** (`contracts/package.json` with `"type": "module"` and its own lockfile). The bot's CJS→ESM decision then stays independent of Hardhat. Keep the fork harness spawning HH3 from that directory.
- **[HH3]** Run `npx hardhat clean` and delete `artifacts/`, `cache/`, `typechain-types/` before the first HH3 build, so a stale HH2 artifact cannot satisfy a fork test. Reimplement the extra-sources override with `paths.sources` or a hook, and add a test that the fixture artifact exists **and** has `_format === 'hh3-artifact-1'`.
- **[HH3]** Before `ignition migrate chain-1`: commit, run it, then `git diff` and assert that **`deployed_addresses.json` and `journal.jsonl` are byte-identical** and only artifacts/build-info changed. Keep the original HH2 build-info, which is the verification source of truth.
- **[HH3]** Remove mainnet networks from the default config, or gate them behind HH3 `configVariable()` + `hardhat-keystore`, so no deploy can happen without an interactive secret. Never put `DEPLOY_PRIVATE_KEY` in `.env` during this milestone.
- **[HH3]** Add a RED-proof for the fork harness: point it at a chainId-1 endpoint and assert the tripwire aborts; then assert a normal fork reports 31337. Confirm the CI slither job parses HH3 build-info, or move it to direct `solc`/`crytic-compile --compile-force-framework solc`.
- `@nomicfoundation/hardhat-ethers-chai-matchers` peers `chai >=5.1.2 <7`, so chai 6 is compatible (verified).

**Phase to address:** [HH3] (its own phase, after [RESTRUCT], independent of any bot ESM work).

---

### Pitfall 12: CommonJS → ESM conversion breaks interop in ways that only show under the production runner

**What goes wrong (verified on this box, Node 24.18):**
- `telegramListener.ts:5-6` imports `telegram/sessions` and `telegram/events`. gramjs has **no `exports` map**, and native ESM rejects directory imports: **`ERR_UNSUPPORTED_DIR_IMPORT`** (verified). `tsx` resolves these, so dev works and `node dist/...` crashes.
- **ethers dual-package hazard.** An ESM bot loads `ethers/lib.esm`, while CJS `@flashbots/ethers-provider-bundle` (`build/index.js`, no `exports`) `require`s `ethers/lib.commonjs`. Verified: `esm.JsonRpcProvider === cjs.JsonRpcProvider` → **false**, and an ESM `Wallet` is **not** `instanceof` the CJS `AbstractSigner`. Two ethers instances exist in one process, so any `instanceof` path inside ethers or the bundle provider misbehaves.
- `bot.ts:2359` `if (require.main === module)` has no ESM equivalent. `import.meta.main` exists only in Node ≥ 24.2. Hand-rolled `import.meta.url === pathToFileURL(argv[1])` comparisons misfire on Windows drive-letter case.
  - If the guard is wrong, the bot never starts.
  - If the guard is dropped, **tests that import `bot.ts` start the bot**.
- `__dirname`: `api/routes/health.ts:15` reads `join(__dirname,'../../../package.json')`; `scripts/addLiquidity.ts:14`, `capture-launch.ts:431`.
- Inline `require` (`bot.ts:2344`), dynamic `import('./bot')` (`alphaDrop.ts`), JSON imports needing `with { type: 'json' }`, and top-level await in the entry all change *when* listeners attach.
- `uuid` is already ESM-only (since v12). On Node 22.12+ it works from CJS via `require(esm)`, so it does **not** force the conversion.

**How to avoid:**
- **[TOOLCHAIN]** Treat ESM as **optional and last**. Do it only if something still forces it after Hardhat is isolated (Pitfall 11). Never do it in the same phase as the restructure.
- If converting: use `module`/`moduleResolution: nodenext`; explicit `.js` extensions; deep imports as `telegram/sessions/index.js`; `import.meta.dirname`; replace `require.main` with an explicit `main.ts` entry that has no import-side-effect start.
- **[TOOLCHAIN]** Add a startup assertion that the ethers instance used by the Flashbots provider is the app's instance, or a smoke test that the bundle provider accepts the app's `Wallet`/provider. Run `npm ls ethers` and require exactly one deduped copy.
- **[REENTRY]/[CI]** Add a boot smoke under the **exact production runner and command** (not tsx-in-vitest). Import the entry in a boot-paused mode and assert listeners are installed and the API is bound.

**Phase to address:** [TOOLCHAIN] (late, optional); smoke in [CI]/[REENTRY].

---

### Pitfall 13: Behavior changes smuggled into cleanup; sibling call sites left unfixed (the INT-NONCE-SELL pattern)

**What goes wrong:**
"Cleanup" commits change trading behavior, and audit fixes land on one call site while siblings keep the bug. INT-NONCE-SELL proved that "each site is individually wrapped" was asserted, not verified.

**Behavior-changing "cleanups" waiting to happen in this repo:**
- Adding slippage protection to `amountOutMin = 0` (`exitEngine.ts:366`). A rug-exit sell can then revert mid-rug and leave the position stranded.
- Converting the per-position `setInterval(async…, 5000)` (`exitEngine.ts:1906,2007`) to a self-scheduling `setTimeout` loop, the usual misused-promises fix. That changes exit cadence (5 s + duration), trailing-stop responsiveness, and interacts with `exitWatchdog.ts`.
- Replacing the unmaintained `@flashbots/ethers-provider-bundle` (last published 2024-02; peer `ethers: 6.7.1` exact). That changes the private-submission path.
- "Deduplicating" the V3 snipe's inlined arm logic into `armPositionMonitoring` (known drift, PROJECT.md tech debt). If the two differ, the dedupe *is* a behavior change.
- Changing the dashboard bind, CORS, or kill-switch semantics while "cleaning the dashboard".

**Signing sites that must all be under `withNonceLock`:**
- `bot.ts:225,267,558,746`
- `exitEngine.ts:543,552,788,871,874,1509,1512,1531`
- anti-rug via `executeFullSell`
- `utils/mevStrategies/reconciliation.ts` re-fetch paths
- dashboard emergency sell (`api/routes/controls.ts`)

**How to avoid:**
- **[AUDIT]** Use a commit taxonomy: `refactor:` / `lint:` / `fmt:` / `deps:` commits must show **zero diff in the [CHAR] decision traces**. `behavior:` commits must cite an operator-decision ID. CI checks the decision-trace hash on non-`behavior:` commits.
- **[RAILS]/[FIX]** Turn the nonce invariant from asserted into enforced:
  - `withNonceLock` sets an `AsyncLocalStorage` context; every signing primitive (`sendTxWithRetry`, strategy `submit`, `ensureApproval`, `escalatePrivate*`) calls `assertNonceLockHeld(wallet)` and throws otherwise.
  - Detecting a nested same-wallet acquisition (the CR-01 deadlock shape) is possible too, but throw-vs-deadlock is a behavior choice for the operator.
  - Add a static inventory test: an AST walk listing every `sendTransaction|signTransaction|sendBundle|sendRawTransaction|broadcast` call, asserting each sits under the lock or in a documented called-under-lock function. It must also assert "≥ N sites found".
- **[AUDIT]** Findings-register template has a mandatory field "Sibling sites checked: [file:line list] — method: grep/AST". A finding cannot close without it.
- **[AUDIT]** Prevent reviewer anchoring: the fresh-eyes audit reads **code, not prior VERIFICATION/SUMMARY docs**. Prior conclusions are re-checked only after an independent pass. Confirmed capital-safety findings get D-STOP-THE-LINE treatment and are re-surfaced to the operator, never auto-deferred (operator memory: "Don't auto-defer confirmed findings").

**Phase to address:** [AUDIT] (taxonomy, register); [RAILS]/[FIX] (ALS enforcement); [CI] (trace-hash gate).

---

### Pitfall 14: Live re-entry passes on the fork but fails on mainnet, or runs against stale state and config

**What goes wrong:**
- **Fork ≠ mainnet for inclusion.** A Hardhat fork has no builders, so it cannot reproduce calm-gas Flashbots non-inclusion, the failure class that needed three decimal phases (21.1/21.2/21.3). Its base fee is frozen at the fork block. chainId 31337 may route a different MEV strategy path than chainId 1. A fork proves calldata and accounting, not inclusion (D-EVIDENCE-BAR).
- **Stale or wrong DB.**
  - `.env.example:92` sets `DB_PATH=./data/bot.db`, a **relative path resolved against `process.cwd()`** (`db.ts:9`), and db.ts **mkdirs and silently creates a fresh DB** (`db.ts:12-17`).
  - A new entry point, runner, or IDE run config with a different cwd boots against an empty DB. That loses the persisted kill-switch (paused state), dedup history (re-snipe risk), position resume (`getResumeExitMonitorTrades`), and the anti-rug dry-run start stamp (`detector.ts:585`, gated by `preflight.ts:628`).
  - The dashboard static path is also cwd-relative (`api/server.ts:165`).
- **WAL data loss.** `data/bot.db-wal` holds un-checkpointed data newer than `bot.db`. Copying only `bot.db` as a "backup", or deleting `-wal`/`-shm` in a hygiene sweep, loses the live-roundtrip records.
- **Leftover env.** dotenv never overrides existing `process.env` (still default `override: false` in v18). Shell exports from the fork rehearsal win over `.env` on the live run: `ALLOW_REAL_MAINNET=1`, `ETH_FORK_RPC_URL`, a temp `DB_PATH`, toggled `ANTIRUG_*` live-execute flags.
- **Preflight doesn't exercise the new composition root.** `scripts/preflight.ts:20-24` imports `src/preflight.ts` and `chainRegistry` directly, never the bot entry. Import order, env timing, DB path, and listener wiring of the restructured entry are untested by `npm run preflight`.
- **Schema rollback hazard.** `db.ts:232` writes `user_version = 7` unconditionally. If a dev build bumps to 8 and the live run uses a rolled-back build, the version is silently downgraded and the next newer boot re-runs `ALTER TABLE … ADD COLUMN` (duplicate-column crash).

**How to avoid:**
- **[RAILS]/[FIX]** Resolve `DB_PATH` to an absolute path and log it at boot. In production mode, **refuse to create a DB**: require an existing file with `user_version === 7` and the expected tables, and make `--init-db` explicit. Add a `version > CURRENT` **fail-closed** guard. Add no migrations this milestone unless a finding requires one.
- **[RAILS]** Log a boot config fingerprint (`op: 'boot.config'`): each money-relevant var, its value class, and its **source** (shell vs `.env`, detectable from dotenv's returned `parsed`). Preflight **fails** if a test-only var (`ALLOW_REAL_MAINNET`, `*_FORK_*`) is set, or if a money var is shell-overridden.
- **[REENTRY]** Back up with `db.pragma('wal_checkpoint(FULL)')` then `db.backup()` / `VACUUM INTO`, never a raw file copy. **[HYGIENE]** Never delete `-wal`/`-shm`; add them to the "do not touch" list for repo sweeps.
- **[REENTRY]** Sequence:
  1. Fork rehearsal on the **real entry and runner**.
  2. Fresh shell (verify `env | grep -E 'ALLOW_REAL|FORK|DB_PATH'` is empty).
  3. Boot **paused** via the persisted kill-switch and verify listeners, anti-rug arming, and the single-instance lock.
  4. Resume.
  5. One small buy→monitor→sell with on-chain artifacts.

  Ask explicitly whether this build changed the inclusion path; if so, the live run is the only valid proof.

**Phase to address:** [RAILS] (DB/env guards), [REENTRY] (procedure).

---

### Pitfall 15: Coverage floors and green CI give false comfort on money paths

**What goes wrong:**
- Coverage counts execution, not assertion. Tests that mock `nonceAuthority` (7 files) or all of `ethers` (30 files) still produce high line coverage on the money paths they bypass.
- Vitest 5 changed coverage semantics: `include`/`exclude` now match project-relative paths precisely, and glob thresholds no longer inherit `perFile`. The current global 70% floor (`vitest.config.ts`) can quietly measure a different file set after the upgrade.
- Vitest 5 also makes unawaited `.resolves/.rejects` fail. The tempting "fix" for a newly failing test is deleting the assertion rather than awaiting it.

**How to avoid:**
- **[CI]** Use per-glob `perFile: true` thresholds on the money-path directories (buy, exit, anti-rug, nonce). Print and diff the resolved coverage file list v4 vs v5 at upgrade time.
- **[CI]/[TESTQ]** Use mutation score on the money-path core (Stryker) as the meaningful floor. Coverage stays a secondary gate.
- **[CI]** Add a lint/test rule banning `vi.mock` of `nonceAuthority`, `exitManager`, and the honeypot dispatch in money-path test dirs. Mock only the I/O boundary (DB, notifier, relay HTTP), per the v6.17 pattern.

**Phase to address:** [CI] + [TESTQ].

---

## Moderate Pitfalls

### M1: Formatter introduction = whole-repo diff plus CRLF churn on Windows
**What goes wrong:**
- The index is all-LF, but the working tree has **207 CRLF files** (`git ls-files --eol`), `core.autocrlf=true`, and **no `.gitattributes`**.
- A formatter with `endOfLine: lf` rewrites those 207 files. `--check` on Windows then disagrees with CI on Linux, and a formatting commit mixed with fixes hides semantic edits.

**Prevention [TOOLCHAIN]:**
1. Add `.gitattributes` (`* text=auto eol=lf`; `*.sh`, binaries explicit) and run `git add --renormalize .` as **its own commit**.
2. Apply the formatter as **one isolated `fmt:` commit**, registered in `.git-blame-ignore-revs`. Verify `tsc` emit (or the [CHAR] decision trace) is byte-identical before and after.
3. Never run `eslint --fix` in the same commit.
4. Do this **before [RESTRUCT]**, so moved code is already formatted and move diffs stay reviewable.

### M2: Dropping `--legacy-peer-deps`
**What goes wrong:** `@flashbots/ethers-provider-bundle@1.0.0` peers `ethers: "6.7.1"` exact (`npm ls` shows `ethers@6.16.0 invalid`), so a plain `npm ci` fails with ERESOLVE.

**Prevention [DEPS-RT]:**
- Use `"overrides": { "@flashbots/ethers-provider-bundle": { "ethers": "$ethers" } }`, then require `npm ls ethers` to show a **single** deduped copy (a second copy brings back the instanceof hazard).
- Avoid `npm audit fix --force`, which does semver-major jumps blindly. Fix each prod vuln deliberately:
  - `ethers 6.17.0` removes the nested vulnerable `ws 8.17.1`.
  - `axios` ≥ 1.21.
  - Express 5.3 transitive bumps for `body-parser`, `proxy-addr` (critical), `qs`.
  - `uuid 14` (GHSA-w5hq-g745-h8pq).
  - `socks`/`ip-address` arrive via `telegram`, which has no newer release (2.26.22 is latest), so they need an `overrides` pin plus a gramjs smoke test.

### M3: better-sqlite3 13 on Windows
**What goes wrong:** v13 is a rewrite on N-API with in-package prebuilds (`prebuilds/win32-x64.node`), `engines.node >=22`. **13.0.1 had a parameter-binding regression and 13.0.2 fixed a `worker.terminate()` abort.** On Windows, a running node process (WebStorm vitest watcher, orphan `hardhat node`, orphan bot) holds the `.node` file locked, so `npm ci` fails with EPERM/EBUSY and leaves a partial install. HH3's EDR native binary has the same problem.

**Prevention [DEPS-RT]:**
- Pin `^13.0.3`.
- Kill all node processes before installing.
- Post-install check: `node -e "require('better-sqlite3')(':memory:').pragma('user_version')"`.
- Re-run the real migration test against a copy of the prod DB (via `VACUUM INTO`).

### M4: The ts-node replacement changes signal delivery, so two-stage SIGINT can skip straight to force-exit
**What goes wrong:**
- On Windows, Ctrl+C is delivered to **every process attached to the console**. A wrapper (`npx`, `npm run`, the `tsx` CLI) may also relay it, so the bot can receive SIGINT **twice**.
- The second one triggers stage 2 of `createTwoStageShutdown` (`bot.ts:2290`), a force-exit, possibly mid-sell.
- The other way round, the wrapper may swallow it (the known npx issue).

**Prevention [TOOLCHAIN]/[REENTRY]:**
- Launch with no wrapper process: `node --import tsx <entry>`, or compiled `node dist/main.js`.
- Add a manual test in both Git Bash and PowerShell: one Ctrl+C logs only `shutdown.stage1`.
- Keep the force-kill-PID runbook, and update STATE.md Operating Notes and the operator memory note.

### M5: Vitest 4 → 5 semantic changes (official migration guide)
**What goes wrong:**
- Requires Node ≥ 22.12 and Vite ≥ 6.4.
- `clearMocks` defaults to true. This repo already sets `mockReset: true`, so impact is small, but setup-recorded calls are now cleared.
- Nested `vi.mock`/`vi.hoisted` now **throws**. None found today; keep it that way.
- Unawaited async assertions fail.
- `toThrow('')` matches any error.
- `test.sequential` was removed.
- Fake timers now also fake `Temporal`.
- Inline projects inherit the root config and share one Vite server by default. The repo already uses `extends: true`; verify the `fork` project's `globalSetup` and `fileParallelism: false` still apply.
- `-t` filters use `>` separators.

**Prevention [TOOLCHAIN]:** Upgrade with the suite green on v4 first. Diff the test count per project v4 vs v5 (catches silently dropped files). Treat newly failing tests as *findings* (likely vacuous assertions), not as noise.

### M6: Fake timers plus the promise-chain mutex give false-green tests
**What goes wrong:** 32 test files use `vi.useFakeTimers()`. `withNonceLock` advances on microtasks. Synchronous `vi.advanceTimersByTime` never flushes the chain, so tests can pass without the lock or the inclusion ladder ever running.

**Prevention [TESTQ]:** Use `vi.advanceTimersByTimeAsync`. Assert that the locked operation's side effect actually happened (a submit observed at the boundary).

### M7: Node and `@types/node` version skew
**What goes wrong:** The dev box runs Node 24.18, CI pins Node `'22'`, and the upgrade target is `@types/node` 26. Code can type-check against APIs missing at runtime: `import.meta.main` is 24.2+, and dotenv/HH3/ESLint have different minimum versions.

**Prevention [TOOLCHAIN]/[CI]:** Choose one Node major (24 LTS; Node 22 reaches end-of-life in April 2027). Set it in `.nvmrc`, `engines`, CI, and `@types/node` (same major). The floors that force at least 22.13 are Vitest 5 (≥ 22.12), HH3 (≥ 22.13), ESLint 10 (≥ 22.13), and better-sqlite3 13 (≥ 22).

### M8: ESLint 10 specifics
**What goes wrong:** eslintrc is fully removed (already on flat config). **Config lookup now starts from each linted file's directory.** If `dashboard/` gets its own `eslint.config.*`, root `npx eslint .` silently uses it for dashboard files. `eslint:recommended` now adds `no-useless-assignment`, `no-unassigned-vars`, `preserve-caught-error`; these apply only if `js.configs.recommended` is added. `preserve-caught-error` rewrites are fine, but `throw new Error(msg, { cause })` changes logged error shape.

**Prevention [TOOLCHAIN]:** Pin the config path in the `lint` script (`--config eslint.config.mjs`) and lint `src test scripts dashboard/src` explicitly. Add the presets you adopt one at a time, each with a burn-down count.

### M9: dotenv 18
**What goes wrong:**
- `-r dotenv/config` preloading was removed (use `dotenv run --`).
- The injection message moved to **stderr** (it was stdout in v17, interleaving with pino JSON on stdout). `dotenv/config` now defaults to `quiet: true` (18.0.4).
- `override`/`debug` strings are now parsed with `parseBoolean` (18.0.6), so `"false"` really is false.
- `override` still defaults to false.
- This repo calls `dotenv.config()` in at least 5 places (`config.ts:4`, `notifier.ts:6`, `hardhat.config.ts`, `vitest.config.ts`, scripts).

**Prevention [DEPS-RT]:** Collapse to the single env loader (Pitfall 5). Pass `quiet: true` explicitly. Do not switch to Node `--env-file` without checking parser differences (quotes, multiline, `#`).

### M10: `__dirname` path math in the API
**What goes wrong:** `api/routes/health.ts:15` does `JSON.parse(readFileSync(join(__dirname,'../../../package.json')))` at **import time**. Move the file one level, or run from a compiled `dist/api/routes/`, and it resolves outside the repo. That crashes on import and takes down the whole API, including emergency sell.

**Prevention [RESTRUCT]:** Import the version from a generated constant or `createRequire(…)('…/package.json')` relative to a stable anchor. Add a test that `/api/health` boots in the compiled layout.

### M11: Dashboard cleanup breaks the API contract or the served bundle
**What goes wrong:** The dashboard has its own `typescript ^5.8`, Vite 8, `"type": "module"`. The bot serves `dashboard/dist` from `process.cwd()` (`server.ts:165`). The Phase 16 decision is "API response is the source of truth for dashboard types". Restructuring `src/api` response shapes, or upgrading the dashboard's TS separately, lets the two drift. A stale `dashboard/dist` gets served after API changes.

**Prevention [HYGIENE]:** Contract tests on the API response JSON shapes. Build the dashboard in CI. Same TS strategy as root (6 API + 7 tsc).

### M12: Repo-hygiene sweeps delete or commit the wrong things
**What goes wrong:**
- Untracking `.DS_Store`/`.idea/` with `git rm` (not `--cached`) deletes IDE state.
- `git add -A` during cleanup picks up ignored-but-sensitive neighbors if `.gitignore` is edited carelessly: `cookies.txt` (a dashboard session cookie, ignored at `.gitignore:22`), `data/*.log` (wallet and tx details), `.env`.
- Deleting `data/bot.db-wal/-shm` (see Pitfall 14).
- Per the operator memory, sweeps must include `.claude/worktrees/agent-*/`.

**Prevention [HYGIENE]:** `git rm --cached` only. Stage explicit paths. Review `git status --ignored` before and after. Keep a "never delete" list (`data/`, `.env*`, `ignition/deployments/`).

---

## Minor Pitfalls

### m1: ethers 6.17.0 is low-risk, but read what changed
`requestRate` throttling was added, but the default is `0` (off; verified in `abstract-provider.ts:511,571`). 301/302 redirects now preserve the method. Block gained `transactionsRoot`. ENSv2 changes. **Prevention [DEPS-RT]:** Upgrade alone, with the 30 `vi.mock('ethers')` tests treated as *not* covering it. Run the integration and fork suites.

### m2: uuid 14
Drops Node 18, needs global `crypto`, minimum TypeScript 5.4.3. It is already ESM-only (since v12) and works from CJS on Node ≥ 22.12 via `require(esm)`. **Prevention:** Remove the stale `@types/uuid ^11` (uuid ships its own types).

### m3: chai 6
Ships a single bundle: `chai/lib/*` deep imports are gone. **Prevention:** grep for `chai/lib`. Keep chai only where Hardhat tests need it; Vitest's `expect` covers the rest.

### m4: `package.json` metadata
`main: dist/index.js` does not exist, and `"type": "commonjs"` is explicit. Changing `type` flips module semantics for every `.js`/`.ts` file. **Prevention [HYGIENE]:** Change `main`/`type` only within the ESM decision (Pitfall 12), never as "metadata cleanup".

### m5: Legacy single-arg lock overloads
`exitManager.ts:16-31` keeps `tryAcquireSellLock(token)` overloads keyed as `token` instead of `chain:token`. Today only the 2-arg form is called (verified: 4 call sites), but a restructure that picks the 1-arg overload creates a key that **does not exclude** the 2-arg key. **Prevention [RESTRUCT]:** Delete the legacy overloads (dead code) in a `refactor:` commit, with a test that all callers use the composite key.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `as number` / `as bigint` on `Contract` results to clear no-unsafe-* | Burns down 213 errors fast | Encodes runtime lies (`decimals` is bigint); hides BigInt-mixing crashes | Never on money paths; typed ABI + runtime assert instead |
| `void p` without `.catch` on startup promises | Silences no-floating-promises | Unhandled rejection crashes the process (no handler exists) or, with a swallowing catch, fails open | `void p.catch(escalate)` only; escalation must be fail-closed for listener/arming startup |
| Compat shims at old module paths during restructure | Smaller diffs, tests keep passing | Duplicate-instance risk if not pure re-exports; vi.mock paths keep "working" on the shim | Only pure `export * from`, removed by the end of [RESTRUCT], with an identity test |
| `npm audit fix --force` | Clears the vuln gate | Silent semver-major jumps in transitive deps (express internals, ws) | Never; fix each advisory deliberately |
| `ignoreDeprecations: "6.0"` | TS 6 compiles immediately | TS 7 hard-errors anyway; postpones the real config migration | Only as a temporary step inside one plan, removed before TS 7 |
| Disabling a lint rule globally to hit zero errors | Meets the "zero baseline" gate | Can hide real issues (`no-floating-promises` must never be disabled) | Only for rules with a documented rationale and operator sign-off (e.g. `require-await`) |
| Big-bang ESM + Hardhat 3 + restructure in one phase | "Modernize once" | Can't bisect a regression; three behavior-shifting changes at once | Never; isolate HH3, restructure first, ESM last/optional |
| Keeping `vi.mock('ethers')` / `vi.mock(nonceAuthority)` tests | Fast, green | They pass capital-safety bugs (v6.17 history) | Only for pure-formatting/telemetry units; never for lock, exit, or submit paths |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| ethers v6 events | Treating `provider.on/off` as sync and wrapping handlers inline | They return Promises; keep listener identity stable; do state mutation before the first `await` |
| `@flashbots/ethers-provider-bundle` 1.0.0 | Letting npm install a second ethers for its exact peer; replacing the lib as "modernization" | `overrides` to `$ethers`, single-copy check; replacement only as an explicit operator-decided behavior change |
| gramjs (`telegram` 2.26.22) | Native-ESM deep imports `telegram/sessions` (ERR_UNSUPPORTED_DIR_IMPORT); wrapping `addEventHandler` callbacks | `…/index.js` paths if ESM; try/catch inside the handler; transitive vulns via `overrides` + smoke test |
| Express 5 | Wrapping async handlers in `void` to satisfy no-misused-promises, which loses Express 5's native rejection→error-middleware forwarding; removing the 4th arg of error middleware | Express 5 + `@types/express` 5 accept Promise-returning handlers; keep `(err, req, res, _next)` |
| pino | Moving `dotenv` earlier "fixes" `LOG_LEVEL` and changes log volume and content silently | Treat as a `behavior:` change; review what `debug` logs before enabling |
| better-sqlite3 13 | Raw file copy as backup; deleting `-wal`; upgrading while a node process holds the DB/addon | Checkpoint + `db.backup()`; never touch `-wal/-shm`; kill node first; pin ≥ 13.0.2 |
| Hardhat 3 / Ignition | In-place `ignition migrate` without diffing; leaving mainnet networks live; trusting stale `artifacts/` | Commit-migrate-diff; keystore-gated networks; `hardhat clean` + artifact `_format` check |
| Slither/Mythril CI | Assuming crytic-compile reads HH3 build-info | Verify the HH3 build-info format is parsed, or compile with solc directly for analysis |
| typescript-eslint + TS 7 | Bumping `typescript` to 7 directly | `typescript` alias → `@typescript/typescript6`, TS 7 under a second alias |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `await` added inside per-event snipe dispatch | 2nd/3rd pair in a block sniped late or missed | Keep fire-and-forget with fail-closed catch; ordering test | First block with ≥ 2 new pairs |
| `setInterval(async)` poll overlap after an `await` is introduced | Same block range re-queried; duplicate handling; RPC bursts | Assign `lastBlock` before awaiting work, or an in-flight guard | Any tick that takes > 2 s (HTTP polling) or > 5 s (exit poll) |
| Leaked `'block'` listeners (wrapped handlers) | RPC calls per block grow with position count | Stable handler identity; `listenerCount` test | A few open V3 positions over hours |
| TS 7 native `tsc` makes CI fast while lint runs TS 6 | Lint becomes the slow CI step | Accept it; cache ESLint; don't drop type-aware lint for speed | Immediately after the TS 7 switch |
| Vitest 5 shared Vite server across inline projects | Module state leakage between unit/integration if isolation is changed | Keep default `isolate`; don't set `isolate: false` for speed on money-path suites | If someone tunes for speed via `vitest doctor` |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `DASHBOARD_HOST || '127.0.0.1'` → `??` | Empty value binds `::`, exposing controls and emergency sell to the LAN | Typed env module; empty = default; test bind address |
| Tests loading the real `.env` | Real key/token in test processes; real Telegram sends; prod DB writes | Dummy test env, network deny, prod-DB tripwire |
| `DEPLOY_PRIVATE_KEY` in `.env` + HH3 mainnet network entry | Accidental mainnet deploy during tooling migration | Keystore/`configVariable`; remove mainnet networks from the default config |
| Setting `ALLOW_REAL_MAINNET=1` to make an HH3 fork test pass | Disables the tripwire protecting the prod wallet | RED test that the tripwire trips; investigate the chainId instead |
| Leftover shell env on the live run | Live bot on a fork RPC or temp DB; guards disabled | Boot config fingerprint with var source; preflight fails on test-only vars |
| `overrides` used to silence audit findings | Unvetted transitive versions (gramjs deps) | Each override justified, plus a smoke test of the dependent feature |

## UX Pitfalls (operator experience)

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Test runs send real Telegram alerts ("V3 TX failed") | Operator can't tell real emergencies from test noise | Network deny in tests; notifier refuses to send when `VITEST` is set |
| Hardcoded "Honeypot: No" (`isHoneypot = false`) in New-Token alerts | False reassurance in every alert | Findings register → operator decides: real value or remove the line |
| Start/stop commands change (ts-node → new runner) without updating runbooks and memory | Operator runs a stale command; Ctrl+C semantics differ | Update `docs/operations/going-live.md`, STATE.md Operating Notes, `package.json` scripts, and operator memory in the same plan |
| A new formatter makes WebStorm show whole-file diffs | Review fatigue (the operator is cycle-fatigued on long phases) | One isolated `fmt:` commit + `.git-blame-ignore-revs` + `.gitattributes` first |

## "Looks Done But Isn't" Checklist

- [ ] **Lint burn-down:** zero errors, but verify no `await` was added inside `.on(`/`setInterval` bodies (`git log -p | grep`), and that `listenerCount` tests still pass.
- [ ] **Restructure:** tests green, but verify every `vi.mock` path resolves (gate script), the singleton guards never threw, `madge --circular` is clean, and the decision traces are byte-identical.
- [ ] **TS 7:** `tsc` clean, but verify ESLint actually ran type-aware rules on TS 6 (not crashed or skipped), and that all three tsconfigs set `types` and `rootDir`.
- [ ] **Hardhat 3:** compile works, but verify the fixture `Honeypot.sol` artifact is HH3-format, `deployed_addresses.json`/`journal.jsonl` are unchanged, the fork reports 31337, the tripwire RED test passes, and slither parsed the build.
- [ ] **Deps:** `npm audit --omit=dev` is 0, but verify `npm ls ethers` shows a single copy, gramjs still connects (smoke), and better-sqlite3 opens a copy of the prod DB at `user_version 7`.
- [ ] **Coverage floor:** threshold met, but verify the measured file set matches the intended money-path globs (Vitest 5 semantics) and the mutation score on lock/exit is above floor.
- [ ] **ts-node replaced:** scripts run, but verify the bot boots under the exact production command from the repo root **and** from another cwd (it must refuse a fresh DB), and a single Ctrl+C gives stage 1 only.
- [ ] **Audit finding closed:** fix merged, but verify the "sibling sites checked" field lists every call site with its method.
- [ ] **Re-entry:** fork rehearsal green, but verify a fresh shell (no `ALLOW_REAL_MAINNET`/`FORK`/temp `DB_PATH`), a boot-paused check, a single-instance lock, a backup via `db.backup()`, and a live roundtrip with on-chain artifacts.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Test run touched the prod DB | MEDIUM | Stop; copy `bot.db`+`-wal`+`-shm` together; open a copy read-only; compare `trades`/`pause_state`/`exit_state` with the last known-good backup; restore via `db.backup()`; add the tripwire before rerunning |
| Duplicate lock instance shipped | HIGH | Kill-switch pause; force-kill all node PIDs; audit recent txs for nonce collisions or double sells; add the singleton guard + process lock; RED-prove with a two-path import test |
| Lint commit changed behavior | LOW-MEDIUM | `git revert` the lint commit (lint commits are isolated by taxonomy); reclassify the site; re-land as `behavior:` with an operator decision if wanted |
| Ignition migrate altered the deployment record | LOW (if committed first) | `git checkout -- ignition/deployments/chain-1`; rerun with a diff check; never redeploy |
| Fresh empty DB created by wrong cwd | MEDIUM | Do not trade; locate the real DB; delete the stray DB; set an absolute `DB_PATH`; add refuse-to-create |
| Live run with leftover fork env | HIGH if it traded | Kill-switch pause; inspect `boot.config` log; reconcile on-chain state against the DB; fresh shell; re-run preflight |
| TS 7 broke lint mid-phase | LOW | Restore the `typescript` alias to `@typescript/typescript6`; keep TS 7 under a second alias |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P1 Tests reach prod state | [RAILS] (+ [CI] mock-path gate) | Prod-DB tripwire test; network-deny test; vi.mock-path gate red on a deliberately stale path |
| P2 Floating-promise fixes change concurrency | [CHAR] then [LINT] | Same-block ordering test; `listenerCount === 1` after N re-installs; decision-trace hash unchanged |
| P3 Listener identity broken | [LINT] (tests from [CHAR]) | Burn→Collect returns `listenerCount('block')` to baseline |
| P4 Duplicate module instances / two processes | [RAILS], [RESTRUCT] | Singleton guard throws on a second load; second bot refuses to boot; shim identity test |
| P5 Init order / import side effects | [RAILS], [RESTRUCT] | `madge --circular` = 0; boot-order spy test; single `dotenv` call site |
| P6 `\|\|`→`??` env semantics | [CHAR], [RESTRUCT] | Config snapshot over the `{unset,'','0','abc'}` matrix |
| P7 Lying type fixes | [LINT] (policy first) | No `as` on Contract results (review/lint); bigint→Number ban check |
| P8 require-await / unused-var deletions | [LINT] | `errorMiddleware.length === 4`; V3 listener arg test; preflight report snapshot |
| P9 Characterization traps | [CHAR], [TESTQ] | Fixed-clock trace determinism (2 runs identical); positive "≥ N sites" in grep tests; mutation score |
| P10 TS 7 / typescript-eslint / ts-node | [TOOLCHAIN] | CI runs tsc(7) + type-aware ESLint(6) both green; no `ignoreDeprecations` |
| P11 Hardhat 3 / Ignition / fork harness | [HH3] | Deployment-record diff clean; fixture artifact `hh3-artifact-1`; tripwire RED test; slither job green |
| P12 ESM interop | [TOOLCHAIN] (late/optional) | Boot smoke under the prod runner; `npm ls ethers` single copy; gramjs import smoke |
| P13 Behavior smuggling / sibling sites | [AUDIT], [RAILS]/[FIX], [CI] | Trace-hash gate on non-`behavior:` commits; ALS `assertNonceLockHeld` throws in a RED test; signing-site inventory ≥ N |
| P14 Re-entry fork≠mainnet / stale state | [RAILS], [REENTRY] | Refuse-to-create-DB test; `version > CURRENT` guard test; boot-config fingerprint; live artifact (D-EVIDENCE-BAR) |
| P15 Coverage false comfort | [CI], [TESTQ] | perFile money-path thresholds; mutation score; mechanism-mock ban rule |
| M1 Formatter/CRLF | [TOOLCHAIN] (before [RESTRUCT]) | `.gitattributes` + renormalize commit; fmt commit with an identical trace |
| M2–M3 Peer deps / better-sqlite3 | [DEPS-RT] | `npm ci` without `--legacy-peer-deps`; addon smoke; prod-DB-copy migration test |
| M4 SIGINT under the new runner | [TOOLCHAIN], [REENTRY] | Manual one-Ctrl+C test in Git Bash + PowerShell → stage 1 only |
| M5–M6 Vitest 5 / fake timers | [TOOLCHAIN], [TESTQ] | Per-project test-count diff v4→v5; async timer advance in lock tests |
| M7 Node/types skew | [TOOLCHAIN], [CI] | `.nvmrc` = CI = `engines` = `@types/node` major |
| M10–M11 health.ts path / dashboard contract | [RESTRUCT], [HYGIENE] | Compiled-layout health test; API contract tests; dashboard build in CI |
| M12 Hygiene sweeps | [HYGIENE] | `git status --ignored` before/after; never-delete list honored |

**Ordering implications for the roadmapper:**
1. **[RAILS] first.** It protects the prod DB, wallet, and Telegram from every later phase and adds the singleton/process guards.
2. **[AUDIT] in parallel or immediately after**, producing the register that [CHAR] tags against (KEEP/SUSPECT).
3. **[CHAR] before [LINT] money-path sites and before [RESTRUCT].**
4. **Formatter + `.gitattributes` before [RESTRUCT]**, as isolated mechanical commits.
5. **[LINT] mechanical sites can precede [RESTRUCT]**, since fixing in place keeps the diffs small. **[RESTRUCT] precedes the big toolchain moves.**
6. **[TOOLCHAIN] order:** ts-node replacement + TS 6 → ESLint 10 / Vitest 5 → TS 7 side-by-side → (optional, last) ESM.
7. **[HH3] is its own phase in a sub-package**, decoupled from bot ESM.
8. **[FIX] D-STOP-THE-LINE items interrupt wherever they are found.**
9. **[CI] gates switch on progressively**: each gate is enabled in the phase that drives its metric to zero.
10. **[REENTRY] last**, under the final runner and entry.

## Sources

**Official release notes and migration guides (checked 2026-11-06):**
- TypeScript 7.0 announcement, "Running Side-by-Side with TypeScript 6.0" (2026-07-08): https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- TypeScript 6.0 announcement, deprecations and new defaults (2026-03-23): https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- typescript-eslint issue #12518 (TS 7 unsupported; maintainers point to side-by-side): https://github.com/typescript-eslint/typescript-eslint/issues/12518
- Hardhat, Migrate from Hardhat 2 (ESM required, hooks replace subtasks, Node ≥ 22.13): https://hardhat.org/migrate-from-hardhat2
- Hardhat artifacts format (`hh3-artifact-1`, `project/` inputSourceName, split build-info): https://hardhat.org/docs/reference/artifacts
- Hardhat Ignition CLI (`ignition migrate`): https://hardhat.org/ignition/docs/reference/cli-commands.md; PR #6976 (tasks throw on v2 artifacts): https://github.com/NomicFoundation/hardhat/pull/6976
- Hardhat node / forking via `edr-simulated`: https://hardhat.org/docs/guides/hardhat-node.md
- crytic-compile "Support for Hardhat 3" #629: https://github.com/crytic/crytic-compile/issues/629
- Vitest 5 migration guide: https://vitest.dev/guide/migration/ ; Vitest 5 release blog: https://vitest.dev/blog/vitest-5.html ; `vi.mock` does not intercept `require`: https://vitest.dev/api/vi.html
- ESLint v10 migration guide: https://eslint.org/docs/latest/use/migrate-to-10.0.0 ; release post: https://eslint.org/blog/2026/02/eslint-v10.0.0-released/
- dotenv CHANGELOG (18.0.0–18.0.9): https://github.com/motdotla/dotenv/blob/HEAD/CHANGELOG.md
- better-sqlite3 v13.0.0 release (N-API, in-package prebuilds): https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0 ; 13.0.1 regression / 13.0.2 fix noted in https://github.com/tobi/qmd/issues/827
- uuid v14 CHANGELOG: https://github.com/uuidjs/uuid/blob/v14.0.0/CHANGELOG.md
- chai v6.0.0 release: https://github.com/chaijs/chai/releases/tag/v6.0.0
- ethers v6.17.0 release: https://github.com/ethers-io/ethers.js/releases/tag/v6.17.0 (requestRate default checked in `src.ts/providers/abstract-provider.ts`)

**npm registry (`npm view`, 2026-11-06):** typescript 7.0.2 (exports only version + unstable/*), typescript-eslint 8.72.1 (peer typescript <6.1.0), hardhat 3.21.2 (type module), vitest 5.1.0 (node ^22.12||^24||>=26), eslint 10.14.0, better-sqlite3 13.0.3 (node >=22), dotenv 18.0.9, uuid 14.0.3, chai 6.3.0, ethers 6.17.0, @flashbots/ethers-provider-bundle 1.0.0 (peer ethers 6.7.1, last modified 2024-02-06), hardhat-ethers-chai-matchers (peer chai >=5.1.2 <7), telegram 2.26.22 (latest).

**Checked on this repo and machine (Windows 11, Node v24.18.0):**
- `npx eslint src -f json`: rule/site inventory.
- grep and code reads across `src/` and `test/`.
- `npm audit --omit=dev`, `npm ls ethers`, `git ls-files --eol`, `git config core.autocrlf/ignorecase`.
- Empirical Node checks:
  - path-case duplicate module instances (CJS + ESM)
  - ethers ESM/CJS class non-identity
  - `telegram/sessions` ERR_UNSUPPORTED_DIR_IMPORT
  - `listen(port,'')` binds `::`
  - `NaN ?? 120` and `Number('') ?? 120` semantics

**Project history:** `.planning/RETROSPECTIVE.md` (v6.17 lessons: mock-the-mechanism, INT-NONCE-SELL, D-EVIDENCE-BAR, calm-gas builder coverage), `.planning/PROJECT.md`, `.planning/STATE.md`.

---
*Pitfalls research for: v7.0 Full Audit & Modernization of a live real-money multi-chain MEV sniper bot*
*Researched: 2026-11-06*
