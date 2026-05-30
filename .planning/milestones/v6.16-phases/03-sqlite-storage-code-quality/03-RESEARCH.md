# Phase 3: SQLite Storage & Code Quality - Research

**Researched:** 2026-03-22
**Domain:** SQLite persistence, structured logging, provider/ABI consolidation (Node.js/TypeScript)
**Confidence:** HIGH

## Summary

Phase 3 replaces the JSON file storage (`storage.ts`) with SQLite via `better-sqlite3`, replaces all `console.log`/emoji logging with structured JSON logging via `pino`, centralizes 8 redundant provider instantiations into a singleton factory, and consolidates ~15 inline ABI arrays into a single module.

The codebase currently has 58 `console.log/warn/error` calls across 14 files, 8 separate `JsonRpcProvider` instantiations across 4 files, and approximately 15 inline ABI arrays across 4 files. The existing `storage.ts` is 56 lines with an in-memory cache that diverges from disk -- SQLite with WAL mode directly replaces this with atomic, concurrent-safe writes.

**Primary recommendation:** Use `better-sqlite3` 12.x (synchronous API, WAL mode) for storage, `pino` 10.x for structured JSON logging, a module-level singleton Map for provider instances, and a single `src/utils/abis.ts` module for all ABI definitions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use `better-sqlite3` as the SQLite binding -- synchronous API, fastest Node.js option, WAL mode for concurrent reads. No ORM layer needed for ~3 tables.
- **D-02:** SQLite is the sole source of truth -- no in-memory cache that can diverge from disk (DB-02). The current in-memory `state` object in storage.ts is eliminated.
- **D-03:** WAL mode enabled on DB creation for concurrent read access during monitoring loops.
- **D-04:** Trade events only -- record buy, sell, and status changes with timestamps, prices, gas costs. No validation results or monitoring tick history. Keeps DB lean and queryable (DB-03).
- **D-05:** P&L computed on query via SQL JOIN, not stored at sell time. Raw data (buy price, sell price, gas) is the source of truth. Future-proofs for partial sells in Phase 7 (DB-04).
- **D-06:** Trades table schema: id, token, chain, action (buy/sell/fail), tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status.
- **D-07:** Auto-migrate `.bot-state.json` on first run -- detect file, import tokens into SQLite, rename to `.bot-state.json.bak`. Zero manual effort. If SQLite DB already exists, skip migration silently.
- **D-08:** JSON lines format for all log output -- each line is a JSON object with level, msg, contextual fields, and timestamp. Machine-parseable, grep-friendly.
- **D-09:** Log level filtering via `LOG_LEVEL` environment variable. Levels: debug < info < warn < error. Default: info.
- **D-10:** Telegram alerts remain separate from logging -- explicit `sendTelegramAlert()` calls in business logic. Error logs do NOT auto-trigger Telegram alerts. Different concerns, different channels.

### Claude's Discretion
- Specific logging library choice (pino, winston, or lightweight custom implementation)
- SQLite schema details beyond the trades table (indexes, constraints, additional tables if needed)
- Singleton provider implementation pattern (module-level cache, class, or factory function)
- ABI centralization file structure (single file vs per-contract)
- DB file location (project root vs data directory)
- Migration error handling (what happens if .bot-state.json is corrupted)

