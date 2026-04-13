---
phase: 16
slug: dashboard-type-alignment-dead-code-cleanup
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-13
---

# Phase 16 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| /api/trades | Authenticated API endpoint adding buy_id field | Auto-increment integer (no PII) |
| /health | Unauthenticated health endpoint adding version field | Package version string (public metadata) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-16-01 | I (Information Disclosure) | /api/trades adding buy_id | accept | buy_id is auto-increment integer with no PII value; endpoint already requires authentication | closed |
| T-16-02 | I (Information Disclosure) | /health version field | accept | Version string from package.json is public metadata with no security value; health endpoint deliberately unauthenticated per D-20 | closed |
| T-16-03 | T (Tampering) | Dead shutdown code removal | accept | bot.ts local handler unchanged; removal only affects unreachable code paths | closed |

*Status: open / closed*
*Disposition: mitigate (implementation required) / accept (documented risk) / transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-16-01 | T-16-01 | buy_id is a sequential integer with no PII or exploitable information; trades endpoint requires authentication | gsd-security-audit | 2026-04-13 |
| AR-16-02 | T-16-02 | Package version is public metadata already available via package.json in repository; health endpoint is intentionally unauthenticated (decision D-20) | gsd-security-audit | 2026-04-13 |
| AR-16-03 | T-16-03 | Dead shutdown exports were unreachable code; bot.ts local initMultiChainShutdownHandler remains intact and handles all shutdown scenarios | gsd-security-audit | 2026-04-13 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-13 | 3 | 3 | 0 | gsd-security-audit |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-13
