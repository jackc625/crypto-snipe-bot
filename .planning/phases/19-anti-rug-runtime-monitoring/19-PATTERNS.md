# Phase 19: Anti-Rug Runtime Monitoring - Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 23 (12 new bot/anti-rug + 6 modify bot + 7 new dashboard + 3 fixtures/docs)
**Analogs found:** 22 / 23

## File Classification

### Bot / Anti-Rug Module (NEW)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/anti-rug/detector.ts` | service (event listener + dispatch) | event-driven (WS pub-sub) | `src/bot.ts:656-752` (`startDexListener`) | exact (single-listener-per-chain + reconnect) |
| `src/anti-rug/exitTrigger.ts` | service (bridge) | request-response | `src/api/routes/controls.ts:51-111` (`force-sell` handler → `executeFullSell`) | exact (bridge to executeFullSell with reason + reasonDetail) |
| `src/anti-rug/lpBaseline.ts` | service (snapshot + DAO) | CRUD | `src/exitEngine.ts:805-866` (`startExitMonitor` baseline snapshot) | exact (baseline at buy success + DB upsert) |
| `src/anti-rug/allowlist.ts` | service (config-driven gate) | CRUD (read-mostly) | `src/utils/blocklist.ts` (blocklist Set) + `src/utils/safetyProviders/unicrypt.ts` (canonical address pattern) | role-match (symmetrical to blocklist; allowlist is contract-set with provenance) |
| `src/anti-rug/circuitBreaker.ts` | service (rate-limit counter + DAO) | event-driven + CRUD | `src/utils/exitManager.ts:14-25` (selling mutex Map) | role-match (per-chain Map state + lifecycle hooks; new "rolling window" semantic) |
| `src/anti-rug/raceTelemetry.ts` | service (instrumentation / telemetry) | request-response (sync calls) | `src/utils/honeypot/simulator.ts` (`provider.send(...)` direct call) + `src/utils/flashbots.ts` (Flashbots bundle dispatch) | role-match (provider.send('eth_callBundle') pattern) |
| `src/anti-rug/events.ts` | utility (ABI fragments + decode helpers) | none (pure type/constant module) | `src/utils/abis.ts` (centralised ABIs) | exact (extend existing PAIR_ABI / V3_POOL_ABI patterns) |
| `src/anti-rug/types.ts` | utility (type definitions) | none | `src/utils/honeypot/types.ts` (discriminated-union HoneypotResult) | exact (discriminated-union RugEvaluation = same shape) |

### Bot / Existing Files (MODIFY)

| Modified File | Role | Data Flow | Closest Analog (same file precedent) | Match Quality |
|---------------|------|-----------|--------------------------------------|---------------|
| `src/exitEngine.ts` (extend reason union; cleanup hook) | service | request-response | `src/exitEngine.ts:424-519` (`executeFullSell` existing signature) | exact (same signature; add union member + branch) |
| `src/bot.ts:332-341` / `:399-409` (V2 wiring) | controller (orchestrator) | event-driven (callback at buy-success) | `src/bot.ts:404-409` (existing `startExitMonitor` attach) | exact (parallel attach pattern) |
| `src/bot.ts:522-530` / `:635-644` (V3 wiring) | controller (orchestrator) | event-driven (callback at buy-success) | `src/bot.ts:639-644` (existing V3 `startExitMonitor` attach) | exact (parallel attach pattern) |
| `src/bot.ts:816+` (`startMultiChainBot` resume + WS init) | controller (orchestrator startup) | batch (DB scan + resume) | `src/bot.ts:952-994` (`resumeMultiChainMonitoring`) | exact (DB scan → per-trade resume) |
| `src/chainRegistry.ts` (add `antiRug` field) | config | none | `src/chainRegistry.ts:54-80` (`ChainConfig.honeypotChecker` Phase 18) | exact (same conditional-merge per-chain pattern) |
| `src/utils/db.ts` (schema v4→v5 migration + prepared statements) | model (persistence) | CRUD | `src/utils/db.ts:64-110` (Phase 7 `exit_state` table migration v3) | exact (additive ALTER + new table + prepared statements) |
| `src/config.ts` (REQUIRED_ENV_VARS extension) | config | none | `src/config.ts:13-66` (existing entries) | exact (append entries) |

### Bot / API Routes (NEW + MODIFY)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/api/routes/antiRug.ts` (NEW) — CB reset, allowlist hits, dry-run telemetry | controller (Express router) | request-response | `src/api/routes/controls.ts:39-221` (`controlRoutes` factory) | exact (factory takes `contexts`, uses DB + `executeFullSell` analogue) |
| `src/api/server.ts` (mount new router) | controller (app wiring) | none | `src/api/server.ts:55-70` (existing `apiRouter.use(...)`) | exact (single-line registration) |
| `src/api/ws/broadcaster.ts` (no change — re-used) | utility (transport) | event-driven | already exists | exact (re-use `broadcast(type, data)` for new event types) |

### Dashboard (NEW)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `dashboard/src/components/anti-rug/AntiRugStateBadge.tsx` | component (display) | none (pure render) | `dashboard/src/components/ChainBadge.tsx` (badge primitive) | exact (badge with semantic colour mapping + click handler) |
| `dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx` | component (display + scrolling list) | event-driven (WS push) | `dashboard/src/components/EventFeed.tsx` (filterable scrollable list) + `dashboard/src/components/StatCard.tsx` (stat numbers) | role-match (combines stat + list patterns) |
| `dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx` | component (alert banner) | event-driven (WS push) | `dashboard/src/components/ChainStatusCard.tsx:61-80` (warning banner) + `dashboard/src/pages/Overview.tsx:166-170` (loss border banner) | role-match (full-bleed alert variant) |
| `dashboard/src/components/anti-rug/CircuitBreakerResetModal.tsx` | component (gated confirm flow) | request-response (POST + close) | `dashboard/src/components/ConfirmDialog.tsx` (requireConfirmText machinery) + `dashboard/src/components/EmergencyConfirmDialog.tsx` (composed wrapper) | exact (extends ConfirmDialog with N acknowledge checkboxes + RESET-text gate) |
| `dashboard/src/components/anti-rug/WsHealthIndicator.tsx` | component (status display) | event-driven (WS push) | `dashboard/src/components/StatusDot.tsx` + sidebar footer at `dashboard/src/components/Sidebar.tsx:49-77` | exact (semantic colour dot + tooltip) |
| `dashboard/src/components/anti-rug/AntiRugExitDetailModal.tsx` | component (read-only evidence modal) | event-driven (open via badge click) | `dashboard/src/components/ConfirmDialog.tsx` (modal shell — no confirm) | exact (wider shell, no confirm button, click-to-copy patterns) |
| `dashboard/src/components/anti-rug/FrontrunDistributionPanel.tsx` | component (chart panel + filters) | event-driven (WS push) | `dashboard/src/components/EventFeed.tsx` filter pattern + new chart.js Bar | role-match (filterable categorical bars; new chart shape) |
| `dashboard/src/components/anti-rug/GapDetectedBanner.tsx` | component (warning banner) | event-driven (WS push) | `dashboard/src/components/ChainStatusCard.tsx:61-80` (dismissible warning banner) | exact (dismissible warning-border variant + localStorage state) |
| `dashboard/src/hooks/useWebSocket.ts` (extend switch dispatch) | hook (transport) | event-driven (WS push) | `dashboard/src/hooks/useWebSocket.ts:68-88` existing `switch (msg.type)` | exact (add 5 new case branches) |
| `dashboard/src/types/api.ts` (extend Position + new event payloads) | type definitions | none | `dashboard/src/types/api.ts:13-29` (`Position` interface) | exact (additive field on Position; new exported event types) |

### Tests + Fixtures + Docs (NEW)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `test/fixtures/contracts/RugPull.sol` (NEW) | test fixture (Solidity contract) | none | `test/fixtures/contracts/Honeypot.sol` (5-mode immutable-discriminator fixture) | exact (mode-discriminated rug-pull V2+V3 modes) |
| `test/fork/fixtures/rugs/eth-v2-horse.json` (NEW) | test fixture (JSON) | none | `test/fork/fixtures/honeypots/eth-max-wallet.json` | exact (same fixture-JSON schema with rug-specific fields) |
| `test/fork/fixtures/rugs/README.md` (NEW) | docs (test schema) | none | `test/fork/fixtures/honeypots/README.md` (Wave-1 follow-up tracking) | exact (same outline + schema table) |
| `test/unit/anti-rug/*.test.ts` (NEW — multi-signal eval + allowlist) | test (unit) | none | `test/unit/chainRegistry.test.ts` (env var setup + mock pattern) + `test/integration/honeypotDispatch.test.ts` (multi-amount aggregation) | role-match (multi-signal AND chain table) |
| `test/integration/anti-rug/*.test.ts` (NEW — fake WSProvider drills) | test (integration) | none | `test/integration/wsReconnect.test.ts:17-100` (mock ws provider lifecycle) | exact (mock WS provider reconnect/backfill drill) |
| `test/fork/antiRugDetector.fork.test.ts` (NEW — fork drill) | test (fork) | none | `test/fork/honeypotChecker.fork.test.ts:1-120` (hardhat fork + chainId guard + artifact loading) | exact (same fork pattern; deploy RugPull, replay LP-removal) |
| `docs/operations/anti-rug-rollout.md` (NEW [USER-BINDING]) | docs (operator handoff) | none | `docs/CONFIGURATION.md` (existing CONFIGURATION format) | role-match (env-var-driven config doc format) |
| `docs/operations/anti-rug-tuning.md` (NEW) | docs (operator protocol) | none | `docs/CONFIGURATION.md` (existing format) | role-match (env-driven tuning protocol) |
| `.env.example` (MODIFY [USER-BINDING]) | config (template) | none | `.env.example` lines 13-37 (existing per-chain blocks) | exact (append new ANTIRUG_* per-chain entries) |