### Deferred Ideas (OUT OF SCOPE)
- Validation result logging to DB (what checks passed/failed per token) -- could be added later if pipeline tuning needs data
- Log-triggered Telegram alerts (auto-alert on error-level logs) -- revisit if manual alert placement becomes burdensome
- WebSocket provider for real-time events instead of polling -- Phase 4+ concern
- TypeScript strictness improvements (replacing `any` types) -- nice-to-have, not scoped
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DB-01 | JSON file storage replaced with SQLite database using WAL mode for concurrent access | better-sqlite3 12.x with `db.pragma('journal_mode = WAL')` -- verified API, synchronous, no ORM needed |
| DB-02 | SQLite is the sole source of truth -- no in-memory cache that can diverge from disk | Eliminate `let state: State` in storage.ts; all reads go through prepared statements directly |
| DB-03 | Full transaction audit trail: every buy, sell, and status change recorded with timestamps | Trades table with schema from D-06; INSERT on each action in markSniped/updateTokenStatus |
| DB-04 | P&L calculated per trade with realized gains/losses queryable by token, chain, and date range | SQL JOIN query computing P&L from buy/sell rows; no stored computed fields |
| INFRA-01 | Structured logging with severity levels (debug, info, warn, error) replaces all console.log/emoji logging | pino 10.x with JSON lines output; 58 console calls across 14 files to migrate |
| INFRA-02 | Singleton provider instance per chain eliminates redundant provider creation across modules | Module-level Map cache in `src/utils/provider.ts`; 8 provider instantiations across 4 files to consolidate |
| INFRA-03 | All ABI definitions centralized in a single module -- no inline ABI arrays in business logic | Single `src/utils/abis.ts` module; ~15 inline ABI arrays across 4 files to consolidate |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | SQLite database binding | Synchronous API avoids event-loop complexity; fastest Node.js SQLite; WAL mode built-in; prebuilt binaries for Node 22 |
| @types/better-sqlite3 | 7.6.13 | TypeScript types for better-sqlite3 | Required for strict TypeScript compilation |
| pino | 10.3.1 | Structured JSON logger | JSON lines output by default; 10x faster than winston; TypeScript types included; level filtering built-in |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino-pretty | 13.1.3 | Human-readable log formatting | Development only -- pipe output: `node dist/bot.js \| pino-pretty` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pino | winston | Winston is slower (10x), larger dependency tree, more configurable but overkill for JSON-lines-only use case |
| pino | Custom logger | Fewer dependencies but must hand-roll level filtering, timestamp formatting, child loggers, and serialization -- pino does all this in ~40KB |
| better-sqlite3 | sql.js | Pure JS (no native module) but 5-10x slower, no WAL mode, async-only API |

**Recommendation for Claude's Discretion (logging):** Use pino. It outputs JSON lines by default (D-08), has built-in level filtering (D-09), is the fastest option, includes TypeScript types, and requires zero configuration to meet all logging requirements.

**Installation:**
```bash
npm install better-sqlite3 pino --legacy-peer-deps && npm install -D @types/better-sqlite3 pino-pretty --legacy-peer-deps
```

Note: `--legacy-peer-deps` is required due to existing `@flashbots/ethers-provider-bundle` peer dependency conflict (documented in Phase 2 decisions).

## Architecture Patterns

### Recommended Project Structure
```
src/
├── utils/
│   ├── db.ts              # SQLite database singleton, schema, migrations
│   ├── logger.ts          # Pino logger factory (replaces current 4-line logger)
│   ├── provider.ts        # Singleton provider cache per chain
│   ├── abis.ts            # All ABI definitions (centralized)
│   ├── storage.ts         # REPLACED -- delete after migration complete
│   ├── exitManager.ts     # Update: use logger, use db instead of storage
│   ├── tokenSafety.ts     # Update: use logger, use provider singleton, use abis
│   ├── txManager.ts       # Update: use logger
│   ├── pairDiscovery.ts   # Update: use provider singleton, use abis
│   ├── notifier.ts        # Update: use logger (stays separate from log pipeline per D-10)
│   ├── retry.ts           # Update: use logger
│   └── ...
├── bot.ts                 # Update: use all new modules
├── alphaDrop.ts           # Update: use provider singleton, use abis, use logger
├── telegramListener.ts    # Update: use logger
└── config.ts              # Add LOG_LEVEL and DB_PATH env vars
```

### Pattern 1: Database Singleton with WAL Mode
**What:** Single database instance created on module load, WAL mode enabled, prepared statements cached.
**When to use:** Every module that needs database access imports from `db.ts`.
**Example:**
```typescript
// src/utils/db.ts
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'bot.db');

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for concurrent reads during monitoring loops
db.pragma('journal_mode = WAL');
// Recommended: synchronous = NORMAL for WAL mode (safe + fast)
db.pragma('synchronous = NORMAL');
// Busy timeout: wait 5s for locks instead of failing immediately
db.pragma('busy_timeout = 5000');

// Schema creation
db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL,
        chain TEXT NOT NULL DEFAULT 'mainnet',
        action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'fail')),
        tx_hash TEXT,
        block INTEGER,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
        amount_in TEXT,
        amount_out TEXT,
        gas_cost TEXT,
        price_at_action TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sold', 'failed'))
    );
    CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token);
    CREATE INDEX IF NOT EXISTS idx_trades_chain ON trades(chain);
    CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
`);

