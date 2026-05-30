---
phase: 21
slug: exit-engine-live-runtime-hardening
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-29
---

# Phase 21 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Exit-Engine Live-Runtime Hardening — real-capital mainnet trading bot; capital-safety is paramount.
> Register authored at plan time (every plan 21-01…21-08 carries a `<threat_model>` STRIDE block); this
> document records the retroactive verification that each declared mitigation exists in the implementation.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| test-harness ↔ real mainnet RPC | Two-layer chainId===1 gate (`test/fork/setup.ts:38-61` global tripwire + `test/fork/helpers/realMainnetGate.ts:67-75` per-test). Local fork reports 31337 and passes naturally; only an exact `ALLOW_REAL_MAINNET='1'` opts in. | signed tx / real ETH / wallet key (must never cross from a test) |
| bot process ↔ Flashbots relay | `X-Flashbots-Signature` auth + private builder-to-builder bundle (never public mempool); simulate-before-submit (`flashbots.ts:235`). | signed raw tx bytes, `FLASHBOTS_AUTH_KEY` auth identity |
| operator ↔ live-capital on-chain actions | Plan 07 is `autonomous:false`; an operator (not an agent) performs every on-chain action behind a blocking-human go/no-go gate with dual address verification. | real ETH, wallet `PRIVATE_KEY` |
| logs / capture artifacts ↔ committed repo | pino logs, fork fixtures, and evidence docs must hold public-only values; archive RPC URL logged as "key redacted". | tx/bundle hashes, addresses, blocks (public) — secrets referenced by NAME only |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation (verified) | Status |
|-----------|----------|-----------|-------------|------------------------|--------|
| T-21-01-01 | Repudiation / masked-failure | exit.* op logs presented as "exit happened" | mitigate | D-OP-DB-TRUTH: op log is filtering-only; ground truth = `trades.amount_out` non-null + on-chain receipt. `exit.receipt.decoded` op sits inside an existing log, not a success gate (`src/exitEngine.ts:1032`); tests assert op presence not exit success. | closed |
| T-21-01-02 | Tampering | op-enrichment altering exit control flow / poll timing | mitigate | Additive logging only — all `op:'exit.*'` keys live inside existing structured first-args; poll telemetry wraps the body with no added await; `clearInterval` / `pollIntervalMs` unchanged; tsc clean. | closed |
| T-21-01-03 | Information disclosure | logging full Flashbots bundle response (signed raw tx / auth identity) | mitigate | `flashbots.ts:325-328` logs ONLY `{bundleHash, minedTxHash, block}`; stats log only pubkeys+booleans. Grep `signedTransaction\|FLASHBOTS_AUTH_KEY` in flashbots/exitEngine = 0 matches. | closed |
| T-21-01-SC | Tampering (supply chain) | npm/package installs | mitigate | `tech-stack.added: []`; reuses pino + `@flashbots/ethers-provider-bundle@1.0.0` already in package.json. | closed |
| T-21-02-01 | Tampering / financial loss | a test transacting on real mainnet | mitigate | Layer a: `setup.ts:50` global tripwire aborts the run on chainId 1 without opt-in; Layer b: `realMainnetGate.ts:67-75` per-test throw. Local fork = 31337. Meta-test 8/8. | closed |
| T-21-02-02 | Information disclosure | prod `PRIVATE_KEY` leaked into a test fixture / CI log | mitigate | `FORK_ONLY_TEST_KEY` = Hardhat acct#0 (`realMainnetGate.ts:34`); `process.env.PRIVATE_KEY` appears only in a do-NOT comment (line 28), zero executable refs across test/fork. | closed |
| T-21-02-03 | Elevation of privilege | a future test forgetting to opt in and silently hitting mainnet | mitigate | The GLOBAL tripwire (`setup.ts:38-61`) runs in globalSetup and protects every fork test, including future ones. | closed |
| T-21-02-04 | Repudiation | a bypass-in-prod-code path defeating the gate | mitigate | D-ROLLBACK: gate lives only in `test/fork/`; no `src/` change; only exact-string `ALLOW_REAL_MAINNET='1'` opts in. | closed |
| T-21-02-SC | Tampering (supply chain) | package installs | mitigate | `tech-stack.added: []`; reused ethers 6.16 + vitest. | closed |
| T-21-03-01 | Tampering | capture-launch.ts writing a malicious/typo address into a fixture | mitigate | `capture-launch.ts:122` `ethers.getAddress(rawToken)` checksum-validation, fail-fast on bad addr; fork-only fixtures; hand-picked LP-burned tokens. | closed |
| T-21-03-02 | Information disclosure | Archive RPC URL (Alchemy key in URL) logged or committed | mitigate | `capture-launch.ts:188-204` reads RPC from env, logs `source` name + "key redacted"; fixtures carry no URL (grep for key/rpc/0x{64} = 0). | closed |
| T-21-03-03 | Tampering / financial loss | replay test signing with the prod wallet on a real-mainnet RPC | mitigate | `realLaunchReplay.fork.test.ts:153` `requireRealMainnetGate` before tx; signs `FORK_ONLY_TEST_KEY`; zero `process.env.PRIVATE_KEY`; fork = 31337. | closed |
| T-21-03-04 | Repudiation / masked-failure | replay asserting success from an op log / shipping skipped stubs | mitigate | Asserts `trades.amount_out IS NOT NULL` from DB via read-only conn (`realLaunchReplay.fork.test.ts:457,519,565`); no `it.skip` stubs. | closed |
| T-21-03-SC | Tampering (supply chain) | package installs | mitigate | `tech-stack.added: []`. | closed |
| T-21-04-01 | Tampering / financial loss | persistence test signing with the prod wallet | mitigate | `exitStatePersistence.fork.test.ts:125` `requireRealMainnetGate`; signs `FORK_ONLY_TEST_KEY`; zero `process.env.PRIVATE_KEY`; fork = 31337. | closed |
| T-21-04-02 | Repudiation / masked-failure | flaky test losing last-cycle state (SIGKILL-before-WAL-flush) reported as pass | mitigate | Clean clearAllTimers→resumeExitMonitor shape; no SIGKILL (grep=0); asserts the persisted last-cycle row via read-only conn; deterministic gate. | closed |
| T-21-04-03 | Repudiation | asserting persistence from a log line instead of the DB | mitigate | D-OP-DB-TRUTH: asserts `exit_state` column equality via `readExitStateRow`/`getExitState`, never a log line. | closed |
| T-21-04-SC | Tampering (supply chain) | package installs | mitigate | `tech-stack.added: []`. | closed |
| T-21-05-01 | Information disclosure | documenting a secret (key, RPC key) in the runbook | mitigate | `going-live.md` §10 references only the public wallet address + env-var NAMES; no key values. | closed |
| T-21-05-02 | Financial loss (missing safety step) | incomplete runbook omitting gas-spike abort or simulate-before-submit | mitigate | §10 encodes fork-rehearsal-green, read-only preflight go/no-go, abort-if-gas-spiked re-read, dual address verification, and simulate-before-submit (`eth_callBundle`). | closed |
| T-21-05-03 | Repudiation | a wrong reword misleading the verifier | mitigate | Each reword cites its RESEARCH/PATTERNS resolution; acceptance asserts the literal strings (grep table verifies counts). | closed |
| T-21-05-SC | Tampering (supply chain) | npm/package installs | **accept** | Docs-only plan; zero install surface. Verified: 21-05 modified only `.planning/REQUIREMENTS.md` + `docs/operations/going-live.md`. *(see Accepted Risks Log)* | closed |
| T-21-06-01 | Tampering / financial loss | rehearsal signing with the prod wallet | mitigate | `captureRehearsal.fork.test.ts:161` `requireRealMainnetGate`; signs `FORK_ONLY_TEST_KEY`; zero `process.env.PRIVATE_KEY`; fork = 31337. | closed |
| T-21-06-02 | Repudiation / masked-failure | rehearsal "passes" without the engine actually firing the sell | mitigate | Asserts `trades.amount_out` NOT NULL via the real `executeFullSell→decodeReceipt` chain (read-only conn); op stream is filter-only. | closed |
| T-21-06-03 | False assurance | treating the green fork rehearsal as closure for EXIT-LIVE-03/04 | mitigate | D-EVIDENCE-BAR: `requirements: []` intentionally empty; test asserts `usedPassthrough===true` + explicit non-closure. Real closure lands in Plan 07/08. | closed |
| T-21-06-SC | Tampering (supply chain) | package installs | mitigate | `tech-stack.added: []`. | closed |
| T-21-07-01 | Financial loss | real-capital buy+sell at a gas spike or on an unsafe token | mitigate | Operator-gated go/no-go (`21-07-CAPTURE-ARTIFACTS.md` §0): gas 0.384 gwei CALM with abort-if-spiked; min size; token passed honeypot gate (Honeypot:No, 0bps tax). | closed |
| T-21-07-02 | Tampering / catastrophic loss | an autonomous agent transacting real ETH | mitigate | `autonomous:false`; only task is a `checkpoint:human-action` blocking-human gate; operator ran the bot, agent read-only ("No agent transacted"); both addresses verified pre-spend. | closed |
| T-21-07-03 | Information disclosure | pasting a private/RPC key into the artifacts file | mitigate | Artifacts hold PUBLIC values only (tx hashes, `amount_out`, bundleHash/minedTxHash, screenshot); grep for private_key/0x{64}/alchemy-key = only the public hashes. | closed |
| T-21-07-04 | Repudiation / masked-failure | recording "the script ran" instead of the real artifact | mitigate | D-OP-DB-TRUTH + D-EVIDENCE-BAR: resolvable Etherscan sell tx `0xcc7997bb…` (block 25203624, status 1), DB `amount_out=993814525259157`, dashboard screenshot. | closed |
| T-21-07-05 | MEV exposure | the live sell competes in the public MEV/Flashbots arena | mitigate | Sell routed PRIVATELY via Flashbots; simulate-before-submit present (`flashbots.ts:235`); landed via private bundle `0xb8e15354…`. | closed |
| T-21-07-SC | Tampering (supply chain) | npm/package installs | **accept** | Operator capture session; no installs. Verified zero-install footprint. *(see Accepted Risks Log)* | closed |
| T-21-08-01 | Repudiation / false closure | an item closed by a fork-pass or fabricated excerpt | mitigate | D-EVIDENCE-BAR: `closed-fork-only:1` = ONLY EXIT-LIVE-02 (ROADMAP sc-1(b) authorized, quoted verbatim); every other row links a real artifact. | closed |
| T-21-08-02 | Information disclosure | a pino excerpt/screenshot leaking a secret into the committed archive | mitigate | Op excerpts/screenshots are public values only; consolidation reviewed before commit; capture artifacts grep clean of secrets. | closed |
| T-21-08-03 | Tampering | the induced RPC drop affecting the real bot's live operation | mitigate | Controlled/brief/deterministic inducement (`rawWs.terminate()`, ~1s reconnect); exit poll uses the HTTP provider so exits are unaffected; no real-capital position at risk. | closed |
| T-21-08-04 | Repudiation | hiding a bug surfaced during capture | mitigate | D-STOP-THE-LINE: Stop-the-Line Determination stated ("none"); the 21-07 capture anomaly was investigated + ruled out as cosmetic (debug session resolved), not filed-and-deferred. | closed |
| T-21-08-SC | Tampering (supply chain) | npm/package installs | **accept** | Observation captures + a docs file; no installs. Verified zero-install footprint. *(see Accepted Risks Log)* | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Totals:** 37 threats — 34 `mitigate` (closed with code/test/doc evidence) + 3 `accept` (documented). `threats_open: 0`.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-21-01 | T-21-05-SC | Plan 21-05 is docs-only (`REQUIREMENTS.md` + `going-live.md`). No package added → zero supply-chain install surface to mitigate. | gsd-security-auditor (verified zero-install footprint) | 2026-05-29 |
| AR-21-02 | T-21-07-SC | Plan 21-07 is an operator-driven live-capture session using the already-built bot. No package added → zero supply-chain install surface. | gsd-security-auditor (verified zero-install footprint) | 2026-05-29 |
| AR-21-03 | T-21-08-SC | Plan 21-08 is observation captures + an evidence doc. No package added → zero supply-chain install surface. | gsd-security-auditor (verified zero-install footprint) | 2026-05-29 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-29 | 37 | 37 | 0 | gsd-security-auditor (Phase 21 retroactive verification, ASVS L1) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-29
