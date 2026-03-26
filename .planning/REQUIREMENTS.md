# Requirements: Crypto Snipe Bot

**Defined:** 2026-03-19
**Core Value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management

## v1 Requirements

Requirements for production-ready multi-chain sniper bot. Each maps to roadmap phases.

### Bug Fixes & Hardening

- [x] **FIX-01**: Stop-loss and take-profit cannot fire simultaneously on the same token — mutex-based exit mediation prevents double-sell
- [x] **FIX-02**: Flashbots relay network is selected dynamically based on configured chain, not hardcoded to mainnet
- [x] **FIX-03**: Nonce increments on each Flashbots bundle retry so retries can actually succeed
- [x] **FIX-04**: Sell simulation safety check is re-enabled and runs before every buy transaction
- [x] **FIX-05**: Bot handles SIGTERM/SIGINT gracefully — clears all intervals, timeouts, and flushes state before exit
- [x] **FIX-06**: All required environment variables are validated on startup with clear error messages listing what's missing
- [x] **FIX-07**: Timed sell timeout is cancelled when position is already sold via stop-loss or take-profit
- [x] **FIX-08**: Monitoring loops exit when token balance reaches zero instead of polling indefinitely
- [x] **FIX-09**: Telegram alpha listener only processes messages from whitelisted sender IDs

### Infrastructure — ethers v6 Migration

- [x] **ETH6-01**: All ethers v5 imports and APIs migrated to ethers v6 (BigNumber → native BigInt, updated provider/signer API)
- [x] **ETH6-02**: All arithmetic operations use BigInt correctly — no Number() precision loss on wei values
- [x] **ETH6-03**: Flashbots provider upgraded to @flashbots/ethers-provider-bundle v1.0.0 (ethers v6 compatible)
- [x] **ETH6-04**: Hardhat toolbox upgraded to v6+ with hardhat-ethers v4+ for ethers v6 compatibility

### Infrastructure — SQLite Storage

- [x] **DB-01**: JSON file storage replaced with SQLite database using WAL mode for concurrent access
- [x] **DB-02**: SQLite is the sole source of truth — no in-memory cache that can diverge from disk
- [x] **DB-03**: Full transaction audit trail: every buy, sell, and status change recorded with timestamps
- [ ] **DB-04**: P&L calculated per trade with realized gains/losses queryable by token, chain, and date range

### Infrastructure — Code Quality

- [x] **INFRA-01**: Structured logging with severity levels (debug, info, warn, error) replaces all console.log/emoji logging
- [x] **INFRA-02**: Singleton provider instance per chain eliminates redundant provider creation across modules
- [x] **INFRA-03**: All ABI definitions centralized in a single module — no inline ABI arrays in business logic

### Multi-Chain

- [ ] **CHAIN-01**: Chain registry maps chainId to RPC endpoints, contract addresses, gas config, and MEV strategy
- [x] **CHAIN-02**: Per-chain configuration supports ETH mainnet, BSC, Base, and Arbitrum with chain-specific parameters
- [x] **CHAIN-03**: Bot runs concurrent event listeners on all configured chains simultaneously
- [x] **CHAIN-04**: MEV protection uses Flashbots on ETH, bloXroute/private RPCs on BSC, and appropriate strategies per chain
- [x] **CHAIN-05**: Dynamic capital allocation distributes funds across chains based on opportunity quality and activity levels

### DEX Support — Uniswap V3

- [ ] **V3-01**: Bot detects new V3 pool creation (PoolCreated events) across all configured chains and fee tiers
- [ ] **V3-02**: Bot waits for Mint event (liquidity addition) after PoolCreated before sniping — does not snipe empty pools
- [ ] **V3-03**: V3 swap execution uses the V3 SwapRouter with correct fee tier and sqrtPriceX96 parameters
- [ ] **V3-04**: V3 price monitoring uses sqrtPriceX96 or oracle for accurate position valuation

### Risk Management

- [x] **RISK-01**: Configurable max position size caps ETH/BNB per snipe trade
- [x] **RISK-02**: Daily loss limit halts sniping when realized losses exceed configured threshold in 24h
- [x] **RISK-03**: Max open positions limit prevents exceeding configured concurrent position count across all chains
- [x] **RISK-04**: Configurable cooldown period between snipes prevents overtrading during launch waves
- [x] **RISK-05**: Portfolio-level exposure tracking shows total capital at risk across all chains and positions

### Smart Exit Strategies

- [x] **EXIT-01**: Trailing stop-loss tracks price high-water mark and sells on configured percentage pullback from peak
- [x] **EXIT-02**: Partial sells execute at configurable price targets (e.g., sell 50% at 2x, 25% at 5x, trail remainder)
- [x] **EXIT-03**: Stop-loss and take-profit thresholds adjust dynamically based on measured token price volatility
- [x] **EXIT-04**: Exit urgency escalates as position ages — tighter stops and lower targets over time