// Prepared statements (cached for performance)
const insertTrade = db.prepare(`
    INSERT INTO trades (token, chain, action, tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status)
    VALUES (@token, @chain, @action, @txHash, @block, @timestamp, @amountIn, @amountOut, @gasCost, @priceAtAction, @status)
`);

const getTradesByToken = db.prepare(`
    SELECT * FROM trades WHERE token = ? ORDER BY timestamp ASC
`);

const updateTradeStatus = db.prepare(`
    UPDATE trades SET status = ? WHERE token = ? AND status = 'pending'
`);

const isTokenSniped = db.prepare(`
    SELECT 1 FROM trades WHERE token = ? LIMIT 1
`);

export { db, insertTrade, getTradesByToken, updateTradeStatus, isTokenSniped };
```
Source: [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

### Pattern 2: Pino Logger with Level Filtering
**What:** Create a pino instance with LOG_LEVEL from env, export for all modules.
**When to use:** Replace every `console.log/warn/error` call.
**Example:**
```typescript
// src/utils/logger.ts
import pino from 'pino';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    // base: false removes pid/hostname for cleaner output
    base: undefined,
});

// Usage in other modules:
// import { logger } from './utils/logger';
// const log = logger.child({ module: 'bot' });
// log.info({ token: '0x...', action: 'buy' }, 'Snipe executed');
// log.warn({ token: '0x...' }, 'Safety check failed');
// log.error({ err }, 'Transaction failed');
```
Source: [pino API docs](https://github.com/pinojs/pino/blob/main/docs/api.md)

### Pattern 3: Singleton Provider Factory
**What:** Module-level Map caching one `JsonRpcProvider` per network key.
**When to use:** Every module that creates Contract instances imports `getProvider()`.
**Example:**
```typescript
// src/utils/provider.ts
import { ethers, JsonRpcProvider, Wallet } from 'ethers';
import { CONFIG } from '../config';

const providers = new Map<string, JsonRpcProvider>();

export function getProvider(network?: string): JsonRpcProvider {
    const net = network || CONFIG.network;
    let provider = providers.get(net);
    if (!provider) {
        const rpcUrl = CONFIG.rpc[net as keyof typeof CONFIG.rpc];
        if (!rpcUrl) {
            throw new Error(`No RPC URL configured for network: ${net}`);
        }
        provider = new ethers.JsonRpcProvider(rpcUrl);
        providers.set(net, provider);
    }
    return provider;
}

export function getWallet(network?: string): Wallet {
    return new ethers.Wallet(CONFIG.walletPrivateKey, getProvider(network));
}
```

### Pattern 4: Centralized ABI Module
**What:** All ABI fragment arrays in one file, exported as named constants.
**When to use:** Every module that creates Contract instances imports ABIs from here.
**Example:**
```typescript
// src/utils/abis.ts

// -- Factory --
export const FACTORY_ABI = [
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
    "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

// -- Router --
export const ROUTER_ABI = [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory)",
    "function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory)",
    "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)"
];

// -- ERC20 --
export const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint)",
    "function approve(address spender, uint amount) public returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function tradingEnabled() view returns (bool)"
];

// -- Pair --
export const PAIR_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function balanceOf(address owner) view returns (uint256)",
    "function totalSupply() view returns (uint256)"
];

