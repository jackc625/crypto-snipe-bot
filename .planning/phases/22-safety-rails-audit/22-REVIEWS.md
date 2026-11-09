---
phase: 22
reviewers: [codex, antigravity]
reviewed_at: 2026-11-06T22:55:53Z
plans_reviewed: [22-01-PLAN.md, 22-02-PLAN.md, 22-03-PLAN.md, 22-04-PLAN.md, 22-05-PLAN.md, 22-06-PLAN.md, 22-07-PLAN.md, 22-08-PLAN.md, 22-09-PLAN.md, 22-10-PLAN.md, 22-11-PLAN.md, 22-12-PLAN.md, 22-13-PLAN.md, 22-14-PLAN.md, 22-15-PLAN.md, 22-16-PLAN.md, 22-17-PLAN.md, 22-18-PLAN.md, 22-19-PLAN.md, 22-20-PLAN.md, 22-21-PLAN.md, 22-22-PLAN.md, 22-23-PLAN.md, 22-24-PLAN.md, 22-25-PLAN.md, 22-26-PLAN.md, 22-27-PLAN.md, 22-28-PLAN.md, 22-29-PLAN.md]
models:
  codex: "gpt-6.1-sol (reasoning=xhigh)"
  antigravity: "gemini-4-argon-high"
model_sources:
  codex: "pinned"
  antigravity: "pinned"
---

# Cross-AI Plan Review — Phase 22

<!-- gsd:plan-revision-conflicts:begin -->
## Plan-Revision Conflicts
<!-- gsd:plan-revision-conflicts:end -->

> **Lane status:** Codex produced a full source-grounded review (29/29 plans). **Antigravity dropped**: attempt 1 hit its 9-minute print timeout with the turn still in progress; attempt 2 (timeout raised to 1800 s for the retry only, config restored afterwards) was refused with `RESOURCE_EXHAUSTED (429): Individual quota reached — resets in 75h46m`. Claude was skipped for independence (orchestrator runtime). This is effectively a **single-reviewer** review.

## Codex Review

Reviewed all **29 plans** against repository source and installed library code. This was a read-only review: I did not run Vitest, Hardhat, the bot, migrations, or secret scans. Proposed implementation files do not yet exist, so their guarantees remain implementation obligations.

## 22-01

**Summary:** The backup-first approach is appropriate, with useful fixture checks and independent manifest verification. The starting revision and backup inventory need tightening.

**Strengths:**

- Backs up the actual ignored state: `.gitignore:28` excludes `data/`, while `ignition/.gitignore:1` excludes deployment journals.
- Raw copying avoids the import-time writes in `src/utils/db.ts:17`, `:20`, and `:235`.

**Concerns:**

- **HIGH:** `22-01-PLAN.md:137` records `phase_start_sha` after Task 1 commits the backup tool. Consequently, the later `phase_start_sha..HEAD` scan excludes that first implementation commit.
- **MEDIUM:** Directory enumeration defines much of the expected inventory. A missing optional deployment artifact can disappear from both the backup and manifest without detection. Symlink/junction handling is unspecified.

**Suggestions:**

- Record an immutable phase-start revision before Task 1; record the backup-tool revision separately.
- Define mandatory files per existing deployment, reject links escaping the source tree, and compare source and backup inventories.

**Risk assessment: MEDIUM.** Sound preservation method, with gaps in provenance and completeness checks.

## 22-02

**Summary:** Artifact provenance and the operator-only exact-value check are strong choices. Scanner effectiveness and network isolation are insufficiently demonstrated.

**Strengths:**

- Verification precedes execution (`22-02-PLAN.md:99`).
- Exact-value checking addresses secrets that keyword rules may miss, including the Telegram token embedded in the endpoint at `src/utils/notifier.ts:10`.

**Concerns:**

- **HIGH:** Proxy variables are described as blocking internet access, but they establish proxy configuration, not an enforced network boundary (`22-02-PLAN.md:174`).
- **HIGH:** The custom rules and two-pass public-key classification lack executable scanner fixtures. An incorrectly scoped allowlist could suppress another secret on the same line (`22-02-PLAN.md:101`).
- **LOW:** `unset-or-too-short` is an additional output state that later acceptance rules do not consistently support (`22-02-PLAN.md:103`).

**Suggestions:**

- Add scanner fixtures for private keys, sessions, binary/archive contents, and a public key sharing a line with a non-public secret.
- Use enforced network isolation or accurately describe the proxy measure.
- Standardize the exact-value result schema.

**Risk assessment: HIGH.** A false-clean result authorizes the backup upload.

## 22-03

**Summary:** Download-back verification appropriately tests the off-machine copy. The machine-readable acceptance gate currently permits incomplete secret-check evidence.

**Strengths:**

- The downloaded archive must match the original hash and its extracted manifest (`22-03-PLAN.md:149`).
- The decision checkpoint explains the disclosure and provides a USB alternative.

**Concerns:**

- **HIGH:** The verification at `22-03-PLAN.md:155` accepts an absent or empty `exact_value_check`: `Object.values({}).every(...)` returns true.
- **MEDIUM:** The same expression accepts arbitrary values other than `"yes"` and does not verify the required key set or both target checks.
- **LOW:** Manifest entry-count equality appears in acceptance prose but not the automated gate (`22-03-PLAN.md:160`).

**Suggestions:**

