---
phase: "23"
slug: "test-safety-net-harness-triage-characterization"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-13"
---

# Phase 23 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

All 33 plans had a `<threat_model>` block at plan time, so this register comes from the plans rather than being rebuilt from the code. Each mitigation below was checked against the code at HEAD `2f2d9b0`. Seven plan summaries (23-17, 23-18, 23-19, 23-26, 23-29, 23-30, 23-31) have a Threat Flags section, and none of them raises a new threat.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Test harness to real network | A missed seam would let real ethers, axios or a WebSocket open a real socket (23-01, 23-24, 23-32) | JSON-RPC / WebSocket traffic; must stay on loopback |
| Fake chain to code under test | Test evidence is only as real as the fake chain's answers (23-01, 23-05, 23-28) | Blocks, receipts, logs, nonces, fees |
| Test code to code under test | A stray mock would silently replace the mechanism being proven (23-02) | Module bindings |
| Test schema to production schema | A hand-copied schema drifts silently (23-03) | SQLite schema |
| Finding register to reports and operator | A hand-edited status or an inferred ruling could claim a bug is settled without proof (23-04, 23-14, 23-16, 23-32) | Triage outcomes, operator rulings, run evidence |
| Telegram and dashboard inputs to buy and exit paths | Tests must prove the real gate and route, not a mocked one (23-06, 23-07, 23-08) | Sender IDs, auth cookies, stop / sell requests |
| Concurrent handlers to one wallet | The nonce lock is the only thing between them and a duplicate nonce (23-09, 23-17) | Signing calls, nonces |
| Tests to the live database and signing scripts | A test must not open `data/` or run a signing script with a real key (23-13, 23-27) | DB path, wallet key |
| Railed child to simulated chain | A child process must reach only loopback (23-06, 23-12, 23-27) | RPC URLs, env |
| Test environment to public internet | The one approved outside call in the phase, kept out of the test run (23-15) | One relay POST signed by a throwaway key |
| Recordings and env snapshots to git history | A real key or URL must never be committed, and a recording change must be deliberate (23-20, 23-21, 23-22, 23-23, 23-25, 23-33) | Recorded ops, env values |
| Test suite to its own protection | A removed check must be named, and a proof that cannot fail must not count (23-18, 23-19, 23-29, 23-30, 23-31) | Test titles, mutants, reach markers |
| Commit messages to the CI checks | A commit message is untrusted input (23-25) | Commit subjects and bodies |
| Register to later phases | A seal must describe exactly what was settled (23-26) | SEAL records, scan records |

---

## Threat Register

58 threats: 57 `mitigate` (all closed) and 1 `accept` (T-23-SC, which appears in every plan). Line references are at HEAD `2f2d9b0`. Rows marked "Hardening note" have an open info-level code review item; see the Hardening Notes section below.