// -- Token limits (optional methods) --
export const TOKEN_LIMITS_ABI = [
    "function totalSupply() view returns (uint256)",
    "function maxWalletAmount() view returns (uint256)",
    "function maxWallet() view returns (uint256)",
    "function maxTxAmount() view returns (uint256)",
    "function maxTransactionAmount() view returns (uint256)"
];
```

### Pattern 5: P&L Query via SQL
**What:** Compute P&L from raw trade data using SQL, not stored computed fields.
**When to use:** Any reporting or querying of trade performance.
**Example:**
```typescript
// In db.ts
const getPnLByToken = db.prepare(`
    SELECT
        b.token,
        b.chain,
        b.amount_in  AS buy_cost_eth,
        b.gas_cost    AS buy_gas,
        s.amount_out  AS sell_revenue_eth,
        s.gas_cost    AS sell_gas,
        CAST(s.amount_out AS REAL) - CAST(b.amount_in AS REAL)
            - CAST(b.gas_cost AS REAL) - CAST(COALESCE(s.gas_cost, '0') AS REAL)
            AS realized_pnl
    FROM trades b
    LEFT JOIN trades s ON b.token = s.token AND s.action = 'sell'
    WHERE b.action = 'buy'
      AND (? IS NULL OR b.token = ?)
      AND (? IS NULL OR b.chain = ?)
      AND (? IS NULL OR b.timestamp >= ?)
      AND (? IS NULL OR b.timestamp <= ?)
    ORDER BY b.timestamp DESC
`);
```

### Anti-Patterns to Avoid
- **In-memory cache in front of SQLite:** D-02 explicitly forbids this. The current `let state: State` pattern is the problem being solved. All reads must go through the database.
- **Async SQLite operations:** better-sqlite3 is synchronous by design. Do not wrap calls in Promises or use `async/await` around database operations -- this wastes event loop ticks and adds no benefit.
- **Opening multiple Database instances:** Open one instance in `db.ts` at module load. Multiple instances to the same file cause WAL contention. Share the singleton.
- **Storing computed P&L at write time:** D-05 says raw data is source of truth. Compute on read via SQL. Storing computed values creates staleness bugs when future phases add partial sells.
- **Using pino for Telegram alerts:** D-10 says Telegram alerts are separate from logging. Keep explicit `sendTelegramAlert()` calls in business logic. Do not pipe log output to Telegram.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured JSON logging | Custom `JSON.stringify` wrapper around console.log | pino | Level filtering, child loggers, timestamp formatting, serializers, performance -- all built-in |
| SQLite access | Raw `require('better-sqlite3')` in every module | Single `db.ts` module with cached prepared statements | Prevents multiple DB handles, centralizes schema, makes testing possible |
| Log level filtering | `if (level >= threshold) console.log(...)` | pino's built-in `level` option | Pino handles level comparison, noop for suppressed levels (zero overhead), env var driven |
| Schema migration | Manual ALTER TABLE scripts | Versioned `db.exec()` in `db.ts` with user_version pragma | Simple for 3 tables; full migration framework is overkill here |

**Key insight:** The logging migration (58 calls across 14 files) is mechanical but must be done systematically. Pino's child logger pattern (`logger.child({ module: 'tokenSafety' })`) naturally replaces the ad-hoc `[BOT]` prefixes and emoji prefixes currently in use.

## Common Pitfalls

### Pitfall 1: Circular Dependency with Config/Logger/DB
**What goes wrong:** `config.ts` imports `logger.ts` which imports `db.ts` which imports `config.ts`. Module resolution hangs or produces undefined values.
**Why it happens:** Config needs validation logging, logger needs log level from config, DB needs path from config.
**How to avoid:** Logger reads `LOG_LEVEL` directly from `process.env` (not from CONFIG). DB reads `DB_PATH` directly from `process.env`. Neither imports from `config.ts`. Config module can import logger for startup error messages.
**Warning signs:** `TypeError: Cannot read property 'X' of undefined` at startup.

### Pitfall 2: Emoji in Structured Logs
**What goes wrong:** Existing console calls use emoji prefixes. If these leak into pino messages, the JSON output becomes harder to parse and grep.
**Why it happens:** Find-and-replace that converts `console.warn("emoji msg")` to `log.warn("emoji msg")` preserves the emoji text.
**How to avoid:** Strip emojis during migration. Convert semantic meaning to structured fields: `console.warn("warning Honeypot API failed:", message)` becomes `log.warn({ check: 'honeypot', fallback: 'staticCall' }, 'Honeypot API check failed')`.
**Warning signs:** JSON log output containing unicode emoji characters.

### Pitfall 3: Text Amount Storage in SQLite
**What goes wrong:** Storing ETH amounts as TEXT to avoid precision loss, then comparing them as numbers in SQL with incorrect casting.
**Why it happens:** JavaScript BigInt and wei values exceed SQLite INTEGER range (64-bit signed). TEXT is correct storage type, but SQL arithmetic on TEXT requires explicit CAST.
**How to avoid:** Store amounts as TEXT (wei strings). Use `CAST(column AS REAL)` for P&L arithmetic in SQL queries. Accept minor floating-point rounding in P&L reports (acceptable for reporting, not for transaction execution).
**Warning signs:** P&L queries returning NULL or incorrect values.

### Pitfall 4: Migration Race Condition
**What goes wrong:** Bot starts, migration reads `.bot-state.json`, another process concurrently writes it, migration imports stale data.
**Why it happens:** The current storage.ts writes synchronously on every state change. If bot is running while migration starts, data can be lost.
**How to avoid:** Migration runs at startup before event listeners are registered. Sequence: (1) open DB, (2) check if `.bot-state.json` exists, (3) import, (4) rename to `.bak`, (5) THEN start listeners. This is already the natural startup order.
**Warning signs:** Missing trades after migration.

### Pitfall 5: Forgetting to Close DB on Shutdown
**What goes wrong:** WAL checkpoint doesn't run, WAL file grows, or data is lost on crash.
**Why it happens:** `exitManager.ts` currently calls `flushState()`. After migration, it needs to call `db.close()` instead.
**How to avoid:** Update `gracefulShutdown()` in `exitManager.ts` to import and call `db.close()`. The shutdown handler already exists and works (FIX-05).
**Warning signs:** Growing `-wal` and `-shm` files next to the database.

### Pitfall 6: storage.ts API Surface Change
**What goes wrong:** `markSniped()`, `isAlreadySniped()`, `updateTokenStatus()`, `getState()`, `flushState()` are called from `bot.ts` and `exitManager.ts`. Changing signatures breaks callers.
**Why it happens:** New DB-backed functions need additional parameters (chain, amount_in, gas_cost) that the old functions did not accept.
**How to avoid:** Either (a) expand the function signatures and update all call sites together, or (b) create new `db.ts` exports with the expanded API and update callers to use them, then delete old `storage.ts`. Option (b) is cleaner -- leaves old code working until all callers are migrated.
**Warning signs:** TypeScript compilation errors after changing storage exports.

## Code Examples

Verified patterns from official sources:

### Database Schema Migration (user_version pragma)
```typescript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
const CURRENT_SCHEMA_VERSION = 1;