---

## Pattern Assignments

### `src/anti-rug/detector.ts` (service, event-driven WS pub-sub)

**Analog:** `src/bot.ts:656-752` (`startDexListener`)

**Imports pattern** (from `src/bot.ts:1-30` + module-style of `src/utils/honeypot/index.ts:24-27`):

```typescript
import { Contract, EventLog, WebSocketProvider } from 'ethers';
import type { ChainContext, DexConfig, DexConfigV2, DexConfigV3 } from '../chainRegistry';
import { PAIR_ABI, V3_POOL_ABI } from '../utils/abis';
import { isDexV2, isDexV3 } from '../chainRegistry';
import { sendCtxAlert } from '../utils/notifier';
import { logger } from '../utils/logger';
import { removeWsProvider } from '../utils/provider';

const log = logger.child({ module: 'antiRug:detector' });
```

**Single-listener-per-chain + reconnect pattern** (copy of `src/bot.ts:660-752`):

```typescript
// Source: src/bot.ts:660-752 — startDexListener
// Anti-rug version: filter ALL open-position pair/pool addresses in ONE subscription per chain
// per Pitfall #10 (subscription-cap leaks). Internal dispatch routes events to subscribed positions.

const pairAddresses = [...positionRegistry.keys()];
const burnTopic = ethers.id('Burn(address,uint256,uint256,address)');
const transferTopic = ethers.id('Transfer(address,address,uint256)');
const filter = { address: pairAddresses, topics: [[burnTopic, transferTopic]] };

ws.on(filter, (logEvent) => {
    const pairAddress = logEvent.address.toLowerCase();
    const position = positionRegistry.get(pairAddress);
    if (!position) return; // not one of ours
    evaluateRugSignals(ctx, position, logEvent);
});

// Reconnect handling — IDENTICAL to bot.ts:682-751 pattern
let reconnectDelay = 1000;
const maxDelay = 60000;
async function handleWsCloseAntiRug(): Promise<void> {
    ctx.log.warn({ delay: reconnectDelay }, 'Anti-rug WebSocket disconnected, reconnecting');
    await sendCtxAlert(ctx, `Anti-rug WebSocket disconnected, reconnecting...`);
    removeWsProvider(ctx.chain.name);

    while (true) {
        await new Promise(r => setTimeout(r, reconnectDelay));
        reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
        try {
            const newWsProvider = new WebSocketProvider(ctx.chain.wsRpcUrl!, ctx.chain.chainId);
            ctx.wsProvider = newWsProvider;
            // Re-subscribe with same topic-filter union
            newWsProvider.on(filter, /* ... same dispatcher ... */);
            reconnectDelay = 1000;
            ctx.log.info('Anti-rug WebSocket reconnected, re-subscribed');

            // PHASE 19 EXTENSION: trigger backfill via getLogs(lastSeenBlock+1, currentBlock)
            await backfillSinceLastSeen(ctx, newWsProvider);

            (newWsProvider.websocket as any).on('close', handleWsCloseAntiRug);
            break;
        } catch (err) {
            ctx.log.error({ err, delay: reconnectDelay }, 'Anti-rug reconnect failed, will retry');
        }
    }
}
(wsProvider.websocket as any).on('close', handleWsCloseAntiRug);
```

**Heartbeat pattern** (NEW per RESEARCH.md §6.1; no codebase analog — copy from ws README cited in research):

```typescript
// Source: ws@^8.20.0 README "How to detect and close broken connections" (cited in 19-RESEARCH.md §6.1)
// NEW behaviour — ethers v6 has no built-in heartbeat per #1053. ws library already a top-level dep.
function heartbeat(this: WebSocket) {
    (this as any).isAlive = true;
}

const rawWs: WebSocket = (ctx.wsProvider as any).websocket;
(rawWs as any).isAlive = true;
rawWs.on('pong', heartbeat);

const heartbeatInterval = setInterval(() => {
    if ((rawWs as any).isAlive === false) {
        ctx.log.warn({ chain: ctx.chain.name }, 'Anti-rug WS heartbeat dead — terminating');
        return rawWs.terminate();  // triggers 'close' → existing reconnect path above
    }
    (rawWs as any).isAlive = false;
    rawWs.ping();
}, 30_000);

rawWs.on('close', () => clearInterval(heartbeatInterval));
```

**HTTP polling fallback pattern** (copy from `src/bot.ts:758-810`):

```typescript
// Source: src/bot.ts:758-810 — startHttpPollingListener
// Anti-rug version: same poll-loop shape, swap event filter and dispatcher
async function startHttpPollingAntiRug(ctx: ChainContext): Promise<void> {
    const pairAddresses = [...positionRegistry.keys()];
    let lastBlock = await ctx.httpProvider.getBlockNumber();

    setInterval(async () => {
        try {
            const currentBlock = await ctx.httpProvider.getBlockNumber();
            if (currentBlock <= lastBlock) return;
            const events = await ctx.httpProvider.getLogs({
                address: pairAddresses,
                fromBlock: lastBlock + 1,
                toBlock: currentBlock,
                topics: [[burnTopic, transferTopic]],
            });
            for (const event of events) {
                evaluateRugSignals(ctx, positionRegistry.get(event.address.toLowerCase())!, event);
            }
            lastBlock = currentBlock;
            persistLastSeenBlock(ctx.chain.name, currentBlock);  // NEW: write chain_state row
        } catch (err) {
            ctx.log.error({ err }, 'Anti-rug HTTP polling error');
        }
    }, 2000);
}
```

---

### `src/anti-rug/exitTrigger.ts` (service, request-response bridge)

**Analog:** `src/api/routes/controls.ts:51-111` (`/force-sell/:tradeId`) — the canonical "call `executeFullSell` with a `reason` and `reasonDetail`" precedent.

**Imports pattern**:

```typescript
import type { ChainContext, DexConfig } from '../chainRegistry';
import { executeFullSell } from '../exitEngine';
import { clearAllTimersForToken } from '../utils/exitManager';
import { sendCtxAlert } from '../utils/notifier';
import { db } from '../utils/db';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'antiRug:exitTrigger' });
```

**Bridge pattern** (copy of `src/api/routes/controls.ts:82-110`):

```typescript
// Source: src/api/routes/controls.ts:82-110 — force-sell bridge to executeFullSell
// Critical sequence (Pitfall 3 — DOCUMENTED IN CONTROLS):
//   1. clearAllTimersForToken FIRST  (eliminates race with exit engine)
//   2. executeFullSell (handles its own sell-lock acquisition + DB cleanup + Telegram)

export async function triggerAntiRugExit(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    tradeId: number,
    evaluation: RugEvaluation,
): Promise<boolean> {
    // Dry-run gate (per D-LIVE-PER-CHAIN, D-DRY-TELEMETRY)
    if (!ctx.chain.antiRug.liveExecute) {
        log.warn({
            tradeId, token: tokenAddress, chain: ctx.chain.name, evaluation,
        }, 'antirug.dry-run.would-have-sold');
        await sendCtxAlert(ctx, `*[DRY-RUN] Anti-rug exit:* would-have-sold ${tokenAddress}\nSignals: ${JSON.stringify(evaluation.signals)}`);
        return false;
    }

    // Circuit-breaker gate (per ANTIRUG-09)
    if (isCircuitBreakerTripped(ctx.chain.name)) {
        log.fatal({ tradeId, chain: ctx.chain.name }, 'antirug.cb-tripped.exit-suppressed');
        return false;
    }

    // Live execute: bridge to executeFullSell with reason='anti-rug'
    clearAllTimersForToken(ctx.chain.name, tokenAddress);
    log.info({ tradeId, token: tokenAddress, chain: ctx.chain.name }, 'antirug.exit.dispatch');

    const reasonDetail = `LP removed ${evaluation.signals.lpRemovedPct}% by ${evaluation.signals.destination}; ${evaluation.signals.sellSimSlippagePct ?? 'n/a'}% sell-sim slippage`;
    const success = await executeFullSell(
        ctx,
        dex,
        tokenAddress,
        feeTier,
        'anti-rug',           // NEW reason union member
        tradeId,
        reasonDetail,
    );

    incrementCircuitBreaker(ctx.chain.name);
    return success;
}
```