| Threat ID | Plan | Category | Component | Severity | Disposition | Status | Evidence |
|-----------|------|----------|-----------|----------|-------------|--------|----------|
| T-23-01 | 23-01 | Tampering | seam attachment (test/realpath/harness/chain.ts) | high | mitigate | closed | `installSeams` chain.ts:250 throws if the ethers alias, the bundle-provider alias or the FetchRequest hook did not attach (:258, :262, :272). Every project loads the rails (vitest.config.ts:22), which deny non-loopback traffic (test/rails/setup.cjs:6) |
| T-23-02 | 23-01 | Tampering | fake chain data | medium | mitigate | closed | `latest` counts mined transactions only (chain.ts:27); reads are encoded with the real AbiCoder (:209); an unknown method or read is recorded as a stray and fails the test (:1693, :1876; harness.test.ts:189, :202) |
| T-23-03 | 23-02 | Repudiation | green suite hiding a mechanism mock | high | mitigate | closed | scripts/check-realpath-mocks.ts parses the AST (ts.createSourceFile :288, :436, :459) and checks a resolved-path allow list; runs in CI (test.yml:55). No test/realpath/triage file contains a `vi.mock` |
| T-23-04 | 23-02 | Tampering | known-bug marker passing on a setup failure | high | mitigate | closed | `knownBug` knownBug.ts:93 wraps one assertion with an exact deep-equal and catches nothing else (header :14). Its behaviours are proven at harnessCapture.test.ts:405 onward: still broken passes, looks fixed throws, a third value fails, and an error during the compare reaches the test unchanged (:449) |
| T-23-36 | 23-02 | Repudiation | capture failure hidden by a production catch | high | mitigate | closed | Violations go to an out-of-band list (capture.ts:217), and `assertNoViolations` (:389) runs in afterEach (setup.ts:241), so a production catch cannot hide one (harnessCapture.test.ts header :7; WR-05 case :259) |
| T-23-05 | 23-03 | Repudiation | migration tests that mirror instead of run | medium | mitigate | closed | migrations.golden.test.ts:34 imports the real `migrateSchema` from src/utils/dbSchema and runs it |
| T-23-06 | 23-04 | Tampering | register outcome fields | high | mitigate | closed | One writer, .planning/audit/tools/set-triage.ts (atomic write, :98). The rules are in check.ts `checkTriageField` :379, and `--self-test` :1808 proves each one |
| T-23-07 | 23-04 | Repudiation | S0/S1 closed without the operator | high | mitigate | closed | check.ts:764: NOT-A-BUG on an S0/S1 finding needs a `ruling_ref` to a review record that rules on that exact ID. Review records must carry `operator_response` (:601) |
| T-23-52 | 23-04 | Repudiation | self-test standing in for a real proof | high | mitigate | closed | Only calls in the evidence zone (check.ts:357) feed the finding rules. A location guard (:496) refuses the reserved literal inside the triage folder (:540), and self-tests at :2071-2085 prove both directions |
| T-23-37 | 23-04 | Tampering | triage population shrinking | high | mitigate | closed | inputs/triage-population.json is frozen at 7d1c699 and joined with the live set (check.ts:361). A downgrade never drops the S0/S1 rules (:567, :696). It holds 61 IDs, not the 59 in the plan text: AUD-ANTIRUG-018 was raised to S1 (ESC-ANTIRUG-03) and AUD-ANTIRUG-024 added (ESC-ANTIRUG-02). The set only grew |
| T-23-08 | 23-05 | Repudiation | buy-path RED tests | medium | mitigate | closed | Exact-value `knownBug` markers; the real `Transaction.from` decode is used in 8 AUD-BUY tests; on-chain halves are recorded as `needs_fork` in the findings (for example AUD-BUY-015.json, AUD-BUY-033.json) |
| T-23-09 | 23-06 | Elevation | Telegram allowlist and dashboard stop | high | mitigate | closed | AUD-BUY-006 drives the real inline handler in src/telegramListener.ts through the client fake (import :29, harness/telegram.ts). AUD-BUY-011 uses the real `startApiServer`, the real login and the real POST /api/chains/eth/stop over loopback (:9-12). Neither file has a `vi.mock` |
| T-23-38 | 23-06 | Information disclosure | real signing script run as a child (AUD-BUY-001) | critical | mitigate | closed | The child starts through `runRailedChildToEnd`, which calls `spawnRailedChildAsync` (loopback.ts:194-195), with sentinel env. AUD-BUY-001.test.ts:158 asserts the printed wallet is the sentinel address. In the ledger (:280-287) every allowed connection is loopback, and the only blocked event is `env-read-blocked` on `.env` |
| T-23-10 | 23-07 | Repudiation | exit RED tests | medium | mitigate | closed | The real monitor runs on the fake clock (world.ts `createScenario`/`stepFor`, `vi.advanceTimersByTimeAsync` :99). Sells are decoded in AUD-EXIT-001/003/004/015, and real-token behaviour is flagged for the Phase 25 fork (AUD-EXIT-003) |
| T-23-11 | 23-08 | Repudiation | exit lifecycle RED tests | medium | mitigate | closed | Real routes over loopback (AUD-EXIT-007, AUD-EXIT-008, AUD-API-001). No `setTimeout` or sleep in any of the plan's test files |
| T-23-12 | 23-09 | Repudiation | nonce and race tests | high | mitigate | closed | The real `withNonceLock` runs in AUD-TX-001/002/003 and AUD-BUY-004. No `vi.mock` and no sleeps in the plan's files. CR-03 (lock-released misread) is fixed |
| T-23-13 | 23-10 | Repudiation | WebSocket lifecycle RED tests | medium | mitigate | closed | Subscriptions are read from the fake node (AUD-ANTIRUG-001, AUD-API-002, AUD-BUY-008) with no `vi.mock`. The real-socket crash case is in 23-12 (fixtures/wsReconnectRefused.ts). CR-01 and CR-04 are fixed |
| T-23-14 | 23-11 | Repudiation | risk and DB tests | medium | mitigate | closed | AUD-DB-001..004 run on a real graph (`createScenario`/`createTempDbFile`). AUD-DB-007 re-measures the real connection through a railed child (:120) |
| T-23-15 | 23-12 | Denial of service | crash-class proofs | medium | mitigate | closed | Each proof spawns through `spawnRailedChild` (AUD-ANTIRUG-002:57, AUD-API-008:42, AUD-TX-009:46, AUD-BUY-005:64) and has a healthy control and a contained case |
| T-23-16 | 23-13 | Tampering | db.ts import proof | medium | mitigate | closed | AUD-DB-006 (fixture dbImportWrites.ts) runs db.ts in a railed child with DB_PATH set to a temp file and compares the main file's hash (:23, :41-43, :58) |
| T-23-17 | 23-14 | Repudiation | closed entries | medium | mitigate | closed | check.ts:771: outcome `fixed` needs a `closes-finding: <ID>` marker next to the rail test, matched on the exact ID |
| T-23-18 | 23-15 | Information disclosure | relay-probe-tx006.ts | high | mitigate | closed | The key is a throwaway from `Wallet.createRandom` (:206). The tool never reads `.env`, dotenv or a bot key, and it sends only with `--confirm-approved` (:241) |
| T-23-19 | 23-15 | Spoofing | outside network call | medium | mitigate | closed | One POST to `RELAY_URL` (:54), made after the operator approved the dry-run preview at the 23-15 Task 2 checkpoint. The answer (HTTP 403) is recorded |
| T-23-39 | 23-15 | Repudiation | ambiguous relay response closing the candidate | high | mitigate | closed | `classifyRelayResponse` (:89) was fixed before the request went out. The 403 is classed inconclusive, so AUD-TX-006 stays unreproduced (23-15-SUMMARY:113) |
| T-23-20 | 23-16 | Repudiation | S0/S1 operator rulings | high | mitigate | closed | Review records require the verbatim `operator_response` and per-finding `rulings` (check.ts:601); the ruling must list the finding (:764). The report is generated from real test metadata (scripts/triage-report.ts) |
| T-23-40 | 23-16 | Repudiation | a run missing a test or claim | high | mitigate | closed | triage-report.ts:334 compares at least three runs on the full tuple and checks completeness against the frozen population (:417-420). The evidence file is written only from a clean match |
| T-23-21 | 23-17 | Elevation | new signing site outside withNonceLock | high | mitigate | closed | check-signing-census.ts is type-aware (`ts.createProgram`/`getTypeChecker` :353-354). Unknown lock status fails (:51), and surplus sites fail. Runs in CI (test.yml:56-67). CR-08 and CR-09 (delegations, `getFunction` values) are fixed |
| T-23-22 | 23-17 | Tampering | exception list quietly growing | high | mitigate | closed | AC-53: every listed unlocked site names a registered finding and a covering decision (:2060, `decision-does-not-cover` :1808). The floor history is read from git, and a shallow clone exits 2 (:2384). Hardening note IN-24 |
| T-23-23 | 23-18 | Repudiation | converted tests losing protection | medium | mitigate | closed | In-memory mutants with a manifest (red-proof-conversions.ts:23). Renames and removals are recorded (test-identity.ts:10). Per 23-18-SUMMARY, no title changed and no source hash changed |
| T-23-24 | 23-19 | Repudiation | converted tests losing protection | medium | mitigate | closed | Same proof mechanism as T-23-23, plus the standing AST gate scripts/check-vi-mock-paths.ts (CI test.yml:45). Test identity is clean (23-19-SUMMARY) |
| T-23-25 | 23-20 | Information disclosure | recordings | high | mitigate | closed | A field-aware secret scan (test/realpath/recordingsScan.ts:23) walks every recording (:13). It is proven both ways in recordingsGuard.test.ts, and update-recordings.ts runs the same scan after a re-record (WR-35) |
| T-23-26 | 23-20 | Tampering | silent re-recording | high | mitigate | closed | Only update-recordings.ts sets `VITEST_CSB_UPDATE_RECORDINGS` (:3; serializer.ts:74). The serializer writes only when CI is unset and the update switch is live (:33), and the compare fails on a mismatch. The commit check is T-23-41. Hardening note IN-31 |
| T-23-27 | 23-21 | Tampering | scenario tags | medium | mitigate | closed | Tag rule test at recordingsGuard.test.ts:381; tag IDs are checked against the register |
| T-23-28 | 23-22 | Repudiation | non-ETH recordings | medium | mitigate | closed | otherRoutes.test.ts:136 asserts the checker read happened on every route, so a fail-closed skip cannot be recorded as a real path |
| T-23-29 | 23-23 | Information disclosure | env snapshot files | high | mitigate | closed | The secret scan covers all 108 files under test/realpath/recordings/env. Sentinel values are allowed only by exact value under named keys (recordingsScan.ts:25) |
| T-23-30 | 23-24 | Tampering | in-process boot test | high | mitigate | closed | boot.test.ts:6 calls `startMultiChainBot` in-process and never starts src/main.ts or src/bot.ts as a program. `BOOT_ENV` (:71) binds 127.0.0.1 on port 0; the rails stay on |
| T-23-31 | 23-25 | Elevation | commit check bypass by a shallow clone | high | mitigate | closed | check-commit-taxonomy.ts:47: a shallow clone exits 2. CI uses `fetch-depth: 0` (test.yml:21) |
| T-23-32 | 23-25 | Tampering | commit message and path injection | medium | mitigate | closed | git is called with argument arrays (`spawnSync` :115); IDs use a bounded regex (:87) and are looked up in the judged commit's own tree. Hardening note IN-25 |
| T-23-41 | 23-25 | Tampering | laundering a recording by deleting and re-adding it | high | mitigate | closed | Re-adding a path that existed earlier counts as a change (:11), proven by a self-test. A merge-only change prints a warning under AC-42 |
| T-23-33 | 23-26 | Tampering | Phase 22 seal | high | mitigate | closed | seal-verify.ts never writes SEAL.json (:57). SEAL.json last changed in 28f8f5f (Phase 22), and no commit in `main..HEAD` touches it. The successor seal is SEAL-23b.json |
| T-23-34 | 23-26 | Information disclosure | commits in the phase | high | mitigate | closed | The phase scan of 912b915..bd35d87 recorded 0 non-public hits (SEAL-23b.json, inputs/phase-scan-23b.json). **This audit** ran `seal-verify.ts --scan --seal .planning/audit/SEAL-23b.json` over the six later commits (bd35d87..2f2d9b0): 0 hits, `SEAL VALID`, so every Phase 23 commit has been scanned. Hardening note IN-30 |
| T-23-42 | 23-26 | Tampering | a substituted scan record | high | mitigate | closed | Successor-seal rules (seal-verify.ts:44-56) check the scan record's digest, range and predecessor linkage, with `--self-test`. CR-10 is fixed: the seal record is read from git and anchored. Hardening notes IN-29, IN-30 |
| T-23-43 | 23-27 | Tampering | temp-file database path in loadGraph | high | mitigate | closed | `assertTempDbFile` (world.ts:279-295) refuses relative, UNC/ADS and non-tmpdir paths. It runs at :340, before the first src/ import (:347). Memory mode refuses a DB_PATH other than `:memory:` (:336-337). The src-side `assertNotProdDbUnderVitest` and the rails DB tripwire sit underneath. Hardening note IN-08 |
| T-23-44 | 23-27 | Spoofing | child process reaching a real endpoint | high | mitigate | closed | Children start through `runRailedChildToEnd`, which calls `spawnRailedChildAsync` (loopback.ts:194-195). The ledger, read after the run, shows loopback-only connections (AUD-BUY-001.test.ts:280-284; harnessRestart.test.ts:301) |
| T-23-45 | 23-27 | Tampering | harness change under plans that already proved something | high | mitigate | closed | The Harness Gap Procedure is in force from 23-27 on. One gap was raised (23-15): the operator chose allow-harness-change, it landed as one harness-only commit (65172c9), and the full realpath re-run gave 76/76 with all 71 baseline rows identical (23-15-SUMMARY:51-55, :86). The 23-33 serializer change has an owner named by operator ruling. Later harness commits are WR-* review fixes, and UAT (187 passed) ran after them |
| T-23-48 | 23-27 | Tampering | subscription delivery over a real socket (loopback.ts) | medium | mitigate | closed | Each subscription belongs to the socket that opened it (loopback.ts:11). harness.test.ts:789 shows only matching logs arrive |
| T-23-35 | 23-28 | Tampering | node inclusion model (chain.ts) | high | mitigate | closed | `latest` counts mined transactions only (chain.ts:27). Admission uses geth's checks and error text: chain ID, nonce too low, replacement bump (:31). Transaction states (accepted, queued, replaced, dropped, mined) keep an ordered history (:599-604, :792). Hardening note IN-02 |
| T-23-47 | 23-28 | Tampering | fee answers and stored logs (chain.ts) | medium | mitigate | closed | Legacy-fee mode at chain.ts:815. Logs are built with real encoders and filtered by address and topic for both `eth_getLogs` and subscriptions (harness.test.ts:789) |
| T-23-46 | 23-29 | Tampering | in-memory edit of the railed spawner | high | mitigate | closed | The overlay applies only under scripts/vitest.in-memory-mutant.config.ts and only when `CSB_MUTANT_SPEC` is set (:9). Each find must occur exactly once (in-memory-mutant-overlay.cjs:15). The rails preload stays first, and test/rails is unchanged on disk (23-29-SUMMARY) |
| T-23-53 | 23-29 | Repudiation | a guard row excusing a stray mutant | high | mitigate | closed | A guard must name exactly one literal test title found by AST and tie to a named conversion (red-proof-conversions.ts:167). Guard counts are pinned, and each rule has a self-test case |
| T-23-49 | 23-29 | Repudiation | a mutant that never applied or never reached its target | high | mitigate | closed | Exactly-once finds, reach markers, assertion-only failures on the expected tests, and a passing no-mutant run. `--self-proof` shows each refusal firing (red-proof-conversions.ts:27, :1110) |
| T-23-50 | 23-30 | Repudiation | anti-rug and config conversions losing protection | medium | mitigate | closed | In-memory mutant RED proofs. The never-compiled type assertion is replaced by a real `ts.createProgram` query (test/unit/exitEngine/antiRugReason.test.ts:311). The one removed assertion is named (23-30-SUMMARY) |
| T-23-51 | 23-31 | Repudiation | CLI, lock and entry-point conversions losing protection | medium | mitigate | closed | In-memory mutants with nothing written under src/ or scripts/. A guard row keeps the lock-before-start order, and renames are honoured by test identity (23-31-SUMMARY) |
| T-23-32a | 23-32 | Tampering | triage-evidence.json | medium | mitigate | closed | Regenerated from three identical runs; the only difference is the one recorded title (23-32-SUMMARY:20, :94) |
| T-23-32b | 23-32 | Information disclosure | in-process boot | low | mitigate | closed | `BOOT_ENV` binds 127.0.0.1 on port 0 (boot.test.ts:71). All four ledgers show nonLoopbackAllowed 0 and telegramAllowed 0 (23-32-SUMMARY:176, :249) |
| T-23-33a | 23-33 | Tampering | which recording a scenario compares | high | mitigate | closed | Each comparison is recorded per run (serializer.ts `compareRecording`). check-recordings-compared.ts runs in CI right after `test:realpath` (test.yml:29-39), and the WR-28 fix counts only a match as compared |
| T-23-33b | 23-33 | Repudiation | stale run records | medium | mitigate | closed | The check reads only the judged run's records, and a missing record exits 2 (check-recordings-compared.ts:72, :426). Hardening note IN-23 |
| T-23-SC | all | Tampering | npm / pip / cargo installs | low | accept | closed | No dependency change in Phase 23: from the merge base to HEAD, package.json changes only in `scripts`, and package-lock.json has no `version` or `resolved` line changes. See AR-23-01 |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-23-01 | T-23-SC | Every plan's threat model accepts supply-chain risk on the grounds that it installs no packages. Confirmed at audit: package.json changes only add npm scripts, and package-lock.json is unchanged. | Plan-time disposition (all 33 plans); confirmed by audit | 2026-11-13 |

