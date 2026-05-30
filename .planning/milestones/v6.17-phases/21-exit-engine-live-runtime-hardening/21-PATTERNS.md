# Phase 21: Exit-Engine Live-Runtime Hardening - Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 11 (4 NEW source/script/test, 3 NEW fixtures + README, 4 MODIFY)
**Analogs found:** 11 / 11 (every target has a same-repo analog — this is a hardening phase, zero greenfield)

> **Sourcing note:** RESEARCH.md already established every analog at `file:line` with VERIFIED tags. This map re-reads each analog and captures the **literal code excerpt** the executor copies, plus carries forward the confirm/contradict notes RESEARCH made against the CONTEXT decisions. Where RESEARCH and the live codebase disagree with a requirement's wording, the discrepancy is flagged inline (it is not the pattern's job to fix it — the planner rewords per D-OP-CONVENTION / OQ#5).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/capture-launch.ts` **(NEW)** | utility / offline script | batch (archive `getLogs`) | `scripts/deploy-honeypot-checker.ts` (CLI shell) + `scripts/preflight.ts` (provider/env wiring) | role-match (no archive-reader script exists yet; CLI shell is exact) |
| `test/fork/fixtures/realLaunches/*.json` ×3 **(NEW)** | test fixture (data) | request-response (replay input) | `test/fork/fixtures/rugs/eth-v2-horse.json` + `rugs/README.md` + `honeypots/README.md` | exact (mirror the schema + null-block-tracker convention) |
| `test/fork/fixtures/realLaunches/README.md` **(NEW)** | docs (fixture schema) | n/a | `test/fork/fixtures/rugs/README.md` | exact |
| `test/fork/realLaunchReplay.fork.test.ts` **(NEW)** | test (fork) | request-response (drive `handleNewPairForChain`) | `test/fork/honeypotChecker.fork.test.ts` (fork wiring + chainId guard) + `bot.ts:909/:934` (handler call shape) | role-match (NOT `snipeLifecycle.test.ts` — see Pitfall A) |
| `test/fork/exitStatePersistence.fork.test.ts` **(NEW)** | test (fork) | event-driven (SIGTERM → reload) | `test/fork/honeypotChecker.fork.test.ts` (fork shell) + `exitEngine.ts:916-980` `resumeExitMonitor` (reload path) | role-match |
| `test/fork/realMainnetGate.fork.test.ts` **(NEW)** | test (fork meta-test) | request-response | `honeypotChecker.fork.test.ts:57-63` `isHardhatFork` | exact (extend the existing guard) |
| `test/fork/setup.ts` **(MODIFY)** — global tripwire | test harness (globalSetup) | event-driven (boot guard) | self (`setup.ts:5-9` rpc-resolution + throw shape) + `isHardhatFork` | exact |
| `src/exitEngine.ts` **(MODIFY)** — `op` enrichment | service (bot runtime) | event-driven (poll loop) + CRUD (DB writes) | `src/bot.ts:360/:392/:418` killswitch `op`; `src/anti-rug/detector.ts:872/:932`, `exitTrigger.ts:232` `antirug.*` `op` | exact (replicate logger call signature) |
| `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` **(NEW)** | docs (audit/evidence) | n/a | `.planning/milestones/v6.17-safety-bank-audit.md` (frontmatter + Methodology + per-item table) | exact |
| `docs/operations/going-live.md` **(MODIFY)** — live-capture runbook | docs (runbook) | n/a | self (existing numbered-section + Pre-flight §7 + Kill switch §9 shape) | exact |
| `.env.example` **(MODIFY)** — new vars | config | n/a | self (`.env.example:6/:37/:54` var = default + `# [REQ/OPT]` comment) | exact |

---

## Pattern Assignments

### `scripts/capture-launch.ts` (NEW — utility / offline archive-RPC recorder)

**Analogs:** `scripts/deploy-honeypot-checker.ts` (CLI shell), `scripts/preflight.ts` (provider + env wiring)
**CONTEXT carry:** D-FIXTURE-SELECTION (records by token address + launch block, deterministic); Claude's-Discretion (CLI shape/output/archive source). **RESEARCH OQ#6 = RESOLVED:** archive RPC = `process.env.ALCHEMY_URL` (`chainRegistry.ts:936`, `setup.ts:6`); A1 caveat — confirm the Alchemy tier is archive-enabled for arbitrary-block `getLogs`, else add `CAPTURE_ARCHIVE_RPC_URL`.