function migrateSchema(db: Database.Database): void {
    const version = db.pragma('user_version', { simple: true }) as number;

    if (version < 1) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL COLLATE NOCASE,
                chain TEXT NOT NULL DEFAULT 'mainnet',
                action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'fail')),
                tx_hash TEXT,
                block INTEGER,
                timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
                amount_in TEXT,
                amount_out TEXT,
                gas_cost TEXT,
                price_at_action TEXT,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sold', 'failed'))
            );
            CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token);
            CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
        `);
    }

    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
}
```

### JSON State Migration
```typescript
// Source: project-specific, informed by better-sqlite3 transaction API
import fs from 'fs';
import path from 'path';

function migrateJsonState(db: Database.Database): void {
    const jsonPath = path.join(process.cwd(), '.bot-state.json');
    if (!fs.existsSync(jsonPath)) return;

    // Skip if DB already has data (idempotent)
    const count = db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number };
    if (count.c > 0) return;

    try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const state = JSON.parse(raw);

        const insert = db.prepare(`
            INSERT INTO trades (token, chain, action, tx_hash, timestamp, status)
            VALUES (?, 'mainnet', 'buy', ?, ?, ?)
        `);

        const importAll = db.transaction((sniped: Record<string, any>) => {
            for (const [token, info] of Object.entries(sniped)) {
                insert.run(token, info.txHash, info.timestamp, info.status);
            }
        });

        importAll(state.sniped || {});

        // Rename original file
        fs.renameSync(jsonPath, jsonPath + '.bak');
        logger.info({ migrated: Object.keys(state.sniped || {}).length }, 'Migrated .bot-state.json to SQLite');
    } catch (e) {
        // Corrupted JSON: log warning, do not block startup
        logger.warn({ err: e }, 'Failed to migrate .bot-state.json -- file may be corrupted, skipping');
    }
}
```