- Require the complete named key set, valid result enums, evidence covering both targets, and matching manifest counts.
- Bind the operator’s result to the archive hash and checker revision.

**Risk assessment: HIGH.** SAFE-01 can presently be declared valid without the required exact-value evidence.

## 22-04

**Summary:** Structured findings and mechanical validation are valuable, but the proposed inventory and schema rules contain execution blockers.

**Strengths:**

- Fixed-revision evidence and explicit ownership support reproducibility (`22-04-PLAN.md:121`).
- Mandatory sibling checks are appropriate for duplicated implementations such as risk parsing in `src/riskManager.ts:28` and `src/api/routes/risk.ts:80`.

**Concerns:**

- **HIGH:** The slice globs are passed directly to `git ls-tree`. I verified that `src/api/**`, `src/utils/honeypot/**`, and the TX brace expression return **zero files**, while literal `src/api` returns 14.
- **HIGH:** The checker requires escalation for every `secret` tag, conflicting with the expressly non-escalated known-public entries (`22-04-PLAN.md:139`).
- **MEDIUM:** “Every slice has 20 sweep cells” includes special slices that are not assigned sweep files.
- **MEDIUM:** ESC-PRE-02 initially lists `RC-10`, whereas backlink validation expects finding IDs (`22-04-PLAN.md:171`).

**Suggestions:**

- Materialize one authoritative file list before invoking Git.
- Resolve classification exceptions, special-slice capabilities, and escalation aliases in the schema and self-tests.
- Preserve actual acknowledgement evidence rather than manufacturing verbatim responses.

**Risk assessment: HIGH.** These tools could reject valid output or certify incomplete coverage.

## 22-05

**Summary:** The shared preload/setup implementation is well grounded in installed library behavior. Committing the sentinel file and preventing raw access to production files need explicit treatment.

**Strengths:**

- The native constructor interception matches `node_modules/better-sqlite3/lib/database.js:48` and `:69`.
- Removing dotenv and disabling Vite env loading addresses the existing startup read in `vitest.config.ts:2`.

**Concerns:**

- **HIGH:** `.gitignore:20` ignores `test/.env.test`. I verified this with `git check-ignore`; ordinary explicit-path staging will refuse the file.
- **HIGH:** Blocking SQLite filename opens does not prevent raw DB reads or writes. Buffer construction becomes an anonymous database at `node_modules/better-sqlite3/lib/database.js:16`, and the proposed filesystem wrappers protect `.env` paths, not `data/`.
- **MEDIUM:** Both projects share ledger control filenames (`22-05-PLAN.md:173`), creating run-attribution and overwrite risks.

**Suggestions:**

- Add a narrowly scoped sentinel-file exception or explicitly force-add it.
- Protect production data through relevant filesystem APIs as well as SQLite.
- Allocate ledger directories by unique invocation ID.

**Risk assessment: HIGH.** The current design is narrower than its production-isolation claim.

## 22-06

**Summary:** The evidence-copy/working-copy separation is careful. Literal matching must not be treated as proof of test authorship.

**Strengths:**

- The two-image comparison matches the real schema keys in `src/utils/db.ts:35`, `:68`, `:131`, and `:148`.
- Keeping recovery writes confined to W protects the backup and evidence image.

**Concerns:**

- **HIGH:** A token occurring in tests does not prove a test wrote its database row. `test/fork/fixtures/realLaunches/eth-v2-tp.json:5` deliberately contains the real LADYS address.
- **MEDIUM:** `22-06-PLAN.md:116` can mark such rows confirmed test-origin evidence. Generated addresses can also evade literal extraction.
- **MEDIUM:** The forensic finding is always tagged `rail`, but its checkpoint is conditional on matching rows; this conflicts with mandatory rail escalation.

**Suggestions:**

- Report `test_literal_matches` separately from attributed test writes.
- Require corroboration for authorship and preserve an “unknown origin” classification.
- Make integrity failures fatal and align escalation rules.

**Risk assessment: HIGH.** Incorrect attribution could mislead subsequent recovery decisions.

## 22-07

**Summary:** Blob-level verification is the right acceptance mechanism. The planned commit-count expectation needs correction.

**Strengths:**

- Addresses both actual ignore mechanisms: `.gitignore:36` and `ignition/.gitignore:1`.
- Checks committed bytes rather than relying on working-tree line endings (`22-07-PLAN.md:100`).

**Concerns:**

- **LOW:** Ten total deployment files do not mean ten changed paths in the OD-21 commit. The four already tracked, unchanged files will not appear in its diff.
- **MEDIUM:** Deferring the line-ending rule knowingly leaves a checkout hazard; the later recheck detects it only after the working copy changes.

**Suggestions:**

- Separate “ten tracked files total” from “six newly tracked files expected.”
- Preserve the manifest-based restore procedure and verify both ignore behavior and blob equality.

**Risk assessment: MEDIUM.** Preservation is strong; operational expectations need precision.

## 22-08

**Summary:** Starting with rail-only tests and fixture liveness checks is prudent. The child helper and ledger acceptance need stronger boundaries.

**Strengths:**

- Fake-root liveness precedes real-root DB assertions (`22-08-PLAN.md:147`), appropriately protecting the import-time open at `src/utils/db.ts:17`.
- Tests cover module-scope imports and child processes.

**Concerns:**