**CLI shell pattern** (`scripts/deploy-honeypot-checker.ts:33-67`) — copy the dotenv→child-logger→fail-fast-on-argv→`process.exit(1)` skeleton:
```typescript
import * as dotenv from 'dotenv';
import { logger } from '../src/utils/logger';

dotenv.config();
const log = logger.child({ module: 'deploy-honeypot-checker' });   // → module: 'capture-launch'

const chain = process.argv[2];                                     // → tokenAddress = process.argv[2]
if (!chain || !(chain in CHAIN_TO_NETWORK)) {
    log.fatal({ chain, valid: Object.keys(CHAIN_TO_NETWORK) }, 'Usage: ts-node scripts/deploy-honeypot-checker.ts <chain>');
    process.exit(1);
}
```
**Validation (V5 / Security Domain):** checksum-validate the argv address before use — `ethers.getAddress(process.argv[2])` (mirror `chainRegistry.ts:888`). Reject a malformed/typo address loudly (a bad address baked into a fixture later drives a fork buy).

**ethers provider + env-fallback wiring** (`scripts/preflight.ts:20-26`) — the env-load + module-child-logger + `dotenv.config()` ordering:
```typescript
import * as dotenv from 'dotenv';
import { logger } from '../src/utils/logger';
import { getProvider } from '../src/utils/provider';   // singleton-cached, idempotent
dotenv.config();
const log = logger.child({ module: 'preflight-cli' });
```
For archive reads use an explicit `new ethers.JsonRpcProvider(rpcUrl)` (rpcUrl = `process.env.CAPTURE_ARCHIVE_RPC_URL || process.env.ALCHEMY_URL`) — the same `ETH_FORK_RPC_URL || ALCHEMY_URL` fallback idiom as `test/fork/setup.ts:6`.

**Events to decode** (`src/utils/abis.ts:7,51,57` — VERIFIED in RESEARCH):
```typescript
// PairCreated (V2):  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"   // abis.ts:7  FACTORY_ABI
// PoolCreated (V3):  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"  // abis.ts:51
// Mint (V3 pool):    "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)"  // abis.ts:57
```
Resolve `PairCreated`/`PoolCreated` → `Mint` → first `Swap` around the launch block via `getLogs`/`queryFilter` with explicit `fromBlock`/`toBlock`; emit a `realLaunches/<slug>.json` per the fixture schema below.

**Process-exit convention** (`scripts/preflight.ts:111-120`): `process.exit(0)` on success, `process.exit(1)` on usage/expected failure, top-level `.catch` → `process.exit(2)` for an uncaught throw. Console API is intentionally NOT used (pino only) — see `deploy-honeypot-checker.ts:18` comment.

---

### `test/fork/fixtures/realLaunches/*.json` ×3 + README.md (NEW — test fixture data)

**Analogs:** `test/fork/fixtures/rugs/eth-v2-horse.json`, `rugs/README.md`, `honeypots/README.md`
**CONTEXT carry:** D-FIXTURE-EXITS (3 fixtures each drive a DIFFERENT exit path — full take-profit / partial-sell / trailing-stop+urgency); D-FIXTURE-DEX (V2+V3 spread); D-FIXTURE-SELECTION (hand-picked safe+tradeable so the gate passes). The reject path stays on `honeypots/`+`rugs/` (no reject fixture added here).

**Fixture JSON shape** — extend the `rugs/` schema (`rugs/eth-v2-horse.json`, VERIFIED), swapping the rug-removal fields for launch + exit-expectation fields:
```json
{
  "slug": "eth-v2-<token>",
  "chain": "eth",
  "dexType": "v2",
  "tokenAddress": "0x...",
  "tokenSymbol": "...",
  "pairAddress": "0x...",          // V2 only (poolAddress for V3)
  "routerAddress": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",   // V2 mainnet router (matches rugs/eth-v2-horse.json:8)
  "swapRouterAddress": "0x...",    // V3 only (SwapRouter02)
  "quoterAddress": "0x...",        // V3 only
  "feeTier": null,                 // 500/3000/10000 for V3
  "pairCreatedBlock": 18000000,
  "mintBlock": 18000000,
  "firstSwapBlock": 18000001,
  "forkBlockNumber": 17999999,     // launchBlock - 1  (CRITICAL — see caveat)
  "expectedVerdict": "safe",
  "expectedExitPath": "take-profit | partial-sell | trailing-stop",
  "discoveredVia": "etherscan",
  "discoveredOn": "2026-05-..",
  "notes": "..."
}
```
**Critical replay caveat** (`rugs/README.md:81`, `eth-v2-horse.json:23` notes — VERIFIED): `forkBlockNumber` **MUST** be `launchBlock - 1` so the fork replays the launch txn as the *next* block. Same ordering caveat for `PairCreated → Mint → first-Swap`.

