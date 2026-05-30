---
phase: 14
slug: sell-revenue-receipt-decoding
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-06
---

# Phase 14 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Phase 14 delivers the sell-path receipt decoder (`decodeReceipt`) and wires it into `executeFullSell`/`executePartialSell`, plus fixes the Flashbots synthetic-hash bug. This security contract aggregates threats from both 14-01-PLAN (receipt decoder) and 14-02-PLAN (exitEngine wiring + Flashbots).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| RPC provider → receipt data | Receipt data comes from an external RPC node; user-configured | `TransactionReceipt` (gasUsed, gasPrice, blockNumber, logs[]) |
| Token contract → WETH events | Arbitrary token contracts in the same block may emit `Transfer`/`Withdrawal`-shaped events | Event topics + data |
| Flashbots relay → bundle response | Flashbots relay returns bundle metadata containing tx hashes | `bundleTransactions[0].hash` |
| bloXroute relay → JSON-RPC response | bloXroute endpoint returns JSON-RPC result | `data.result` (tx hash) |
| exitEngine → receiptDecoder | Internal module boundary, no external trust | `txHash`, `wethAddress`, `walletAddress`, `JsonRpcProvider` |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-14-01 | Spoofing | `src/utils/receiptDecoder.ts` (WETH event filter) | mitigate | `logEntry.address.toLowerCase() !== wethLower` filter runs **before** `Interface.parseLog` (both Withdrawal and Transfer strategy loops). Only logs emitted by the canonical WETH contract are trusted. Malicious tokens emitting spoofed `Transfer(to=wallet)` events from their own address are skipped. Locked by unit test "ignores spoofed Transfer events from non-WETH contracts (T-14-01)". | closed |
| T-14-02 | Tampering | RPC receipt data | accept | RPC provider is user-configured trusted infrastructure. Receipt data is signed by block validators. The bot already trusts the RPC for all on-chain reads (quotes, balances, nonce, receipts); no new trust surface is introduced by Phase 14. | closed |
| T-14-03 | Information Disclosure | `gasCost` / `amountOut` in logs | accept | Decoded financial values are logged at `info` level via pino. Bot logs are local (no log shipping). No PII involved. The same values already appear in the `trades` table and dashboard. | closed |
| T-14-04 | Denial of Service | `decodeReceipt` in sell path | accept | Receipt decode adds ~0-4s to sell path latency (one RPC call + optional 2s retry). Sells already take seconds for tx confirmation. The added latency is bounded and acceptable for the data-completeness benefit. No unbounded loops — both log-scan loops are linear in `receipt.logs.length` and exit on first match. | closed |
| T-14-05 | Tampering | `src/utils/mevStrategies/flashbots.ts` bundle hash | accept | Flashbots relay is user-configured trusted infrastructure. Defensive guard added in Plan 02: `const realHash = bundle.bundleTransactions?.[0]?.hash; if (!realHash) throw new Error(...)` — if the library response shape is malformed, it fails loudly instead of silently casting `undefined` to a string hash (which was the original bug). Locked by `test/integration/mevStrategies.test.ts` regression tests for both the real-hash and missing-hash cases. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-14-01 | T-14-02 | RPC provider is user-configured trusted infra; bot already trusts RPC for all on-chain reads. No new trust surface. | phase-14 planner | 2026-04-06 |
| AR-14-02 | T-14-03 | Financial values logged locally only; no PII; same values persisted to `trades` table. | phase-14 planner | 2026-04-06 |
| AR-14-03 | T-14-04 | ~0-4s added latency is bounded and small relative to existing sell-path tx confirmation time. Loops are linear + first-match-wins. | phase-14 planner | 2026-04-06 |
| AR-14-04 | T-14-05 | Flashbots relay is user-configured trusted infra; defensive guard throws on malformed library responses rather than silently corrupting. | phase-14 planner | 2026-04-06 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-06 | 5 | 5 | 0 | /gsd-secure-phase (State B, register-walk) |

### Audit 2026-04-06 — notes

- Input state: **B** (no pre-existing SECURITY.md; PLAN + SUMMARY artifacts present).
- Threat register built from `14-01-PLAN.md` `<threat_model>` (T-14-01..03) and `14-02-PLAN.md` `<threat_model>` (T-14-04, T-14-05, inherited T-14-01).
- Verification done by direct code inspection (register-walk), no auditor spawn — `threats_open: 0` after classification short-circuits Step 5 per workflow.
- Mitigation evidence:
  - **T-14-01:** `src/utils/receiptDecoder.ts:74-75` and `:90-91` (address check before parseLog in both strategy loops). Test lock-in: `test/unit/receiptDecoder.test.ts` — "ignores spoofed Transfer events from non-WETH contracts (T-14-01)".
  - **T-14-05:** `src/utils/mevStrategies/flashbots.ts:80-83` (`bundle.bundleTransactions?.[0]?.hash` + throw-on-missing).
- T-14-02, T-14-03, T-14-04: accepted-risk dispositions, documented in Accepted Risks Log.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-06