- **HIGH:** Restrictions are specified for `inheritedEnv`, but not equivalently for post-install `envOverrides` and extra Node options (`22-08-PLAN.md:117`). These can affect protection inherited by descendants.
- **MEDIUM:** The wrapper accepts a recent shared summary rather than proving it belongs to the exact invocation and every selected project (`22-08-PLAN.md:115`).
- **MEDIUM:** Zero instrumented allowance events do not independently establish zero successful outbound traffic.

**Suggestions:**

- Define permitted override keys and launcher/Node options explicitly.
- Bind worker and child records to one run ID; fail on missing project or worker evidence.
- Keep native helper commands narrowly enumerated.

**Risk assessment: HIGH.** These facilities become the trust base for subsequent verification.

## 22-09

**Summary:** The guards address real hazards, and the verbatim migration extraction is sensible. The actual write-open remains vulnerable to changes after probing.

**Strengths:**

- Directly addresses unconditional version writes at `src/utils/db.ts:232` and cwd-dependent resolution at `:9`.
- The migration-body comparison protects the substantial existing schema function at `src/utils/db.ts:29`.

**Concerns:**

- **HIGH:** The read-only probe closes before `new Database(DB_PATH)` opens read-write (`22-09-PLAN.md:142`). Deletion or replacement between those operations can still create or modify an unintended DB.
- **MEDIUM:** `db:init` lacks coverage for a non-empty version-0 database, sidecars, and interrupted initialization (`22-09-PLAN.md:176`).

**Suggestions:**

- Use `fileMustExist` on production write opens and revalidate the version before migration writes.
- Add fixture-only deletion/replacement races.
- Test version-0 databases containing tables/data and define atomic initialization behavior.

**Risk assessment: HIGH.** Refuse-to-create must hold at the actual write boundary.

## 22-10

**Summary:** The catch-path notifier refusal correctly preserves dashboard behavior. One prescribed probe path is wrong.

**Strengths:**

- Matches the existing notifier structure: the catch ends at `src/utils/notifier.ts:50`, then broadcast occurs at `:54`; the missing-credentials branch returns at `:40`.
- Spying on axios makes the refusal’s RED demonstration safe.

**Concerns:**

- **HIGH:** `test/rails/probes/dotenvProbe.ts` imports `../../src/config` in `22-10-PLAN.md:130`. That resolves under `test/`, not the repository’s `src/`.
- **MEDIUM:** Dynamic dotenv proof covers config; the other four sites receive only source-pattern checks.

**Suggestions:**

- Correct the import to `../../../src/config`.
- Add safe behavioral probes for the other reachable entry points and mutation proofs for both notifier send paths.

**Risk assessment: MEDIUM.** The design is sound after correcting the probe and strengthening coverage.

## 22-11

**Summary:** Centralizing fork RPC selection and eliminating parent-environment inheritance are useful. The exempt Hardhat child remains a distinct trust boundary.

**Strengths:**

- Replaces real unsafe inheritance at `test/integration/preflightCli.test.ts:40` and `test/integration/pauseCli.test.ts:282`.
- Centralizes the fallback currently present at `test/fork/setup.ts:8`.

**Concerns:**

- **HIGH:** The main-process import-closure scan cannot inspect what `execSync`/`spawn` later launches. The exempt setup starts Hardhat at `test/fork/setup.ts:14`, whose config reads `.env` at `hardhat.config.ts:9`.
- **MEDIUM:** The AST gate needs binding-aware handling of aliases, destructuring, re-exports, and dynamic imports to support its broad claim.

**Suggestions:**

- Explicitly distinguish closure safety from child-process safety.
- Define the sanitized Hardhat-child launch obligation.
- Add seeded alias and alternate-import fixtures to the spawn gate.

**Risk assessment: MEDIUM.** Unit/integration isolation improves substantially; fork-child isolation remains unresolved.

## 22-12

**Summary:** The strict identity/epoch mechanism is coherent. Its verification contains an unavoidable count mismatch.

**Strengths:**

- Guards real module state at `src/utils/nonceAuthority.ts:43` and `src/utils/exitManager.ts:14`.
- Keeps state-reset hooks separate from module-load identity.

**Concerns:**

- **HIGH:** Task 1 adds `vi.resetModules()` to `singleton.test.ts` (`22-12-PLAN.md:104`), but Task 2 demands exactly 37 matching files (`:135`). The earlier DB rail test also adds reset usage.
- **MEDIUM:** Junction imports under `--preserve-symlinks` can fail through dependency resolution before reaching the guard, producing a misleading proof unless the precise failure is checked.

**Suggestions:**

- Freeze the original 37-file set at the base SHA and verify that set remains passing; count new files separately.
- Require the precise duplicate error and evidence that the alias reached registration.

**Risk assessment: HIGH.** The prescribed acceptance command cannot pass unchanged.

## 22-13

**Summary:** Lock-before-import and a pinned SQLite handle are appropriate. The boot refusal and concurrency harness need stronger acceptance conditions.

**Strengths:**

- A separate entry avoids immediately importing the DB through `src/bot.ts:52`.
- Force-kill and GC scenarios test consequential lock failures.

**Concerns:**