**README pattern** (`rugs/README.md` whole-file structure): replicate these sections verbatim in structure — (1) intro citing the consuming test + the parallel `honeypots/`/`rugs/` dirs, (2) `## JSON Schema` with the field table, (3) per-fixture subsection, (4) `## How to Add a New Fixture` numbered steps (incl. the JSON-parse check `node -e "JSON.parse(...)"`), (5) `## Outstanding Block-Pin Verification` Wave-1 tracker table for any `null` field, (6) `## See Also`. **Removal-pairing rule** (`rugs/README.md:198`): deleting a fixture JSON MUST be paired with removing its test entry or the suite fails to start.

**Gate-pass authoring check** (RESEARCH Pitfall 6 / `bot.ts:253`): each fixture token must PASS the live HoneypotChecker (`0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`, `chainRegistry.ts:222`) at its pinned block, or `handleNewPairForChain` SKIPS the buy and the lifecycle never runs. `capture-launch.ts` should run the honeypot roundtrip as a pre-commit verification (mirrors `rugs/README.md:189` "run the detector against the fork once to capture expected values").

---

### `test/fork/realLaunchReplay.fork.test.ts` (NEW — fork test, drives the REAL handler)

**Analog:** `test/fork/honeypotChecker.fork.test.ts` (fork provider + chainId guard + artifact-load shell). **NOT** `snipeLifecycle.test.ts`.
**CONTEXT carry:** EXIT-LIVE-09 success-criterion-2 — replay drives `handleNewPairForChain`, NOT a manual swap. D-04 observable effect = a `buy` row + a `sell`/`partial_sell` row with `amount_out` set per fixture token.

**Fork wiring + chainId guard** (`honeypotChecker.fork.test.ts:73-83`):
```typescript
beforeAll(async () => {
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545', undefined, { cacheTimeout: -1 });
    deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);   // fork-only key — see below
    chainGuardOk = await isHardhatFork(provider);
    if (!chainGuardOk) return;   // do NOT transact if we'd hit real mainnet
    // ...load artifacts...
});
```
**Fork-only wallet (D-TEST-WALLET-FORKONLY / Anti-Pattern):** use the Hardhat default account #0 key (`honeypotChecker.fork.test.ts:41-42`), a throwaway with 10000 fork ETH — **NEVER** `process.env.PRIVATE_KEY` (the prod wallet, loaded at `provider.ts:59` / `chainRegistry.ts:1067`).
```typescript
const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';  // honeypotChecker.fork.test.ts:41
```

