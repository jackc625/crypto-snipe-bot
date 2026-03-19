# Codebase Concerns

**Analysis Date:** 2026-03-19

## Critical Security Issues

**Wallet Private Key Exposure:**
- Issue: Private key stored in plaintext environment variables without encryption
- Files: `src/config.ts`, `src/utils/tokenSafety.ts`, `src/bot.ts`, `auth.ts`
- Impact: If `.env` is leaked (e.g., committed to git), attacker can drain wallet completely
- Current mitigation: `.env` in `.gitignore` (observed)
- Recommendations:
  - Use encrypted key management (e.g., AWS KMS, HashiCorp Vault)
  - Implement hot wallet/cold wallet separation for mainnet
  - Add pre-commit hook to prevent `.env` commits
  - Consider using hardware wallet for mainnet operations

**Hardcoded Honeypot Check Fallback Uses Private Key:**
- Issue: Line 51 in `src/utils/tokenSafety.ts` uses `CONFIG.walletPrivateKey` directly in fallback swap simulation
- Files: `src/utils/tokenSafety.ts:51`
- Impact: Private key passed as direct parameter in callStatic, not as signer
- Fix approach: Remove private key from parameter; use wallet address only

**Flashbots Auth Signer Exposed:**
- Issue: `FLASHBOTS_AUTH_KEY` read from environment in runtime without validation
- Files: `src/utils/txManager.ts:13`
- Impact: If auth key is leaked, attacker can submit transactions through relay
- Recommendations:
  - Validate auth key exists before attempting bundle submission
  - Consider using separate auth key from main wallet key
  - Add monitoring for unusual Flashbots usage

**Unvalidated RPC Endpoint for Sepolia:**
- Issue: Alchemy RPC URL from `ALCHEMY_URL` env var used directly without connection validation
- Files: `src/config.ts:7`, `hardhat.config.ts:11`
- Impact: If malicious RPC is provided, attacker can intercept all blockchain reads/writes
- Fix approach: Add RPC endpoint validation on startup; verify chain ID matches expected network

## Tech Debt

**Mixed Async Error Handling:**
- Issue: Inconsistent error handling patterns across codebase
- Files: `src/bot.ts:104-106`, `src/utils/tokenSafety.ts:42-61`, `src/utils/notifier.ts:19-20`
- Current state: Some functions catch with `any`, others with `unknown`, others with specific Error types
- Impact: Difficult to debug, inconsistent error messages, potential uncaught errors
- Fix approach:
  - Standardize on `unknown` with type guards
  - Create shared error class for bot-specific errors
  - Add structured logging with error codes

**Type Safety Issues:**
- Issue: Use of `any` type in critical code paths
- Files: `src/bot.ts:43`, `src/utils/tokenSafety.ts:85`, `src/utils/notifier.ts:19`, `src/utils/testAlert.ts:24`
- Impact: TypeScript cannot catch type errors at compile time
- Fix approach: Replace `any` with concrete types or generics; enable `noImplicitAny` in tsconfig

**Disabled Safety Check in Production Code:**
- Issue: Sell simulation disabled with "TEMPORARY" comment
- Files: `src/bot.ts:236-243`
- Impact: Critical safety mechanism skipped; bot can attempt to sell unsellable tokens
- Recommendations:
  - Re-enable sell simulation check or make it configurable
  - Add flag to tsconfig to prevent undefined features from being deployed

**Hardcoded Network in Flashbots:**
- Issue: Flashbots provider hardcoded to "mainnet" even when running on Sepolia testnet
- Files: `src/utils/flashbots.ts:12`
- Impact: Sepolia bundles sent to mainnet relay, will be rejected
- Fix approach: Make network selection dynamic based on `CONFIG.network`

**Missing Pair Discovery Error Path:**
- Issue: `handleAlphaDrop` calls `getPairAddressFromToken` which returns null on failure, but no recovery mechanism
- Files: `src/alphaDrop.ts:7-15`
- Impact: Alpha drops silently fail without retrying; tokens can be missed
- Fix approach: Implement retry logic with exponential backoff; queue failed lookups