- **HIGH:** Replacing the bottom block at `src/bot.ts:2359` refuses only after imports have run, including config and the DB. It does not establish refusal before production-state access.
- **MEDIUM:** A barrier file plus a 300 ms hold does not ensure every contender is ready before release (`22-13-PLAN.md:151`); slow contenders may legitimately acquire sequentially.
- **MEDIUM:** Stderr implementation must respect the existing prohibition on `console.error` in `test/unit/codeQuality.test.ts:66`.

**Suggestions:**

- Specify the direct-entry safety boundary precisely and test import-time effects on fixtures.
- Add READY handshakes and retain the winner until all contenders have attempted acquisition.
- Use `process.stderr.write` for early refusals.

**Risk assessment: HIGH.** Lock correctness and startup-boundary correctness require separate proof.

## 22-14

**Summary:** A static mock-resolution gate is useful and appropriately independent of test execution. Resolution fidelity is the main implementation risk.

**Strengths:**

- Covers the real relative-mock usage illustrated by `test/integration/killswitchCheckpoints.test.ts:115`.
- Fits the existing CI gate structure at `.github/workflows/test.yml:20`.

**Concerns:**

- **MEDIUM:** Trying filename suffixes and hand-reading `exports` can diverge from Vitest/TypeScript resolution (`22-14-PLAN.md:93`), especially for conditions, wildcard exports, aliases, and directories.
- **MEDIUM:** The three failing fixtures do not demonstrate that removing the scanner makes its own test fail.

**Suggestions:**

- Reuse installed resolution facilities where possible and require resolved targets to be actual modules.
- Add fixtures for directory indexes, `.js`-to-TypeScript resolution, conditional exports, and imported `vi` aliases.
- Include a mutation proof of disabled checking.

**Risk assessment: MEDIUM.** Useful gate, provided false positives and false negatives are controlled.

## 22-15

**Summary:** The full-suite gate is necessary, and the accommodation rules appropriately prohibit weakening assertions. Evidence capture needs to be more reproducible.

**Strengths:**

- Protects tests such as `test/unit/codeQuality.test.ts:79`, whose assertion should survive infrastructure changes.
- Extends acceptance beyond isolated rail tests to the actual unit/integration suite.

**Concerns:**

- **HIGH:** The live grep still assumes the original 37-file set (`22-15-PLAN.md:92`), although newly added tests increase it.
- **MEDIUM:** `ac19-run.json` requires before/after measurements, but the wrapper contract specifies a verdict rather than a machine-readable evidence artifact.
- **MEDIUM:** Equal test counts can conceal replaced tests or materially weakened coverage.

**Suggestions:**

- Verify original test identities from the base SHA, separately from newly added tests.
- Have the wrapper emit the evidence JSON directly, bound to the test report and run ID.
- Define a blocking disposition when genuine defects prevent green execution.

**Risk assessment: MEDIUM.** Strong gate once evidence and original-test preservation are made mechanical.

## 22-16

**Summary:** Isolated collection is justified by the existing import side effects. Export validation and before/after semantics need correction.

**Strengths:**

- Avoids collecting old tests beside the live DB opened at `src/utils/db.ts:17`.
- Explicit project selection avoids the fork setup configured at `vitest.config.ts:36`.

**Concerns:**

- **HIGH:** The export must contain no `.env*` (`22-16-PLAN.md:94`), but the tracked export necessarily contains `.env.example`. That exception must be explicit.
- **MEDIUM:** Most “before” outputs measure the post-rails tree. For example, lint includes newly added `src/` files; only test counts recover the earlier revision.
- **MEDIUM:** In `--phase after`, the pre-rail count is not recollected, but the comparison still requires it; loading the committed baseline is unspecified.

**Suggestions:**

- Permit only `.env.example`.
- Label phase-start and post-rails measurements separately.
- Define after-mode input baselines and canonicalize temp paths and collection diagnostics.

**Risk assessment: HIGH.** The baseline script currently has an export blocker and ambiguous comparison semantics.

## 22-17

**Summary:** The BUY audit targets meaningful code paths, particularly broad post-buy error handling. Its file-selection mechanism can omit the safety subtree.

**Strengths:**

- The catch at `src/bot.ts:1177` covers work after submission and monitoring setup, supporting the planned landed-buy/error investigation.
- The Telegram allowlist question is concrete at `src/telegramListener.ts:77`.

**Concerns:**

- **HIGH:** Direct `git ls-tree` use with `src/utils/honeypot/**` returns no files, omitting code such as `src/utils/honeypot/checkerContract.ts:345`.
- **MEDIUM:** Research descriptions can become presumed conclusions; the catch’s actual state transitions require tracing rather than accepting its “fail-clean” comment.

**Suggestions:**

- Use materialized file lists or literal directory prefixes.
- Record distinct failure points before submission, after mining, during persistence, and during monitoring.
- Keep independent discoveries separate from research-candidate mapping.

**Risk assessment: HIGH.** Good audit questions cannot compensate for incomplete source selection.

## 22-18

**Summary:** EXIT coverage is appropriately focused on recoverability, receipt handling, and idempotency. The price-probe candidate needs more precise framing.

**Strengths:**

- Zero private-sell floors are directly visible at `src/exitEngine.ts:364` and `:395`.
- Initial-price failure returns without starting monitoring at `src/exitEngine.ts:1869`.

**Concerns:**