*Accepted risks do not resurface in future audit runs.*

---

## Hardening Notes (untriaged review items on closed threats)

Each threat below has its planned control in the code, so it is closed. The Phase 23 code review (23-REVIEW.md) also found a weaker edge next to each control. Those items are still `open` in 23-REVIEW-DISPOSITION.md, meaning recorded but not yet triaged. None removes a control, and each is info severity in the review. They are listed here so the link to the threat is not lost.

| Review item | Threat | Gap | Why the threat stays closed |
|-------------|--------|-----|------------------------------|
| IN-08 | T-23-43 | In file mode, loadGraph checks that db.ts opened the requested path only after the import. Memory mode never confirms `getDbFilePath()` is `:memory:` after the import. | The non-tmpdir refusal runs before any src/ import (world.ts:340). The src-side `assertNotProdDbUnderVitest` and the rails DB tripwire also block the live DB. |
| IN-02 | T-23-35 | A relay-accepted transaction with an already-mined nonce stays `accepted` forever, and a later `mine()` throws a misleading error. | It never shows as mined, and the failure is loud. The threat ("an unmined submission looks mined") cannot happen. |
| IN-24 | T-23-22 | A floor drop passes if its message names any AUD- ID registered at HEAD, not necessarily the finding that removed the site, and the git calls are not hardened. CI comment test.yml:56-57 claims more than the code does. | A floor drop still has to name a registered finding in a visible commit, and exceptions need a covering decision (AC-53). Growth cannot be quiet. |
| IN-30 | T-23-34, T-23-42 | seal-verify's git calls ignore replace refs and `log.showRoot`. Through the exported library API, a requested scan with no `scan_fn` reads as clean. | The CLI always passes a scanner. This audit's run scanned for real: the range fixtures found their planted hits, then 0 hits over bd35d87..HEAD. |
| IN-29 | T-23-42 | The combined merge listing can miss a merge that takes a non-first parent's old version, undone by a later merge. | The hidden content can only be a version already reachable from `sealed_sha` (review's own impact note). |
| IN-23 | T-23-33b | `--sole-run` does not confirm that the run it judges is the realpath step's run. | Today no unit or integration test calls `compareRecording`, and the zero-run and two-run cases fail closed. This is a future-proofing gap. |
| IN-25 | T-23-32 | The commit check's ID lookup accepts any blob at `findings/<ID>.json`, even an empty file. | Injection is still blocked: argument-array git, a bounded regex, and a lookup in the judged commit's tree. |
| IN-31 | T-23-26 | The normalizer's broad regexes and lossy error and class handling could erase real differences in future recordings. | None of the current recordings contains `$error` or `$class`; the gap is latent. |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-13 | 58 | 58 | 0 | gsd-secure-phase orchestrator (L1 evidence check per threat; auditor not spawned per the ASVS-1 short-circuit rule; seal-verify --scan run over bd35d87..2f2d9b0) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-13