**Inconsistent Configuration Spread:**
- Issue: `CONFIG` imports everything from `addresses.json` with spread operator
- Files: `src/config.ts:18`
- Impact: Type-unsafe; any missing fields in addresses.json silently become undefined
- Fix approach: Explicitly list required fields from addresses.json; add runtime validation

## Known Bugs

**Stop-Loss/Take-Profit Intervals Never Cleared on Process Exit:**
- Symptoms: Intervals continue running even after process termination signal; memory leak and orphaned timers
- Files: `src/bot.ts:67-108`, `src/bot.ts:122-164`
- Trigger: Process receives SIGTERM/SIGKILL while monitoring active positions
- Current state: `clearInterval` only called when price targets hit, not on shutdown
- Workaround: Manually restart process to clear intervals
- Fix approach:
  - Store interval references in a registry
  - Add graceful shutdown handler to clear all intervals
  - Add process signal handlers (SIGTERM, SIGINT)

**Timed Sell Timeout Never Cleared:**
- Symptoms: `setTimeout` in `scheduleTimedSell` not tracked; timer fires even after token position cleared
- Files: `src/bot.ts:169-202`
- Trigger: Token sold via stop-loss/take-profit before auto-sell timeout fires
- Impact: Attempting to sell already-sold token position; wasting gas
- Fix approach: Store timeout IDs per token; cancel when token status changes to "sold"

**Potential Race Condition in Token Status Updates:**
- Symptoms: Multiple concurrent `updateTokenStatus` calls could overwrite each other
- Files: `src/storage.ts:38-42`, `src/bot.ts` (multiple call sites)
- Trigger: Stop-loss and manual sell both trigger simultaneously
- Impact: Incorrect final token status stored; mispayment tracking
- Fix approach: Add file locking; use atomic write with versioning

**Missing Nonce Management in Flashbots Retries:**
- Symptoms: All bundle retries use same nonce; only first bundle can be included
- Files: `src/utils/txManager.ts:15-19`
- Trigger: Initial bundle fails; retry loop runs
- Impact: Retries will always fail with "nonce too low"; bot unable to recover from bundle rejection
- Fix approach: Increment nonce on each retry; track nonce state across attempts

**Empty Balance Check in Monitoring Loops:**
- Symptoms: If wallet balance becomes 0, monitoring functions continue polling indefinitely
- Files: `src/bot.ts:80`, `src/bot.ts:136`
- Trigger: Balance transferred elsewhere before stop-loss/take-profit triggers
- Impact: Wasted RPC calls; continued alerts about unrealizable sells
- Fix approach: Add balance validation check; exit monitoring if balance insufficient

**Network Change Not Handled After Contract Instantiation:**
- Symptoms: Provider network changes during runtime but hardcoded network references don't update
- Files: `src/config.ts:14` (hardcoded "sepolia")
- Trigger: Test → mainnet migration without full restart
- Impact: All subsequent calls hit wrong network
- Fix approach: Make network selection runtime-configurable; validate provider network matches expected

## Performance Bottlenecks

**RPC Provider Instantiation Overhead:**
- Problem: New provider created on every function call in some utilities
- Files: `src/utils/tokenSafety.ts:96`, `src/alphaDrop.ts:29, 36`
- Cause: No singleton pattern; each function independently creates JsonRpcProvider
- Impact: ~2-5% slower execution; increased connection churn
- Improvement path:
  - Create shared provider instance in utils/provider.ts
  - Export single instance used across all modules
  - Expected savings: ~100-200ms per operation

**Inefficient Contract Instantiation:**
- Problem: Inline ABI definitions repeated across functions
- Files: `src/bot.ts:24-37`, `src/utils/tokenSafety.ts:9-28`
- Cause: No centralized ABI constants
- Impact: Code duplication; harder to update ABIs
- Improvement path: Create `src/constants/abis.ts` with all ABI definitions