**Cleanup hook (`unsubscribeAntiRug`) on full-close** (NEW; symmetrical to `deleteExitState` at `src/exitEngine.ts:504`):

```typescript
// Wire into exitEngine.ts:502-504 — same point where deleteExitState runs:
// updateTradeStatus.run('sold', tokenAddress.toLowerCase(), ctx.chain.name);
// clearAllTimersForToken(ctx.chain.name, tokenAddress);
// deleteExitState.run(tradeId);
// unsubscribeAntiRug(ctx.chain.name, tokenAddress, tradeId);  // NEW
```

---

### `src/anti-rug/lpBaseline.ts` (service, CRUD)

**Analog:** `src/exitEngine.ts:805-866` (`startExitMonitor` baseline-at-buy pattern) + `src/utils/db.ts:394-411` (prepared statement helpers)

**Snapshot at buy success pattern** (copy of `src/exitEngine.ts:813-839`):

```typescript
// Source: src/exitEngine.ts:813-839 — entryPrice baseline snapshot at start of monitor
// Anti-rug version: snapshot reserves (V2) or pool.liquidity()+slot0() (V3) at buy success

export async function snapshotLpBaseline(
    ctx: ChainContext,
    dex: DexConfig,
    tradeId: number,
    pairOrPoolAddress: string,
    feeTier: number | null,
): Promise<void> {
    const block = await ctx.httpProvider.getBlockNumber();
    const ts = Math.floor(Date.now() / 1000);

    if (dex.dexType === 'v2') {
        const pair = new Contract(pairOrPoolAddress, PAIR_ABI, ctx.httpProvider);
        const [reserves, totalSupply] = await Promise.all([
            pair.getReserves(),
            pair.totalSupply(),
        ]);
        upsertLpBaseline.run({
            tradeId,
            poolType: 'v2',
            pairOrPoolAddress: pairOrPoolAddress.toLowerCase(),
            v2Token0Reserve: reserves[0].toString(),
            v2Token1Reserve: reserves[1].toString(),
            v2LpTotalSupply: totalSupply.toString(),
            v3ActiveLiquidity: null,
            v3TickAtSnapshot: null,
            v3PositionNftId: null,
            v3FeeTier: null,
            snapshotBlock: block,
            snapshotTs: ts,
        });
    } else {
        // V3 path — pool.liquidity() + pool.slot0()
        const pool = new Contract(pairOrPoolAddress, V3_POOL_ABI, ctx.httpProvider);
        const [liquidity, slot0] = await Promise.all([
            pool.liquidity(),
            pool.slot0(),
        ]);
        upsertLpBaseline.run({
            tradeId,
            poolType: 'v3',
            pairOrPoolAddress: pairOrPoolAddress.toLowerCase(),
            v2Token0Reserve: null,
            v2Token1Reserve: null,
            v2LpTotalSupply: null,
            v3ActiveLiquidity: liquidity.toString(),
            v3TickAtSnapshot: Number(slot0[1]),
            v3PositionNftId: null,
            v3FeeTier: feeTier,
            snapshotBlock: block,
            snapshotTs: ts,
        });
    }

    log.info({ tradeId, pool: pairOrPoolAddress, snapshotBlock: block }, 'antirug.lp-baseline.snapshot');
}
```

---

### `src/anti-rug/allowlist.ts` (service, CRUD read-mostly)

**Analog:** `src/utils/blocklist.ts` (Set primitive) + `src/utils/safetyProviders/unicrypt.ts` (per-chain canonical-addresses pattern). Symmetrical inverse of blocklist.

**Imports + structure** (modelled on `src/utils/safetyProviders/unicrypt.ts:1-14`):

```typescript
// Source: src/utils/blocklist.ts + src/utils/safetyProviders/unicrypt.ts
// HARDCODED base allowlist per chain (D-LIST-SOURCE); env overlay merged at startup
// (D-LIST-VERIFY: getCode() check, FATAL on empty code = EOA).

import { Contract } from 'ethers';
import type { ChainContext } from '../chainRegistry';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'antiRug:allowlist' });

// V2 + V3 lockers per chain — addresses from 19-RESEARCH.md §2.1 / §2.2
// Annotated by provenance label for D-LIST-AUDIT lockerName lookups.
interface AllowlistEntry {
    address: string;       // checksummed
    lockerName: string;    // e.g. 'Unicrypt UniLockerV2 ETH'
    provenance: 'hardcoded' | 'env-overlay';
}

const HARDCODED_V2_ALLOWLIST: Record<string, AllowlistEntry[]> = {
    eth: [
        { address: '0x59d7d55ddc58494fbbbca29904f108ece82ac7fb', lockerName: 'Unicrypt UniLockerV2 ETH', provenance: 'hardcoded' },
        { address: '0xe2fe530c047f2d85298b07d9333c05737f1435fb', lockerName: 'TeamFinance Lock ETH', provenance: 'hardcoded' },
        { address: '0x71b5759d73262fbb223956913ecf4ecc51057641', lockerName: 'PinkLock V2 ETH', provenance: 'hardcoded' },
        { address: '0x000000000000000000000000000000000000dEaD', lockerName: 'Burn address (canonical)', provenance: 'hardcoded' },
    ],
    // bsc, base, arb populated similarly from 19-RESEARCH.md §2.1
};

// Startup-time verification — getCode() check per D-LIST-VERIFY
// FATAL non-zero exit if any address has no code (EOA = wrong)
// Pattern mirrors src/chainRegistry.ts:376-389 fail-loud env validation
export async function verifyAllowlistAtStartup(
    ctx: ChainContext,
    allowlist: AllowlistEntry[],
): Promise<void> {
    for (const entry of allowlist) {
        if (entry.address === '0x000000000000000000000000000000000000dEaD') continue; // canonical burn
        const code = await ctx.httpProvider.getCode(entry.address);
        if (code === '0x') {
            log.fatal(
                { chain: ctx.chain.name, address: entry.address, lockerName: entry.lockerName, provenance: entry.provenance },
                'Anti-rug allowlist address has no code (EOA?) — refusing to start',
            );
            process.exit(1);
        }
    }
    // Dump merged allowlist with provenance for operator verification
    log.info({ chain: ctx.chain.name, allowlist: allowlist.map(e => ({ address: e.address, name: e.lockerName, src: e.provenance })) },
             'Anti-rug allowlist verified at startup');
}
```

---

### `src/anti-rug/circuitBreaker.ts` (service, rate-limit counter)

**Analog:** `src/utils/exitManager.ts:14-25` (selling mutex Map pattern); semantics NEW (rolling window).

**State + lifecycle pattern** (modelled on `src/utils/exitManager.ts:14-25`):

```typescript
// Source: src/utils/exitManager.ts:14-25 — per-chain Map with composite keys
// Anti-rug version: rolling-window trigger counter per chain + manual reset

import { logger } from '../utils/logger';
import { sendCtxAlert } from '../utils/notifier';
import { broadcast } from '../api/ws/broadcaster';
import type { ChainContext } from '../chainRegistry';

const log = logger.child({ module: 'antiRug:cb' });

// Per-chain trigger history: array of timestamps within window
const triggerHistory = new Map<string, number[]>();
// Per-chain tripped state
const trippedChains = new Set<string>();

export function incrementCircuitBreaker(ctx: ChainContext, evidence: TriggerEvent): void {
    const now = Date.now();
    const windowMs = ctx.chain.antiRug.circuitBreakerWindowHours * 3600 * 1000;
    const threshold = ctx.chain.antiRug.circuitBreakerTriggers;

    const history = triggerHistory.get(ctx.chain.name) || [];
    // Drop entries older than window
    const recent = history.filter(t => now - t < windowMs);
    recent.push(now);
    triggerHistory.set(ctx.chain.name, recent);

    if (recent.length >= threshold && !trippedChains.has(ctx.chain.name)) {
        trippedChains.add(ctx.chain.name);
        log.fatal({ chain: ctx.chain.name, triggers: recent.length, windowMs },
                  'antirug.cb-tripped');
        // Broadcast to dashboard (UI-SPEC: cb_tripped event)
        broadcast('cb_tripped', { chain: ctx.chain.name, triggers: recent.length, windowHours: ctx.chain.antiRug.circuitBreakerWindowHours, triggerEvents: /* last N trigger details */ });
        sendCtxAlert(ctx, `*[ANTI-RUG HALTED] ${ctx.chain.displayName}* — ${recent.length} triggers in last hour`);
    }
}

export function isCircuitBreakerTripped(chainName: string): boolean {
    return trippedChains.has(chainName);
}

export function resetCircuitBreaker(ctx: ChainContext): void {
    trippedChains.delete(ctx.chain.name);
    triggerHistory.delete(ctx.chain.name);
    log.info({ chain: ctx.chain.name }, 'antirug.cb-reset');
    broadcast('cb_reset', { chain: ctx.chain.name, resetByOperatorTs: Date.now() });
}
```