### Monitoring & Web Dashboard

- [x] **MON-01**: HTTP health check endpoint exposes bot liveness, chain connectivity status, and open position count
- [x] **DASH-01**: Web dashboard displays real-time open positions with current P&L per token and chain
- [x] **DASH-02**: Historical trade log with filtering by chain, date range, and profit/loss
- [x] **DASH-03**: Bot controls accessible from dashboard (start/stop per chain, adjust snipe parameters)
- [x] **DASH-04**: Risk dashboard shows portfolio exposure, daily P&L curve, and position limit utilization

### Testing

- [ ] **TEST-01**: Unit tests cover all 9 token safety checks including API failure fallback paths
- [ ] **TEST-02**: Unit tests verify SQLite storage concurrency — concurrent writes produce correct state
- [ ] **TEST-03**: Integration tests verify Flashbots bundle submission, retry with nonce increment, and fallback to direct send
- [ ] **TEST-04**: Integration tests verify stop-loss, take-profit, and trailing stop trigger correctly and do not double-sell
- [ ] **TEST-05**: Mainnet fork tests simulate full snipe flow: detect pair → validate → buy → monitor → sell

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Detection

- **DETECT-01**: Mempool monitoring for pending liquidity transactions enables block-0 sniping (currently block-mode only)
- **DETECT-02**: Anti-rug real-time monitoring detects liquidity removal events after purchase and frontrun exits

### Advanced Risk

- **ARISK-01**: ML-based token scoring using historical trade outcomes for buy/skip decisions
- **ARISK-02**: Cross-chain correlation analysis to detect coordinated rug pulls across chains

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Copy trading / wallet tracking | Always behind the leader; sniping edge comes from speed not following |
| Arbitrage between DEXes | Completely different architecture; competes with professional MEV searchers |
| Limit orders / manual trading | Bot is fully automated; manual trading competes with DEX aggregators |
| AI/ML token scoring (v1) | Noisy training data; rule-based heuristics are more reliable for v1 |
| Mobile app | Web dashboard is mobile-responsive; Telegram provides mobile alerts |
| CEX support | DEX-only architecture; CEX trading is a different product |
| Multi-wallet support | Use separate bot instances; simpler key management and debugging |
| Presale / fair-launch sniping | Every launchpad has different contract ABIs; maintenance nightmare |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIX-01 | Phase 1 | Complete |
| FIX-02 | Phase 1 | Complete |
| FIX-03 | Phase 1 | Complete |
| FIX-04 | Phase 1 | Complete |
| FIX-05 | Phase 1 | Complete |
| FIX-06 | Phase 1 | Complete |
| FIX-07 | Phase 1 | Complete |
| FIX-08 | Phase 1 | Complete |
| FIX-09 | Phase 1 | Complete |
| ETH6-01 | Phase 2 | Complete |
| ETH6-02 | Phase 2 | Complete |
| ETH6-03 | Phase 2 | Complete |
| ETH6-04 | Phase 2 | Complete |
| DB-01 | Phase 3 | Complete |
| DB-02 | Phase 3 | Complete |
| DB-03 | Phase 3 | Complete |
| DB-04 | Phase 3 | Pending |
| INFRA-01 | Phase 3 | Complete |
| INFRA-02 | Phase 3 | Complete |
| INFRA-03 | Phase 3 | Complete |
| CHAIN-01 | Phase 4 | Pending |
| CHAIN-02 | Phase 4 | Complete |
| CHAIN-03 | Phase 4 | Complete |
| CHAIN-04 | Phase 4 | Complete |
| CHAIN-05 | Phase 4 | Complete |
| V3-01 | Phase 5 | Pending |
| V3-02 | Phase 5 | Pending |
| V3-03 | Phase 5 | Pending |
| V3-04 | Phase 5 | Pending |
| RISK-01 | Phase 6 | Complete |
| RISK-02 | Phase 6 | Complete |
| RISK-03 | Phase 6 | Complete |
| RISK-04 | Phase 6 | Complete |
| RISK-05 | Phase 6 | Complete |
| EXIT-01 | Phase 7 | Complete |
| EXIT-02 | Phase 7 | Complete |
| EXIT-03 | Phase 7 | Complete |
| EXIT-04 | Phase 7 | Complete |
| MON-01 | Phase 8 | Complete |
| DASH-01 | Phase 8 | Complete |
| DASH-02 | Phase 8 | Complete |
| DASH-03 | Phase 8 | Complete |
| DASH-04 | Phase 8 | Complete |
| TEST-01 | Phase 9 | Pending |
| TEST-02 | Phase 9 | Pending |
| TEST-03 | Phase 9 | Pending |
| TEST-04 | Phase 9 | Pending |
| TEST-05 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 48 total
- Mapped to phases: 48
- Unmapped: 0

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 after roadmap creation*