- **MEDIUM:** Missing decimals alone does not establish the exact price-ratio defect. The code quotes a fixed raw token amount at `src/exitEngine.ts:328` and divides current by entry output at `:1714`; probe size, market impact, and zero output must be distinguished.
- **MEDIUM:** Re-entrancy and indefinitely pending waits are different mechanisms despite their shared RC-10 linkage.

**Suggestions:**

- Specify separate evidence obligations for unit mismatch, nonlinear quote effects, zero output, and non-finite ratios.
- Trace full, partial, resumed, and failed-held exits separately.
- Preserve individual causal claims under shared escalation records.

**Risk assessment: MEDIUM.** Strong scope, with some candidate wording that could encourage premature conclusions.

## 22-19

**Summary:** The anti-rug plan covers the principal emergency-response mechanisms. Its strongest contribution will be explicit lifecycle traces across reconnects and restarts.

**Strengths:**

- Shared-provider mutation is real at `src/anti-rug/detector.ts:925`.
- Threshold/window evaluation at `src/anti-rug/circuitBreaker.ts:107` warrants the planned exact-semantics inventory.

**Concerns:**

- **MEDIUM:** Circuit-breaker state is module-local at `src/anti-rug/circuitBreaker.ts:73`. The audit should explicitly distinguish intended restart reset from loss of required protection.
- **MEDIUM:** Subscription ownership crosses slice boundaries; detector-only reading cannot establish interactions with dashboard removal at `src/api/routes/chains.ts:141`.

**Suggestions:**

- Require written traces for reconnect during stop/start, backfill during a pending exit, and restart after breaker trip.
- Record all cross-slice evidence at the same base SHA.
- Give deferred OD-19 references an explicit external-owner representation.

**Risk assessment: MEDIUM.** The area scope is good; lifecycle evidence must cross module boundaries.

## 22-20

**Summary:** The TX audit is technically well motivated, including direct verification of ethers behavior. Its current slice selector is a serious completeness defect.

**Strengths:**

- Unbounded sequencing is visible in `src/utils/nonceAuthority.ts:65`.
- Installed ethers confirms timeout zero at `node_modules/ethers/lib.commonjs/providers/provider.js:1045` and doubled base-fee construction at `abstract-provider.js:625`.

**Concerns:**

- **HIGH:** The TX brace expression and `mevStrategies/**` both return zero files when passed directly to `git ls-tree`. The ledger check can compare two equally empty selections.
- **MEDIUM:** RC-10 combines nested-lock deadlock and an operation that never settles; fixing one must not close the other.

**Suggestions:**

- Enumerate the six utility files explicitly and use the literal strategy directory.
- Assert expected core files are present before auditing.
- Give distinct nonce-stall mechanisms independently verifiable subfindings.

**Risk assessment: HIGH.** Source-selection errors undermine this particularly important audit slice.

## 22-21

**Summary:** The DB/risk/config plan addresses consequential persistence and configuration behavior. Parser outcomes should be classified individually.

**Strengths:**

- Duplicated risk defaults are demonstrable at `src/riskManager.ts:28` and `src/api/routes/risk.ts:80`.
- Crash consistency questions follow directly from `src/utils/db.ts:22` and post-submission insertion at `src/bot.ts:1127`.

**Concerns:**

- **MEDIUM:** A blanket “NaN fails open” classification would be inaccurate: `src/chainRegistry.ts:676` explicitly rejects invalid block-age configuration.
- **MEDIUM:** Threshold schema completeness does not prove that every relevant parameter was discovered, particularly dynamic keys at `src/chainRegistry.ts:663`.

**Suggestions:**

- Inventory each parser and consuming comparison together.
- Generate a candidate list of static and dynamic env reads and relevant numeric constants, with explicit exclusions.
- Keep different-wallet/shared-DB exposure separate from the accepted same-wallet process-lock scope.

**Risk assessment: MEDIUM.** Strong audit scope; discovery completeness remains primarily manual.

## 22-22

**Summary:** API and dashboard coverage is appropriate, but emergency-sell eligibility deserves an explicit audit scenario beyond duplicate submission.

**Strengths:**

- The listener-removal concern is concrete at `src/api/routes/chains.ts:141`.
- Existing cookie/session behavior can be traced at `src/api/middleware/auth.ts:66` and `:83`.

**Concerns:**

- **HIGH:** Emergency sell selects only pending buys at `src/api/routes/controls.ts:126`, while recovery deliberately includes failed-held positions at `src/utils/db.ts:603`. The plan should explicitly investigate whether emergency sell omits still-owned failed exits.
- **MEDIUM:** Labeling dashboard numbers cosmetic could miss formatting that changes an operator’s understanding of exposure or sell size.

**Suggestions:**

- Require the failed-held emergency-sell trace and register its disposition.
- Audit amount formatting and stale-state presentation as operationally relevant.
- Keep CORS, CSRF, authentication, and duplicate execution as separate mechanisms.

**Risk assessment: HIGH.** Emergency controls must account for every still-held position.

## 22-23

**Summary:** Per-file test-quality labels will help later triage. The rubric needs to distinguish legitimate isolation from replacing the behavior being tested.

**Strengths:**

- Examining tests against their real targets addresses the assurance gap.
- Source-only tests such as `test/unit/bot/twoStageSigint.test.ts:133` can be accurately distinguished from runtime verification.

**Concerns:**

- **MEDIUM:** Assertions on mocks are not inherently hollow. The classification needs to identify the regression that could occur while the test remains green.
- **MEDIUM:** One file can contain both real-path and mechanism-mocking cases; a single label may obscure this distinction.

