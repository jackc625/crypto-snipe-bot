# Phase 1: Bug Fixes & Hardening - Research

**Researched:** 2026-03-19
**Domain:** Node.js/TypeScript concurrency, Flashbots bundle API, Telegram GramJS event filtering, process lifecycle management
**Confidence:** HIGH

## Summary

Phase 1 fixes nine known bugs and hardening gaps in the existing single-chain Ethereum sniper bot. The codebase is TypeScript/Node.js (ethers v5, CommonJS) with no test infrastructure. The bugs fall into four categories: (1) race conditions between exit mechanisms causing double-sells, (2) Flashbots misconfiguration preventing bundle retries and testnet operation, (3) missing safety checks and input validation, and (4) absent process lifecycle management (shutdown, startup validation, Telegram sender filtering).

All fixes operate within existing code files. No new dependencies are strictly required -- the per-token mutex can be implemented with a simple `Map<string, boolean>` flag pattern since JavaScript is single-threaded and the race condition occurs between async callbacks, not true threads. The `async-mutex` package (v0.5.0) is an option if more formal locking semantics are desired, but a lightweight in-memory flag with `Map<string, boolean>` is sufficient and avoids adding dependencies in a bug-fix phase.

**Primary recommendation:** Fix each bug in isolation with minimal cross-cutting changes. The mutex pattern, interval/timeout registry, and shutdown handler are the three structural additions; everything else is point fixes to existing functions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Exit conflict resolution:** Shared per-token mutex -- first exit mechanism to acquire the lock proceeds; others see the flag and skip
- **On sell TX failure:** Alert via Telegram with error details, mark position as 'failed', stop all monitoring for that token -- no automatic retry
- **Balance check every poll:** Each 15s monitoring loop checks wallet balance for the token; if zero, clear interval and stop monitoring
- **Graceful shutdown on SIGTERM/SIGINT:** Clear all intervals/timeouts, flush state to disk, exit cleanly within 5 seconds -- do NOT attempt to sell open positions
- **Resume monitoring on restart:** Read persisted state, find tokens with status 'pending', restart stop-loss/take-profit/timed-sell loops for them
- **Timed sell on resume:** Reset the timer to a fresh duration (don't calculate remaining time from buy timestamp)
- **Telegram whitelist:** `TELEGRAM_ALLOWED_SENDERS` (comma-separated user IDs) and `TELEGRAM_ALLOWED_CHANNELS` (comma-separated channel/group IDs) as env vars
- **Non-whitelisted messages:** Log sender ID and message snippet at debug level, then drop -- no Telegram alert, no silent discard
- **Sell simulation:** Always-on in production, no toggle, no bypass. Hard block on failure -- buy skipped with Telegram alert

### Claude's Discretion
- Post-sell cleanup strategy (immediate cleanup vs. fallback loops)
- Sell simulation method choice (fee-on-transfer only vs. both methods)
- Exact mutex implementation pattern
- Error message formatting for startup validation failures

### Deferred Ideas (OUT OF SCOPE)
- Timed sell duration tuning (currently 5 min, may need 15-30 min) -- Phase 7
- Emergency sell-all-positions on shutdown -- may be revisited in later phases
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FIX-01 | Stop-loss and take-profit cannot fire simultaneously -- mutex-based exit mediation | Per-token selling flag in `Map<string, boolean>`, checked before any sell TX. See Architecture Pattern 1. |
| FIX-02 | Flashbots relay network selected dynamically, not hardcoded to mainnet | `FlashbotsBundleProvider.create()` 3rd param is relay URL, 4th is network name. Map from `CONFIG.network`. See Flashbots Relay Config section. |
| FIX-03 | Nonce increments on each Flashbots bundle retry | Add `nonce + retries` in the retry loop in `txManager.ts`. Currently nonce is fetched once before loop. See Pitfall 2. |
| FIX-04 | Sell simulation re-enabled and runs before every buy | Uncomment `simulateSell` in `bot.ts:236-243`, restore the early-return logic with Telegram alert on failure. |
| FIX-05 | Graceful shutdown -- clear intervals, timeouts, flush state | Interval/timeout registry + `process.on('SIGTERM'/'SIGINT')` handler. See Architecture Pattern 2. |
| FIX-06 | Startup env var validation with clear error messages | Validation function in `config.ts` checking all required vars before CONFIG export. See Architecture Pattern 3. |
| FIX-07 | Timed sell timeout cancelled when position already sold | Store timeout IDs per token in registry; cancel on status change to 'sold'. Linked to FIX-01 mutex. |
| FIX-08 | Monitoring loops exit on zero token balance | Add `balance.isZero()` check at start of each interval callback, call `clearInterval` and update status. |
| FIX-09 | Telegram listener only processes whitelisted sender IDs | Check `event.message.senderId` and `event.chatId` against env var whitelist. See Architecture Pattern 4. |
</phase_requirements>

## Standard Stack

### Core (Already in Use -- No Changes)
| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| ethers | 5.7.2 | Blockchain interaction | v5 -- migration is Phase 2, not Phase 1 |
| @flashbots/ethers-provider-bundle | 0.6.1 | MEV-protected bundle submission | ethers v5 compatible; v1.0.0 is Phase 2 |
| telegram (GramJS) | 2.26.22 | Telegram client for alpha drops | Provides NewMessage event filtering |
| dotenv | 17.2.0 | Environment variable loading | Already used in config.ts |
| typescript | 5.8.3 | Type checking and compilation | strict mode enabled |

### Supporting (No New Dependencies Needed)
| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| Node.js built-in `process` | N/A | Signal handling (SIGTERM/SIGINT) | No import needed |
| Node.js built-in `fs` | N/A | State persistence | Already used in storage.ts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Simple Map flag for mutex | `async-mutex` 0.5.0 | async-mutex adds formal Mutex/Semaphore semantics but is overkill for single-threaded per-token flag; Map is sufficient |
| Manual interval registry | `node-cleanup` npm package | Adds dependency for something achievable in ~20 lines |

**No new packages to install for Phase 1.** All fixes use existing dependencies and Node.js built-ins.

## Architecture Patterns

### Recommended Project Structure (Changes Only)
```
src/
  bot.ts                  # Modified: add mutex, interval/timeout registry, balance checks
  config.ts               # Modified: add env var validation function
  telegramListener.ts     # Modified: add sender/channel whitelist check
  utils/
    txManager.ts          # Modified: increment nonce on retry
    flashbots.ts          # Modified: dynamic relay URL + network selection
    storage.ts            # Modified: export flushState(), expose state for resume
    exitManager.ts        # NEW: per-token mutex, interval/timeout registry, shutdown handler
```

### Pattern 1: Per-Token Selling Mutex (FIX-01, FIX-07)

**What:** A `Map<string, boolean>` tracks whether a sell is in progress for each token. Before any sell (stop-loss, take-profit, timed sell), the code checks this flag. First to set it wins; others bail out.

**When to use:** Before every sell transaction attempt.

**Why a simple Map works:** JavaScript is single-threaded. The "race" happens when two async interval callbacks both evaluate their sell condition as true in rapid succession. The check-and-set on the Map is synchronous and atomic within a single event loop tick.

```typescript
// src/utils/exitManager.ts
const sellingTokens = new Map<string, boolean>();

export function tryAcquireSellLock(tokenAddress: string): boolean {
    const key = tokenAddress.toLowerCase();
    if (sellingTokens.get(key)) return false;
    sellingTokens.set(key, true);
    return true;
}

export function releaseSellLock(tokenAddress: string): void {
    sellingTokens.delete(tokenAddress.toLowerCase());
}

// Usage in monitorStopLoss, monitorTakeProfit, scheduleTimedSell:
if (!tryAcquireSellLock(tokenAddress)) {
    clearInterval(interval); // or clearTimeout for timed sell
    log("Another exit already handling this token. Skipping.");
    return;
}
// ... do the sell ...
// On success: update status to "sold", clean up ALL intervals/timeouts for this token
// On failure: send Telegram alert, mark "failed", clean up ALL intervals/timeouts
// releaseSellLock is optional -- once sold/failed, the token is done
```

### Pattern 2: Interval/Timeout Registry + Shutdown Handler (FIX-05, FIX-07, FIX-08)

**What:** A central registry tracks all active `setInterval` and `setTimeout` handles keyed by token address. The shutdown handler iterates this registry and clears everything.

```typescript
// src/utils/exitManager.ts
interface TokenTimers {
    stopLossInterval?: ReturnType<typeof setInterval>;
    takeProfitInterval?: ReturnType<typeof setInterval>;
    timedSellTimeout?: ReturnType<typeof setTimeout>;
}

const timerRegistry = new Map<string, TokenTimers>();

export function registerStopLoss(token: string, interval: ReturnType<typeof setInterval>): void {
    const key = token.toLowerCase();
    const entry = timerRegistry.get(key) || {};
    entry.stopLossInterval = interval;
    timerRegistry.set(key, entry);
}

// Similar for registerTakeProfit, registerTimedSell

export function clearAllTimersForToken(token: string): void {
    const key = token.toLowerCase();
    const entry = timerRegistry.get(key);
    if (!entry) return;
    if (entry.stopLossInterval) clearInterval(entry.stopLossInterval);
    if (entry.takeProfitInterval) clearInterval(entry.takeProfitInterval);
    if (entry.timedSellTimeout) clearTimeout(entry.timedSellTimeout);
    timerRegistry.delete(key);
}

export function clearAllTimers(): void {
    for (const [token] of timerRegistry) {
        clearAllTimersForToken(token);
    }
}
```

**Shutdown handler:**
```typescript
// src/utils/exitManager.ts (or bottom of bot.ts)
import { flushState } from './storage';

let isShuttingDown = false;

function gracefulShutdown(signal: string): void {
    if (isShuttingDown) return; // prevent double-shutdown
    isShuttingDown = true;
    console.log(`[SHUTDOWN] Received ${signal}. Cleaning up...`);

    // 1. Clear all monitoring timers
    clearAllTimers();

    // 2. Remove blockchain event listeners
    factory.removeAllListeners();

    // 3. Flush state to disk
    flushState();

    console.log(`[SHUTDOWN] Cleanup complete. Exiting.`);
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Safety net: force exit after 5 seconds
process.on('SIGTERM', () => {
    setTimeout(() => {
        console.error('[SHUTDOWN] Force exit after 5s timeout');
        process.exit(1);
    }, 5000).unref();
});
```

**Key detail:** Use `.unref()` on the safety-net timeout so it doesn't keep the event loop alive.

### Pattern 3: Startup Environment Validation (FIX-06)

**What:** A validation function that checks all required env vars before the CONFIG object is used. Fails fast with a clear list of what's missing.

```typescript
// src/config.ts
interface EnvVarSpec {
    name: string;
    required: boolean;
    description: string;
    validate?: (value: string) => boolean;
}

const REQUIRED_ENV_VARS: EnvVarSpec[] = [
    { name: 'PRIVATE_KEY', required: true, description: 'Wallet private key for signing transactions' },
    { name: 'ALCHEMY_URL', required: true, description: 'Alchemy RPC endpoint URL' },
    { name: 'TELEGRAM_BOT_TOKEN', required: true, description: 'Telegram bot token for alerts' },
    { name: 'TELEGRAM_CHAT_ID', required: true, description: 'Telegram chat ID for alerts' },
    { name: 'TELEGRAM_API_ID', required: true, description: 'Telegram API ID for listener' },
    { name: 'TELEGRAM_API_HASH', required: true, description: 'Telegram API hash for listener' },
    { name: 'TELEGRAM_SESSION', required: true, description: 'Telegram session string' },
    { name: 'FLASHBOTS_AUTH_KEY', required: true, description: 'Flashbots authentication signing key' },
    { name: 'TELEGRAM_ALLOWED_SENDERS', required: false, description: 'Comma-separated allowed Telegram sender IDs' },
    { name: 'TELEGRAM_ALLOWED_CHANNELS', required: false, description: 'Comma-separated allowed Telegram channel/group IDs' },
];

function validateEnvVars(): void {
    const missing: string[] = [];
    for (const spec of REQUIRED_ENV_VARS) {
        if (spec.required && !process.env[spec.name]) {
            missing.push(`  - ${spec.name}: ${spec.description}`);
        }
    }
    if (missing.length > 0) {
        console.error(`\n[STARTUP ERROR] Missing required environment variables:\n${missing.join('\n')}\n`);
        console.error('Create a .env file with these variables or set them in your environment.\n');
        process.exit(1);
    }
}

// Call at module load time, before CONFIG is constructed
validateEnvVars();
```

### Pattern 4: Telegram Sender Whitelist (FIX-09)

**What:** Parse `TELEGRAM_ALLOWED_SENDERS` and `TELEGRAM_ALLOWED_CHANNELS` from env, check each incoming message against these lists.

**Key technical detail:** GramJS `message.senderId` is a `BigInteger` from the `big-integer` library (not native `bigint`). `event.chatId` is also `BigInteger | undefined`. Comparisons must use `.toString()` or `.equals()`.

```typescript
// src/telegramListener.ts

// Parse whitelist from env
const allowedSenders = new Set(
    (process.env.TELEGRAM_ALLOWED_SENDERS || '').split(',').map(s => s.trim()).filter(Boolean)
);
const allowedChannels = new Set(
    (process.env.TELEGRAM_ALLOWED_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean)
);

// In the event handler, before processing:
const senderId = event.message.senderId?.toString();
const chatId = event.chatId?.toString();

const senderAllowed = senderId && allowedSenders.has(senderId);
const channelAllowed = chatId && allowedChannels.has(chatId);

if (!senderAllowed && !channelAllowed) {
    // Log at debug level per user decision
    console.debug(`[TELEGRAM] Rejected message from sender=${senderId} chat=${chatId}: ${messageText?.substring(0, 50)}...`);
    return;
}
```

**Note on `chats` parameter in NewMessage:** GramJS `NewMessage` constructor accepts `chats` and `fromUsers` parameters for built-in filtering. However, the user decision specifies rejecting with a debug log, which requires a manual check inside the handler (built-in filtering silently drops messages). Use manual check to satisfy the logging requirement.

### Pattern 5: Flashbots Dynamic Relay Configuration (FIX-02)

**What:** Map `CONFIG.network` to the correct relay URL and network name for `FlashbotsBundleProvider.create()`.

```typescript
// src/utils/flashbots.ts
import { CONFIG, SupportedNetwork } from "../config";

const FLASHBOTS_RELAYS: Record<string, { url: string; network: string }> = {
    sepolia: { url: "https://relay-sepolia.flashbots.net", network: "sepolia" },
    mainnet: { url: "https://relay.flashbots.net", network: "mainnet" },
};

export async function getFlashbotsProvider(
    provider: providers.JsonRpcProvider,
    authSigner: Wallet
): Promise<FlashbotsBundleProvider> {
    const relay = FLASHBOTS_RELAYS[CONFIG.network];
    if (!relay) {
        throw new Error(`No Flashbots relay configured for network: ${CONFIG.network}`);
    }
    return await FlashbotsBundleProvider.create(
        provider,
        authSigner,
        relay.url,
        relay.network
    );
}
```

**Verified:** `FlashbotsBundleProvider.create()` signature is `create(genericProvider: BaseProvider, authSigner: Signer, connectionInfoOrUrl?: ConnectionInfo | string, network?: Networkish)`. The 3rd parameter accepts a URL string; the 4th accepts a string network name. If no URL provided, defaults to `https://relay.flashbots.net` (mainnet). Source: `node_modules/@flashbots/ethers-provider-bundle/build/index.d.ts:198`.

### Pattern 6: Nonce Increment on Retry (FIX-03)

**What:** In `txManager.ts`, the nonce is fetched once before the retry loop. On each retry, the nonce must increment.

```typescript
// src/utils/txManager.ts -- fix in retry loop
const baseNonce = await provider.getTransactionCount(wallet.address, "latest");

let retries = 0;
while (retries <= maxRetries) {
    const currentNonce = baseNonce + retries; // Increment per retry

    const populatedTx: TransactionRequest = {
        ...txRequest,
        gasLimit,
        gasPrice,
        nonce: currentNonce,  // Use incrementing nonce
        chainId: (await provider.getNetwork()).chainId,
    };
    // ...
}
```

### Anti-Patterns to Avoid
- **Don't use `async-mutex` for the token selling lock:** Adds a dependency for a problem solvable with a synchronous Map check. The "race" is between async callbacks, not threads.
- **Don't register shutdown handlers inside interval callbacks:** Register once at startup. Multiple registrations cause multiple cleanup attempts.
- **Don't use `process.exit()` without flushing state:** Always call `flushState()` before `process.exit()`. `writeFileSync` is blocking, so it completes before exit.
- **Don't compare BigInteger directly with `===`:** GramJS uses the `big-integer` library. Use `.toString()` for comparisons with string IDs from env vars.
- **Don't use `NewMessage({ fromUsers: [...], chats: [...] })` for the whitelist:** The built-in filtering silently drops messages without logging. The user decision requires debug-level logging of rejected messages, so manual filtering inside the handler is necessary.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exponential backoff retry | Custom retry loop | `src/utils/retry.ts` (already exists) | Already implements configurable retries with backoff factor |
| Telegram notifications | Custom HTTP calls | `src/utils/notifier.ts` `sendTelegramAlert()` | Already handles bot token, chat ID, error recovery |
| Token status tracking | Custom file format | `src/utils/storage.ts` `updateTokenStatus()` | Already supports 'pending'/'sold'/'failed' states |
| Flashbots provider | Direct relay API calls | `@flashbots/ethers-provider-bundle` | Already handles bundle signing, submission, response parsing |

**Key insight:** Phase 1 should reuse existing utilities aggressively. The bugs are in how these utilities are called (wrong parameters, missing calls, no coordination), not in the utilities themselves.

## Common Pitfalls

### Pitfall 1: Double-Shutdown Race
**What goes wrong:** Both SIGTERM and SIGINT fire in quick succession (e.g., Ctrl+C in Docker). Two shutdown handlers run concurrently, potentially double-flushing state.
**Why it happens:** Node.js can receive both signals. Each calls the handler.
**How to avoid:** Use an `isShuttingDown` boolean flag. First handler to set it proceeds; second handler returns immediately.
**Warning signs:** "Cleanup complete" logged twice; corrupted state file.

### Pitfall 2: Nonce Gap on Retry
**What goes wrong:** If `baseNonce + retries` creates a gap (e.g., another TX was submitted externally), the bundle will never be included.
**Why it happens:** External nonce changes between retries.
**How to avoid:** Re-fetch nonce from provider on each retry attempt OR use `baseNonce + retries` (simpler, works when bot is only nonce consumer). Given the bot is the sole user of this wallet, `baseNonce + retries` is safe.
**Warning signs:** "Bundle NOT included" on every retry attempt.

### Pitfall 3: BigInteger Comparison in Telegram Whitelist
**What goes wrong:** `event.message.senderId === '12345'` returns false because `senderId` is a `BigInteger` object, not a string or number.
**Why it happens:** GramJS uses the `big-integer` library for all IDs.
**How to avoid:** Always call `.toString()` on `senderId` and `chatId` before comparing to whitelist entries.
**Warning signs:** All messages rejected even from whitelisted senders.

### Pitfall 4: Unregistered Timeout from `scheduleTimedSell`
**What goes wrong:** `setTimeout` in `scheduleTimedSell` is not stored anywhere, so it cannot be cancelled when stop-loss or take-profit fires first.
**Why it happens:** The current code calls `setTimeout` and discards the returned timeout ID.
**How to avoid:** Store the timeout ID in the timer registry. When any exit mechanism fires, call `clearAllTimersForToken()`.
**Warning signs:** "Timed sell TX sent" logged after "Stop-loss TX confirmed" for the same token.

### Pitfall 5: `writeFileSync` During Shutdown
**What goes wrong:** If the state file is being written by a monitoring callback when shutdown starts, the shutdown handler's `flushState()` could interleave and corrupt the file.
**Why it happens:** `writeFileSync` in the monitoring callback is blocking, but it started from an async context that was interrupted.
**How to avoid:** In practice this is extremely unlikely in Node.js single-threaded model -- `writeFileSync` is atomic within a single event loop tick. But the shutdown handler should check `isShuttingDown` before allowing new writes.
**Warning signs:** Corrupted or empty `.bot-state.json` after restart.

### Pitfall 6: Missing `factory.removeAllListeners()` on Shutdown
**What goes wrong:** The `PairCreated` event listener continues firing during shutdown, triggering new buy attempts while cleanup is in progress.
**Why it happens:** Only intervals and timeouts are cleared; the ethers event listener is forgotten.
**How to avoid:** Store the factory contract reference where the shutdown handler can access it. Call `factory.removeAllListeners()` as the first step in shutdown.
**Warning signs:** "New pair detected" log messages appearing after "Shutting down" message.

## Code Examples

### Sell with Mutex + Cleanup (Full Pattern)
```typescript
// Source: Derived from existing bot.ts structure + user decisions
async function executeSell(
    tokenAddress: string,
    reason: 'stop-loss' | 'take-profit' | 'timed-sell'
): Promise<void> {
    if (!tryAcquireSellLock(tokenAddress)) {
        log(`[${reason}] Another exit already handling ${tokenAddress}. Skipping.`);
        return;
    }

    try {
        const token = new Contract(tokenAddress, erc20Abi, wallet);
        const balance = await token.balanceOf(wallet.address);

        if (balance.isZero()) {
            log(`[${reason}] Zero balance for ${tokenAddress}. Cleaning up.`);
            updateTokenStatus(tokenAddress, "sold");
            clearAllTimersForToken(tokenAddress);
            return;
        }

        await maybeApprove(token, balance);
        const deadline = Math.floor(Date.now() / 1000) + 60;
        const path = [tokenAddress, CONFIG.wethAddress];

        const sellTx = await router.swapExactTokensForETH(
            balance, 0, path, wallet.address, deadline,
            { gasLimit: CONFIG.gasLimit || 300000, gasPrice: await provider.getGasPrice() }
        );

        log(`[${reason}] Sell TX sent: ${sellTx.hash}`);
        await sendTelegramAlert(`*${reason} sell TX sent:* [View](https://etherscan.io/tx/${sellTx.hash})`);
        await sellTx.wait();

        updateTokenStatus(tokenAddress, "sold");
        clearAllTimersForToken(tokenAddress);
        await sendTelegramAlert(`*${reason} TX confirmed*`);

    } catch (e) {
        log(`[${reason}] Sell failed for ${tokenAddress}:`, e);
        updateTokenStatus(tokenAddress, "failed");
        clearAllTimersForToken(tokenAddress);
        await sendTelegramAlert(`*${reason} sell failed:* ${e instanceof Error ? e.message : String(e)}`);
    }
}
```

### State Resume on Restart
```typescript
// Source: Derived from user decision on restart behavior
import { getState } from './utils/storage';