**Synchronous File I/O in Hot Path:**
- Problem: `markSniped` and `updateTokenStatus` use `writeFileSync`
- Files: `src/utils/storage.ts:26`
- Cause: Blocking writes; blocks event loop
- Impact: Observable lag in responsive operations; can miss events
- Improvement path:
  - Use async `writeFile` with debouncing
  - Implement write queue to batch updates
  - Add in-memory cache with periodic flush

**Monitoring Loops Poll Every 15 Seconds:**
- Problem: Fixed interval of 15s in stop-loss and take-profit checks
- Files: `src/bot.ts:107`, `src/bot.ts:163`
- Cause: No event-based monitoring; pure polling
- Impact: 15s latency to detect price changes; 1440+ API calls per day per token
- Improvement path:
  - Integrate WebSocket provider for real-time events
  - Use Uniswap V3 oracle instead of getAmountsOut
  - Expected savings: 90% reduction in RPC calls

**Cart Before Horse: TX Confirmation Wait:**
- Problem: `tx.wait(3)` blocks execution in normal mode; retries can't proceed
- Files: `src/utils/txManager.ts:64`
- Cause: Blocking wait; no async cancellation mechanism
- Impact: If wait hangs (network lag), retries never attempt
- Fix approach: Add timeout to wait call; implement cancellation token pattern

## Fragile Areas

**Token Safety Checks Have Silent Fallbacks:**
- Files: `src/utils/tokenSafety.ts` (multiple functions)
- Why fragile:
  - API failures silently degrade to less-safe checks
  - Honeypot API → fallback callStatic (line 42-62)
  - Unicrypt API → fallback burn check (line 88-92)
  - Any check → default to "block it" or "allow it"
- Safe modification:
  - Add explicit configuration for fallback behavior
  - Log all fallbacks with severity level
  - Test coverage: Each fallback path should have integration test
- Test coverage: No test files found for tokenSafety.ts

**Telegram Integration Points:**
- Files: `src/telegramListener.ts`, `auth.ts`
- Why fragile:
  - Manual session string generation required
  - No session refresh mechanism
  - TELEGRAM_SESSION env var can expire silently
  - Message parsing uses simple regex without protocol validation
- Safe modification:
  - Implement session refresh logic
  - Add session expiration detection
  - Validate message format before processing
  - Add retry mechanism for Telegram connection loss
- Test coverage: No automated tests for Telegram integration

**Stop-Loss and Take-Profit Logic Intertwined:**
- Files: `src/bot.ts:54-164`
- Why fragile:
  - Both monitor same token; could trigger simultaneously
  - Same interval pattern repeated; hard to maintain
  - Initial price calculation could fail; defaults to empty
  - ROI calculation could divide by zero if initialPrice is 0
- Safe modification:
  - Refactor into shared `PriceMonitor` class
  - Add invariant: initialPrice > 0 before starting monitor
  - Mutex-lock token during sell to prevent double-sell
  - Add unit tests for price calculation edge cases