**Suggestions:**

- Identify affected test cases and the missing observable behavior within each finding.
- Record whether dependencies or the claimed mechanism are mocked.
- Require a concrete escaped-regression explanation for elevated severity.

**Risk assessment: MEDIUM.** Useful output depends on disciplined classification rather than mock counts.

## 22-24

**Summary:** The plan correctly targets schema drift and fork-test configuration. It must avoid treating all fork fixtures as synthetic data.

**Strengths:**

- Schema drift is explicit: `test/helpers/testDb.ts:69` sets version 4 while `src/utils/db.ts:27` supports version 7.
- The ineffective setting is visible at `test/fork/realLaunchReplay.fork.test.ts:75`; production reads `STOP_LOSS_PCT` at `src/config.ts:291`.

**Concerns:**

- **MEDIUM:** Real launch fixtures contain genuine mainnet token addresses, so their presence cannot establish test-origin DB contamination.
- **MEDIUM:** Provider mocks default to successful receipts at `test/helpers/mockProvider.ts:26`, whereas ethers has materially different replacement/error paths.

**Suggestions:**

- Classify fixture provenance explicitly: synthetic, public historical, or operator state.
- Map receipt mocks to status-zero, replacement, timeout, and reorg behavior.
- Give every changed, unexecuted fork file a named verification owner without claiming execution coverage.

**Risk assessment: MEDIUM.** Well-targeted audit, with attribution and fidelity risks.

## 22-25

**Summary:** Auditing signing scripts and tooling is essential. The proposed future lock-query recommendation would not itself prevent concurrent signing.

**Strengths:**

- Real out-of-process writes exist at `scripts/recover-sell-ladys.ts:70` and `scripts/addLiquidity.ts:48`.
- Deleted-artifact dependencies are concrete at `scripts/deploySepoliaTest.ts:7`.

**Concerns:**

- **HIGH:** Recommending `tryAcquireThenRelease` before signing creates a check-then-act window: the bot can acquire the lock after the query releases it and before the script signs.
- **MEDIUM:** Hardhat’s dotenv read and configured mainnet deploy accounts remain real boundaries at `hardhat.config.ts:9` and `:64`.

**Suggestions:**

- Recommend holding an appropriate lock throughout the signing operation, with an operator decision if required.
- Trace script side effects beyond transactions, including address-file writes at `scripts/addLiquidity.ts:76`.
- Keep Solidity logic explicitly outside this phase.

**Risk assessment: HIGH.** An advisory lock query would provide false concurrency assurance.

## 22-26

**Summary:** A source-derived signing census is valuable, but the specified detector cannot support “every signing site” yet.

**Strengths:**

- Type-aware detection improves on grep for dynamic contract calls such as `scripts/recover-sell-ladys.ts:78`.
- Reflog and merge coverage are explicitly specified.

**Concerns:**

- **HIGH:** Contract deployment is omitted from the detector’s method list. `scripts/deploySepoliaTest.ts:22`, `:32`, `:42`, and `:52` call `ContractFactory.deploy`, which signs transactions.
- **HIGH:** Dynamic contract APIs, unresolved types, and indirect caller chains cannot safely be treated as proven locked or excluded.
- **MEDIUM:** Message/auth signatures do not consume transaction nonces; grouping them with transaction signing can create incorrect violations.

**Suggestions:**

- Add deployment, method `.send`, aliases, and unresolved-type fixtures.
- Use `locked`, `unlocked`, and `unknown` with explicit evidence.
- Separate transaction signing from authentication signatures and reconcile a manually checked inventory.

**Risk assessment: HIGH.** The census can currently produce an incomplete authoritative N.

## 22-27

**Summary:** Payload preparation and union merging are sensible. The external assistants’ read isolation needs proof, and new findings need complete downstream artifacts.

**Strengths:**

- An exact send list and pre-send decision make disclosure reviewable (`22-27-PLAN.md:87`).
- Retaining unsupported external claims as candidates avoids silently discarding disagreements.

**Concerns:**

- **HIGH:** Changing cwd and selecting read-only/sandbox flags does not, by itself, establish that an assistant cannot read outside the export. The plan provides no filesystem-boundary verification.
- **MEDIUM:** Merge instructions update findings, ledgers, and sweeps, but do not require thresholds and operator cards for newly discovered behavior-changing recommendations (`22-27-PLAN.md:151`).

**Suggestions:**

- Demonstrate read confinement using a harmless denied file outside the export, or use a restricted environment with only approved source mounted.
- Extend merging to cards, thresholds, and deduplication provenance.
- Preserve independent output before exposing either assistant to existing findings.

**Risk assessment: HIGH.** Source-only disclosure must be enforced, not inferred from cwd.

## 22-28

**Summary:** Single-writer consolidation is appropriate. It needs stronger referential and coverage checks than field completeness alone.

**Strengths:**

- Preserving IDs and linking duplicates protects traceability (`22-28-PLAN.md:87`).
- Cross-linking definitions addresses real repeated defaults at `src/riskManager.ts:28` and `src/api/routes/chains.ts:88`.

**Concerns:**

- **HIGH:** Coverage derived from the same defective slice selectors can appear complete while omitting whole directories.
- **MEDIUM:** Merging duplicate findings can leave conflicting escalation records, severities, recommendations, or decision references unless each is explicitly reconciled.
- **MEDIUM:** Later re-audit findings can introduce cards after this plan has finished numbering them.