---

### `src/anti-rug/raceTelemetry.ts` (service, telemetry/instrumentation)

**Analog:** `src/utils/honeypot/simulator.ts` (`provider.send` direct call for synthetic simulation) + `src/utils/flashbots.ts` (Flashbots bundle dispatch).

**Three-channel triple measurement pattern** (D-RACE-TELEMETRY):

```typescript
// (a) latency — wall-clock timer (no analog — trivial)
// (b) Flashbots eth_callBundle — ETH only; bsc/base/arb skip
// (c) post-hoc reality — getReserves() at block N+2 (V2) or QuoterV2 (V3)

// (b) eth_callBundle pattern (NEW; cited in 19-RESEARCH.md §8 + CRITICAL #2)
// Use existing @flashbots/ethers-provider-bundle (already a top-level dep)
// or raw provider.send. Pattern mirrors src/utils/honeypot/simulator.ts shape:

async function flashbotsRaceVerdict(
    ctx: ChainContext,
    signedTx: string,
    targetBlock: number,
): Promise<'win' | 'loss' | 'skip'> {
    if (ctx.chain.name !== 'eth') return 'skip';
    try {
        const result = await ctx.httpProvider.send('eth_callBundle', [{
            txs: [signedTx],
            blockNumber: '0x' + targetBlock.toString(16),
            stateBlockNumber: 'latest',
        }]);
        if (result.results?.[0]?.error) return 'loss';
        return result.coinbaseDiff > 0 ? 'win' : 'loss';
    } catch (e) {
        log.warn({ err: e }, 'antirug.flashbots-sim.error');
        return 'loss';
    }
}
```

---

### `src/anti-rug/types.ts` (utility — type definitions)

**Analog:** `src/utils/honeypot/types.ts` (discriminated-union HoneypotResult)

**Discriminated-union RugEvaluation** (copy of `src/utils/honeypot/types.ts:42-65` pattern):

```typescript
// Source: src/utils/honeypot/types.ts:42-65 — discriminated-union HoneypotResult
// Anti-rug version: RugEvaluation makes vacuous "safe" return unrepresentable in
// the type system (per CONTEXT.md <code_context> D-13/D-14 carry-forward).

export interface RugSignals {
    lpRemovedPct: number;            // 0-100; >threshold trips signal 1
    destination: string;             // lowercased; allowlist check
    allowlistHit: 'safe' | 'unsafe' | 'unknown';
    sellSimSlippagePct: number | null;  // V3 only; null on V2
    v2ReservePctBelow: number | null;   // V2 only
}

export type RugEvaluation =
    | { verdict: 'safe'; reason: 'partial-signal'; signals: RugSignals }
    | { verdict: 'allowlisted'; signals: RugSignals; lockerName: string }
    | { verdict: 'unsafe'; reason: 'three-signal-trigger'; signals: RugSignals }
    | { verdict: 'unknown'; reason: string };  // fail-closed default

// Per-chain AntiRug config — extends ChainConfig (planner adds field at chainRegistry.ts:54-80)
export interface AntiRugConfig {
    liveExecute: boolean;             // <CHAIN>_ANTIRUG_LIVE_EXECUTE (default false → dry-run)
    lpRemovalPct: number;             // default 50
    confirmBlocks: number;            // default 1
    circuitBreakerTriggers: number;   // default 3
    circuitBreakerWindowHours: number;// default 1
    gasMultiplier: number;            // default 2.0
    backfillCapBlocks: number;        // per-chain RPC cap (ETH=10 Alchemy free, others=500)
    maxBackfillBlocks: number;        // hard ceiling; FAIL CLOSED above this
    allowlistV2: AllowlistEntry[];    // hardcoded + env overlay
    allowlistV3: AllowlistEntry[];    // hardcoded + env overlay
}
```

---

### `src/anti-rug/events.ts` (utility — ABI fragments + decode helpers)

**Analog:** `src/utils/abis.ts` (centralised ABIs)

**Centralised ABI extension** (extend the existing pattern at `src/utils/abis.ts:32-39` and `:54-59`):

```typescript
// Source: src/utils/abis.ts:54-59 — existing V3_POOL_ABI extends here
// 19-RESEARCH.md §1.1 + §1.2 give the verified signatures

// V2 Pair (extend existing PAIR_ABI; add Burn signature)
export const PAIR_BURN_EVENT = 'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)';
export const PAIR_TRANSFER_EVENT = 'event Transfer(address indexed from, address indexed to, uint256 value)';

// V3 Pool — extend V3_POOL_ABI with Burn + Collect
export const POOL_BURN_EVENT = 'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)';
export const POOL_COLLECT_EVENT = 'event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)';

// Topic hashes — computed at module load
export const PAIR_BURN_TOPIC = ethers.id('Burn(address,uint256,uint256,address)');
export const PAIR_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
export const POOL_BURN_TOPIC = ethers.id('Burn(address,int24,int24,uint128,uint256,uint256)');
export const POOL_COLLECT_TOPIC = ethers.id('Collect(address,address,int24,int24,uint128,uint128)');

export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead';
```

---

### `src/exitEngine.ts` (MODIFY — extend reason union + cleanup hook)

**Self-analog:** `src/exitEngine.ts:424-519` (existing `executeFullSell` signature)

**Reason union extension** (in-place edit at line 429):

```typescript
// CURRENT (src/exitEngine.ts:429):
//   reason: 'trailing-stop' | 'stop-loss' | 'urgency-market-sell',
// PHASE 19 EDIT:
//   reason: 'trailing-stop' | 'stop-loss' | 'urgency-market-sell' | 'anti-rug',
```

**Elevated-gas branch within `executeFullSell` body** (new branch around line 450, near `const gasLimit = ctx.chain.gas.maxGasLimit`):

```typescript
// NEW: when reason === 'anti-rug', apply ctx.chain.antiRug.gasMultiplier
// (default 2.0×). Existing gasLimit value preserved; multiplier applies to
// the EIP-1559 maxFeePerGas / maxPriorityFeePerGas in buildV2SellTx / buildV3SellTx.
// txBuilder threads the multiplier through (planner decides exact threading).
const gasMultiplier = reason === 'anti-rug'
    ? ctx.chain.antiRug.gasMultiplier
    : ctx.chain.gas.multiplier;
```

**Cleanup hook integration point** (add ONE line at `src/exitEngine.ts:504`, after `deleteExitState.run(tradeId);`):

```typescript
// Existing line 504:
deleteExitState.run(tradeId);
// NEW: terminate anti-rug subscription on full close (D-TERMINATION)
unsubscribeAntiRug(ctx.chain.name, tokenAddress, tradeId);
```

---

### `src/bot.ts` (MODIFY — parallel attach + resume + WS init)

**Self-analog 1 (V2 attach):** `src/bot.ts:399-409` — existing `startExitMonitor` attach in V2 buy-success branch
**Self-analog 2 (V3 attach):** `src/bot.ts:635-644` — existing V3 `startExitMonitor` attach
**Self-analog 3 (resume):** `src/bot.ts:952-994` — `resumeMultiChainMonitoring`

**Parallel attach pattern at V2 buy success** (around `bot.ts:404-406`):

```typescript
// EXISTING (src/bot.ts:404-406):
const tradeRow = getTradeIdForPendingToken.get(targetToken.toLowerCase(), ctx.chain.name) as { id: number } | undefined;
if (tradeRow) {
    await startExitMonitor(ctx, dex, targetToken, null, ctx.chain.snipeAmount, tradeRow.id, originalTokenAmount);
}
// NEW PARALLEL ATTACH (per CONTEXT.md <integration_points>):
if (tradeRow) {
    // Snapshot LP baseline at buy success (D-V3-THRESHOLD; ANTIRUG-04)
    await snapshotLpBaseline(ctx, dex, tradeRow.id, pairAddress, null);
    // Register position in per-chain anti-rug dispatch table
    registerAntiRugPosition(ctx, dex, targetToken, pairAddress, tradeRow.id, null);
}
```

**Parallel attach pattern at V3 buy success** (around `bot.ts:639-644`) — same shape, swap `pairAddress` for `poolAddress` and pass `feeTier`.

**Resume pattern extension at `startMultiChainBot`** (add new step after existing `resumeMultiChainMonitoring(contexts)` at `bot.ts:871`):