### Pino Child Logger per Module
```typescript
// Source: https://github.com/pinojs/pino/blob/main/docs/api.md
// In bot.ts:
import { logger } from './utils/logger';
const log = logger.child({ module: 'bot' });

// Replaces: function log(...args: any[]) { console.log("[BOT]", ...args); }
log.info({ pair: pairAddress }, 'New pair detected');
log.info({ token: targetToken, checks: { honeypot: isHoneypot, blacklisted: isBlacklisted } }, 'Safety checks complete');
log.warn({ token: targetToken, reason: 'stop-loss' }, 'Sell failed');

// In tokenSafety.ts:
const log = logger.child({ module: 'tokenSafety' });
log.warn({ token: tokenAddress, check: 'honeypot', fallback: 'staticCall' }, 'Honeypot API failed, using fallback');
log.info({ token: tokenAddress, taxPercent: (taxPercent * 100).toFixed(2) }, 'Transfer tax estimated');
```

### Config Additions
```typescript
// In config.ts -- add to REQUIRED_ENV_VARS array:
{ name: 'LOG_LEVEL', required: false, description: 'Logging level: debug, info, warn, error (default: info)' },
{ name: 'DB_PATH', required: false, description: 'SQLite database file path (default: ./data/bot.db)' },
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JSON file with in-memory cache | SQLite with WAL mode | Industry standard | Atomic writes, concurrent access, queryable audit trail |
| console.log with string formatting | Structured JSON logging (pino/bunyan) | ~2018 onward | Machine-parseable, level filtering, zero-cost disabled levels |
| Provider per module | Singleton provider per chain | ethers v6 best practice | Reduced RPC connection overhead, consistent state |
| Inline ABI arrays | Centralized ABI module | Standard practice | Single source of truth, no duplication bugs |

**Deprecated/outdated:**
- `console.log` with emoji prefixes: Impossible to parse programmatically, no level filtering, no structured fields
- JSON file persistence: No concurrent access safety, no atomic writes, no queryability

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Hardhat + Chai (via @nomicfoundation/hardhat-toolbox) -- already installed |
| Config file | hardhat.config.ts (Solidity only); no TypeScript unit test config yet |
| Quick run command | `npx hardhat test test/db.test.ts` (after setup) |
| Full suite command | `npx hardhat test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | SQLite replaces JSON storage with WAL mode | unit | `npx ts-node --eval "require('./src/utils/db')"` (smoke) | No -- Wave 0 |
| DB-02 | No in-memory cache divergence | unit | Verify storage.ts deleted, all reads go through db.ts | No -- Wave 0 |
| DB-03 | Full audit trail with timestamps | unit | Insert buy/sell/fail, verify all rows present with timestamps | No -- Wave 0 |
| DB-04 | P&L query by token/chain/date | unit | Insert buy+sell pair, verify P&L computation | No -- Wave 0 |
| INFRA-01 | Structured JSON logging replaces all console.log | unit + grep | `grep -r "console\." src/ --include="*.ts"` returns 0 matches | No -- Wave 0 |
| INFRA-02 | Singleton provider per chain | unit | Call getProvider() twice, assert same instance | No -- Wave 0 |
| INFRA-03 | Centralized ABIs, no inline arrays | grep | `grep -r "function.*view returns" src/ --include="*.ts"` only in abis.ts | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx hardhat test test/db.test.ts --no-compile` (quick DB tests)
- **Per wave merge:** `npx hardhat test` (full suite)
- **Phase gate:** Full suite green + grep verification for INFRA-01/INFRA-03

### Wave 0 Gaps
- [ ] `test/db.test.ts` -- covers DB-01, DB-02, DB-03, DB-04 (SQLite storage, audit trail, P&L query)
- [ ] `test/logger.test.ts` -- covers INFRA-01 (structured logging output verification)
- [ ] `test/provider.test.ts` -- covers INFRA-02 (singleton behavior)
- [ ] Test runner for pure TypeScript tests (mocha or ts-node based; Hardhat test runner works for .ts files via hardhat-toolbox)

## Open Questions

1. **Windows native module compilation for better-sqlite3**
   - What we know: better-sqlite3 12.8.0 supports Node 22.x. Dry-run install succeeded (`npm install better-sqlite3 --legacy-peer-deps --dry-run` completed without errors), suggesting prebuilt binaries are available.
   - What's unclear: Whether prebuild-install found a Windows binary or would fall back to node-gyp compilation. MSVC `cl.exe` is NOT in PATH on this machine.
   - Recommendation: Attempt actual install early (Wave 0). If it fails, install `windows-build-tools` via `npm install -g windows-build-tools` or use `better-sqlite3-with-prebuilds` package as fallback.

2. **P&L arithmetic precision with TEXT storage**
   - What we know: Wei values exceed SQLite INTEGER max (2^63). TEXT storage is correct. CAST to REAL gives ~15 significant digits.
   - What's unclear: Whether REAL precision is acceptable for P&L reporting of very large trades.
   - Recommendation: Acceptable for reporting purposes. P&L is informational, not used for transaction execution. Precision loss at 15 significant digits is negligible for ETH/wei values.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v22.16.0 | -- |
| npm | Package management | Yes | 9.9.4 | -- |
| TypeScript | Compilation | Yes | 5.8.3 | -- |
| better-sqlite3 prebuilt | DB-01 | Likely (dry-run OK) | 12.8.0 | `windows-build-tools` or `better-sqlite3-with-prebuilds` |
| python3 | node-gyp fallback | Yes (WindowsApps) | Unknown | -- |
| MSVC cl.exe | node-gyp fallback | No | -- | Install `windows-build-tools` if needed |

**Missing dependencies with no fallback:**
- None identified -- dry-run install succeeded.

**Missing dependencies with fallback:**
- MSVC build tools: Not in PATH, but prebuilt binary download likely succeeded. If actual install fails, use `npm install -g windows-build-tools`.

## Sources

### Primary (HIGH confidence)
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) - API docs, WAL mode, transactions, prepared statements
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) - Constructor, pragma, prepare, run/get/all, transaction
- [pino GitHub](https://github.com/pinojs/pino) - API docs, constructor options, log methods, child loggers
- [pino API docs](https://github.com/pinojs/pino/blob/main/docs/api.md) - Level filtering, timestamp, base, formatters
- npm registry: better-sqlite3@12.8.0, @types/better-sqlite3@7.6.13, pino@10.3.1, pino-pretty@13.1.3 -- versions verified via `npm view`

### Secondary (MEDIUM confidence)
- [better-sqlite3 performance docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) - WAL mode, checkpoint starvation, busy timeout
- [Pino Logger Guide - SigNoz](https://signoz.io/guides/pino-logger/) - Pino usage patterns for 2026
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) - Engine requirements (Node 20.x/22.x/23.x/24.x/25.x)

### Tertiary (LOW confidence)
- [better-sqlite3 Windows prebuilt binary issue](https://github.com/JoshuaWise/better-sqlite3/issues/355) - Windows binary availability (older issue, status may have changed)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - better-sqlite3 and pino are locked/recommended choices with verified versions from npm registry
- Architecture: HIGH - Patterns derived from official API documentation; singleton/centralized patterns are standard Node.js practice
- Pitfalls: HIGH - Based on direct codebase analysis (58 console calls counted, 8 provider instances mapped, circular dependency risk identified from import graph)
- Environment: MEDIUM - Dry-run install succeeded but actual native compilation not tested on this Windows machine

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable libraries, 30-day validity)