**Suggestions:**

- Compare coverage against an independently enumerated source universe.
- Validate every referenced finding, decision, escalation, threshold, and sweep membership.
- Make consolidation callable again after the final re-audit.

**Risk assessment: MEDIUM.** The process is sensible once upstream schema and inventory defects are repaired.

## 22-29

**Summary:** Final diff review and state re-verification are necessary. The proposed sealing process does not yet cover its own final output or fully satisfy the fork acceptance criteria.

**Strengths:**

- Rechecks the migration body against `src/utils/db.ts:29`.
- Rechecks Ignition working-tree bytes and blobs, addressing the genuine ignore/checkout hazards.
- Includes the real import-time migration and guard changes in independent review.

**Concerns:**

- **HIGH:** The scan covers `phase_start_sha..HEAD` before this task commits its own findings, rendered documents, and summary (`22-29-PLAN.md:145`). Those final changes are outside the scanned range.
- **HIGH:** Unexecuted fork assertions are registered as obligations, but registration does not satisfy “under every project” acceptance. The real fork setup still launches the dotenv-reading Hardhat child (`test/fork/setup.ts:14`; `hardhat.config.ts:9`).
- **MEDIUM:** Rails discoveries are all converted into `AUD-TESTQ`, although some may be production defects requiring different classification and ownership.

**Suggestions:**

- Seal a specific final revision, scan through it, and make subsequent changes invalidate the seal.
- Re-run consolidation after re-audit findings.
- Obtain the required fork evidence through a safe rehearsal or explicitly amend the acceptance contract.
- Preserve each discovery’s actual defect type.

**Risk assessment: HIGH.** The phase could otherwise close with unverified obligations and unscanned final changes.

## Overall assessment

**Recommendation: revise before execution. Overall risk: HIGH.**

The plans show strong attention to preservation, real-path testing, operator decisions, and behavior control. The main weaknesses are in the mechanisms intended to prove completion.

Prioritize these changes:

1. **Repair file enumeration.** Materialize exact file lists; the current `git ls-tree` wildcard and brace arguments omit important source.
2. **Repair the verification infrastructure.** Track the sentinel file, correct the dotenv probe path, freeze the original reset-test set, and use invocation-specific ledger evidence.
3. **Close protection gaps.** Address raw production-file access, child override boundaries, write-open races, and external-assistant read confinement.
4. **Correct evidence semantics.** Separate literal matches from test authorship, include deployments in the census, and validate complete secret-check results.
5. **Define a final seal.** Verify the actual final revision, reconcile late findings, and distinguish deferred fork work from satisfied acceptance criteria.

**Coverage: 29/29 plans reviewed. No repository files changed.**

---

## Antigravity Review

**Attempt 1 (default 600 s lane timeout):**

```
Antigravity review failed or returned empty output.
stderr:
[agy] print timeout after 9m0s with turn in progress; returning partial output
error: print timeout after 9m0s with the turn still in progress; the response is partial
AGY_ERROR: {"short_error":"print timeout after 9m0s with the turn still in progress; the response is partial","status":"DEADLINE_EXCEEDED","retryable":false,"reason":"print_timeout"}
If no agy run started, that is the pre-session-stall case: check whether a new ~/.gemini/antigravity-cli/brain/<conv-id>/ dir appeared within ~30s of launch.
```

**Attempt 2 (review.timeouts.antigravity = 1800, temporary):**

```
Antigravity review failed or returned empty output.
agy log hint (pinned model may be unavailable — run 'agy models' and set review.models.agy):
E1106 17:55:23.747578     455 errorreport.go:247] agent executor error: generating and executing: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 75h46m39s.
stderr:
error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 75h46m39s.
AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 75h46m39s.","status":"RESOURCE_EXHAUSTED","error_code":429,"code_kind":"http","retryable":true,"error_id":"ba3ff3b2-c5ce-422f-b0e8-4794793f707e-13"}
If no agy run started, that is the pre-session-stall case: check whether a new ~/.gemini/antigravity-cli/brain/<conv-id>/ dir appeared within ~30s of launch.
```

---

## Consensus Summary

Only one grounded review came back (Codex), so no concern is backed by two or more reviewers. Everything below is Codex's alone. To make up for the missing second reviewer, the orchestrator checked Codex's most consequential HIGH claims against the repo. Those results are recorded separately below and are not a reviewer verdict.

### Orchestrator spot-verification of Codex HIGH claims