function resumeMonitoring(): void {
    const state = getState();
    for (const [token, info] of Object.entries(state.sniped)) {
        if (info.status === 'pending') {
            log(`[RESUME] Restarting monitoring for ${token}`);
            monitorStopLoss(token, CONFIG.snipeAmountETH);
            monitorTakeProfit(token, CONFIG.snipeAmountETH);
            scheduleTimedSell(token); // Fresh timer per user decision
        }
    }
}
```

### Storage: Expose State + Flush
```typescript
// src/utils/storage.ts -- additions
export function getState(): State {
    return state;
}

export function flushState(): void {
    persist(); // writeFileSync -- blocks until complete
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flashbots Goerli relay | Flashbots Sepolia relay | 2023 (Goerli deprecated) | Goerli relay still exists but Sepolia is the current testnet |
| `ethers.utils.parseEther` (v5) | `ethers.parseEther` (v6) | ethers v6 (2023) | Phase 2 concern, not Phase 1 |
| BigNumber (ethers v5) | native BigInt (ethers v6) | ethers v6 (2023) | Phase 2 concern, not Phase 1 |

**Deprecated/outdated:**
- Goerli testnet relay: `https://relay-goerli.flashbots.net` -- deprecated, use Sepolia
- The `"mainnet"` string hardcoded in `flashbots.ts:12` -- must be dynamic

## Open Questions

1. **BSC Flashbots equivalent**
   - What we know: `CONFIG.network` supports "bsc" but there is no Flashbots relay for BSC
   - What's unclear: Whether `sendTxWithRetry` should fall back to direct send on non-Flashbots chains
   - Recommendation: For Phase 1, only fix mainnet/sepolia relay selection. BSC MEV protection is Phase 4 scope.

2. **Sell simulation method**
   - What we know: `simulateSell()` exists in `tokenSafety.ts`. User wants it always-on.
   - What's unclear: Whether to call both standard swap simulation and fee-on-transfer variant, or just fee-on-transfer
   - Recommendation (Claude's discretion): Try fee-on-transfer variant first (covers more tokens). If it passes, token is sellable. If it fails, try standard. This maximizes detection without blocking legitimate tokens.

3. **Resume: what if token was rugged during downtime?**
   - What we know: On restart, pending tokens get fresh monitoring loops
   - What's unclear: Whether to check current balance before resuming (token may have been rugged or balance transferred)
   - Recommendation: Check balance before resuming monitoring. If zero, mark as 'failed' and skip.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected -- no test files exist in the project |
| Config file | None -- see Wave 0 |
| Quick run command | `npx hardhat test` (Hardhat+Mocha+Chai already in devDependencies) |
| Full suite command | `npx hardhat test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIX-01 | Mutex prevents double-sell | unit | `npx hardhat test test/exitManager.test.ts --grep "mutex"` | No -- Wave 0 |
| FIX-02 | Dynamic Flashbots relay URL | unit | `npx hardhat test test/flashbots.test.ts --grep "relay"` | No -- Wave 0 |
| FIX-03 | Nonce increments on retry | unit | `npx hardhat test test/txManager.test.ts --grep "nonce"` | No -- Wave 0 |
| FIX-04 | Sell simulation blocks bad tokens | unit | `npx hardhat test test/bot.test.ts --grep "simulation"` | No -- Wave 0 |
| FIX-05 | Graceful shutdown clears timers | unit | `npx hardhat test test/exitManager.test.ts --grep "shutdown"` | No -- Wave 0 |
| FIX-06 | Missing env vars produce clear errors | unit | `npx hardhat test test/config.test.ts --grep "validation"` | No -- Wave 0 |
| FIX-07 | Timed sell cancelled on prior exit | unit | `npx hardhat test test/exitManager.test.ts --grep "timed"` | No -- Wave 0 |
| FIX-08 | Zero balance stops monitoring | unit | `npx hardhat test test/bot.test.ts --grep "balance"` | No -- Wave 0 |
| FIX-09 | Non-whitelisted messages rejected | unit | `npx hardhat test test/telegramListener.test.ts --grep "whitelist"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx hardhat test` (full suite -- small codebase)
- **Per wave merge:** `npx hardhat test` (same, until suite grows)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/` directory -- create it
- [ ] `test/exitManager.test.ts` -- covers FIX-01, FIX-05, FIX-07
- [ ] `test/flashbots.test.ts` -- covers FIX-02
- [ ] `test/txManager.test.ts` -- covers FIX-03
- [ ] `test/bot.test.ts` -- covers FIX-04, FIX-08
- [ ] `test/config.test.ts` -- covers FIX-06
- [ ] `test/telegramListener.test.ts` -- covers FIX-09

**Note:** Mocha + Chai already present in devDependencies. Hardhat test runner works with Mocha. No additional test framework installation needed. Tests for pure logic (mutex, config validation, whitelist filtering) do not need Hardhat network -- plain Mocha/Chai is sufficient. Tests for blockchain interaction (sell simulation, balance checks) can use Hardhat network.

## Sources

### Primary (HIGH confidence)
- `node_modules/@flashbots/ethers-provider-bundle/build/index.d.ts` -- `FlashbotsBundleProvider.create()` signature verified directly from installed package
- `node_modules/@flashbots/ethers-provider-bundle/src/index.ts:250-275` -- Create method implementation confirming relay URL and network parameters
- `node_modules/telegram/events/NewMessage.d.ts` -- `NewMessageInterface` with `fromUsers`, `chats`, `blacklistChats` parameters
- `node_modules/telegram/tl/custom/senderGetter.d.ts` -- `senderId` is `bigInt.BigInteger` type
- `node_modules/telegram/tl/custom/chatGetter.d.ts` -- `chatId` is `bigInt.BigInteger | undefined` type
- [Flashbots Testnets Documentation](https://docs.flashbots.net/flashbots-auction/advanced/testnets) -- Sepolia relay URL `https://relay-sepolia.flashbots.net`
- [Flashbots RPC Endpoints](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint) -- Mainnet relay URL `https://relay.flashbots.net`

### Secondary (MEDIUM confidence)
- [async-mutex npm](https://www.npmjs.com/package/async-mutex) -- v0.5.0 current, TypeScript-native mutex (not recommended for Phase 1)
- [GramJS NewMessage docs](https://gram.js.org/beta/interfaces/custom.NewMessageInterface.html) -- `fromUsers` and `chats` parameters for event filtering
- [Node.js Graceful Shutdown patterns](https://dev.to/yusadolat/nodejs-graceful-shutdown-a-beginners-guide-40b6) -- SIGTERM/SIGINT handler patterns

### Tertiary (LOW confidence)
- None -- all findings verified against installed packages or official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies; all existing packages verified from node_modules
- Architecture: HIGH -- patterns derived from direct code analysis of existing codebase and verified API signatures
- Pitfalls: HIGH -- identified from actual bugs in the codebase with specific line numbers
- Validation: MEDIUM -- test framework exists in devDependencies but no tests exist yet; test commands untested

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable domain -- existing bug fixes, no fast-moving dependencies)