```typescript
// EXISTING src/bot.ts:871:
resumeMultiChainMonitoring(contexts);
// NEW STEP 7.5 (per CONTEXT.md <integration_points> "bot.ts:702-832 startMultiChainBot"):
// Initialise per-chain anti-rug listeners, load lp_baseline rows, resubscribe, backfill via getLogs
await resumeAntiRugMonitoring(contexts);
```

The `resumeAntiRugMonitoring` function copies the structure of `resumeMultiChainMonitoring` at `bot.ts:952-994`:

```typescript
// Source structure: src/bot.ts:952-994 — resumeMultiChainMonitoring
// Anti-rug version: scan trades + lp_baseline JOIN; per-chain WS + backfill
async function resumeAntiRugMonitoring(contexts: ChainContext[]): Promise<void> {
    const openTrades = db.prepare(`
        SELECT t.id, t.token, t.chain, t.pool_type, t.fee_tier, b.pair_or_pool_address
        FROM trades t
        INNER JOIN lp_baseline b ON b.trade_id = t.id
        WHERE t.status = 'pending' AND t.action = 'buy'
    `).all() as Array<{ id: number; token: string; chain: string; pool_type: string; fee_tier: number | null; pair_or_pool_address: string }>;

    for (const trade of openTrades) {
        const ctx = contexts.find(c => c.chain.name === trade.chain);
        if (!ctx) continue;
        registerAntiRugPosition(ctx, /* resolve dex */, trade.token, trade.pair_or_pool_address, trade.id, trade.fee_tier);
    }

    for (const ctx of contexts) {
        await startChainAntiRugListener(ctx);  // single-listener-per-chain
        await backfillSinceLastSeen(ctx);      // chunked getLogs per D-BACKFILL
    }
}
```

---

### `src/chainRegistry.ts` (MODIFY — add `antiRug` field per chain)

**Self-analog:** `src/chainRegistry.ts:54-80` (`honeypotChecker` field added in Phase 18)

**Per-chain field extension pattern** (copy of Phase 18 `honeypotChecker` integration at lines 67-74 + 169-178 + 444-462):

```typescript
// Step 1 — Extend ChainConfig interface at line 80 (after gas field):
export interface ChainConfig {
    // ...existing fields...
    honeypotChecker: HoneypotCheckerConfig;
    antiRug: AntiRugConfig;     // NEW (Phase 19)
    // ...
}

// Step 2 — Extend ChainTemplate at line 121 (after defaultHoneypotCheckerAddress):
interface ChainTemplate {
    // ...
    defaultHoneypotCheckerAddress: string | null;
    // NEW (Phase 19):
    defaultAntiRugLpRemovalPct: number;       // 50
    defaultAntiRugConfirmBlocks: number;      // 1
    defaultAntiRugCircuitBreakerTriggers: number;     // 3
    defaultAntiRugCircuitBreakerWindowHours: number;  // 1
    defaultAntiRugGasMultiplier: number;      // 2.0
    defaultAntiRugBackfillCapBlocks: number;  // 10 (ETH Alchemy free) / 500 (others)
    defaultAntiRugMaxBackfillBlocks: number;  // 7200 = 1 day on ETH
}

// Step 3 — Per-chain template entries at lines 129-321 (one block per chain):
// ETH (line 129):
    defaultAntiRugLpRemovalPct: 50,
    defaultAntiRugConfirmBlocks: 1,
    defaultAntiRugCircuitBreakerTriggers: 3,
    defaultAntiRugCircuitBreakerWindowHours: 1,
    defaultAntiRugGasMultiplier: 2.0,
    defaultAntiRugBackfillCapBlocks: 10,   // Alchemy free-tier safe (19-RESEARCH.md CRITICAL #1)
    defaultAntiRugMaxBackfillBlocks: 7200, // 1 day on ETH

// Step 4 — Env overlay at line 360-389 (after honeypotChecker overlay):
const antiRugLiveExecuteRaw = process.env[`${template.envPrefix}_ANTIRUG_LIVE_EXECUTE`] || 'false';
const antiRugLpRemovalPctRaw = process.env[`${template.envPrefix}_ANTIRUG_LP_REMOVAL_PCT`] || String(template.defaultAntiRugLpRemovalPct);
// ... similar for every env per CONTEXT.md D-ENV-EXAMPLE list
// Fail-loud validation per src/chainRegistry.ts:376-389 pattern
if (Number.isNaN(antiRugLpRemovalPct) || antiRugLpRemovalPct < 0 || antiRugLpRemovalPct > 100) {
    log.fatal({ chain: chainName, key: `${template.envPrefix}_ANTIRUG_LP_REMOVAL_PCT`, value: antiRugLpRemovalPctRaw },
              'Anti-rug LP-removal-pct must be in [0, 100]');
    process.exit(1);
}

// Step 5 — Assign to chainConfig at line 444-468:
const chainConfig: ChainConfig = {
    // ...existing fields...
    honeypotChecker: { /* existing */ },
    antiRug: {
        liveExecute: antiRugLiveExecuteRaw === 'true',
        lpRemovalPct: antiRugLpRemovalPct,
        confirmBlocks: antiRugConfirmBlocks,
        circuitBreakerTriggers: antiRugCBTriggers,
        circuitBreakerWindowHours: antiRugCBWindowHours,
        gasMultiplier: antiRugGasMultiplier,
        backfillCapBlocks: antiRugBackfillCap,
        maxBackfillBlocks: antiRugMaxBackfill,
        allowlistV2: mergeAllowlist(HARDCODED_V2_ALLOWLIST[chainName], antiRugExtraEnv),
        allowlistV3: mergeAllowlist(HARDCODED_V3_ALLOWLIST[chainName], antiRugExtraEnv),
    },
    // ...
};
```

---

### `src/utils/db.ts` (MODIFY — schema v4→v5 + prepared statements)

**Self-analog:** `src/utils/db.ts:64-110` (Phase 7 v3 migration adding `exit_state` table; same shape as needed for `lp_baseline`)

**Migration pattern** (copy of v3 migration block at `src/utils/db.ts:64-110`):

```typescript
// Source: src/utils/db.ts:64-110 — Phase 7 v3 migration adding exit_state
// Anti-rug version: v4→v5 additive lp_baseline + chain_state tables

// Bump CURRENT_SCHEMA_VERSION at line 27:
const CURRENT_SCHEMA_VERSION = 5;   // was 4

// New migration step inside migrateSchema(), after the version < 4 block at line 112:
if (version < 5) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS lp_baseline (
            trade_id INTEGER PRIMARY KEY,
            pool_type TEXT NOT NULL CHECK(pool_type IN ('v2', 'v3')),
            pair_or_pool_address TEXT NOT NULL COLLATE NOCASE,
            -- V2 fields (NULL when pool_type='v3')
            v2_token0_reserve TEXT,
            v2_token1_reserve TEXT,
            v2_lp_total_supply TEXT,
            -- V3 fields (NULL when pool_type='v2')
            v3_active_liquidity TEXT,
            v3_tick_at_snapshot INTEGER,
            v3_position_nft_id TEXT,
            v3_fee_tier INTEGER,
            -- common
            snapshot_block INTEGER NOT NULL,
            snapshot_ts INTEGER NOT NULL,
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );
        CREATE INDEX IF NOT EXISTS idx_lp_baseline_pool ON lp_baseline(pair_or_pool_address);

        CREATE TABLE IF NOT EXISTS chain_state (
            chain TEXT PRIMARY KEY,
            last_seen_block INTEGER NOT NULL,
            last_updated_ts INTEGER NOT NULL
        );
    `);
    logger.info('Created lp_baseline + chain_state tables (schema version 5)');
}
db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
```

**Prepared statements pattern** (copy of `src/utils/db.ts:394-411` Phase 7 exit_state statements):

```typescript
// Source: src/utils/db.ts:394-411 — upsertExitState / getExitState / deleteExitState
// Anti-rug version: same shape for lp_baseline and chain_state

const upsertLpBaseline = db.prepare(`
    INSERT INTO lp_baseline (trade_id, pool_type, pair_or_pool_address, v2_token0_reserve, v2_token1_reserve, v2_lp_total_supply, v3_active_liquidity, v3_tick_at_snapshot, v3_position_nft_id, v3_fee_tier, snapshot_block, snapshot_ts)
    VALUES (@tradeId, @poolType, @pairOrPoolAddress, @v2Token0Reserve, @v2Token1Reserve, @v2LpTotalSupply, @v3ActiveLiquidity, @v3TickAtSnapshot, @v3PositionNftId, @v3FeeTier, @snapshotBlock, @snapshotTs)
    ON CONFLICT(trade_id) DO UPDATE SET
        v2_token0_reserve = @v2Token0Reserve,
        v2_token1_reserve = @v2Token1Reserve,
        v2_lp_total_supply = @v2LpTotalSupply,
        v3_active_liquidity = @v3ActiveLiquidity,
        v3_tick_at_snapshot = @v3TickAtSnapshot,
        snapshot_block = @snapshotBlock,
        snapshot_ts = @snapshotTs
`);

