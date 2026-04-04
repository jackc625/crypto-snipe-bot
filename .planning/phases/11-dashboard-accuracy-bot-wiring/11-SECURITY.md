---
phase: 11
slug: dashboard-accuracy-bot-wiring
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-04
---

# Phase 11 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Dashboard API ↔ Browser | HTTP/WS between Express server and React dashboard | Session cookies, portfolio data (positions, P&L, trade amounts) |
| API Server ↔ RPC Providers | On-chain price queries via queryPrice() | Token addresses, price data, wallet-derived amounts |
| Telegram Network ↔ Bot Process | gramjs client receiving messages from Telegram servers | Sender IDs, channel IDs, message text containing contract addresses |
| Bot Orchestrator ↔ API Server | onRestart callback passed from bot.ts to server.ts | Chain context references, DEX listener handles |
| Dashboard API ↔ SQLite | Database queries for positions, trades, P&L | Trade records, exit states, position metadata |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-11-01 | Denial of Service | `src/api/helpers/positions.ts` — queryPrice per request | mitigate | `priceStale` fallback to `highWaterMark` when RPC fails; parallel queries via `Promise.all` bound to open position count | closed |
| T-11-02 | Elevation of Privilege | `src/api/routes/chains.ts` — chain restart endpoint | mitigate | Auth middleware on all `/api/*` routes; state checks prevent double-start/stop; warnings array for partial failures (D-12) | closed |
| T-11-03 | Spoofing | `src/telegramListener.ts` — whitelist bypass | mitigate | Sender/channel whitelist with OR logic; regex-only address extraction (`/0x[a-fA-F0-9]{40}/g`); lowercase normalization | closed |
| T-11-04 | Information Disclosure | `src/api/routes/health.ts` — telegram status | accept | Only exposes `telegramConnected` boolean and generic `telegramError` string — no credentials, session data, or API keys | closed |
| T-11-05 | Tampering | `src/api/server.ts` — WebSocket position push | mitigate | Session validation required on WS upgrade (`ws/handler.ts`); same session store as HTTP auth; path-restricted to `/ws` | closed |
| T-11-06 | Information Disclosure | `src/api/helpers/positions.ts` — portfolio data | accept | Auth-gated endpoint; operator's own portfolio data; RPC URLs masked via `maskUrl()` in chains route | closed |
| T-11-07 | Denial of Service | `src/telegramListener.ts` — address flood via Telegram | mitigate | `processedContracts` dedup Set prevents reprocessing; 5-second cooldown between messages; per-chain `getCode` validation | closed |
| T-11-08 | Spoofing | `src/telegramListener.ts` — empty whitelist allows all | accept | Documented design per D-21/D-22: empty whitelist = allow all senders; FIX-09 confirms existing logic is correct | closed |

*Status: open / closed*
*Disposition: mitigate (implementation required) / accept (documented risk) / transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-11-01 | T-11-04 | Health endpoint telegram status is non-sensitive metadata (boolean + generic error). No credentials or session data exposed. | gsd-security-audit | 2026-04-04 |
| AR-11-02 | T-11-06 | Portfolio data is operator's own; endpoint requires valid session. Data exposure is the endpoint's purpose. RPC URLs are masked. | gsd-security-audit | 2026-04-04 |
| AR-11-03 | T-11-08 | Empty whitelist = allow all is intentional design (D-21/D-22). Operator controls whitelist via env vars. FIX-09 audit confirms correct implementation. | gsd-security-audit | 2026-04-04 |

---

## Pre-existing Observations (Out of Phase 11 Scope)

The following items were observed during audit but predate Phase 11. They are noted here for visibility but are not Phase 11 threats:

| Area | Observation | Origin |
|------|-------------|--------|
| CORS | `cors({ origin: true, credentials: true })` is permissive; mitigated by `sameSite: strict` cookies | Phase 8 |
| Rate Limiting | No rate limiting on `/api/auth/login` | Phase 8 |
| Error Handling | Error middleware returns `err.message` to client on 500 | Phase 8 |
| CSP | Helmet CSP disabled (`contentSecurityPolicy: false`) | Phase 8 |
| WebSocket Origin | No `Origin` header validation on WS upgrade | Phase 8 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-04 | 8 | 8 | 0 | gsd-security-audit (Opus 4.6) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-04
