---
phase: 13
slug: config-env-var-correctness
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-06
---

# Phase 13 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| .env -> config.ts | User-supplied env var values parsed into runtime config | Numeric string (STOP_LOSS_PCT), secret key (FLASHBOTS_AUTH_KEY) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-01 | Tampering | STOP_LOSS_PCT env var | mitigate | parseFloat with isNaN guard at config.ts:126-127 — non-numeric values fall back to default 25, preventing NaN propagation to exit engine | closed |
| T-13-02 | Denial of Service | FLASHBOTS_AUTH_KEY removal from required | accept | chainRegistry.ts:315 validates FLASHBOTS_AUTH_KEY conditionally when eth chain enabled. Removing global required prevents blocking non-ETH deployments. ETH deployments still fail fast. | closed |
| T-13-03 | Information Disclosure | STOP_LOSS_PCT logged | accept | Stop-loss percentage is a numeric threshold, not PII or secrets. No sensitive data exposed. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-13-01 | T-13-02 | chainRegistry.ts already validates FLASHBOTS_AUTH_KEY conditionally per enabled chain (line 315). Global required was redundant and blocked valid non-ETH deployments. | gsd-secure-phase | 2026-04-06 |
| AR-13-02 | T-13-03 | STOP_LOSS_PCT is a numeric trading threshold (e.g., 25%). Not sensitive — no PII, credentials, or secrets. | gsd-secure-phase | 2026-04-06 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-06 | 3 | 3 | 0 | gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-06
