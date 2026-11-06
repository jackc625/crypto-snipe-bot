# Architecture Research

**Domain:** Live-capital multi-chain EVM MEV sniper bot (TypeScript/Node), deep restructure milestone v7.0
**Researched:** 2026-11-06
**Confidence:** HIGH for the current-state map (read from live code; cycles confirmed by `madge` and an independent import-graph script). MEDIUM-HIGH for the target layout and phase order (these are judgment calls built on verified facts). MEDIUM for the external toolchain facts noted inline.

> The `.planning/codebase/` map (ARCHITECTURE.md header says 2026-03-19, STRUCTURE.md 2026-04-29) is **obsolete**. It still describes `storage.ts`/`.bot-state.json`, `monitorStopLoss`, and a `flashbots.ts` in utils. Nothing below relies on it.

---

## 1. Current-State Map (verified 2026-11-06)

### 1.1 Module responsibilities

| Module (lines) | What it actually owns | Module-level state / import-time side effects |
|---|---|---|
| `src/bot.ts` (2,361; ~1,369 code) | Composition root **and** 9 unrelated responsibilities (see 1.4) | Imports the whole graph. `require.main === module` entry. Lazy `require('./utils/db')` in shutdown |
| `src/anti-rug/detector.ts` (2,295; ~1,300 code) | Position registry, per-chain WS subscription, heartbeat, reconnect, backfill, HTTP poll fallback, dispatch, V2/V3 signal evaluators, V3 burn-grace state, confirm-blocks gate | `positionRegistry`, `chainState`, `pendingV3Burn` Maps; `let evaluateRugSignalsShim`; 4 `_…ForTesting` hooks |
| `src/exitEngine.ts` (2,045; ~1,139 code) | Exit config, strategy math, pricing, sell-tx builders, public fallback, full/partial sell, failed-held protection, serial `ExitWorker`, poll loop, start/resume | `exitConfig = buildExitConfig()` **at import**; `routinePausedPositions` Set; `exitWorker` singleton; 5 test seams |
| `src/chainRegistry.ts` (1,089; ~789 code) | Chain/DEX types, `CHAIN_TEMPLATES` data, hardcoded V2/V3 anti-rug allowlists, `buildChainRegistry` env overlay + fail-loud validation (`process.exit(1)`), `createChainContext` | Pure data at import; `process.exit` on bad env at call time. 29 `process.env` reads |
| `src/preflight.ts` (1,011; ~614 code) | 9 readiness checks, cross-env rules, stale-data check, summary printer, `preflight()`/`preflightDryRun()`. **Also** the buy-path affordability gate (`checkEntryExitAffordability`, `computeWorstCasePublicExitGas`) and the mid-run wallet floor (`checkWalletBalance`) | Constants only. Deliberately type-only imports `chainRegistry` to avoid a transitive `dotenv.config()` |
| `src/config.ts` (309) | Required-env spec + validation; legacy single-chain `CONFIG` (mostly dead, but `slippagePercent` and exit fields are live) | **`dotenv.config()`, `validateEnvVars()`→`process.exit(1)`, `NETWORK` validation→`process.exit(1)` at import** |
| `src/utils/db.ts` (773) | Connection, pragmas, migrations v1..v7, JSON-state migration, legacy-row normalization, ~25 prepared statements, PnL queries, `closeDb`, `forceWalCheckpoint` | **At import: `mkdir data/`, open `DB_PATH`, WAL pragmas, `migrateSchema()`, `migrateJsonState()`, `normalizeLegacyMainnetRows()` (an UPDATE), prepare all statements** |
| `src/utils/exitManager.ts` (226) | Per-token sell lock, per-position queued lock, timer registry | 3 Maps. `registerStopLoss/TakeProfit/TimedSell` have **zero callers** (dead) |
| `src/utils/nonceAuthority.ts` (84) | `withNonceLock`, a per-wallet promise-chain mutex | `chains` Map (module identity is the invariant) |
| `src/utils/provider.ts` (60) | HTTP/WS provider cache, `getWallet` | `httpProviders`, `wsProviders` Maps |
| `src/utils/logger.ts` (10) | pino root logger | **Reads `LOG_LEVEL` at import** |
| `src/utils/notifier.ts` (98) | Telegram send + dashboard broadcast | **`dotenv.config()` at import; Telegram URL with the bot token is built at import** |
| `src/riskManager.ts` (181) | 5-rule `canSnipe` gate, cooldown | **`loadRiskConfig()` and `db.prepare()` at import**; `lastSnipeTime` Map |
| `src/api/middleware/auth.ts` (110) | Sessions, login | `sessions` Map; **`setInterval` at import (`unref`'d)** |
| `src/api/ws/broadcaster.ts` (50) | Authenticated WS client set + `broadcast()` | `authenticatedClients` Set. **Imported by domain code** (see 1.3) |
| `src/api/server.ts` (224) | Express/WS server factory | `stoppedChains` Set |
| `src/utils/mevStrategies/*` (1,534) | Flashbots/bloXroute/passthrough strategies, inclusion reconciliation, gas math | None at import |
| `src/utils/honeypot/*` (825) | On-chain checker dispatch, `HoneypotResult` union, bytecode scan, sanitizer | None |
| `src/utils/tokenSafety.ts` (527) | 9 legacy single-chain checks (**dead**: only imported by bot.ts, never called) + 8 `…ForChain` checks | None |
| `src/utils/{gasManager,pairDiscovery}.ts` | `gasManager.getGasOptions` is imported by bot.ts but **never called**; `pairDiscovery.ts` has **zero importers** | Dead |
| `src/anti-rug/raceTelemetry.ts` | Imported only by one unit test | Production-dead (needs an audit decision) |

### 1.2 Real import cycles (runtime edges)

`npx madge --circular --extensions ts src` reports **2 cycles**, which matches the independent graph script:

1. **`anti-rug/detector.ts → anti-rug/exitTrigger.ts → exitEngine.ts → anti-rug/detector.ts`**. This is a static cycle. `exitEngine` imports `detector` only for `unregisterAntiRugPosition`, which is a pure registry mutation (`detector.ts:464-492`). Fix: extract the registry into `anti-rug/registry.ts`. That is a tiny, zero-behavior-change SPLIT.
2. **`alphaDrop.ts → bot.ts → telegramListener.ts → alphaDrop.ts`**. It is broken at runtime by `await import('./bot')` in `alphaDrop.ts:35,45`. It goes away naturally once the snipe handlers leave bot.ts, because alphaDrop then statically imports `execution/snipeV2|V3` and only the composition root imports the telegram listener.

Type-only edges also run "upward": `chainRegistry → honeypot/types, anti-rug/types`, `utils/exitWatchdog → exitEngine`, and ~25 files → `chainRegistry` types. They cause no runtime cycles, but the layering rules have to account for them.

### 1.3 Dependency-direction violations today

- **Domain → api:** `utils/notifier`, `anti-rug/circuitBreaker`, `anti-rug/detector`, `anti-rug/exitTrigger` and `bot` import `api/ws/broadcaster`. The broadcaster is a leaf with no imports. It is infrastructure, not API.
- **Execution → ops:** the buy path (`bot.ts:288 enforceEntryExitAffordability`) imports `preflight.checkEntryExitAffordability`. The mid-run interval imports `preflight.checkWalletBalance`.
- **Buy path → exit:** `bot.ts` imports `computePublicMinOut` from `exitEngine` (a shared slippage helper).
- **API → domain internals:** `api/routes/controls` calls `exitEngine.executeFullSell` directly, and so does `anti-rug/exitTrigger`. That bypass of the ExitWorker is intentional, and mediation relies on `tryAcquireSellLock` inside `executeFullSell` (`exitEngine.ts:832`).
- **Env reads are scattered over 19 files** (`chainRegistry` 29, `preflight` 15, `config` 11, `bot` 7, …). Several are read per call on purpose (tests mutate env between cases), so a naive "freeze config at boot" would change semantics.

Fan-in (runtime): logger 36, db 11, abis 10, broadcaster 9, notifier 8, config 6, provider 5, exitEngine 5, reconciliation 5.

### 1.4 Anatomy of the oversized files (distinct responsibilities; line ranges are from the live file)

**`src/bot.ts`** has 10 responsibilities:

| Lines | Responsibility | Target |
|---|---|---|
| 1-113 | 30+ imports (incl. 10 dead legacy imports) + re-export of `makeExitWatchdog` | dissolved |
| 115-221 | V3 pricing, `waitForLiquidity`, `checkMinLiquidity`, `maybeApproveForChain` | `safety/liquidity.ts`, `execution/submitBuy.ts` |
| 231-269 | `submitBuyTx`: the nonce-locked buy-submit seam | `execution/submitBuy.ts` |
| 270-327 | `enforceEntryExitAffordability` | `risk/affordability.ts` |
| 328-387 | env parse helpers, `emitSnipeFailClean` | `execution/snipeOutcome.ts` |
| 388-453 | `armPositionMonitoring` (exit monitor, then baseline, then anti-rug register; the **ordering is the invariant**) | `execution/armPosition.ts` |
| 454-865 | `executeDeliberateBuy`, `recordDeliberateBuy`, `recordAndArmDeliberateBuy` (private-first ladder, no-double-buy guard, public leg) | `execution/deliberateBuy.ts` |
| 866-1193 | `handleNewPairForChain`: V2 snipe pipeline (dedup, blocklist, honeypot, parallel bank, risk, kill-switch CP1-CP3, affordability, submit, record, arm) | `execution/snipeV2.ts` |
| 1194-1518 | `handleNewV3PoolForChain`: V3 pipeline (inlines arm logic; known drift debt) | `execution/snipeV3.ts` |
| 1519-1678 | `startDexListener` + V2/V3 WS reconnect loops + HTTP polling | `detection/dexListener.ts`, `detection/httpPolling.ts` |
| 1683-1886 | `startMultiChainBot` (registry, preflight, contexts, MEV health, listeners, 2 untracked `setInterval`s, resume, onRestart, API, Telegram, watchdog, shutdown) | `app/orchestrator.ts`, `app/periodicChecks.ts`, `app/chainRestart.ts` |
| 1888-2147 | `resumeMultiChainMonitoring`, `resumeAntiRugMonitoring` | `app/resume.ts` |
| 2148-2184 | `installExitWatchdog` | `app/watchdog.ts` |
| 2185-2353 | two-stage SIGINT factory + `initMultiChainShutdownHandler` | `app/shutdown.ts` |
| 2355-2361 | entry guard | `app/main.ts` |

**`src/anti-rug/detector.ts`** has 8 responsibilities: registry and state types (135-198, 340-515), test hooks (249-339), `startChainAntiRugListener` with the filter-union subscription (516-721), heartbeat and WS-close reconnect (722-1006), backfill, HTTP polling and `getLogsForBackfill` (1007-1320, 1398-1461), dispatch router (1320-1397), V2/V3 signal evaluators with V3 burn-grace state and the confirm-blocks gate (1462-2205), and `evaluateRugSignals` (2206-2295).

**`src/exitEngine.ts`** has 9 responsibilities: config (26-127), pure strategy math (128-305), `queryPrice` (306-350), sell-tx builders and approval (351-425), public-fallback ladder (426-565), failed-held protection and `executeFullSell` (566-1172), `ExitWorker` with its seams (1173-1472), partial sell and reason formatting (1473-1681), and poll loop plus start/resume (1682-2045).

**`src/chainRegistry.ts`** has 5: types (29-115), templates data (116-415), hardcoded allowlists and merge (445-631), `buildChainRegistry`, which alone is **318 code lines** (643-1048), and context and guards (1049-1089).

**`src/preflight.ts`** has 4 groups. Two of them do not belong to it: (a) `checkWalletBalance` (178-235), which is reused at runtime, and (b) the affordability math (236-480), which is reused by the buy path. The other two are (c) the 7 boot-time checks plus cross-env rules plus the stale-data check (485-876), and (d) the runner and summary (877-1011).

**Function hotspots** (code lines, comments stripped): `buildChainRegistry` 318, `controlRoutes` 209, `handleNewV3PoolForChain` 205, `executeFullSell` 198, `handleNewPairForChain` 185, `executeDeliberateBuy` 174, `backfillSinceLastSeen` 169, `chainRoutes` 154, `migrateSchema` 141. 18 functions exceed 100 code lines and 8 exceed 150. Splitting files alone will **not** satisfy a per-function size rule.

**Lint concentration:** 159 of the 350 errors sit in the three files being split (bot 91, detector 34, exitEngine 34). 39 of tokenSafety's 58 errors are in the dead legacy functions, and 18 of bot.ts's errors are unused vars, mostly the dead imports. **About 60 errors disappear by deleting audited dead code.** 40 of the 42 floating/misused-promise errors are in event wiring: WS listener callbacks, `setInterval(async …)`, reconnect loops, and the shutdown `removeAllListeners()`.

### 1.5 Latent hazards found while mapping (send these to the audit register; do NOT fix silently inside a move)

| # | Hazard (verified in code) | Severity class |
|---|---|---|
| H1 | **Dashboard "stop chain" strips anti-rug protection.** `api/routes/chains.ts:139-141` calls `ctx.wsProvider.removeAllListeners()`. The anti-rug detector subscribes on that same shared provider (`detector.ts` `ctx.wsProvider.on(filter, dispatcher)`), so stopping a chain from the dashboard also removes the rug-log subscription for held positions. `/start` re-runs only `startDexListener`, not `startChainAntiRugListener`. | **Capital-safety candidate. D-STOP-THE-LINE: re-surface to the operator; do not auto-defer.** |
| H2 | **Three owners mutate `ctx.wsProvider`:** the V2/V3 DEX reconnect loops (`bot.ts:1550-1605`), the anti-rug `handleWsClose` (`detector.ts` ~918-926), and `onRestart`. Each runs `removeWsProvider(chain)` and builds its own `new WebSocketProvider` outside the provider cache. A reconnect by one can destroy the other's subscription or orphan a provider. With N DEXes on a chain there are N independent close handlers. | Capital-safety candidate (anti-rug blind window) |
| H3 | **Init order is behavior.** `config.ts` imports `logger` before calling `dotenv.config()`, so **`LOG_LEVEL` from `.env` is ignored** (logger is built first). `DB_PATH` works today only because every entry point happens to import `config` (and so dotenv) before `db`. If a restructure loads `db` first, the bot opens the default `./data/bot.db`, possibly reading the **wrong kill-switch state**. | High (kill-switch adjacency) |
| H4 | **Tests can touch the real bot DB.** `vitest.config.ts` loads the real `.env`. Tests such as `test/unit/db.test.ts` and `test/unit/bot/twoStageSigint.test.ts` import `src/utils/db` (directly or via bot.ts) without a `DB_PATH` override. Import runs migrations plus an `UPDATE` against `DB_PATH`, which defaults to `./data/bot.db`, the location of the bot's live DB (it exists locally, and its WAL was modified 2026-05-29). | High (test isolation) |
| H5 | **`test/helpers/testDb.ts` hand-duplicates the schema at `user_version = 4`.** Production is 7, so tests using it run without `lp_baseline`, `chain_state` or `pause_state`. | Medium (schema drift) |
| H6 | There is **no `unhandledRejection` handler**, so Node's default is to crash the process. Every floating promise in listener wiring (e.g. `handleNewPairForChain(...)` called un-awaited in WS callbacks) currently means "a rejection crashes the bot". Adding `.catch()` during lint burn-down changes crash semantics, so it is a **behavior decision**. | Medium (operator decision) |
| H7 | Shutdown clears only the `exitManager` timer registry. The MEV-health and mid-run `setInterval`s, HTTP-poll intervals, anti-rug heartbeats and reconnect sleeps are untracked. That is masked today by `process.exit(0)`. | Low |
| H8 | `src/api/routes/health.ts:15` reads `join(__dirname, '../../../package.json')`. **It breaks if the file's depth changes**, and `__dirname` does not exist under ESM. | Breaks on move |
| H9 | Tests are **not type-checked**: `tsconfig.json` includes only `src`, and `tsconfig.bot.json` includes `src` plus the hardhat config. | Enabler gap |

---

## 2. Standard Architecture (target)

### 2.1 System overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│ app/  COMPOSITION ROOT: the only module allowed to wire domains together   │
│  main.ts (entry) · orchestrator · resume · periodicChecks · chainRestart   │
│  shutdown · watchdog                                                       │
├──────────────┬──────────────┬──────────────┬───────────────────────────────┤
│ detection/   │ ops/         │ api/         │   (consumers: depend inward)  │
│ dexListener  │ preflight/   │ server,routes│                               │
│ httpPolling  │  checks/*    │ middleware,ws│                               │
│ telegram,    │  runner      │ helpers      │                               │
│ alphaDrop    │              │              │                               │
├──────────────┴──────────────┴──────────────┴───────────────────────────────┤
│ execution/  buy pipelines: snipeV2 · snipeV3 · deliberateBuy · submitBuy · │
│             armPosition · snipeOutcome                                     │
├────────────────────────────────┬──────────────────────────────────────────┤
│ exit/  (sell side)             │ anti-rug/  (runtime rug monitor)          │
│  monitor · worker · fullSell   │  registry · listener · wsLifecycle ·      │
│  partialSell · publicFallback  │  backfill · dispatch · signals/* ·        │
│  sellTx · pricing · math       │  evaluate · exitTrigger · lpBaseline …    │
│        ── exit → anti-rug/registry ONLY;  anti-rug/exitTrigger → exit ──   │
├──────────────┬──────────────┬───────────────────────────────────────────────┤
│ safety/      │ risk/        │ submission/                                 │
│ honeypot/*   │ riskManager  │ txManager · mev/{flashbots,bloxroute,        │
│ providers/*  │ affordability│ passthrough,reconciliation,gasMath,types}   │
│ tokenSafety  │ walletFloor  │ receiptDecoder                              │
│ blocklist,   │              │                                             │
│ liquidity    │              │                                             │
├──────────────┴──────────────┴───────────────────────────────────────────────┤
│ chain/   types · templates · allowlists · registry · context              │
│ config/  env (single dotenv load + validation) · legacy CONFIG            │
├───────────────────────────────────────────────────────────────────────────┤
│ infra/   logger · db/{connection,migrations,trades,exitState,antiRug,      │
│          killSwitch,pnl} · providers · abis · notifier · broadcast ·       │
│          retry · withTimeout · concurrency/{nonceAuthority,positionLocks,  │
│          timerRegistry}                                                    │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component responsibilities

| Component | Owns | Why it is its own layer |
|---|---|---|
| `infra/` | Process-wide singletons with no trading logic: logger, DB handle and statements, provider cache, nonce/sell/queue locks, timer registry, broadcast client set, Telegram | One instance per process is the invariant. Isolating them makes module identity auditable |
| `config/` + `chain/` | Env bootstrap, validation, chain/DEX config, `ChainContext` | Everything depends on these. They must not depend on any domain |
| `safety/` | Pre-buy gates (honeypot checker, parallel bank, liquidity, blocklist) | Pure verdict producers. They never sign |
| `risk/` | `canSnipe`, entry/exit affordability, wallet floor | Shared by the buy path, preflight and the mid-run check. Today they are trapped in `preflight.ts`/`bot.ts` |
| `submission/` | Turning a tx request into an included tx (MEV strategies, reconciliation, receipt decode) | Used by both buy and sell. The lowest money-path layer |
| `exit/` | Everything after a position is held | Today's `exitEngine.ts`, split by stage |
| `anti-rug/` | Runtime LP-removal detection and emergency exit trigger | Already a directory. The detector is split by lifecycle stage |
| `execution/` | Buy pipelines (snipe V2/V3, deliberate) and arming of monitors | This is what bot.ts "is" once orchestration leaves |
| `detection/` | Turning chain events and Telegram messages into handler calls | Event wiring only. No gating logic |
| `ops/` | Preflight checks and runner (the kill-switch CLIs stay in `scripts/`) | A leaf consumer used only by `app/` and `scripts/` |
| `api/` | HTTP/WS dashboard surface | Must be imported only by `app/` |
| `app/` | Boot order, intervals, resume order, restart, shutdown, watchdog | The **only** place that knows the whole graph. Splitting `main.ts` (which calls start) from `orchestrator.ts` (which defines start) makes the graph importable without booting |

### 2.3 Recommended project structure

```
src/
├── app/            # composition root: main.ts is the ONLY file that starts anything
├── config/         # env.ts (dotenv + REQUIRED_ENV_VARS), legacy.ts (shrinking CONFIG)
├── chain/          # types, templates, allowlists, registry, context, index (barrel)
├── infra/
│   ├── db/         # connection, migrations, per-table statement modules, index
│   └── concurrency/# nonceAuthority (keep the file name), positionLocks, timerRegistry
├── safety/
│   ├── honeypot/   # unchanged internals (moved from utils/honeypot)
│   └── providers/  # moved from utils/safetyProviders
├── risk/
├── submission/
│   └── mev/
├── exit/
├── anti-rug/
│   └── signals/
├── execution/
├── detection/
├── ops/
│   └── preflight/
│       └── checks/
└── api/            # internal layout unchanged; ws/broadcaster leaves for infra/broadcast
```

**Structure rationale (opinionated choices beyond the operator's proposal):**
- **Add `submission/`.** Without it, "execution" would hold both the buy pipeline (high level) and txManager/MEV (low level, also used by exit), and exit would have to import "execution", which inverts the layering. With it, buy and sell both sit above one submission layer.
- **Add `risk/`.** `checkEntryExitAffordability` and `checkWalletBalance` are runtime money-path gates. Leaving them in `ops/preflight` would make the buy path import ops.
- **Add `chain/` separate from `config/`.** `ChainContext` carries live providers and the wallet, so it is runtime, not config.
- **Keep `anti-rug/` (hyphen) and the `nonceAuthority.ts` file name.** Renames add churn and break grep-ability of carried-forward decision names (D-NONCE-AUTHORITY-ALL) for no gain.
- **Dissolve `utils/` completely.** Every file has a real home. Do not create a new `shared/` grab-bag. If something has no home, that is an audit question.

---

## 3. File-by-File Move/Split Map

Legend: **MOVE** = relocation with no body edits (only import specifiers change). **SPLIT** = code extracted verbatim from an existing file. **NEW** = a module that does not exist today. **MOD** = a behavior-neutral edit, which must be called out in the commit. **DEL** = deletion after audit confirmation. Ranges marked "≈" are approximate boundaries; planners should re-measure them at plan time.

### 3.1 Infrastructure and config (leaves; move first)

| Old | New | Kind | Notes / seam |
|---|---|---|---|
| `utils/logger.ts` | `infra/logger.ts` | MOVE | 36 importers. LOG_LEVEL ordering (H3) is fixed only by an explicit operator decision |
| `api/ws/broadcaster.ts` | `infra/broadcast.ts` | MOVE | Removes all domain→api edges. `api/ws/handler` imports it from infra |
| `utils/notifier.ts` | `infra/notifier.ts` | MOVE (+MOD later) | Its import-time `dotenv.config()` is removed only once `config/env.ts` is the guaranteed first import |
| `utils/provider.ts` | `infra/providers.ts` | MOVE | Cache-key semantics unchanged |
| `utils/abis.ts` | `infra/abis.ts` | MOVE | |
| `utils/retry.ts`, `utils/withTimeout.ts` | `infra/retry.ts`, `infra/withTimeout.ts` | MOVE | |
| `utils/nonceAuthority.ts` | `infra/concurrency/nonceAuthority.ts` | MOVE | **Module identity is the invariant** (see 6.4) |
| `utils/exitManager.ts` (14-100) | `infra/concurrency/positionLocks.ts` | SPLIT | Sell lock and queued lock |
| `utils/exitManager.ts` (100-226) | `infra/concurrency/timerRegistry.ts` | SPLIT | The legacy `registerStopLoss/TakeProfit/TimedSell` are DEL (zero callers) |
| `utils/db.ts` (1-25) | `infra/db/connection.ts` | SPLIT | open + pragmas, same order |
| `utils/db.ts` (26-316) | `infra/db/migrations.ts` | SPLIT | Becomes `runMigrations(db)` with byte-identical SQL. `test/helpers/testDb.ts` must call it (fixes H5) |
| `utils/db.ts` (318-740) | `infra/db/{trades,pnl,exitState,antiRug,killSwitch}.ts` | SPLIT | Statements are grouped by table. `forceWalCheckpoint` lives in `killSwitch.ts` |
| — | `infra/db/index.ts` | NEW | A barrel that preserves today's **evaluation order** (connection, then migrations, then statements) and the old export surface |
| `config.ts` (1-245) | `config/env.ts` | SPLIT + MOD | Single `dotenv.config()` plus `REQUIRED_ENV_VARS` and validation. It becomes the **first import of every entry point** |
| `config.ts` (246-309) | `config/legacy.ts` | SPLIT | `CONFIG`. The dead fields are DEL; the live ones are `slippagePercent` and the exit fields |
| `chainRegistry.ts` (≈29-115, 1083-1089) | `chain/types.ts` | SPLIT | Also becomes the home of `HoneypotCheckerConfig`/`AntiRugConfig`/`AllowlistEntry` re-exports |
| `chainRegistry.ts` (≈116-415) | `chain/templates.ts` | SPLIT | Pure data |
| `chainRegistry.ts` (≈445-631) | `chain/allowlists.ts` | SPLIT | |
| `chainRegistry.ts` (≈632-1062) | `chain/registry.ts` | SPLIT | `buildChainRegistry`, `getEnabledChains`. Decomposing the 318-line function into per-section parsers is a later phase |
| `chainRegistry.ts` (≈1064-1077) | `chain/context.ts` | SPLIT | `createChainContext` |
| — | `chain/index.ts` | NEW | Barrel with the old `chainRegistry` surface |

### 3.2 Domains

| Old | New | Kind | Notes / seam |
|---|---|---|---|
| `utils/honeypot/*` | `safety/honeypot/*` | MOVE | The `HoneypotResult` union is untouched |
| `utils/safetyProviders/*` | `safety/providers/*` | MOVE | |
| `utils/tokenSafety.ts` | `safety/tokenSafety.ts` | MOVE (+DEL) | Delete the 9 legacy single-chain functions first (≈1-308; 39 lint errors) |
| `utils/blocklist.ts` | `safety/blocklist.ts` | MOVE | |
| `bot.ts` 115-221 | `safety/liquidity.ts` | SPLIT | `getV3Price`, `waitForLiquidity`, `checkMinLiquidity` |
| `riskManager.ts` | `risk/riskManager.ts` | MOVE | Import-time `db.prepare` stays until the db split lands |
| `preflight.ts` 236-480 + `bot.ts` 270-327 | `risk/affordability.ts` | SPLIT | Removes the execution→ops edge |
| `preflight.ts` 164-235 | `risk/walletFloor.ts` | SPLIT | Used by preflight and `app/periodicChecks` |
| `utils/txManager.ts` | `submission/txManager.ts` | MOVE | |
| `utils/mevStrategies/*` | `submission/mev/*` | MOVE | |
| `utils/mevStrategies/reconciliation.ts` (gas math: `applyGasMultiplier` sits in types, plus 225-357) | `submission/mev/gasMath.ts` | SPLIT | Pure functions risk/ needs. Keeps the 701-line file under threshold |
| `utils/receiptDecoder.ts` | `submission/receiptDecoder.ts` | MOVE | |
| `exitEngine.ts` 26-127 | `exit/config.ts` | SPLIT | `exitConfig` is still built at import (same timing) |
| `exitEngine.ts` 128-305 | `exit/strategyMath.ts` | SPLIT | Pure |
| `exitEngine.ts` 306-425 | `exit/pricing.ts`, `exit/sellTx.ts` | SPLIT | |
| `exitEngine.ts` 426-565 | `exit/publicFallback.ts` | SPLIT | `computePublicMinOut` is imported by `execution/deliberateBuy` |
| `exitEngine.ts` 566-1172 | `exit/fullSell.ts` | SPLIT | `routinePausedPositions` and its test seam move together |
| `exitEngine.ts` 1173-1472 | `exit/worker.ts` | SPLIT | `ExitWorker`, `enqueueExit`, `setExitWorkerWatchdog`, and its seams |
| `exitEngine.ts` 1473-1681 | `exit/partialSell.ts` | SPLIT | |
| `exitEngine.ts` 1682-2045 | `exit/monitor.ts` | SPLIT | `pollExitStrategy`, `startExitMonitor`, `resumeExitMonitor` |
| — | `exit/index.ts` | NEW | Barrel with the old `exitEngine` surface |
| `anti-rug/detector.ts` ≈135-198, 340-515 | `anti-rug/registry.ts` | SPLIT | **Breaks cycle #1.** `exit/fullSell` imports this leaf directly, never the barrel |
| `anti-rug/detector.ts` 516-721 | `anti-rug/listener.ts` | SPLIT | Owns `chainState`, the single per-chain subscription |
| `anti-rug/detector.ts` 722-1006 | `anti-rug/wsLifecycle.ts` | SPLIT | Heartbeat and reconnect (preserve H2 behavior verbatim) |
| `anti-rug/detector.ts` 1007-1320, 1398-1461 | `anti-rug/backfill.ts` | SPLIT | Backfill, HTTP poll, `getLogsForBackfill` |
| `anti-rug/detector.ts` 1320-1397 | `anti-rug/dispatch.ts` | SPLIT | The `evaluateRugSignalsShim` and its setter **move with dispatch** |
| `anti-rug/detector.ts` 1462-2205 | `anti-rug/signals/{v2,v3,confirmGate}.ts` | SPLIT | `pendingV3Burn` state lives in `signals/v3.ts` |
| `anti-rug/detector.ts` 2206-2295 | `anti-rug/evaluate.ts` | SPLIT | |
| `anti-rug/detector.ts` | `anti-rug/index.ts` | NEW barrel | `detector.ts` is deleted at the end |
| `anti-rug/raceTelemetry.ts` | DEL or keep | Audit decision | Production-dead |
| `bot.ts` 222-269 | `execution/submitBuy.ts` | SPLIT | `submitBuyTx`, `maybeApproveForChain`, `BuyMode` |
| `bot.ts` 328-387 | `execution/snipeOutcome.ts` | SPLIT | |
| `bot.ts` 388-453 | `execution/armPosition.ts` | SPLIT | Unifying the V3 handler onto it is a behavior-relevant debt item, left for later |
| `bot.ts` 454-865 | `execution/deliberateBuy.ts` | SPLIT | `scripts/deliberate-buy.ts` imports this directly |
| `bot.ts` 866-1193 | `execution/snipeV2.ts` | SPLIT | |
| `bot.ts` 1194-1518 | `execution/snipeV3.ts` | SPLIT | |
| `bot.ts` 1519-1620 | `detection/dexListener.ts` | SPLIT | Preserve the reconnect loops verbatim (H2) |
| `bot.ts` 1621-1678 | `detection/httpPolling.ts` | SPLIT | |
| `alphaDrop.ts`, `telegramListener.ts` | `detection/` | MOVE + MOD | The dynamic `import('./bot')` becomes a static import of `execution/snipe*` (**cycle #2 gone**) |
| `preflight.ts` 485-876 | `ops/preflight/checks/{rpc,mev,checker,antiRugGate,crossEnv,staleData}.ts` | SPLIT | |
| `preflight.ts` 877-1011 + types | `ops/preflight/runner.ts`, `ops/preflight/index.ts` | SPLIT / NEW | `scripts/preflight.ts` imports the barrel |
| `bot.ts` 1683-1886 | `app/orchestrator.ts` | SPLIT | |
| `bot.ts` 1734-1789 | `app/periodicChecks.ts` | SPLIT | The two intervals |
| `bot.ts` ≈1801-1845 | `app/chainRestart.ts` | SPLIT | The `onRestart` closure becomes `makeChainRestart(registry)` |
| `bot.ts` 1888-2147 | `app/resume.ts` | SPLIT | Exit resume **before** anti-rug resume |
| `bot.ts` 2148-2184 + `utils/exitWatchdog.ts` | `app/watchdog.ts` | SPLIT + MOVE | |
| `bot.ts` 2185-2353 | `app/shutdown.ts` | SPLIT + MOD | The inline `require('./utils/db')` becomes a static import (db is already loaded) |
| `bot.ts` 2355-2361 | `app/main.ts` | NEW | The only file with a top-level `start()` call |
| `api/routes/health.ts` | (stays) | MOD | Resolve `package.json` from a project-root helper, not `../../../` (H8) |
| `utils/gasManager.ts`, `utils/pairDiscovery.ts` | — | DEL | Zero runtime callers |

**Barrels policy.** `exit/index.ts`, `anti-rug/index.ts` and `chain/index.ts` are the public surfaces. Code **inside** a domain imports siblings directly and never its own barrel. Code **outside** imports the barrel, **except** the two declared narrow edges (`exit/fullSell → anti-rug/registry`, `anti-rug/exitTrigger → exit/fullSell`), which must import the leaf module directly. Otherwise the barrels recreate cycle #1.

**No compatibility shims at old paths.** A shim such as `src/exitEngine.ts` → `export * from './exit'` makes `vi.mock('…/exitEngine')` mock the shim while internal callers import `exit/fullSell`, so interception silently stops. Update every importer, including the test `vi.mock` specifiers, in the same commit as the move.

---

## 4. Dependency Rules and Enforcement

### 4.1 Allowed-dependency matrix (runtime edges; type-only edges in parentheses)

| From ↓ may import → | infra | config | chain | safety | risk | submission | exit | anti-rug | execution | detection | ops | api | app |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| infra | ✓ | — | (types only) | — | — | — | — | — | — | — | — | — | — |
| config | logger | ✓ | — | — | — | — | — | — | — | — | — | — | — |
| chain | ✓ | ✓ | ✓ | (types) | — | — | — | (types) | — | — | — | — | — |
| safety | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — | — | — |
| risk | ✓ | ✓ | ✓ | — | ✓ | mev/gasMath, mev/types | — | — | — | — | — | — | — |
| submission | ✓ | ✓ | ✓ | — | — | ✓ | — | — | — | — | — | — | — |
| exit | ✓ | ✓ | ✓ | — | — | ✓ | ✓ | **registry only** | — | — | — | — | — |
| anti-rug | ✓ | ✓ | ✓ | — | — | ✓ | **fullSell via exitTrigger only** | ✓ | — | — | — | — | — |
| execution | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | barrel | barrel | ✓ | — | — | — | — |
| detection | ✓ | ✓ | ✓ | — | — | — | — | — | barrel | ✓ | — | — | — |
| ops | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | ✓ | — | — |
| api | ✓ | ✓ | ✓ | sanitize only | ✓ | — | barrel | barrel | — | — | — | ✓ | — |
| app | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| scripts/ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | — | **never `app/main.ts`** |

**Money-path structural rules.** These replace today's comment-and-grep enforcement:
- **R-SIGN:** only `execution/submitBuy.ts`, `exit/fullSell.ts`, `exit/publicFallback.ts`, `exit/partialSell.ts` and `execution/deliberateBuy.ts` may import `submission/txManager`. Calls to `wallet.sendTransaction` / `.signTransaction` are banned elsewhere via ESLint `no-restricted-syntax`. A path-agnostic **signing-site census** test pairs with it (see 6.4).
- **R-PRIVATE-SNIPE:** `execution/snipeV2|V3` must not import the deliberate path's public-leg module, nor `submission/mev/passthrough` directly.
- **R-API-LEAF:** nothing outside `app/` imports `api/**`.
- **R-NO-CYCLES:** zero cycles, as an error from day one of the restructure. Only 2 exist and both are broken early.
- **R-ENV:** `process.env` may appear only in `config/**` and `chain/registry.ts`. **This is the final target, not a move-phase rule.** Per-call env reads must become read-through accessors (`env.int('X', fallback)` evaluated per call), never a frozen boot-time object, because tests and runtime behavior depend on per-call reads.

### 4.2 Tooling

- **dependency-cruiser is the authoritative CI gate.** It checks graph shape (cycles, layer rules with path capture groups, orphans) that a per-line ESLint rule cannot see. Run it with `tsPreCompilationDeps` so type-only edges are classified, then exempt them with `dependencyTypesNot: ["type-only"]` where the matrix says "(types)". Sketch:
  ```js
  // .dependency-cruiser.cjs (excerpt)
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'infra-is-leaf', severity: 'error',
      from: { path: '^src/infra/' },
      to: { path: '^src/(?!infra/)', pathNot: '^src/chain/types\\.ts$' } },
    { name: 'api-only-from-app', severity: 'error',
      from: { path: '^src/(?!app/|api/)' }, to: { path: '^src/api/' } },
    { name: 'exit-to-antirug-registry-only', severity: 'error',
      from: { path: '^src/exit/' },
      to: { path: '^src/anti-rug/', pathNot: '^src/anti-rug/registry\\.ts$' } },
    { name: 'no-own-barrel', severity: 'error',
      from: { path: '^src/([^/]+)/' }, to: { path: '^src/$1/index\\.ts$' } },
    { name: 'nobody-imports-main', severity: 'error',
      from: {}, to: { path: '^src/app/main\\.ts$' } },
    { name: 'no-orphans', severity: 'error',
      from: { orphan: true, pathNot: '\\.d\\.ts$' }, to: {} },
  ]
  ```
- **ESLint (in-editor feedback):** use `eslint-plugin-boundaries` (`boundaries/dependencies`) only if the operator wants red squiggles in WebStorm. dependency-cruiser remains the gate. One tool is mandatory, the second is optional. Add `@typescript-eslint/switch-exhaustiveness-check: error`, which protects the `HoneypotResult` union.
- **Size rules (final thresholds, all `error`):** `max-lines: { max: 400, skipComments: true, skipBlankLines: true }`. The code is about 40-45% rationale comments, so counting comments would punish the documentation culture. `max-lines-per-function: { max: 120, skipComments: true, skipBlankLines: true }` is turned on **only after** the function-decomposition phase, because 18 functions exceed 100 today. Calibrate `complexity` after measurement. Do not guess a number now.
- **Dead code:** `knip` in CI (unused files, exports and deps). It would have caught `pairDiscovery.ts`, `gasManager.ts` and the legacy tokenSafety functions.
- **Mock-path integrity (NEW, needed before any move):** a script that resolves every `vi.mock`/`vi.doMock` string specifier (513 of them target `src/`) relative to its test file and fails if one does not resolve. Later, codemod them to the `vi.mock(import('…'))` form, which Vitest documents as letting TypeScript validate the path. That requires a type-checked test tsconfig (H9).
- **CI order:** `tsc` (all projects, including the new test project), then dependency-cruiser, then ESLint, then knip, then mock-path check, then unit, then integration. The cycle check and mock-path check go into CI **at the start of the restructure**. Lint becomes a gate when burn-down finishes. The size rules become gates at the end of the restructure and decomposition phases.

---

## 5. Architectural Patterns to Follow

### Pattern 1: Composition root with an importable-but-inert graph
**What:** `app/main.ts` is the only module with a top-level `start()`. Every other module only defines things.
**When:** Always, from the restructure onward.
**Trade-offs:** One extra file. In return, "import the whole app graph without booting" becomes a safe smoke test (see 7.2) under the bot-is-OFF rule. Today that is impossible: bot.ts pulls in Express, Telegram, an auth interval and DB migrations on import.

### Pattern 2: State modules own state; behavior modules import them
**What:** When splitting `detector.ts`/`exitEngine.ts`, each module-level Map/Set/`let` lands in exactly one module that exports accessors plus its own `_resetForTesting`. The behavior modules import those accessors.
**Why:** It keeps one instance per process and keeps test seams (`_setEvaluateRugSignalsForTesting`, `_setSellExecutorForTesting`, …) mutating the same binding the production code reads. Splitting a `let` shim away from its reader is a silent "test injects into nothing" failure.
```typescript
// anti-rug/registry.ts: the ONLY owner of positionRegistry
const positionRegistry = new Map<string, Map<string, RegisteredPosition[]>>();
export function unregisterAntiRugPosition(chain: string, tradeId: number): void { /* verbatim */ }
export function getRegisteredPositions(chain: string): RegisteredPosition[] { /* verbatim */ }
export function _resetRegistryForTesting(): void { positionRegistry.clear(); }
```

### Pattern 3: Static imports for safety-critical edges; no late-bound callbacks
**What:** Do not "break" a cycle by injecting `onPositionClosed` hooks at startup for the exit→anti-rug unsubscribe, or for nonce/sell locks.
**Why:** `scripts/deliberate-buy.ts` and many tests compose only part of the app (they call `executeDeliberateBuy` without `startMultiChainBot`). A hook that only `app/` registers would be silently absent on those paths. Break cycles by extracting the leaf (`anti-rug/registry.ts`), never by runtime registration.

### Pattern 4: Pure-move commits, then split commits
**What:** Each restructure step is (a) `git mv` plus specifier updates only, with test and characterization suites green, then (b) a separate SPLIT commit that extracts verbatim ranges. Never mix a move or split with a lint fix or a behavior change.
**Why:** `git diff -M --stat` stays reviewable. Per project memory, merges and large diffs here have deleted code before, and pure-move commits make "nothing was lost" mechanically checkable. Add a script that compares the multiset of non-import statement hashes before and after for SPLIT commits.

### Pattern 5: Explicit initialization over import-time side effects
**What:** Today 7 modules do real work on import (see 1.1). End state: `infra/db/connection.ts` exports `openDb(path)`, `config/env.ts` loads dotenv, and `app/main.ts` (and each script entry) calls them in a fixed order.
**When:** Staged. In the move phase, keep import-time behavior **exactly**, and keep the barrel in `infra/db/index.ts` evaluating connection, migrations and statements in today's order. Convert to explicit `init()` only in a later, characterized MOD step, because changing *when* the DB opens is a behavior change for every script.

---

## 6. Integration Points: Risky to Move, and How

The new/modified status is explicit for each.

### 6.1 Event-listener wiring (DEX factories, WS close handlers, HTTP polling)
- **Today:** `bot.ts:1523-1678`. Each DEX gets its own `Contract.on('PairCreated'|'PoolCreated')`, its own `websocket.on('close')` reconnect loop that builds `new WebSocketProvider` and assigns `ctx.wsProvider`, and handler calls that are not awaited (floating promises, H6).
- **Move (P-RESTRUCTURE):** SPLIT verbatim into `detection/dexListener.ts` and `detection/httpPolling.ts`. Keep listener closures identical, including the un-awaited handler call, the `reconnectDelay` doubling and the `(… as any).websocket` access. No `.catch` added.
- **Guard:** the existing `test/integration/wsReconnect.test.ts` plus `test/unit/chainRestart.test.ts`, retargeted. Add a characterization test that asserts listener count per factory after restart (catches the duplicate-listener risk when `onRestart` re-runs `startDexListener`).
- **Later (MOD, operator decision):** a single per-chain WS owner (`infra/wsConnection.ts`, **NEW**) that reconnects once and notifies subscribers (DEX listener, anti-rug listener). This is the fix for H1/H2 and **changes behavior**. It belongs in the capital-safety fix phase, decided by the operator.

### 6.2 Timer registry
- **Today:** `exitManager.timerRegistry` holds only exit-monitor intervals. The SL/TP/timed registrars are dead. All other timers are untracked (H7).
- **Move:** SPLIT into `infra/concurrency/timerRegistry.ts` with identical key format `${chain}:${token.toLowerCase()}`. DEL the dead registrars. `exit/monitor.ts` and `anti-rug/exitTrigger.ts` import it. `hasExitMonitorTimer` (used by the D-FAILED-EXIT-KEEP-MONITORING re-arm) moves with it.
- **Guard:** add a characterization test of the re-arm-only-when-cleared behavior: an anti-rug sell fails, the position is still held, and the poll timer is re-armed exactly once.
- **Later (NEW `app/lifecycle` disposables registry, MOD):** register the MEV-health, mid-run, HTTP-poll, heartbeat and auth-cleanup timers so shutdown disposes them in order. This is low risk but is a logged decision.

### 6.3 Graceful shutdown ordering
- **Today:** `createTwoStageShutdown` is pure and tested. Cleanup order is API close, Telegram disconnect, `clearAllTimers`, WS `removeAllListeners`+`destroy`, `closeDb`, `exit(0)`, with a single `.unref()`'d grace timer armed **before** cleanup.
- **Move:** SPLIT into `app/shutdown.ts`. MOD: replace the inline `require('./utils/db')` with a static `closeDb` import. db is already loaded by then, so this is behavior-neutral but must be noted in the commit.
- **Guard:** retarget `test/unit/bot/twoStageSigint.test.ts`. Its source-grep assertions read `src/bot.ts` (see 7.3). Add an order-characterization test with collaborators faked at their module boundary. The *order* is what is under test, so faking collaborators is legitimate here.

### 6.4 Nonce lock (`withNonceLock`)
- **Today:** a module-level `chains` Map. The signing sites are `submitBuyTx` (buy), `executeFullSell` approvals, `executePublicFallbackSell`, `executePartialSell`, and the deliberate-buy public leg. The ExitWorker deliberately does **not** take an outer lock (CR-01: a non-reentrant mutex would deadlock).
- **Move:** MOVE the file unchanged. **Two hazards:**
  - **Module duplication.** If the ESM switch or the runner ever loads the file through two specifiers or loaders (e.g. a CJS `require` of an ESM-converted path, or a `?query` variant), two `chains` Maps exist and the collision class silently returns.
  - **Losing a call site during a SPLIT.** The lock calls are inline inside `executeFullSell`.
- **Guard (NEW):**
  1. A path-agnostic **signing-site census** test. It walks the TS AST of all of `src/`, finds every call to `sendTxWithRetry`/`escalatePrivate*`/`.sendTransaction`, asserts that each sits lexically inside a `withNonceLock(…, () => …)` callback or is one of the named seams, and asserts the total count (a dropped or added site fails loudly).
  2. A **singleton-identity** test that imports `nonceAuthority` via every specifier in use and asserts reference equality of `withNonceLock`.
  3. The existing real-path `test/unit/bot/buyNonceLock.test.ts`, retargeted.
  
  Then add dependency-cruiser rule R-SIGN.

### 6.5 Exit mutex (sell lock + queued lock + serial worker + routine pause)
- **Today:**
  - `tryAcquireSellLock` at `exitEngine.ts:832` (full sell) and `:1483` (partial) is the mediation point for the worker, `api/routes/controls` force-sell and emergency-sell, and the anti-rug `exitTrigger`, which all call `executeFullSell` directly.
  - `tryEnqueuePosition` spans the worker lifetime.
  - `routinePausedPositions` lives in exitEngine.
- **Move:** SPLIT the locks into `infra/concurrency/positionLocks.ts`, the worker into `exit/worker.ts`, and the routine pause into `exit/fullSell.ts`. One instance each. Keep the key builders byte-identical. Optionally unify them into one `positionKey()` helper later, after a characterization test pins the key strings.
- **Guard:** retarget the existing exitEngine unit tests (80 import references). Add a characterization test for "API emergency-sell and anti-rug trigger race on the same token: exactly one submit, and the other returns false". Assert the `realSellExecutor` → `executeFullSell` binding still points at the production function after the split.

### 6.6 WS heartbeat and reconnect (anti-rug)
- **Today:** `detector.ts` `setupHeartbeat` (30s ping, terminate on missed pong) and `handleWsClose` (backoff, `removeWsProvider`, new provider, `ctx.wsProvider =`, resubscribe the filter union, backfill since `last_seen_block` with fail-closed gap handling). `chainState` holds the interval and the dispatcher reference used for `.off()`.
- **Move:** SPLIT into `anti-rug/listener.ts` (owns `chainState`) and `anti-rug/wsLifecycle.ts` and `anti-rug/backfill.ts` (import the state accessors). **Do not merge it with the DEX reconnect loop during the move**, even though the two are near-duplicates. Merging them is the H2 behavior fix and is decided separately.
- **Guard:** `test/integration/anti-rug/wsReconnectBackfill.test.ts` and the anti-rug fork suite (`antiRugDetector.fork.test.ts`). Add a characterization test asserting **exactly one** active filter subscription per chain after N registrations, after one reconnect, and after an unregister.

### 6.7 DB migrations (WAL, `user_version = 7`, kill-switch)
- **Today:** `migrateSchema()` runs at import with versioned `if (version < N)` blocks, a transaction for the v6 DDL, and then `user_version = 7`. `pause_state` is seeded at v6. `forceWalCheckpoint` is called on the mid-run auto-pause (CR-04).
- **Move:** SPLIT into `infra/db/migrations.ts`, exported as `runMigrations(db)` with the identical SQL and order. `infra/db/index.ts` calls it at import exactly as today.
- **Guard (NEW, before the split):** a golden schema test. Run migrations on `:memory:` from v0 and snapshot the normalized `sqlite_master` and `user_version`. Also run the v4→v7 upgrade from a fixture DB and snapshot it. Rewrite `test/helpers/testDb.ts` to call `runMigrations` (removes H5 drift). The existing `test/integration/killswitchCheckpoints.test.ts` and `test/integration/pauseFlow.test.ts` guard kill-switch semantics.
- **Init order:** `config/env.ts` must be the first import of every entry point (bot, `scripts/*.ts`), so `DB_PATH` is set before `infra/db` evaluates (H3). The env-import-first rule is enforceable in ESLint with `import/first` plus a custom check, or by a census test over the entry files.

### 6.8 Boot and resume ordering (implicit invariants in `startMultiChainBot`)
These must survive the split into `app/*` verbatim:
1. Preflight runs **before** any `ChainContext` is created.
2. Per chain: context, then MEV health (warn only), then DEX listeners.
3. Intervals are scheduled.
4. `resumeMultiChainMonitoring` (exit) runs **before** `resumeAntiRugMonitoring`, and allowlist verification gates anti-rug per chain (CR-04).
5. The API server starts **before** the Telegram listener. The closure captures the mutable `telegramHandle`.
6. The watchdog is installed, then the shutdown handler.

Inside `armPositionMonitoring`, `startExitMonitor` runs **before** `snapshotLpBaseline`, which runs **before** `registerAntiRugPosition`. Guard all of this with the order-characterization test in 7.2 (C8).

---

## 7. Refactor Order: Decisions and Phase Build Order

### 7.1 Decisions (with justification)

**D1: Characterization tests come BEFORE the toolchain upgrade.**
- The toolchain change is itself a behavior risk. TS 7 removes `moduleResolution: node`, which this repo uses in both tsconfigs, and changes the default `types` to `[]`. A possible ESM switch changes module evaluation and cycle semantics. Replacing ts-node changes the runtime loader. The net has to exist before that, or regressions from the upgrade are undetectable.
- Tests already run under Vite's ESM module runner while production runs CJS via ts-node, so **prod import-order behavior is not covered by the current suite.**
- Churn is small: write the new tests with the stable core API (`describe/it/expect/vi.fn`, `vi.mock(import(...))`). Little of that differs between Vitest 4 and 5.

**D2: Toolchain foundation (including the ESM decision) comes BEFORE the restructure. Contracts/Hardhat 3 are decoupled and come AFTER.**
- The ESM conversion rewrites every relative specifier (adding extensions) and replaces `require.main`, `__dirname` and the inline `require`. Do that once, by codemod, on the known layout under the characterization net, rather than interleaved with 60+ file moves.
- After the switch to `module: nodenext`, the restructure can use `package.json#imports` aliases (`#infra/*`, `#exit/*`). Node, TypeScript and Vite all understand them natively. Aliases make import and `vi.mock` specifiers **stable across later moves**, which is the single biggest de-risker for 513 mocks.
- The fast TS 7 `tsc` shortens the many verify loops of the restructure.
- **Hardhat 3 requires an ESM project** (official docs, error HHE13; HIGH confidence). Do not let that force or block the bot's module decision. First relocate `contracts/`, `hardhat.config.ts`, `ignition/`, `typechain-types/` and the HH2 devDeps into an independent `contracts/` package with its own `package.json` and lockfile. That mirrors the existing `dashboard/` precedent. It is a pure relocation on Hardhat 2, and the fork harness (`test/fork/setup.ts` spawns `npx hardhat node --fork`) points at it. This also removes the toolbox peer-dep tangle from the bot's install, which is the likely root of `--legacy-peer-deps`.
- Upgrade Hardhat 3 later, inside that package. The fork suite is the money-path verification instrument for the restructure and the re-entry gate, so it must not change under the restructure.
- Recommendation on ESM itself: **go ESM for the bot**. It aligns prod with the test runtime, matches Vitest 5 and ESLint 10 config norms, and is required later for any shared contracts code. Do it only after the static cycle is broken and the init-order hardening below is in place.

**D3: Lint burn-down is split. Cheap and mechanical before the moves; semantic after.**
- **Before the moves:** delete audited dead code (about 60 errors gone, and smaller files to move). Fix `no-unused-vars`, `no-unnecessary-type-assertion` and `no-require-imports`. These fixes do not interact with module placement.
- **After the moves**, per domain on small files:
  - the 213 `no-unsafe-*` (mostly untyped ethers `Contract` calls, fixed with typed contract wrappers in `infra/abis`);
  - the 42 floating/misused promises.
- Fixing `no-unsafe-*` inside 2,000-line files before splitting means fix diffs and move diffs touch the same lines, so review and verification get harder for no benefit.
- Promise fixes are **behavior decisions** (H6: adding `.catch` turns "crash" into "continue"). They are best decided per small, characterized module with operator sign-off.

**D4: Confirmed capital-safety bugs are fixed BEFORE the restructure, on the current layout.**
- Characterization tests lock current behavior, bugs included. A move phase must not carry a known money-path bug forward or entangle its fix with a move.
- Per D-STOP-THE-LINE and project memory, H1/H2 (anti-rug blind on dashboard stop or reconnect) are re-surfaced to the operator. They are not deferred.
- Non-capital bugs are fixed after the restructure, in the new homes.

**D5: Dashboard runs in parallel, after the toolchain phase.**
- `dashboard/` is an independent package (own lockfile, `moduleResolution: bundler`, Vite 8, React 19) with **zero imports from `src/`**.
- It couples to the bot through:
  - the HTTP/WS JSON contract;
  - root-vitest tests that read dashboard source (`test/unit/dashboard/*`);
  - `tsc -p dashboard/tsconfig.json` in CI.
- Freeze the API contract during the restructure with a route-response shape characterization (C7). Then the dashboard can be upgraded at any point after the TS-version decision.

**D6: Function decomposition is a separate phase after file splits.**
- File splits move verbatim ranges. Decomposing `buildChainRegistry` (318), the route factories and `migrateSchema` is low risk.
- Decomposing `executeFullSell`, the snipe handlers and `executeDeliberateBuy` (the checkpoint and ladder logic) is a money-path edit. It needs characterization plus RED-proven tests and operator sign-off.
- `max-lines-per-function` becomes a gate only after this phase.

### 7.2 Characterization suite (what "behavior locked" means)

All tests use a temp-file SQLite (`DB_PATH` set per worker) and fake only the network edge. Observations are captured through the dotted `op` log taxonomy (a pino test destination), DB rows, and submit calls at the MEV-strategy boundary.

| ID | Locks | Notes |
|---|---|---|
| C0 | Test tripwires | Not a characterization in itself: `DB_PATH` forced to a temp path in vitest setup (fixes H4); unit-project network guard; mock-path resolution script; dotenv no longer clobbering test env |
| C1 | `buildChainRegistry()` JSON snapshot under N env fixtures, plus fail-loud exits | Cheapest and highest value for the chain/ split |
| C2 | `pollExitStrategy` decision sequence over recorded price series | Golden of enqueue/partial/continue decisions |
| C3 | V2 and V3 snipe pipelines | `op` sequence, DB rows and submit calls over gate permutations: dedup, blocklist, honeypot pass/fail/**unknown**, risk reject, pause at CP1/2/3, affordability fail, submit throw |
| C4 | Deliberate-buy ladder | Private fail, then reconcile, then public; the no-double-buy guard (`deliberateBuyReplay.fork` exists) |
| C5 | Anti-rug dispatch and evaluate over the rug fixtures | Dry-run vs live gate; single subscription per chain |
| C6 | Migrations golden | v0→v7 and v4→v7 |
| C7 | API route response shapes | Protects the dashboard |
| C8 | Boot, resume and shutdown order; arm ordering | |
| C9 | Signing-site census and nonce-lock singleton identity | |
| C10 | Import-time side-effect census | The set of modules with top-level effects. A move that changes it is visible |
| C11 | Import-graph smoke | A subprocess imports `app/orchestrator` (not `main`) under the real runtime with a temp DB and dummy env. Exercises real module resolution and init order **without** booting. It is not a dry-run mode, so the "never boot bot.ts to test" rule holds |

### 7.3 Source-grep tests: convert before moving
About a dozen tests read specific source files and assert on their text:
- `test/unit/bot/twoStageSigint.test.ts:133`
- `test/integration/anti-rug/botWiring.test.ts:339`
- `test/unit/mevStrategies/inclusionReconciliation.test.ts:928,985,992`
- `test/unit/exitEngine/antiRugReason.test.ts:265`
- `test/unit/chainRegistry/antiRugConfig.test.ts:358+`
- `test/unit/codeQuality.test.ts`, `ethersV5PatternsAbsent`, `ethersV6BigIntArithmetic`

Assertions of the form **"X is absent from bot.ts" become vacuously true** once code leaves bot.ts. Assertions of the form "X is present" fail on the move, which is good. Before moving, convert each one to one of:
- a whole-`src/` scan, which is path-agnostic;
- a dependency-cruiser or ESLint rule;
- a behavior test.

The invariants they encode are load-bearing: realHash wiring, nonce lock at the buy seam, snapshot-before-register, and no unsafe tax function.

### 7.4 Suggested phase build order (for the roadmapper)

```
P1 Audit + findings register ─────────────────────────────┐ (read-only)
P2 Test infra tripwires + characterization C0–C11 ────────┤ needs P1 (audit picks scenarios)
P3 Capital-safety fixes (STOP-THE-LINE, RED-proven) ──────┤ needs P2 (net) + operator decisions on H1/H2
P4 Pre-move cleanup: dead-code DEL, mechanical lint,      │ needs P2
   break cycle #1 (anti-rug/registry), env-first import,  │
   source-grep test conversion, testDb → real migrations  │
P5 Toolchain foundation: contracts → own package (HH2),   │ needs P4 (no static cycle; init order explicit)
   TS 6 bridge → nodenext, typed test tsconfig,           │
   vi.mock(import()) codemod, ts-node replacement,        │
   ESM conversion, Vitest 5, ESLint 10 config,            │
   TS 7 tsc (TS 6 alias for API tools), dep-cruiser       │
   + mock-path check + cycle gate in CI                   │
P6 Restructure, leaves first (one plan per row):          │ needs P5
   6a infra (+db split) → 6b config/chain → 6c safety,    │
   risk, submission → 6d exit → 6e anti-rug → 6f          │
   execution → 6g detection + ops → 6h app (bot.ts        │
   dissolved LAST) → 6i dep-cruiser full matrix + max-lines│
P7 Lint burn-down (typed contracts, unsafe-any, promise   │ needs P6; promise fixes = operator decisions (H6)
   handling) → lint gate ON                                │
P8 Function decomposition (non-money first, then money    │ needs P7; max-lines-per-function gate ON at end
   path with sign-off) + explicit init() + disposables    │
P9 Test-suite quality: mock-the-mechanism rewrites, prune,│ can overlap P8; coverage floor on money paths
   coverage floor                                          │
P10 Contracts tooling: Hardhat 3 (ESM) in contracts pkg,  │ needs P5 relocation; any time after P6
    fork-harness migration, slither/mythril gates          │
P11 Dashboard audit + upgrade                             │ parallel, any time after P5
P12 CI hardening (all gates, zero baseline) + docs        │ needs P7–P11
    (architecture/module map regenerated) + repo hygiene   │
P13 Fork rehearsal + live ETH roundtrip re-entry gate ────┘ needs everything
```

**Ordering rationale:**
- Tests come before toolchain (D1); toolchain before structure (D2); structure before quality (D3). That is the canonical order, with two justified insertions:
  - **P3** (capital-safety fixes before anything moves, D4);
  - **P4** (a small behavior-neutral cleanup that makes P5 safe: no static cycles under ESM, explicit env-first import, no vacuous grep tests).
- Within P6, leaves go first. Each infra move is a pure relocation that establishes the layer rule. bot.ts goes last because it is the composition root: when it is dissolved, every module it wires already sits at its final path.

**Research flags for phases:**
- **P5 needs deeper research.** Pin the exact versions: TS 7 has no compiler API, so typescript-eslint, ts-node and any TS-API tool (dependency-cruiser's TS parsing, knip) must use the `@typescript/typescript6` alias (MEDIUM, community sources from November 2026). Choose the ts-node replacement (tsx vs Node native type stripping, which needs `.ts` specifiers or `rewriteRelativeImportExtensions`). Check CJS-only deps under ESM (`@flashbots/ethers-provider-bundle`, `telegram`).
- **P10 needs deeper research.** Find the Hardhat 3 equivalent of `hardhat node --fork` plus the Ignition and typechain changes.
- **P3 and P8 (money-path) need code-review depth `deep` and real-path RED tests,** per project memory on green-suite blind spots.
- **P6 is standard mechanics,** but planners must re-measure line ranges and run the mock-path check every commit.

---

## 8. Invariant Preservation Strategies

| Invariant | Where it lives after the restructure | Preservation strategy |
|---|---|---|
| Bot-wide per-wallet `withNonceLock` on every signing path | `infra/concurrency/nonceAuthority.ts` (MOVE, unchanged) | C9 AST signing-site census; singleton-identity test across specifiers; dependency-cruiser R-SIGN; retargeted `buyNonceLock` real-path test; no outer lock in `exit/worker.ts` (CR-01 comment preserved) |
| Snipes stay private (no auto public fallback) | `execution/snipeV2|V3` → `submitBuyTx` → private strategy only; the public leg exists only in `execution/deliberateBuy.ts` | dependency-cruiser R-PRIVATE-SNIPE; C3 "submit throw → fail clean, zero public submits"; retargeted `snipeFailClean.test.ts` |
| Fail-closed `HoneypotResult` discriminated union | `safety/honeypot/types.ts` (MOVE, unchanged) | `switch-exhaustiveness-check: error`; C3 `unknown` → reject on V2 **and** V3; `honeypotUnknownFailsClosed.test.ts` retargeted |
| Single-listener-per-chain anti-rug WS | `anti-rug/listener.ts` owns `chainState` | Pattern 2 (one owner); C5/6.6 "exactly one subscription after register/reconnect/unregister"; H1/H2 surfaced in P3 |
| Mutex-based exit mediation | `infra/concurrency/positionLocks.ts`, `exit/worker.ts`, `exit/fullSell.ts` | Key strings pinned by test; race characterization (API emergency-sell vs anti-rug); `realSellExecutor` binding check |
| SQLite WAL + `PRAGMA user_version = 7` | `infra/db/connection.ts` (pragmas, same order), `infra/db/migrations.ts` | C6 golden schema; `testDb` uses the real migrations; `infra/db/index.ts` preserves evaluation order; no new migration in v7.0 unless the operator decides |
| Kill-switch persisted in SQLite | `infra/db/killSwitch.ts`; CP1-CP3 reads inside `execution/snipe*`; mid-run pause in `app/periodicChecks.ts` | Env-first import (H3) so `DB_PATH` is never defaulted; `killswitchCheckpoints`, `pauseFlow`, `pauseCli`, `midRunWalletCheck` retargeted; `forceWalCheckpoint` stays at the mid-run pause site |
| Two-stage SIGINT (one force-exit timer) | `app/shutdown.ts` | `twoStageSigint` behavior tests kept; its grep half converted (7.3) |
| Boot, resume and arm ordering | `app/orchestrator.ts`, `app/resume.ts`, `execution/armPosition.ts` | C8 order characterization |

---

## 9. Anti-Patterns to Avoid

### Anti-Pattern 1: Compatibility re-export shims at old paths
**What people do:** Leave `src/exitEngine.ts` as `export * from './exit'` to avoid editing importers.
**Why it's wrong:** `vi.mock` is module-identity based. A mock of the shim does not intercept calls between the new sub-modules, so tests that mock to *suppress* side effects (db, notifier, txManager) silently fall through to the real implementation. In this repo that can mean the real `./data/bot.db` (H4).
**Do this instead:** Update every importer and mock specifier in the move commit, run the mock-path resolution check in CI, and prefer `#alias` specifiers after P5.

### Anti-Pattern 2: "Fixing while moving"
**What people do:** Fold a lint fix, a `.catch()`, or a de-duplication of the two WS reconnect loops into a SPLIT commit.
**Why it's wrong:** It destroys the "pure move" reviewability, and H2/H6 show that these "cleanups" are behavior changes on the money path.
**Do this instead:** Move in one commit and change in another. Record behavior changes as operator decisions.

### Anti-Pattern 3: Breaking cycles with runtime registration
**What people do:** Use `exitEngine.onClose(cb)` registered by `app/` to avoid importing anti-rug.
**Why it's wrong:** Partial compositions (scripts, tests) silently lose the edge (Pattern 3).
**Do this instead:** Extract the shared leaf (`anti-rug/registry.ts`) and import it statically.

### Anti-Pattern 4: Freezing env into a boot-time config object
**What people do:** Centralize all 19 files' `process.env` reads into a `const CONFIG = {...}` evaluated once.
**Why it's wrong:** Several reads are per call on purpose (e.g. exit slippage and attempt budgets, watchdog and SIGINT knobs), and tests rely on it. Import-time evaluation also re-introduces init-order coupling.
**Do this instead:** Use read-through accessors in `config/` that evaluate per call, and centralize the parsing and validation, not the timing.

### Anti-Pattern 5: A new `shared/` or `common/` directory
**What people do:** Dissolve `utils/` into a differently named grab-bag.
**Why it's wrong:** It recreates the problem. Every current utils file has a real home (section 3).
**Do this instead:** If a file has no home, it is dead (DEL) or it reveals a missing domain, which is an audit item.

---

## 10. Data Flow

### Snipe flow (V2; V3 is analogous with a liquidity wait)
```
factory PairCreated (WS) / HTTP poll / Telegram→alphaDrop
   ↓ detection/
execution/snipeV2.handleNewPairForChain
   → dedup (infra/db trades) → blocklist (safety) → honeypot roundtrip (safety, fail-closed)
   → parallel bank (safety) → canSnipe (risk) → kill-switch CP1/CP2 (infra/db killSwitch)
   → affordability (risk) → CP3 → submitBuyTx [withNonceLock] → submission/txManager → MEV (private)
   → insertTrade (realHash) → recordSnipe → execution/armPosition
        → exit/monitor.startExitMonitor → anti-rug/lpBaseline.snapshot → anti-rug.register
```

### Exit flow
```
exit/monitor poll tick (5s) → strategy math → enqueueExit → exit/worker (serial, priority, watchdog)
   → exit/fullSell [sell lock; approvals/fallback inside withNonceLock] → submission → receiptDecoder
   → teardownGenuineClose (timerRegistry clear, anti-rug/registry.unregister, exit_state delete)
     | failed-held → keep monitoring + re-arm
anti-rug WS log → dispatch → signals → evaluate → exitTrigger [circuit breaker, timeout]
   → exit/fullSell directly (bypasses worker; mediated by the sell lock)
api/routes/controls force/emergency-sell → exit/fullSell directly (same mediation)
```

### State ownership
Each piece of state has exactly one owner:
- **SQLite:** trades, exit_state, lp_baseline, chain_state, pause_state.
- **infra singletons:** locks, timers, providers, the broadcast client set.
- **Domain singletons:** the ExitWorker queue, the anti-rug registry, chainState, pendingV3Burn, circuit-breaker windows, risk cooldowns, API sessions and stoppedChains.

---

## 11. Scaling Considerations

| Scale | Architecture adjustments |
|---|---|
| Today (1 chain live, few positions) | Single process, module singletons. Correct as is. Do not introduce DI containers or workers |
| 4 chains (HONEY-04 next milestone) | The H2 fix (one WS owner per chain) becomes mandatory, since more DEXes per chain means more competing reconnect loops. Per-chain timer and disposables registry. This layout already isolates per-chain state by key |
| Mempool sniping (DETECT-01, candidate) | `detection/` gains a pending-tx source. Execution is unchanged because the handlers take `(ctx, dex, …)` |

**First bottleneck** is not CPU. It is single-event-loop liveness (the 21.2 "parked loop" class), which the watchdog addresses. Keep `app/watchdog.ts` and the serial worker as first-class architecture, and do not "optimize" them away during decomposition.

---

## Sources

- Live code, read 2026-11-06:
  - `src/**` (all 63 files enumerated; oversized files read section by section);
  - `test/helpers/testDb.ts`, the source-grep tests cited in 7.3, `test/fork/setup.ts`;
  - `vitest.config.ts`, `tsconfig*.json`, `eslint.config.mjs`, `.github/workflows/test.yml`, `dashboard/{package,tsconfig}.json`, `scripts/{preflight,pause,deliberate-buy}.ts`. HIGH.
- `npx madge --circular --extensions ts src` (2 cycles), plus an independent import-graph/SCC script, a function-size script (TypeScript AST) and an `eslint src -f json` breakdown run in the session scratchpad. HIGH.
- Hardhat docs, "Migrate from Hardhat 2" and error HHE13 "Only ESM projects are supported" (via Context7 `/websites/hardhat`). HIGH.
- TypeScript issue #62200 (moduleResolution node10 deprecated in 6.0, removed in 7.0): https://github.com/microsoft/TypeScript/issues/62200. HIGH.
- TS 7 has no compiler API, and typescript-eslint/ts-node use `@typescript/typescript6`: https://dev.to/boranfurkan/typescript-7-upgrade-the-two-silent-default-changes-and-the-missing-compiler-api-hie (2026-11-02), https://zeroexp.dev/library/typescript-7-migration. MEDIUM (community, recent).
- Vitest module mocking, `vi.mock(import('…'))` lets TypeScript validate paths: https://vitest.dev/guide/mocking/modules. HIGH. Stale-path silent behavior: https://github.com/vitest-dev/eslint-plugin-vitest/issues/665. MEDIUM.
- dependency-cruiser rules reference (`forbidden`, `circular`, `orphan`, path capture groups): https://github.com/sverweij/dependency-cruiser/blob/master/doc/rules-reference.md. HIGH.
- eslint-plugin-boundaries (`boundaries/dependencies`, flat config): https://github.com/javierbrea/eslint-plugin-boundaries, https://www.jsboundaries.dev/docs/rules/. MEDIUM-HIGH.

---
*Architecture research for: v7.0 Full Audit & Modernization (deep restructure)*
*Researched: 2026-11-06*