const getLpBaseline = db.prepare(`SELECT * FROM lp_baseline WHERE trade_id = ?`);
const deleteLpBaseline = db.prepare(`DELETE FROM lp_baseline WHERE trade_id = ?`);

const upsertChainState = db.prepare(`
    INSERT INTO chain_state (chain, last_seen_block, last_updated_ts)
    VALUES (?, ?, ?)
    ON CONFLICT(chain) DO UPDATE SET last_seen_block = excluded.last_seen_block, last_updated_ts = excluded.last_updated_ts
`);
const getChainState = db.prepare(`SELECT last_seen_block, last_updated_ts FROM chain_state WHERE chain = ?`);

// Append to export block at line 420:
export { /* existing exports */, upsertLpBaseline, getLpBaseline, deleteLpBaseline, upsertChainState, getChainState };
```

---

### `src/config.ts` (MODIFY — REQUIRED_ENV_VARS extension)

**Self-analog:** `src/config.ts:13-66` (existing `EnvVarSpec[]`)

**Append entries** (around line 49 after `ARB_*` block):

```typescript
// EXISTING shape (src/config.ts:13-66):
// { name: 'ETH_SNIPE_AMOUNT', required: false, description: 'ETH snipe amount per trade (default: 0.01)' },

// NEW PHASE 19 entries — one block per chain (eth/bsc/base/arb), one entry per env var
// Per D-ENV-EXAMPLE [USER-BINDING]: every new env var lands here
// (and inline-commented in .env.example with default + 1-line description)

{ name: 'ETH_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for ETH (default: false → dry-run)' },
{ name: 'ETH_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for ETH (default: 50)' },
{ name: 'ETH_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay for ETH (default: 1)' },
{ name: 'ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', required: false, description: 'Anti-rug circuit-breaker trigger threshold for ETH (default: 3)' },
{ name: 'ETH_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS', required: false, description: 'Anti-rug circuit-breaker rolling window for ETH (default: 1)' },
{ name: 'ETH_ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Anti-rug gas multiplier for ETH (default: 2.0)' },
{ name: 'ETH_ANTIRUG_ALLOWLIST_EXTRA', required: false, description: 'Comma-separated extra V2+V3 locker allowlist addresses for ETH' },
// ...repeat for BSC_*, BASE_*, ARB_* (28 new entries total = 7 envs × 4 chains)
```

---

### `src/api/routes/antiRug.ts` (NEW — Express router)

**Analog:** `src/api/routes/controls.ts:39-221` (`controlRoutes` factory)

**Router factory pattern** (copy of `src/api/routes/controls.ts:39-50` + `:51-111`):

```typescript
// Source: src/api/routes/controls.ts:39-50 — factory takes contexts; uses prepared statements
import { Router, Request, Response } from 'express';
import type { ChainContext } from '../../chainRegistry';
import { resetCircuitBreaker, isCircuitBreakerTripped } from '../../anti-rug/circuitBreaker';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'api:antirug' });