| Claim | Check run | Result |
|---|---|---|
| Slice globs passed to `git ls-tree` return nothing (22-04 → 22-17/18/19/20/22) | `git ls-tree -r --name-only HEAD -- 'src/api/**'` → 0; `-- src/api` → 14; `'src/utils/honeypot/**'` → 0 vs dir → 7. `:(glob)` magic is rejected by ls-tree. | **Confirmed.** The per-slice `<automated>` checks call `execFileSync('git',['ls-tree',…,…s.globs])`. **Extra detail:** `git ls-files -- 'src/api/**'` *does* return 14, so the 22-04 `final` stage (ls-files) and the per-slice checks (ls-tree) disagree on `**`. Brace expansion (`src/utils/{nonceAuthority,txManager}.ts`) returns 0 under **both** commands. |
| `test/.env.test` is gitignored (22-05) | `git check-ignore -v test/.env.test` | **Confirmed:** `.gitignore:20:.env.*` |
| 22-03 SAFE-01 gate accepts an empty `exact_value_check` | `Object.values({}).every(v=>v!=='yes')` | **Confirmed:** `true`. The gate is `Object.values(o.exact_value_check\|\|{}).every(v=>v!=='yes')`, so a missing or empty object, or any non-`yes` value, passes. |
| 22-10 probe imports `../../src/config` from `test/rails/probes/` | `22-10-PLAN.md:130` | **Confirmed.** That resolves to `test/src/config`. The correct path is `../../../src/config`. |
| 22-12 hard-codes 37 reset/doMock files while adding new ones | `22-12-PLAN.md:135`, `test "$(echo $F \| wc -w)" -eq 37` | **Confirmed** as written. Task 1 adds `vi.resetModules()` usage, so the count changes. |
| 22-26 signing detector omits contract deployment | `22-26-PLAN.md:116` method list | **Confirmed.** There is no `ContractFactory.deploy` / `deploy` entry, and a factory is not a `Contract`/`BaseContract` instance. |
| 22-01 `phase_start_sha` is recorded after Task 1 commits | `22-01-PLAN.md:110` (Task 1 commits backup-state.ts) vs `:137` (Task 2 records HEAD) | **Confirmed.** A later `phase_start_sha..HEAD` range would exclude the backup-tool commit. |

### Highest-priority concerns (single reviewer; the first group is confirmed above)

1. **Slice file enumeration is broken.** The audit-completeness proofs in 22-04, 22-17 to 22-22 and 22-28 can certify coverage while whole directories (honeypot, API, TX utils) are missing. Materialize explicit file lists in `slices.json` and use one enumerator everywhere.
2. **Gates that pass vacuously or can't pass as written.** The 22-03 empty-object pass, the 22-12/22-15 fixed count of 37, the 22-10 wrong probe path, and the 22-05 sentinel file that can't be staged because it's ignored.
3. **Protection gaps relative to the SAFE-02 claim.** These are not yet verified by the orchestrator:
   - 22-05: raw `fs` access to `data/` is not covered.
   - 22-08: limits on child `envOverrides`/NODE_OPTIONS are not defined.
   - 22-09: race between the read-only probe and the read-write open; suggested fix is `fileMustExist`.
   - 22-11/22-29: the fork Hardhat child still reads `.env` via `hardhat.config.ts:9`.
   - 22-27: external-assistant read confinement is assumed from the working directory, not proven.
4. **Evidence semantics.**
   - 22-06/22-24: a literal match against real mainnet fixture addresses is not proof that a test wrote the row.
   - 22-26: deploys are missing from the census, and message signatures are mixed in with nonce-consuming sends.
   - 22-25: the `tryAcquireThenRelease` recommendation leaves a check-then-act window.
5. **Final seal.**
   - 22-29 scans `phase_start_sha..HEAD` before committing its own output.
   - 22-28 numbering and consolidation are not re-run after 22-29 re-audit findings.
   - Fork obligations are registered but never satisfied.
6. **Capital-path gap (22-22), confirmed by orchestrator trace and raised under D-STOP-THE-LINE.**
   - **Where a failed-held position lands:** when an exit fails on a position that is still held, the catch path writes `trades.status = 'failed'` (`src/exitEngine.ts:1163`) and `exit_state.exit_status = 'exit_failed_held'` (`src/exitEngine.ts:700` via `markExitFailedHeld`).
   - **Emergency sell skips it:** `/emergency-sell` selects `WHERE status = ? AND action = ?` with `('pending','buy')` (`src/api/routes/controls.ts:54-56`, `:126`).
   - **Force sell skips it too:** `/force-sell/:tradeId` uses the same `'pending'` filter (`controls.ts:70`).
   - **Result:** the operator's "sell everything" and "sell this one" buttons skip exactly the still-held positions whose sell already failed. If those are the only open positions, emergency sell replies `No open positions to sell`.
   - **Sibling of a fixed bug:** restart-resume was already fixed for this exact class (S-1 / T-21.2-DROPRUG; `getResumeExitMonitorTrades` unions `OR e.exit_status = 'exit_failed_held'`, `src/utils/db.ts:597-604`, `src/bot.ts:1893-1900`). The dashboard controls were not updated with it.
   - **Plan gap:** 22-22 covers emergency-sell idempotency and double-submit (`22-22-PLAN.md:100`) but not this selection gap.
   - **Next step:** add it to 22-22 as an owned item, or as a D-23 pre-phase record, and take it to the operator now rather than filing it.

### Agreed Strengths
None (needs 2+ reviewers). Codex alone credited:
- the backup-first ordering with fixture self-checks (22-01)
- blob-level Ignition verification (22-07)
- interception grounded in the installed better-sqlite3 and ethers source (22-05, 22-20)
- the catch-path notifier refusal (22-10)
- the single-writer consolidation design (22-28)

### Agreed Concerns
None (needs 2+ reviewers). See the single-reviewer priority list above.

### Divergent Views
None. There was no second review to compare against. Re-run `/gsd-review --phase 22 --agy` after the Antigravity quota resets (about 75 h from 2026-11-06T22:55Z) if an independent second opinion is wanted before execution.
