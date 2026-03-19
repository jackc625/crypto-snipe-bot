# Coding Conventions

**Analysis Date:** 2026-03-19

## Naming Patterns

**Files:**
- camelCase for utility files: `gasManager.ts`, `tokenSafety.ts`, `blocklist.ts`
- camelCase for module files: `bot.ts`, `config.ts`, `alphaDrop.ts`
- Utilities grouped in `utils/` subdirectory by domain (gas, tokens, tx, etc.)
- Script files in `scripts/` directory: `genAuthWallet.ts`, `deploySepoliaTest.ts`, `manualTrigger.ts`

**Functions:**
- camelCase for all functions: `getGasOptions()`, `checkHoneypot()`, `isLiquidityLocked()`
- Prefixed with descriptive verbs: `check*`, `is*`, `get*`, `send*`, `handle*`, `mark*`
- Examples from codebase:
  - `checkHoneypot()` - validation function in `src/utils/tokenSafety.ts`
  - `isBlacklistedToken()` - boolean check in `src/utils/tokenSafety.ts`
  - `maybeApprove()` - conditional execution in `src/bot.ts` line 47
  - `sendTxWithRetry()` - action with retry logic in `src/utils/txManager.ts`

**Variables:**
- camelCase for all variables: `tokenAddress`, `buyAmountETH`, `currentPrice`, `initialOut`
- Constants in UPPER_CASE: `TELEGRAM_API`, `UNICRYPT_API`, `ROUTER_ABI`, `PATH`
- Prefixes for clarity:
  - Boolean variables: `isHoneypot`, `isBlacklisted`, `isBad`, `locked`, `anyActiveLock`
  - Amount/price variables: `buyAmount`, `initialPrice`, `stopLossPrice`, `currentPrice`
  - Address variables: `tokenAddress`, `pairAddress`, `targetToken`
  - Configuration: `CONFIG` object (single exported config object)

**Types:**
- PascalCase for type definitions and interfaces: `SupportedNetwork`, `State`, `TransactionRequest`
- Example in `src/config.ts` line 11: `export type SupportedNetwork = keyof typeof rpc;`
- Type annotations on function parameters and return types (see `retry.ts` for `Promise<T>` pattern)

## Code Style

**Formatting:**
- TypeScript with ES2022 target (see `tsconfig.json`: `"target": "ES2022"`)
- 4-space indentation (inferred from code samples)
- No external formatter configured (no .prettierrc or .eslintrc found)
- Semicolons used consistently throughout

**Linting:**
- No linting configuration file present in project root
- No ESLint or Biome configuration detected
- Project relies on TypeScript strict mode for type safety
  - From `tsconfig.json`: `"strict": true`, `"isolatedModules": true`, `"forceConsistentCasingInFileNames": true`

## Import Organization

**Order:**
1. External libraries (ethers, axios, dotenv, telegram)
2. Configuration imports (CONFIG from ./config)
3. Utility imports from own ./utils
4. Type imports

**Pattern example from `src/bot.ts` lines 1-19:**
```typescript
import { ethers, Contract } from "ethers";
import { CONFIG } from "./config";
import { getGasOptions } from "./utils/gasManager";
import {
    checkTokenMetadata,
    isLiquidityLocked,
    // ... batch imports grouped
} from "./utils/tokenSafety";
import { BLOCKLIST } from "./utils/blocklist";
import { sendTelegramAlert } from "./utils/notifier";
```

**Path Aliases:**
- No alias configuration in `tsconfig.json`
- Uses relative paths exclusively: `./config`, `./utils/*`

## Error Handling

**Patterns:**
- try-catch blocks for async operations
- Errors logged with console methods (console.warn, console.error, console.log)
- Fallback mechanisms: See `src/utils/tokenSafety.ts` lines 36-61 (honeypot check with API fallback to static call)
- Type-safe error handling: In `src/utils/txManager.ts` line 47, checks for error property with discriminated union: `if ("error" in bundle)`
- Error messages include emoji prefixes for visual distinction:
  - `❌` for failures
  - `⚠️` for warnings
  - `🚨` for critical errors

**Examples:**
- API error handling with fallback: `src/utils/tokenSafety.ts` lines 38-61
- Retry wrapper with error propagation: `src/utils/retry.ts` lines 9-20
- Transaction error handling with user notification: `src/bot.ts` lines 337-341

## Logging

**Framework:** console methods (console.log, console.warn, console.error)

**Patterns:**
- Timestamped logs via `log()` helper in `src/utils/logger.ts`:
  ```typescript
  export function log(message: string) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] ${message}`);
  }
  ```
- Inline console calls throughout codebase for immediate logging
- Prefix-based logging levels:
  - `[BOT]` prefix in `src/bot.ts` line 44
  - Emoji prefixes for different log types (📉, 🚨, 🛑, ✅, 🔍, etc.)
- Telegram alerts for important events: `sendTelegramAlert()` called after major state changes

## Comments

**When to Comment:**
- Inline comments for temporary workarounds: `src/bot.ts` lines 236-243 show disabled sell simulation with `// TEMPORARY: Disabled...`
- Comments for non-obvious logic: `src/telegramListener.ts` lines 34, 40 mark debug logging "remove later"
- Section comments for major logic blocks: `src/telegramListener.ts` lines 47-58 explain throttling with 🛑 and 🕒 emojis
- No extensive docstrings; code is self-documenting through naming

**JSDoc/TSDoc:**
- Not used in codebase
- Type annotations sufficient for TypeScript compilation and IDE support

## Function Design

**Size:**
- Generally under 50 lines (most functions in `src/utils/` are 15-30 lines)
- Larger orchestration functions: `handleNewPair()` in `src/bot.ts` is 137 lines (lines 205-342)
- Monitor functions create interval-based patterns: `monitorStopLoss()` and `monitorTakeProfit()` are ~60 lines each

**Parameters:**
- Mix of positional and named parameters
- Configuration via CONFIG object rather than function parameters
- Promise-returning functions for async operations
- Generic type parameters in utility functions: `retry<T>()` in `src/utils/retry.ts` line 1

**Return Values:**
- Promise-based async functions: `Promise<boolean>`, `Promise<void>`, `Promise<T>`
- Some functions return null/undefined on failure: `initialOut` check in `src/bot.ts` line 59
- Direct value returns from synchronous functions: boolean checks like `isAlreadySniped()` in `src/utils/storage.ts`

## Module Design

**Exports:**
- Named exports for utility functions: `export async function`, `export function`
- Single default export rarely used
- Configuration exported as named constant: `export const CONFIG` in `src/config.ts`

**Barrel Files:**
- No barrel files (index.ts re-exports) in codebase
- Direct imports from specific modules: `import { handleNewPair } from "./bot"`

**Module Organization:**
- `src/config.ts` - Configuration and environment variables
- `src/bot.ts` - Main bot logic and pair handling
- `src/utils/` - Cross-cutting utilities:
  - `tokenSafety.ts` - Token validation checks (honeyp pot, blacklist, liquidity)
  - `txManager.ts` - Transaction management with retries
  - `gasManager.ts` - Gas price calculation
  - `notifier.ts` - Telegram notifications
  - `storage.ts` - In-memory state persistence
  - `retry.ts` - Generic retry logic
  - `flashbots.ts` - Flashbots provider setup
  - `blocklist.ts` - Blocklist data structures
  - `logger.ts` - Logging utility
- `scripts/` - One-off automation scripts
- `src/alphaDrop.ts` - Alpha drop handling
- `src/telegramListener.ts` - Telegram message listening and routing

---

*Convention analysis: 2026-03-19*