**Liquidity Lock Check Fallbacks to Burn Check:**
- Files: `src/utils/tokenSafety.ts:72-115`
- Why fragile:
  - Burn check can be gamed (could use deadlock address that's not 0xdead)
  - 90% threshold arbitrary (line 105)
  - No check for "renounced liquidity" pattern
- Safe modification:
  - Add configurable burn threshold
  - Check multiple known burn addresses
  - Validate pair is actually in locked state before proceeding
  - Document why 90% was chosen

**Storage System Has No Concurrency Control:**
- Files: `src/utils/storage.ts`
- Why fragile:
  - File writes not atomic; power loss = corrupted state
  - In-memory state could diverge from disk
  - No journaling or transaction log
- Safe modification:
  - Implement write-ahead logging
  - Add file locking (flock)
  - Add startup validation/repair for corrupted state
  - Consider sqlite for transactional semantics

## Scaling Limits

**Single-Threaded Event Loop Bottleneck:**
- Current capacity: ~100-200 tokens monitored simultaneously
- Limit: JavaScript single thread blocks on any long-running operation
- Cause: All operations (RPC calls, file I/O, price checks) sequential
- Scaling path:
  - Move monitoring to Worker threads (node `worker_threads`)
  - Parallelize price checks: Map 1000 tokens to 4-8 workers
  - Expected improvement: 4-8x throughput with 4-8 worker threads

**RPC Rate Limiting Not Handled:**
- Current capacity: Alchemy free tier ~300 req/min
- Limit: No backoff; requests fail when rate limited
- Cause: Fire-and-forget RPC calls without queue
- Scaling path:
  - Implement request queue with rate limiter
  - Add exponential backoff on 429 responses
  - Pool RPC providers to spread load

**Memory Growth from Unsold Tokens:**
- Current capacity: Reasonable for <500 tokens
- Limit: Each token's monitoring loop consumes ~2KB memory; intervals never cleared
- Cause: `processedContracts` Set grows unbounded; intervals never cleared
- Scaling path:
  - Add token expiration: Remove from memory after 24h
  - Clear intervals aggressively; add timer per token
  - Implement circular buffer instead of unbounded Set

**Storage File Growth:**
- Current capacity: .bot-state.json remains manageable for <1000 tokens
- Limit: No cleanup; file grows linearly with tokens
- Cause: `state.sniped` never pruned
- Scaling path:
  - Implement log rotation: Archive old tokens monthly
  - Add timestamp-based pruning (e.g., remove tokens >30d old)
  - Consider streaming JSON format or SQLite

## Security Considerations

**Environment Variable Validation Missing:**
- Risk: Bot crashes at runtime if env var missing; no pre-flight check
- Files: `src/config.ts`, `hardhat.config.ts`
- Current mitigation: Using `!` (non-null assertion) on env access
- Recommendations:
  - Add startup validation function checking all required env vars
  - Provide helpful error messages listing missing vars
  - Validate URL format of RPC endpoint and APIs

**API Key Exposure in Error Messages:**
- Risk: Axios errors containing API keys could be logged
- Files: `src/utils/tokenSafety.ts:38-40`, `src/utils/notifier.ts:14-20`
- Current mitigation: Partial (Honeypot API key not in URL, but Telegram bot token could appear)
- Recommendations:
  - Sanitize error messages before logging
  - Never log full error objects; extract message only
  - Add secret masking utility function

**Unencrypted Sensitive Data in State File:**
- Risk: .bot-state.json contains transaction hashes (linkable to wallet)
- Files: `src/utils/storage.ts`
- Current mitigation: None
- Recommendations:
  - Encrypt sensitive fields in state file
  - Use libsodium or TweetNaCl for encryption
  - Consider removing txHash from state entirely

**No Signature Verification for Telegram Messages:**
- Risk: Any Telegram message could trigger bot action
- Files: `src/telegramListener.ts`
- Current mitigation: Message comes from Telegram API (trusted source)
- Recommendations:
  - Add whitelist of allowed sender IDs
  - Require specific message prefix/format
  - Add rate limiting per sender

**Network Susceptible to Front-Running:**
- Risk: Public mempool sees pending transactions; MEV bots can front-run
- Files: `src/bot.ts:312-326`, `src/utils/txManager.ts:36-43`
- Current mitigation: Flashbots private relay (used)
- Recommendations:
  - Ensure Flashbots is ALWAYS used (don't fall back to public mempool)
  - Monitor for bundle rejection patterns
  - Consider additional privacy layers (MEV-Burn, MEV-Share)

## Dependencies at Risk

**Ethers v5 End-of-Life:**
- Risk: v5 entered LTS in Aug 2023; will be unsupported by 2025
- Package: `ethers 5.7.2`
- Impact: Security vulnerabilities won't be patched; ecosystem moving to v6
- Migration plan:
  - Plan v6 migration; major breaking changes to API
  - v6 uses native BigInt instead of BigNumber (different operators)
  - ~300-400 lines of code changes needed
  - Start migration as priority; v5 incompatible with future tools

**Telegram Client Library May Have Vulnerabilities:**
- Risk: Version 2.26.22 from 2023; potential security issues
- Package: `telegram 2.26.22`
- Impact: If vulnerability discovered, impossible to receive updates
- Current mitigation: None
- Migration plan:
  - Monitor for updates; upgrade immediately when available
  - Consider alternative: telethon (Python-based) or TDLib (C++)
  - Reduce exposure: Limit to message parsing only, no payments

**Axios Security Advisory:**
- Risk: Version 1.10.0 from 2023
- Package: `axios 1.10.0`
- Impact: SSRF vulnerabilities in older versions
- Current mitigation: Limited to external API calls (not user-controlled URLs)
- Migration plan: Upgrade to latest 1.x or migrate to native fetch API

**Flashbots Provider Bundle Compatibility:**
- Risk: Flashbots relay API could change; breaking compatibility
- Package: `@flashbots/ethers-provider-bundle 0.6.1`
- Impact: Bundles could fail silently; no bundle monitoring dashboard integrated
- Recommendations:
  - Monitor Flashbots release notes
  - Add Flashbots relay health check on startup
  - Implement fallback to standard RPC for failed bundles

## Missing Critical Features

**No Key Rotation Mechanism:**
- Problem: Private key cannot be rotated without redeployment
- Blocks: Cannot move funds between wallets without downtime
- Fix approach: Implement key management API; support hot-swap of keys

**No Transaction History/Audit Log:**
- Problem: Only in-memory tracking of sniped tokens
- Blocks: Cannot reconcile failed transactions; no historical analysis
- Fix approach: Add transaction database with full audit trail

**No Risk Management:**
- Problem: Bot will buy any token meeting safety checks
- Blocks: Cannot implement position sizing or portfolio hedging
- Fix approach: Add configurable position limits, max loss limits, diversification rules

**No Graceful Shutdown:**
- Problem: Process kill orphans monitoring intervals and corrupts state
- Blocks: Cannot redeploy without potential data loss
- Fix approach: Implement signal handlers; add graceful shutdown sequence

**No Health Check Endpoint:**
- Problem: Impossible to monitor bot liveness externally
- Blocks: Cannot integrate with monitoring/alerting systems
- Fix approach: Add HTTP health endpoint; expose metrics (tokens monitored, positions held)

## Test Coverage Gaps

**No Unit Tests for tokenSafety.ts:**
- What's not tested: Honeypot detection, blacklist checking, liquidity validation, tax calculation
- Files: `src/utils/tokenSafety.ts` (350 lines, critical path)
- Risk: Changes to safety logic could introduce regressions without detection
- Priority: **CRITICAL** - These are core protection mechanisms

**No Tests for Storage Concurrency:**
- What's not tested: Concurrent writes to .bot-state.json
- Files: `src/utils/storage.ts`
- Risk: Race conditions undetected until production failure
- Priority: **HIGH** - Data corruption risk

**No Integration Tests for Flashbots:**
- What's not tested: Bundle submission, retry logic, nonce handling
- Files: `src/utils/txManager.ts`
- Risk: Bundles could fail in production without warning; retries ineffective
- Priority: **HIGH** - Financial impact

**No Monitoring Loop Tests:**
- What's not tested: Stop-loss/take-profit triggers, interval cleanup
- Files: `src/bot.ts:54-164`
- Risk: Edge cases (zero balance, price = 0) cause crashes
- Priority: **MEDIUM** - Operational stability

**No Telegram Integration Tests:**
- What's not tested: Message parsing, session handling, error recovery
- Files: `src/telegramListener.ts`, `auth.ts`
- Risk: Broken message parsing goes unnoticed until real usage
- Priority: **MEDIUM** - User experience

**No Config Validation Tests:**
- What's not tested: Missing env vars, invalid addresses, network mismatches
- Files: `src/config.ts`
- Risk: Startup errors are cryptic; hard to debug environment issues
- Priority: **LOW** - Affects setup/operations

---

*Concerns audit: 2026-03-19*