**Drive the real handler** (signatures VERIFIED at the listener call sites — copy these exact arg orders):
```typescript
// V2 — src/bot.ts:909 (PairCreated listener → handler)
handleNewPairForChain(ctx, dex as DexConfigV2, token0, token1, pairAddress);
// V3 — src/bot.ts:934 (PoolCreated listener → handler)
handleNewV3PoolForChain(ctx, dex, token0, token1, feeTier, poolAddress, blockNumber);
```
The replay constructs a `ChainContext` (fork provider + fork-only wallet + ETH chain config), fork-pins to `forkBlockNumber`, advances the chain via `provider.send('hardhat_mine', …)` (per `rugs/README.md:184` / RESEARCH OQ#3 `antiRugDetector.fork.test.ts:11-12`), then invokes the handler → full validation→honeypot-gate→safety-bank→buy→`startExitMonitor`→sell lifecycle.

**Anti-Pattern A (RESEARCH Pitfall 5):** do NOT copy `snipeLifecycle.test.ts`'s `deployer.swapExactETHForTokens(...)` manual-swap harness — it never calls `handleNewPairForChain`, so it fails success-criterion-2.

---

### `test/fork/exitStatePersistence.fork.test.ts` (NEW — SIGTERM-restart persistence, EXIT-LIVE-02)

**Analogs:** `honeypotChecker.fork.test.ts` (fork shell), `src/exitEngine.ts:916-980` `resumeExitMonitor` (reload path), `src/bot.ts:1354-1404` `gracefulShutdown` (SIGTERM path), `src/utils/db.ts:67-77` `exit_state` schema.
**CONTEXT carry:** Claude's-Discretion (SIGTERM mechanism + test shape). **RESEARCH OQ#4 = PARTIALLY RESOLVED** — two viable shapes; recommend process-level spawn first, module-level fallback (Windows brittleness). Use **SIGTERM** (Pitfall 4 — SIGKILL races the WAL flush under `synchronous=NORMAL`, `db.ts:22`).

**CRITICAL mapping (RESEARCH Pitfall 1 + the prompt's explicit note):** there is **NO `poll_position` / `poll_count` / `cursor` column**. "poll position" maps to the persisted strategy-state columns. Assert these are identical pre/post restart:
```sql
-- src/utils/db.ts:67-77  (exit_state schema — the columns EXIT-LIVE-02 asserts)
CREATE TABLE IF NOT EXISTS exit_state (
    trade_id INTEGER PRIMARY KEY,
    entry_price REAL NOT NULL,
    high_water_mark REAL NOT NULL,            -- ← assert identical
    trailing_activated INTEGER NOT NULL DEFAULT 0,   -- ← assert identical
    partial_tiers_completed TEXT NOT NULL DEFAULT '[]',  -- ← assert identical
    original_token_amount TEXT NOT NULL,
    urgency_start_ts INTEGER NOT NULL,
    volatility_samples TEXT NOT NULL DEFAULT '[]'   -- ← ideally assert too
);
```
**Write cadence** (every cycle): `upsertExitState.run(serializeExitState(state))` at `exitEngine.ts:819` (poll tick) and `:881` (monitor start); also after partial sells (`:757` per RESEARCH). **Reload path** the restart exercises (`exitEngine.ts:927-938`):
```typescript
const row = getExitState.get(tradeId) as ExitStateRow | undefined;   // exitEngine.ts:927
if (row) {
    state = deserializeExitState(row);                                // :931
    ctx.log.info({ token, tradeId, highWaterMark, trailing, completedTiers }, 'Resumed exit monitor from DB state');  // :932
}
```
**SIGTERM path** (`bot.ts:1402` → `gracefulShutdown` → `clearAllTimers()` `:1380` → `closeDb()` `:1396`). `db.close()` flushes WAL on a clean close — the persisted state is the last completed cycle before the signal.
**Observable effect (D-04):** `getExitState.get(tradeId)` cols IDENTICAL before SIGTERM and after `resumeExitMonitor` reload.

---

### `test/fork/realMainnetGate.fork.test.ts` (NEW) + `test/fork/setup.ts` MODIFY (EXIT-LIVE-08, D-GATE-BOTH-LAYERS)

**Analogs:** `honeypotChecker.fork.test.ts:57-63` `isHardhatFork` (the existing guard logic), `test/fork/setup.ts:5-9` (globalSetup rpc-resolution + throw shape).
**CONTEXT carry:** D-GATE-BOTH-LAYERS — (a) global tripwire in `setup.ts` aborts the whole run if any test sees `chainId===1` without the gate; (b) per-test opt-in decorator as intent marker. **CI never sets the gate.** D-ROLLBACK — no in-prod bypass; the gate lives ONLY in test infra.

**Existing guard to centralize** (`honeypotChecker.fork.test.ts:57-63` — VERIFIED, copy the predicate):
```typescript
function isHardhatFork(provider: ethers.JsonRpcProvider): Promise<boolean> {
    return provider.getNetwork().then((n) => {
        // hardhat node default chainId is 31337; mainnet is 1.
        return Number(n.chainId) !== 1 || process.env.ALLOW_REAL_MAINNET === '1';
    });
}
```
**Layer (a) global tripwire** — add to `test/fork/setup.ts` after the hardhat node is up. Mirror the existing fail-fast throw shape (`setup.ts:7-9`):
```typescript
// existing shape to mirror — setup.ts:7-9
const rpcUrl = process.env.ETH_FORK_RPC_URL || process.env.ALCHEMY_URL;
if (!rpcUrl) { throw new Error('ETH_FORK_RPC_URL or ALCHEMY_URL env var required for fork tests'); }
// NEW tripwire (after 'Started HTTP' resolves): read chainId from the spawned node;
// the local fork reports 31337, so this fires ONLY if a test points at real mainnet
// without ALLOW_REAL_MAINNET=1 → throw to abort the whole globalSetup (every test protected).
```
**Layer (b) per-test decorator** — a thin `beforeAll`/`it`-wrapper helper (`requireRealMainnetGate()`) that inverts `isHardhatFork`: throws unless `ALLOW_REAL_MAINNET==='1'` when the connected provider's chainId is 1. The meta-test asserts the gate throws/`process.exit`es when chainId===1 && gate unset (D-04 observable).
**Note (RESEARCH OQ#3 / Pitfall):** `hardhat node --fork` reports chainId **31337**, not 1 — so the local fork passes both layers naturally; the tripwire is a guard against a *misconfigured real-mainnet RPC*, never tripped in normal CI.

---

### `src/exitEngine.ts` (MODIFY — `op`-field enrichment + poll telemetry, EXIT-LIVE-01/10)

**Analogs (the exact logger call shape):** `src/bot.ts:360/:392/:418` (killswitch.cp*), `src/anti-rug/detector.ts:872/:932` (`antirug.ws.*`), `src/anti-rug/exitTrigger.ts:225-235` (`antirug.exit.dispatch` — closest existing "exit-ish" op).
**CONTEXT carry:** D-OP-CONVENTION (dotted `exit.*`, past-tense, Namespace.Object.Action); D-OP-DB-TRUTH (op is for *filtering*, the DB `amount_out` is *proof* — never assert an exit from a log line); additive logging ONLY, never alter control flow/timing (Anti-Pattern). `src/exitEngine.ts` has **ZERO `op` fields today** (VERIFIED in RESEARCH).

**THE literal logger call signature to replicate** — `op` key INSIDE the structured object (first arg), human message SECOND arg. pino emits `op` as a top-level filterable JSON key (`logger.ts` `base: undefined`):
```typescript
// src/bot.ts:360  (killswitch — ctx.log.info, op inside object, dotted)
ctx.log.info({ op: 'killswitch.cp1', token: targetToken, reason: 'global-pause' }, 'CP1 pause-check: aborting before bundle construction');

// src/anti-rug/exitTrigger.ts:225-235  (multi-line object form — the closest exit precedent)
log.info(
    { chain, tradeId, token: tokenAddress, feeTier, verdict: evaluation.verdict, op: 'antirug.exit.dispatch' },
    'Anti-rug exit dispatched to executeFullSell',
);

// src/anti-rug/detector.ts:869-874  (ws disconnected — Namespace.Object.Action)
log.warn({ chain: chainName, op: 'antirug.ws.disconnected' }, 'Anti-rug WS disconnected — beginning reconnect loop');
```
The exit engine uses `ctx.log` (the per-chain child logger), exactly as the existing `exitEngine.ts:448/:490/:503/:546/:779/:799/:813` info/error/warn calls already do — the task **augments those existing lines** with an `op` field (and adds new lines where none exist).

**Op-surface enumeration** (RESEARCH OQ#2 — ~14-16 points; planner finalizes exact set). Each maps to an existing line that already logs without `op`:
| Path | Existing line | Add `op` |
|------|---------------|----------|
| Zero-balance cleanup | `exitEngine.ts:448` (`'Zero balance, cleaning up'`) | `exit.cleanup.zero-balance` |
| Full-sell submit | `:490` (`'Submitting exit sell via MEV-protected path'`) | `exit.full.submitted` |
| Full-sell confirmed | `:503` (`'Exit sell TX confirmed'`) | `exit.full.executed` ← success-criterion-4 names this |
| Receipt decoded | `:515` call site (`decodeReceipt`) | `exit.receipt.decoded` |
| Full-sell failed | `:546` (catch, `'Exit sell failed'`) | `exit.full.failed` |
| Partial-sell submit | `:615` (`'Submitting partial sell…'`) | `exit.partial.submitted` |
| Partial-sell confirmed | `:621` (`'Partial sell TX confirmed'`) | `exit.partial.executed` |
| Partial-sell failed | `:667` (catch, `'Partial sell failed…'`) | `exit.partial.failed` |
| Trailing-stop triggered | `:779` (`'Trailing stop triggered'`) | `exit.trigger.trailing-stop` |
| Trailing activated at 2x | `:786` (`'Trailing stop activated at 2x'`) | `exit.trailing.activated` |
| Stop-loss triggered | `:799` (`'Fixed stop-loss triggered'`) | `exit.trigger.stop-loss` |
| Urgency hard exit | `:813` (`'Urgency hard exit…'`) | `exit.trigger.urgency` |
| Exit monitor started | `:883` (`'Exit monitor started'`) | `exit.monitor.started` |
| Exit monitor resumed | `:932` (`'Resumed exit monitor from DB state'`) | `exit.monitor.resumed` |
| Poll cycle (per position) | `:895`/`:968` interval body | `exit.poll.cycle` (telemetry — below) |

**Poll-cycle telemetry insertion (EXIT-LIVE-01)** — wrap the EXISTING `setInterval` body (`exitEngine.ts:895-904`, identical copy at `:968-977` in `resumeExitMonitor`):
```typescript
// src/exitEngine.ts:895-904  (the 5s loop — exitConfig.pollIntervalMs, default 5000)
const interval = setInterval(async () => {
    try {
        // EXIT-LIVE-01 ADD: const t0 = performance.now();
        const result = await pollExitStrategy(ctx, dex, tokenAddress, feeTier, buyAmountWei, state);
        // EXIT-LIVE-01 ADD: const durationMs = performance.now() - t0;
        //   ctx.log.info({ op: 'exit.poll.cycle', token: tokenAddress, durationMs,
        //                  budgetMs: exitConfig.pollIntervalMs,
        //                  overrun: durationMs > exitConfig.pollIntervalMs }, 'Exit poll cycle');
        if (result === 'exited') { clearInterval(interval); }
    } catch (e) { ctx.log.error({ err: e, token: tokenAddress }, 'Exit engine poll error'); }
}, exitConfig.pollIntervalMs);
```
**Telemetry-schema note (RESEARCH A4):** the engine runs ONE `setInterval` per position (not a batched loop), so per-position `durationMs` is the behavior-preserving choice. A fleet-level `positions:N` aggregate (per the discretion schema) would need a NEW module-level timer the engine does not have today — that is a design choice, NOT a behavior change to the loop. Both insertion sites (`:895` start, `:968` resume) need the same wrap.

**EXIT-LIVE-04 cross-cut (Pitfall 2/3):** the Flashbots `bundleHash`→mined-hash mapping is captured at the strategy site, NOT here — see Shared Patterns § Flashbots. The exit engine confirm site (`:503`, the `exit.full.executed` op) logs the returned mined hash; the strategy logs the `bundleHash`.

---

### `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` (NEW — evidence archive, EXIT-LIVE-11)

**Analog:** `.planning/milestones/v6.17-safety-bank-audit.md` (frontmatter + Methodology + per-item table + per-finding sections). Also cited: `…-honeypot-checker-audit.md`, `…-debt-baseline.md`.
**CONTEXT carry:** D-EVIDENCE-BAR — single source of truth, strict ground-truth per item (resolvable Etherscan tx hash / DB row excerpt / pino excerpt with real fields / timestamped screenshot); a fork-test pass alone NEVER closes an item. D-OP-DB-TRUTH — assertions are against DB/chain, not telemetry.

**Frontmatter + structure to mirror** (`v6.17-safety-bank-audit.md:1-44`):
```markdown
---
milestone: v6.17
audit_id: EXIT-LIVE-11               # mirror: audit_id: HONEY-11
audited: 2026-05-..
auditor: Phase 21 plan-execute (21-..)
scope: 6 deferred v6.16 human-verification items (EXIT-LIVE-01..07)
disposition_summary:
  closed-live-artifact: N
  closed-fork-only: 0                # D-EVIDENCE-BAR: a fork pass alone does NOT close
related_commits:
  - <hash>  # ...
---

# v6.17 Exit-Engine Live-Runtime Verification Evidence (EXIT-LIVE-11)

**Audited:** ...
**Scope:** ...

## Methodology        # mirror lines 24-42 — state the evidence bar + per-item proof requirement

## Per-Item Findings  # mirror the per-gate table (line 46) — one row per EXIT-LIVE item, columns:
| Item | Artifact type | Ground-truth source | Evidence link | Disposition |
```
Each item links a **resolvable** artifact (Etherscan tx URL, a DB `SELECT` row excerpt showing the actual `amount_out`, a pino JSON excerpt with the real `op`/fields, a timestamped screenshot path). Mirror the `Stop-the-Line Determination` section (`safety-bank-audit.md:59`) for any bug surfaced during capture (D-STOP-THE-LINE → phase 21.1).

---

### `docs/operations/going-live.md` (MODIFY — live-capture runbook section)

**Analog:** self — the existing numbered-section structure (`# Going Live` → `## 1. Trading wallet` … `## 7. Pre-flight checks` → `## 8. Go live` → `## 9. Kill switch`), plus the `## Preflight failure modes` + procedure-style appendices (`## Mid-run wallet undercut recovery` at :445, `## Anti-rug live-gate flip procedure` at :485).
**CONTEXT carry:** D-OPERATOR-HANDOFF lineage — add a live-capture runbook (go/no-go checklist, abort-if-gas-spiked, simulate-before-submit, fork-rehearsal-first). D-NO-TOPUP (abort if gas spiked), D-FORK-REHEARSAL (rehearse on fork first), D-CAPTURE-METHOD (buy hand-picked safe token at min size, capture its exit).

**Section pattern to mirror** — the `## 7. Pre-flight checks` (`:171`) go/no-go shape + the procedure appendices' `### Pre-requisites (both must be met)` / `### Action` / `### Related docs` sub-structure (`## Anti-rug live-gate flip procedure` :485-500). Slot the new runbook as a numbered section near the Kill switch (e.g. `## 10. Live-capture session (EXIT-LIVE-03/04)`), reusing the existing `npm run preflight` go/no-go gate (`scripts/preflight.ts`, §7) as the read-only readiness check. Include the post-buy auto-pause expectation (D-NO-TOPUP — balance dips below the 0.008 floor → Phase 20 D-MID-RUN-CHECK pause; exit monitors keep running; the sell completes), cross-referencing `## Mid-run wallet undercut recovery` (:445).

---

### `.env.example` (MODIFY — new vars, D-ENV-EXAMPLE [USER-BINDING])

**Analog:** self — every var is `NAME=default    # [REQUIRED|OPTIONAL] one-line description` (`.env.example:6`, `:37`, `:54`).
**CONTEXT carry:** D-ENV-EXAMPLE [USER-BINDING] — every new env var lands here with default + 1-line description. RESEARCH Runtime State Inventory names: `ALLOW_REAL_MAINNET` (tripwire, default unset/0), a fork-only test-wallet key var (e.g. `TEST_WALLET_PRIVATE_KEY`, zero-ETH throwaway), optionally `CAPTURE_ARCHIVE_RPC_URL`.

**Entry shape to copy** (`.env.example:6` / `:37`):
```bash
PRIVATE_KEY=your_wallet_private_key    # [REQUIRED] Wallet private key for signing transactions
FLASHBOTS_AUTH_KEY=your_flashbots_auth_signing_key           # [OPTIONAL] Flashbots auth key (required when eth chain enabled)
```
New entries (suggested — under a new `# === Test / Capture Safety (Phase 21) ===` header block, mirroring the existing `# === Section ===` dividers):
```bash
ALLOW_REAL_MAINNET=                    # [OPTIONAL] Test-only tripwire. Set to 1 ONLY to deliberately run a real-mainnet (chainId 1) fork test. NEVER set in CI. Default unset = guard active.
TEST_WALLET_PRIVATE_KEY=               # [OPTIONAL] Fork-only throwaway key (zero real ETH) for fork-impersonation signing. NEVER reuse PRIVATE_KEY (prod wallet).
CAPTURE_ARCHIVE_RPC_URL=               # [OPTIONAL] Archive RPC for scripts/capture-launch.ts historical getLogs. Falls back to ALCHEMY_URL if unset.
```

---

## Shared Patterns

### Dotted `op` taxonomy + literal logger call shape
**Source:** `src/bot.ts:360` (killswitch.cp1), `src/anti-rug/detector.ts:872/:932`, `src/anti-rug/exitTrigger.ts:232` (40+ `antirug.*` ops live across `src/anti-rug/*`).
**Apply to:** `src/exitEngine.ts` (all ~14-16 paths), the EXIT-LIVE-04 strategy log, the poll telemetry.
**Convention (VERIFIED across the repo):** `<logger>.<level>({ <context fields>, op: '<namespace>.<object>.<action>' }, '<human message>')` — `op` is a key inside the structured first arg (NOT the message), past-tense dotted (`antirug.ws.reconnected`, `antirug.lp-baseline.snapshot`, `killswitch.cp1`). pino renders `op` as a top-level JSON key (filterable via `op:exit.*`). The exit engine's logger is `ctx.log` (per-chain child).

### Flashbots bundle-hash capture (EXIT-LIVE-04 — the one genuinely-missing value)
**Source:** `src/utils/mevStrategies/flashbots.ts:90-101`.
**Apply to:** the SELL leg only (the BUY records `txHash:'mev_bundle'` placeholder, `bot.ts:429`/`:728` — NOT a real artifact; Pitfall 3). **D-CHAIN-SINGLE-ROUNDTRIP CONFIRMED by code** (RESEARCH OQ#1): `executeFullSell` → `sendTxWithRetry` → `createMevStrategy(ETH)` → `FlashbotsMevStrategy.sendTransaction` → `sendBundle`.
**The gap (Pitfall 2):** the strategy returns ONLY `bundleTransactions[0].hash`; `bundle.bundleHash` is available but unlogged. Add an `op` log here capturing BOTH:
```typescript
// src/utils/mevStrategies/flashbots.ts:90-101  (bundle included — add the op line)
const waitResponse = await bundle.wait();
if (waitResponse === 0) {
    log.info({ block: targetBlock, attempt: attempt + 1 }, 'Flashbots bundle included');
    const realHash = bundle.bundleTransactions?.[0]?.hash;   // mined tx hash (already returned)
    if (!realHash) { throw new Error(`... missing bundleTransactions[0].hash ...`); }
    // EXIT-LIVE-04 ADD:
    //   log.info({ op: 'flashbots.bundle.included', bundleHash: bundle.bundleHash, minedTxHash: realHash, block: targetBlock }, 'Flashbots bundle mapping')
    return realHash;
}
// bundle: FlashbotsTransactionResponse { bundleHash: string; bundleTransactions: { hash, signedTransaction }[] }  (index.d.ts:41-46)
```
Note this file logs under `module:'mev-flashbots'` (its own `log`, `flashbots.ts:10`), NOT the exit child logger — hence the paired `exit.full.executed` op at the exit confirm site (`exitEngine.ts:503`) carries the mined hash, and the strategy carries the `bundleHash`. The evidence doc maps the two.

### Fork chainId guard (EXIT-LIVE-08)
**Source:** `test/fork/honeypotChecker.fork.test.ts:57-63` (`isHardhatFork`).
**Apply to:** every fork test that could touch a real-mainnet RPC + the global `setup.ts` tripwire. Predicate: `Number(n.chainId) !== 1 || process.env.ALLOW_REAL_MAINNET === '1'`. Local `hardhat node --fork` reports 31337, so it passes naturally; the guard catches a misconfigured real-mainnet endpoint.

### Receipt → `amount_out` ground truth (EXIT-LIVE-03 / D-OP-DB-TRUTH)
**Source:** `src/exitEngine.ts:515` (`decodeReceipt` call) → `:519-534` (`insertTrade.run({ ..., amountOut: receiptData.amountOut })`); column `db.ts` `amount_out` (trades schema, `db.ts:43`). `decodeReceipt` itself is `src/utils/receiptDecoder.ts:37` (do NOT hand-roll — RESEARCH Don't-Hand-Roll).
**Apply to:** EXIT-LIVE-03 assertions + the evidence doc. Ground truth = `trades.amount_out IS NOT NULL` for the sell row + the on-chain receipt, NEVER the `op` log (Anti-Pattern).

### Fork-fixture replay scaffold
**Source:** `rugs/README.md` + `eth-v2-horse.json` (schema + `forkBlockNumber = launchBlock - 1` caveat) + `antiRugDetector.fork.test.ts:11-12` (`hardhat_mine` advance).
**Apply to:** `realLaunches/` fixtures + `realLaunchReplay.fork.test.ts`. Pin → inject/advance → drive the SUT → assert observable DB effect.

---

## No Analog Found

None. Every Phase 21 target has a same-repo analog — this is a verification + hardening phase over a complete (v6.16) engine. The only genuinely-new *code* is `scripts/capture-launch.ts` (offline archive reader), and even it composes two existing CLI analogs (`deploy-honeypot-checker.ts` shell + `preflight.ts` provider wiring). No file falls back to RESEARCH.md generic patterns.

---

## Doc-vs-Code Discrepancies to Carry Into Planning

(RESEARCH established these; the planner rewords per the cited decisions — NOT a pattern-map fix.)

| Item | Discrepancy | Resolution (per RESEARCH/CONTEXT) |
|------|-------------|-----------------------------------|
| EXIT-LIVE-01 op example | REQUIREMENTS says `exit-poll-cycle` (hyphenated) | Reword → `exit.poll.cycle` (dotted) per D-OP-CONVENTION (same as Phase 20 OPS-LIVE-02/06 reword). |
| EXIT-LIVE-07 `schema_version` | No `schema_version` table exists — it's `PRAGMA user_version` (`db.ts:30,194`, `CURRENT_SCHEMA_VERSION = 6` `:27`) | Reword → "`PRAGMA user_version` confirms version 6" (RESEARCH OQ#5). |
| EXIT-LIVE-02 "poll position" | No `poll_position`/`cursor` column | Maps to `high_water_mark`/`trailing_activated`/`partial_tiers_completed` (`db.ts:67-77`) — Pitfall 1. |
| EXIT-LIVE-06 "chain-restart warning" | Exit poll uses `httpProvider` (`exitEngine.ts:322,333`), so a WS drop does NOT stop exits | The warning is the WS-listener/anti-rug event (`bot.ts:859` / `detector.ts:872`), not an exit-poll event — reword to point there (Pitfall 7). |
| HONEY-07/08 traceability | REQUIREMENTS lists "Pending"; gates are LIVE (`bot.ts:253` V2, `:566` V3) | Non-blocking doc-fix — flip to Complete before any real-money capture (RESEARCH OQ#9). Do NOT touch HONEY-04 (out of scope). |

---

## Metadata

**Analog search scope:** `scripts/`, `test/fork/` (+ `fixtures/{rugs,honeypots}/`), `src/exitEngine.ts`, `src/bot.ts`, `src/utils/db.ts`, `src/utils/mevStrategies/flashbots.ts`, `src/anti-rug/`, `.planning/milestones/`, `docs/operations/going-live.md`, `.env.example`.
**Files scanned:** 14 source/test/fixture/doc files read at targeted line ranges (no whole-file loads of large files; non-overlapping reads).
**Pattern extraction date:** 2026-05-26
**Upstream:** `21-CONTEXT.md` (decisions), `21-RESEARCH.md` (file:line analogs reused, not re-discovered).

## PATTERN MAPPING COMPLETE
