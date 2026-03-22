# Phase 3: SQLite Storage & Code Quality - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-22
**Phase:** 03-sqlite-storage-code-quality
**Areas discussed:** Audit trail depth, Data migration, Log output format, SQLite library

---

## Audit Trail Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Trade events only | Record buy, sell, status changes with timestamps, prices, gas costs. P&L computed from buy/sell pairs. | ✓ |
| Trade events + validation results | Above plus which safety checks passed/failed per token. Adds token_validations table. | |
| Full event log | Everything: validation results, price checks, monitoring ticks, gas estimates, Telegram alerts. | |

**User's choice:** Trade events only
**Notes:** None — user selected recommended option.

### Follow-up: P&L Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Compute on query | Store raw facts only. SQL calculates P&L when asked. | ✓ |
| Store at sell time | Write realized P&L as column when sell confirms. | |

**User's choice:** Compute on query
**Notes:** User asked for tradeoff explanation before deciding. Key factor: future-proofing for Phase 7 partial sells — stored P&L would become stale when multiple partial sells happen on the same token.

---

## Data Migration

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-migrate on first run | Detect .bot-state.json, import into SQLite, rename to .bak | ✓ |
| Clean break | Start fresh, ignore old file | |
| Manual migration script | Separate script user runs once | |

**User's choice:** Auto-migrate on first run
**Notes:** None — user selected recommended option.

---

## Log Output Format

| Option | Description | Selected |
|--------|-------------|----------|
| JSON lines | Each log line is a JSON object with level, msg, context, timestamp | ✓ |
| Human-readable | Colored formatted console output with levels | |
| Both (env toggle) | JSON in production, human-readable in development | |

**User's choice:** JSON lines
**Notes:** None — user selected recommended option.

### Follow-up: Log Level Filtering

| Option | Description | Selected |
|--------|-------------|----------|
| ENV variable | LOG_LEVEL=info (default). debug < info < warn < error. | ✓ |
| Always log everything | No filtering, all levels written | |

**User's choice:** ENV variable
**Notes:** None — user selected recommended option.

### Follow-up: Telegram Alerts vs Logging

| Option | Description | Selected |
|--------|-------------|----------|
| Keep separate | Explicit sendTelegramAlert() calls, independent of log system | ✓ |
| Log-triggered alerts | Error-level logs auto-send Telegram alerts | |

**User's choice:** Keep separate
**Notes:** None — user selected recommended option.

---

## SQLite Library

| Option | Description | Selected |
|--------|-------------|----------|
| better-sqlite3 | Sync API, fastest, native C++ addon, WAL mode, 5M+ weekly downloads | ✓ |
| Drizzle ORM + better-sqlite3 | Type-safe ORM layer, schema as TypeScript, auto-migrations | |
| sql.js (WASM) | Pure JS, no native compile, but loads entire DB in memory | |
| node:sqlite (built-in) | Zero deps but experimental, async API, requires Node 22.5+ | |

**User's choice:** better-sqlite3
**Notes:** User asked for detailed tradeoff discussion before deciding. Key factors: sync API matches current storage pattern, fastest option, ORM overkill for ~3 tables, sql.js recreates the JSON file problem (in-memory with manual flush), node:sqlite requires Node 22.5+ bump (project targets 18+).

---

## Claude's Discretion

- Logging library choice (pino, winston, or custom)
- Schema details (indexes, constraints, additional tables)
- Singleton provider implementation pattern
- ABI centralization file structure
- DB file location
- Migration error handling

## Deferred Ideas

- Validation result logging to DB — could add later for pipeline tuning
- Log-triggered Telegram alerts — revisit if manual alert placement becomes burdensome
