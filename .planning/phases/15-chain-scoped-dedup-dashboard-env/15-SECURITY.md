---
phase: 15
slug: chain-scoped-dedup-dashboard-env
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-12
---

# Phase 15 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| External RPC events -> bot.ts handlers | PairCreated / PoolCreated events arrive from untrusted chains; dedup check is the first gate before any on-chain action | Token address (hex string), chain identifier |
| Application -> SQLite | All writes are parameterized prepared statements; no string interpolation | Token address, chain name, trade metadata |
| Legacy data at rest -> runtime queries | Pre-Phase-4 rows carry `chain='mainnet'`; runtime passes `chain='eth'`. Normalization shim bridges at startup. | Chain identifier column value |
| Operator shell -> process.env | Operator provides secrets via .env file or shell export. Bot validates presence at startup. | API keys, private keys, config values |
| External dashboard client -> /api/auth/login | HTTP client supplies `apiKey` in request body. Auth middleware compares against `process.env.DASHBOARD_API_KEY`. | Dashboard API key (secret) |
| Test harness / hot-reload -> process.env mutation | Non-production boot paths can mutate process.env after module load, bypassing startup validation. auth.ts defense-in-depth branch guards this. | Environment variable values |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-15-01 | Tampering | `makeIsTokenSnipedStmt` SQL | mitigate | Prepared statement with `?` placeholders; bind values from internal sources only (`targetToken.toLowerCase()`, `ctx.chain.name`). No user input reaches SQL. | closed |
| T-15-02 | Denial of Service | Cross-chain dedup gap | mitigate | `AND chain = ?` added to isTokenSniped query. Token sniped on BSC no longer blocks same address on ETH/Base/Arb. | closed |
| T-15-03 | Elevation of Privilege | Legacy wrapper deletion | accept | Grep gates confirmed zero callers across src/, scripts/, test/, dashboard/ before deletion. `tsc --noEmit` passes. Full test suite passes. | closed |
| T-15-04 | Information Disclosure | Test fixture token values | accept | Hardcoded zero-address-like test token. No secrets, no private keys, no real token addresses. | closed |
| T-15-05 | Spoofing | `ctx.chain.name` authenticity | accept | Chain name from hardcoded allowlist in `src/chainRegistry.ts`. No runtime path allows forging a chain name. | closed |
| T-15-06 | Spoofing | Dashboard login with `DASHBOARD_API_KEY` unset | mitigate | Bot exits on startup with fatal log naming missing variable. Eliminates misconfigured-and-running window. ASVS L1 fail-closed. | closed |
| T-15-07 | Denial of Service | Dashboard inoperable from missing env var | mitigate | Same fail-fast startup validation as T-15-06. | closed |
| T-15-08 | Information Disclosure | Fatal log includes env var names | accept | Names logged, not values. Variable names already public in repo. Matches existing convention for PRIVATE_KEY, TELEGRAM_BOT_TOKEN. | closed |
| T-15-09 | Elevation of Privilege | Defense-in-depth auth.ts branch | accept | `!expected` branch preserved unchanged with D-09 comment. Guards against post-startup env mutation by test harnesses/hot-reload. | closed |
| T-15-10 | Tampering | Test fixture hardcoded key | accept | Non-secret `test-dashboard-key` in test file only. Follows project convention. | closed |
| T-15-11 | Tampering | `normalizeLegacyMainnetRows()` UPDATE | mitigate | Single SQL literal with no bind params. Idempotent. No injection surface. Runs inside same SQLite connection with schema constraints. | closed |
| T-15-12 | Repudiation | Silent data rewrite at module load | accept | `logger.info` audit trail when rows normalized. Schema invariant preserved; data relabeled not destroyed. | closed |
| T-15-13 | Repudiation | Startup validation fail mode | mitigate | Logger-payload assertion proves operators get audit trail naming missing vars. Test coverage verifies payload content. | closed |

*Status: open / closed*
*Disposition: mitigate (implementation required) / accept (documented risk) / transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-15-01 | T-15-03 | Deleted functions had zero live callers confirmed by grep gates and tsc. Removal cannot introduce privilege vector. | Plan author | 2026-04-13 |
| AR-15-02 | T-15-04 | Test-only hardcoded addresses contain no secrets or real token addresses. | Plan author | 2026-04-13 |
| AR-15-03 | T-15-05 | Chain name sourced from compile-time hardcoded allowlist; no runtime forge path exists. | Plan author | 2026-04-13 |
| AR-15-04 | T-15-08 | Env var names are public knowledge (in repo); logging names not values is standard practice. | Plan author | 2026-04-13 |
| AR-15-05 | T-15-09 | Defense-in-depth branch is belt-and-suspenders for non-production mutation paths. Code unchanged. | Plan author | 2026-04-13 |
| AR-15-06 | T-15-10 | Test fixture key follows existing project convention for non-secret test values. | Plan author | 2026-04-13 |
| AR-15-07 | T-15-12 | Automatic normalization logged at info level. Data relabeled (mainnet->eth), not destroyed. | Plan author | 2026-04-13 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-12 | 13 | 13 | 0 | gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-12
