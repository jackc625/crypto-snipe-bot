---
phase: 12
slug: integration-gap-fixes
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-06
---

# Phase 12 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| DB write | dex_name stored from trusted DexConfig.name (not user input) | String config value → SQLite column |
| API response | dex_name exposed in getPnL output to authenticated dashboard sessions | Non-sensitive config string |
| WS broadcast | Chain status data sent to authenticated WebSocket clients only | Operational status (running/stopped, block number, masked URLs) |
| HTTP stop/start | Chain control mutations require authenticated API session | Control commands via POST endpoints |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-12-01 | Tampering | insertTrade dex_name binding | mitigate | Parameterized prepared statement (`@dexName` binding in db.ts:179) prevents SQL injection | closed |
| T-12-02 | Information Disclosure | dex_name in API response | accept | Non-sensitive configuration data (DEX name like "uniswap-v3"), exposed only to authenticated sessions behind API key middleware | closed |
| T-12-03 | Information Disclosure | WS broadcast of chain status | accept | Chain status is non-sensitive operational data. Broadcast only to authenticatedClients set in broadcaster.ts. Authentication enforced at WS connection time via session validation in upgrade handler | closed |
| T-12-04 | Denial of Service | buildChainStatus async calls | accept | getBlockNumber() calls bounded by configured chain count (max ~4). Same pattern as existing GET handler. No amplification risk | closed |
| T-12-05 | Spoofing | Chain stop/start POST endpoints | mitigate | Session auth middleware applied at router level in server.ts:70 (`app.use('/api', authMiddleware, apiRouter)`). No changes to auth layer | closed |
| T-12-06 | N/A | Stale artifact deletion | accept | Purely cleanup operation. All deleted .js files verified machine-generated with matching .tsx/.ts sources. No code logic changes | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-12-01 | T-12-02 | dex_name is a hardcoded config string (e.g., "uniswap-v3"), not user-generated data. Exposure limited to authenticated dashboard sessions | Plan author | 2026-04-06 |
| AR-12-02 | T-12-03 | Chain status (running/stopped, block number, masked RPC URLs) is operational data with no secret material. WS clients authenticated at connection time | Plan author | 2026-04-06 |
| AR-12-03 | T-12-04 | getBlockNumber() calls are O(chain_count) where chain_count is a small fixed config value (~1-4). No user-controlled amplification vector | Plan author | 2026-04-06 |
| AR-12-04 | T-12-06 | File deletion only — no runtime code changes. All 28 deleted .js files verified to have matching .ts/.tsx sources | Plan author | 2026-04-06 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-06 | 6 | 6 | 0 | gsd-secure-phase orchestrator |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-06