export function antiRugRoutes(contexts: ChainContext[]): Router {
    const router = Router();

    // POST /circuit-breaker/:chain/reset — manual operator reset (D-VIS-CB-TRIPPED)
    // Pattern mirrors controls.ts:51-111 (force-sell handler)
    router.post('/circuit-breaker/:chain/reset', async (req: Request, res: Response) => {
        const chainName = req.params.chain;
        const ctx = contexts.find(c => c.chain.name === chainName);
        if (!ctx) {
            res.status(404).json({ error: 'Chain not found' });
            return;
        }
        if (!isCircuitBreakerTripped(chainName)) {
            res.status(409).json({ error: 'Circuit breaker not currently tripped on this chain' });
            return;
        }
        try {
            resetCircuitBreaker(ctx);
            log.info({ chain: chainName, op: 'cb-reset' }, 'Circuit breaker reset via dashboard');
            res.json({ ok: true, chain: chainName });
        } catch (err) {
            log.error({ err, chain: chainName }, 'CB reset failed');
            res.status(500).json({ error: 'Reset failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
    });

    // GET /events/:chain — recent allowlist hits + dry-run events (D-LIST-AUDIT + D-DRY-TELEMETRY)
    router.get('/events/:chain', async (req: Request, res: Response) => { /* DB query; pattern similar to positions.ts:25-28 */ });

    return router;
}
```

**Mount point in `src/api/server.ts:69`** (one-line addition):

```typescript
// Existing (server.ts:69):
apiRouter.use('/controls', controlRoutes(contexts));
// NEW:
apiRouter.use('/anti-rug', antiRugRoutes(contexts));
```

---

### Dashboard: `AntiRugStateBadge.tsx` (component, display)

**Analog:** `dashboard/src/components/ChainBadge.tsx` (badge primitive)

**Imports + structure** (copy of `ChainBadge.tsx:1-31`):

```typescript
// Source: dashboard/src/components/ChainBadge.tsx (badge primitive)
// Anti-rug version: 6 semantic states with click handler

interface AntiRugStateBadgeProps {
    state: 'live' | 'dry-run' | 'would-have-sold' | 'exit-fired' | 'halted' | 'unmonitored';
    chain: string;
    onClick?: () => void;
    title?: string;     // tooltip text per UI-SPEC copy table
}

const stateStyles: Record<AntiRugStateBadgeProps['state'], { bg: string; label: string }> = {
    'live':             { bg: 'bg-profit',                              label: 'Live' },
    'dry-run':          { bg: 'bg-warning',                             label: 'Dry-run' },
    'would-have-sold':  { bg: 'bg-warning text-text',                   label: 'Would-have-sold' },
    'exit-fired':       { bg: 'bg-loss',                                label: 'Exit fired' },
    'halted':           { bg: 'bg-[#1f2937] border-l-2 border-loss',    label: 'Halted (CB)' },
    'unmonitored':      { bg: 'bg-surface-lighter text-text-disabled',  label: 'Unmonitored' },
};

export function AntiRugStateBadge({ state, onClick, title }: AntiRugStateBadgeProps) {
    const { bg, label } = stateStyles[state];
    return (
        <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}     // stopPropagation — PositionTable.tsx:194 precedent
            title={title}
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs text-white ${bg}`}
        >
            {label}
        </button>
    );
}
```

---

### Dashboard: `CircuitBreakerResetModal.tsx` (component, gated confirm)

**Analog:** `dashboard/src/components/ConfirmDialog.tsx:15-107` (requireConfirmText machinery) + `dashboard/src/components/EmergencyConfirmDialog.tsx` (composed wrapper)

**Gated-acknowledge + RESET-text pattern** (extends ConfirmDialog.tsx — UI-SPEC explicitly requires extension, not duplication):

```typescript
// Source: dashboard/src/components/ConfirmDialog.tsx:15-107 — confirm flow with text gate
// Anti-rug version: N acknowledge checkboxes UNLOCK the RESET-text input

import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';

interface CircuitBreakerResetModalProps {
    open: boolean;
    chain: string;
    triggers: Array<{ token: string; pair: string; signals: RugSignals; outcome: string; timestamp: number }>;
    onConfirm: () => Promise<void>;
    onDismiss: () => void;
}

export function CircuitBreakerResetModal({ open, chain, triggers, onConfirm, onDismiss }: CircuitBreakerResetModalProps) {
    const [acknowledged, setAcknowledged] = useState<Set<number>>(new Set());
    const allAcknowledged = acknowledged.size === triggers.length;

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-surface/70" onClick={onDismiss} />
            <div className="relative bg-surface-light rounded-lg p-6 w-[640px] border border-border shadow-xl max-h-[90vh] overflow-y-auto">
                <h2 className="text-xl font-bold leading-[1.2]">Review and Reset Anti-Rug Circuit Breaker — {chain.toUpperCase()}</h2>
                <p className="text-sm mt-3 text-text leading-[1.5]">
                    The anti-rug circuit breaker tripped after {triggers.length} triggers within {/* W hours */} hours.
                    Review every trigger event below. Reset only if you have confirmed each one is a true positive or a known false positive you have decided to ignore.
                </p>

                {/* Per-trigger section with acknowledge checkbox */}
                {triggers.map((trigger, i) => (
                    <div key={i} className="mt-4 border-l-2 border-loss bg-surface rounded-r-lg px-4 py-3">
                        <h3 className="text-sm font-bold">Trigger {i + 1} of {triggers.length} — fired at {/* formatTimeAgo */}</h3>
                        {/* signal evidence rows */}
                        <label className="flex items-center gap-2 mt-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={acknowledged.has(i)}
                                onChange={() => {
                                    const next = new Set(acknowledged);
                                    next.has(i) ? next.delete(i) : next.add(i);
                                    setAcknowledged(next);
                                }}
                            />
                            <span className="text-xs">I have reviewed this trigger</span>
                        </label>
                    </div>
                ))}

                {/* Acknowledge-gated ConfirmDialog using requireConfirmText machinery
                    Reuses the existing RESET-text gate per UI-SPEC */}
                {allAcknowledged && (
                    <ConfirmDialog
                        open={true}
                        title=""
                        body="Type RESET to confirm"
                        confirmLabel="Reset Circuit Breaker"
                        dismissLabel="Close without resetting"
                        variant="neutral"
                        onConfirm={onConfirm}
                        onDismiss={onDismiss}
                        requireConfirmText="RESET"
                    />
                )}
            </div>
        </div>
    );
}
```

---

### Dashboard: `useWebSocket.ts` (MODIFY — extend switch dispatch)

**Self-analog:** `dashboard/src/hooks/useWebSocket.ts:68-88` (existing `switch (msg.type)` block)

**Switch extension pattern** (add 5 new case branches per UI-SPEC realtime contract):

```typescript
// EXISTING (dashboard/src/hooks/useWebSocket.ts:68-88):
switch (msg.type) {
    case 'positions_update': { /* ... */ }
    case 'notification': { /* ... */ }
    case 'chain_status_change': { /* ... */ }
}

// PHASE 19 ADDITIONS (5 new cases per UI-SPEC):
case 'antirug_state_update': {
    const data = msg.data as { tradeId: number; chain: string; state: AntiRugState; lastEventTs?: number; lastSignals?: RugSignals };
    // Merge state into Position by tradeId
    setPositions(prev => prev.map(p => p.tradeId === data.tradeId ? { ...p, antiRugState: data.state } : p));
    break;
}
case 'antirug_event': {
    const data = msg.data as AntiRugEvent;
    setAntiRugEvents(prev => [data, ...prev].slice(0, 100));
    break;
}
case 'chain_ws_health_change': {
    const data = msg.data as { chain: string; state: 'connected' | 'reconnecting' | 'disconnected'; lastPongTs?: number };
    setChainWsHealth(prev => ({ ...prev, [data.chain]: data }));
    break;
}
case 'cb_tripped': {
    const data = msg.data as { chain: string; triggers: TriggerEvent[]; windowHours: number };
    setCircuitBreakerTrips(prev => ({ ...prev, [data.chain]: data }));
    break;
}
case 'cb_reset': {
    const data = msg.data as { chain: string; resetByOperatorTs: number };
    setCircuitBreakerTrips(prev => { const next = { ...prev }; delete next[data.chain]; return next; });
    break;
}
```

---

### `test/fixtures/contracts/RugPull.sol` (NEW)

**Analog:** `test/fixtures/contracts/Honeypot.sol:1-80` (mode-discriminated fault-injection ERC20)

**Mode-discriminated rug fixture pattern** (copy of `Honeypot.sol` immutable-discriminator shape):

```solidity
// Source: test/fixtures/contracts/Honeypot.sol — 5-mode immutable-discriminator
// Anti-rug version: rug-pull V2 + V3 modes
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract RugPull is ERC20 {
    // Discriminant — uint8 mode (immutable, pinned at construction):
    //   0 = v2-burn-to-eoa     (LP removed, destination is EOA — should trigger)
    //   1 = v2-burn-to-locker  (LP removed, destination is a locker — should NOT trigger)
    //   2 = v2-burn-to-dead    (LP burned to 0xdEaD — allowlisted, should NOT trigger)
    //   3 = v3-burn-collect    (V3 Burn + Collect to EOA — should trigger)
    //   4 = v3-burn-only       (V3 Burn without Collect — should NOT trigger alone)
    uint8 public immutable mode;
    address public immutable rugDestination;   // configurable allowlist target

    constructor(string memory name, string memory symbol, uint8 _mode, address _rugDestination) ERC20(name, symbol) {
        mode = _mode;
        rugDestination = _rugDestination;
    }

    // Helper for test scaffolding — mint to test-supplied address
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    // The rug-pull entrypoint — fork test calls this then asserts multi-signal verdict
    function executeRug(address pair) external {
        // mode-dispatched: emit V2 Burn(sender, amt0, amt1, rugDestination) via _burn + low-level Transfer
        // (planner finalizes the exact dispatch — match Honeypot.sol _update precedent)
    }
}
```

---

### `test/fork/fixtures/rugs/eth-v2-horse.json` (NEW)

**Analog:** `test/fork/fixtures/honeypots/eth-max-wallet.json` (Phase 18 fixture)

**Fixture schema pattern** (extend Phase 18 schema with rug-specific fields per 19-RESEARCH.md §4.1):

```json
{
    "slug": "eth-v2-horse",
    "chain": "eth",
    "dexType": "v2",
    "tokenAddress": "0x...HORSE_TOKEN_ADDR_FROM_19-RESEARCH.md_§4.1...",
    "tokenSymbol": "HORSE",
    "pairAddress": "0x77A838d43Aa717b5C0eEd82E3A3078560e9429b3",
    "routerAddress": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    "lpAddBlock": 18401564,
    "lpRemovalBlock": 18401609,
    "lpRemovalTxHash": "0xed945fa47225956c7dfdd7ec29fb4201f7a914bbdad2f81a7903f4726ebf3952",
    "forkBlockNumber": 18401608,
    "destinationOnBurn": "0x...scammer_address_ending_33b03A...",
    "expectedVerdict": "unsafe",
    "expectedSignals": {
        "lpRemovedPct": ">99",
        "allowlistHit": "unsafe",
        "v2ReservePctBelow": ">99"
    },
    "bugPattern": "lp-removal-no-allowlist",
    "discoveredVia": "medium-article",
    "discoveredOn": "2026-05-23",
    "notes": "100% rug ~10min after LP add; sourced from 19-RESEARCH.md §4.1 candidate A."
}
```

---

### `test/fork/fixtures/rugs/README.md` (NEW)

**Analog:** `test/fork/fixtures/honeypots/README.md` (Phase 18 schema doc + Wave-1 follow-up tracking)

Copy the entire structure of `test/fork/fixtures/honeypots/README.md` — sections "JSON Schema", "V3 Fixtures", "How to Add a New Fixture", "Outstanding Block-Pin Verification", "See Also" — with anti-rug-specific field descriptions and 19-RESEARCH.md references.

---

### `test/integration/anti-rug/wsReconnectBackfill.test.ts` (NEW)

**Analog:** `test/integration/wsReconnect.test.ts:17-100` (mock WSProvider lifecycle drill)

**Mock WSProvider + reconnect-resubscribe-backfill pattern** (copy of `wsReconnect.test.ts:17-72`):

```typescript
// Source: test/integration/wsReconnect.test.ts:17-72 — mock WebSocketProvider class
// Anti-rug version: drill (a) heartbeat-dead → terminate → reconnect
//                          (b) reconnect → resubscribe + backfill via getLogs
//                          (c) backfill gap > cap → FAIL CLOSED

describe('Anti-rug WS reconnect-resubscribe-backfill drill', () => {
    beforeEach(() => { vi.resetModules(); });

    async function importDetector() {
        // Same mock-ethers + mock-logger structure as wsReconnect.test.ts
        // ... mocking pattern verbatim ...
    }

    it('heartbeat dead triggers ws.terminate, reconnect, resubscribe', async () => { /* ... */ });
    it('backfill on reconnect issues chunked getLogs respecting cap', async () => { /* ... */ });
    it('backfill gap exceeding maxBackfillBlocks fires GAP DETECTED', async () => { /* ... */ });
});
```

---

### `test/fork/antiRugDetector.fork.test.ts` (NEW)

**Analog:** `test/fork/honeypotChecker.fork.test.ts:1-120` (hardhat fork + chainId guard + artifact loading)

**Fork test pattern** (copy of `honeypotChecker.fork.test.ts:73-106` `beforeAll` + structure):

```typescript
// Source: test/fork/honeypotChecker.fork.test.ts:73-106 — beforeAll(chainGuard + artifact load + deploy)
// Anti-rug version: deploy RugPull.sol, simulate LP-removal, assert multi-signal verdict

describe('Phase 19 plan 19-* — Anti-rug detector fork tests', () => {
    let provider: ethers.JsonRpcProvider;
    let deployer: ethers.Wallet;
    let rugArtifact: { abi: unknown[]; bytecode: string };

    beforeAll(async () => {
        provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545', undefined, { cacheTimeout: -1 });
        deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
        const ok = await isHardhatFork(provider);     // same chainId guard helper
        if (!ok) return;
        const rugArtifactPath = path.resolve(__dirname, '../../artifacts/test/fixtures/contracts/RugPull.sol/RugPull.json');
        rugArtifact = JSON.parse(fs.readFileSync(rugArtifactPath, 'utf-8'));
    }, 90000);

    describe.each([0, 1, 2, 3, 4])('RugPull mode %i', (mode) => { /* contrived assertions */ });

    // Real-mainnet rug fixture replay (skipped if forkBlockNumber=null)
    describe('eth-v2-horse mainnet fork replay', () => {
        it('detects HORSE LP removal as multi-signal unsafe', async () => {
            // Fork-pin to lpRemovalBlock - 1
            // Inject synthetic bot position; replay lpRemovalBlock
            // Assert evaluation.verdict === 'unsafe', three signals fire
        });
    });
});
```

---

### `docs/operations/anti-rug-rollout.md` (NEW [USER-BINDING])

**Analog:** `docs/CONFIGURATION.md` (existing markdown structure for env-var-driven config)

**Operator-handoff document structure** (modelled on `docs/CONFIGURATION.md` env-var-table format + UI-SPEC copywriting contract):

```markdown
# Anti-Rug Rollout — Operator Handoff

This document is the authoritative reference for rolling Phase 19 anti-rug monitoring
from dry-run to live on each chain. Per D-OPERATOR-HANDOFF and D-LIVE-GATE.

## 1. Pre-flight — Required `.env` changes
[Table of every new env var with default + 1-line description, format identical to docs/CONFIGURATION.md]

## 2. Bot restart procedure post-`.env` changes
[Step-by-step]

## 3. Per-chain verification protocol — dry-run mode
[How to confirm anti-rug is operating in dry-run]

## 4. Per-chain verification protocol — live mode flip
[7-day-AND-event-review gate per D-LIVE-GATE]

## 5. Circuit-breaker reset procedure
[Dashboard reset modal walk-through; backup CLI procedure]

## 6. Troubleshooting common WS-disconnect / backfill-gap scenarios
[Common errors + diagnosis + resolution]
```

---

## Shared Patterns

### Authentication / Auth (N/A)
Anti-rug is an internal subsystem; no auth changes. Dashboard CB-reset endpoint relies on existing `authMiddleware` at `src/api/server.ts:70`.

### Error Handling (Discriminated Unions + Fail-Loud)
**Source:** `src/utils/honeypot/types.ts:42-65` (discriminated union) + `src/chainRegistry.ts:376-389` (fail-loud env validation)
**Apply to:** Every anti-rug service file (detector, exitTrigger, lpBaseline, allowlist, circuitBreaker)

```typescript
// Discriminated union — vacuous "safe" return unrepresentable
export type RugEvaluation = { verdict: 'safe'; ... } | { verdict: 'unsafe'; ... } | { verdict: 'unknown'; ... };

// Fail-loud env validation — pattern from chainRegistry.ts:376-389
if (Number.isNaN(value) || value < 0 || value > 100) {
    log.fatal({ chain: chainName, key: envName, value: raw }, 'Env var out of range');
    process.exit(1);
}
```

### Structured pino Logging (chain-scoped + op-prefixed)
**Source:** `src/exitEngine.ts:17` + `src/utils/notifier.ts:1-8` + universal usage in `src/bot.ts`
**Apply to:** All new anti-rug service files

```typescript
const log = logger.child({ module: 'antiRug:<submodule>' });
// op-prefixed log lines per D-LIST-AUDIT
log.info({ op: 'antirug.allowlist-hit', token, pair, event, destinationAddress, lockerName }, '...');
```

### Telegram + Dashboard Broadcast (sendCtxAlert)
**Source:** `src/utils/notifier.ts:75-98` (`sendCtxAlert` — Telegram + WS broadcast in one call)
**Apply to:** All anti-rug Telegram alerts (D-VIS-LIVE-EXIT, D-VIS-CB-TRIPPED, D-VIS-WS-HEALTH)

```typescript
import { sendCtxAlert } from '../utils/notifier';
await sendCtxAlert(ctx, `*[ANTI-RUG EXIT]* ${symbol} ${tokenAddress}\n...`);
// Severity + category auto-inferred from message text (notifier.ts:16-31)
```

### Sell-Lock Mutex Discipline
**Source:** `src/utils/exitManager.ts:14-25` (`tryAcquireSellLock`) — already enforced inside `executeFullSell` at `src/exitEngine.ts:433-436`
**Apply to:** Anti-rug exit trigger MUST go through `executeFullSell` (never direct `sendTransaction`); the lock acquisition is already automatic. Two parallel exits (anti-rug + trailing-stop) → one wins, the other no-ops with structured log.

### WS Broadcast Channel Naming (Realtime Push Contract)
**Source:** `src/api/ws/broadcaster.ts:39-50` (`broadcast(type, data)`) + UI-SPEC §"Realtime Push Contract"
**Apply to:** All anti-rug events broadcast through existing hub — 5 new event types: `antirug_state_update`, `antirug_event`, `chain_ws_health_change`, `cb_tripped`, `cb_reset`

```typescript
import { broadcast } from '../api/ws/broadcaster';
broadcast('cb_tripped', { chain: ctx.chain.name, triggers: [...], windowHours: 1, triggerCount: 3 });
```

### Per-Chain ChainConfig Field (Conditional-Merge Pattern)
**Source:** `src/chainRegistry.ts:67-74` (`honeypotChecker` Phase 18 field) + `src/chainRegistry.ts:355-389` (env overlay + fail-loud)
**Apply to:** `src/chainRegistry.ts` `antiRug` field — defaults in `CHAIN_TEMPLATES`, per-chain env overlay, fail-loud range validation

### Resume-on-Restart (DB scan + per-trade resume)
**Source:** `src/bot.ts:952-994` (`resumeMultiChainMonitoring`) + `src/exitEngine.ts:874-938` (`resumeExitMonitor`)
**Apply to:** `resumeAntiRugMonitoring` in `bot.ts` startup — DB scan of `trades` JOIN `lp_baseline`, per-trade re-register, per-chain backfill via `getLogs`

---

## No Analog Found

Files with no close codebase analog (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/anti-rug/raceTelemetry.ts` — `eth_callBundle` synthetic race path | service | request-response | Codebase has Flashbots BUNDLE SUBMISSION (`src/utils/flashbots.ts`) but NO bundle-simulation analog. Pattern from 19-RESEARCH.md §8 (cited Flashbots Auction docs). The `provider.send('eth_callBundle', ...)` direct-call shape mirrors `src/utils/honeypot/simulator.ts` `provider.send('eth_simulateV1', ...)` pattern from Phase 18 (HONEY-04 deferred path) — that's the closest shape, but Flashbots-specific auth + URL handling is new. |

All other 22 files have at least a role-match analog.

---

## Metadata

**Analog search scope:**
- `src/` (all subdirectories — bot, exitEngine, chainRegistry, utils, api)
- `dashboard/src/components/`, `dashboard/src/hooks/`, `dashboard/src/pages/`
- `test/unit/`, `test/integration/`, `test/fork/`, `test/fixtures/contracts/`, `test/fork/fixtures/honeypots/`
- `docs/`

**Files scanned (key analogs read in full or by relevant section):**
- `src/bot.ts` (sections at 320-415, 510-650, 656-810, 816-994)
- `src/exitEngine.ts` (sections at 1-100, 420-519, 800-940)
- `src/chainRegistry.ts` (full)
- `src/utils/db.ts` (full)
- `src/utils/notifier.ts` (full)
- `src/utils/exitManager.ts` (full)
- `src/utils/honeypot/types.ts` (full)
- `src/utils/honeypot/index.ts` (full)
- `src/utils/safetyProviders/unicrypt.ts` (full)
- `src/utils/blocklist.ts` (full)
- `src/utils/retry.ts` (full)
- `src/utils/abis.ts` (full)
- `src/api/server.ts` (full)
- `src/api/routes/controls.ts` (full)
- `src/api/routes/positions.ts` (full)
- `src/api/ws/broadcaster.ts` (full)
- `src/config.ts` (full)
- `dashboard/src/components/{ConfirmDialog,EmergencyConfirmDialog,ChainBadge,FilterChips,StatCard,StatusDot,ChainStatusCard,EventFeed,Sidebar,PositionTable}.tsx`
- `dashboard/src/hooks/useWebSocket.ts` (full)
- `dashboard/src/utils/formatters.ts` (full)
- `dashboard/src/types/api.ts` (full)
- `dashboard/src/pages/Overview.tsx` (full)
- `test/fixtures/contracts/Honeypot.sol` (head 80)
- `test/fork/fixtures/honeypots/{eth-max-wallet.json,README.md}` (full)
- `test/integration/wsReconnect.test.ts` (head 100)
- `test/fork/honeypotChecker.fork.test.ts` (head 120)
- `test/unit/{exitEngine,chainRegistry,v3Abis}.test.ts` (head 80 each)
- `docs/CONFIGURATION.md` (head 40)
- `.env.example` (head 50)

**Pattern extraction date:** 2026-05-23
