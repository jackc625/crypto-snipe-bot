---
phase: "22"
slug: "safety-rails-audit"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-09"
---

# Phase 22 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Test suite to production state | Tests, tools and child processes must not reach live state | Live DB, real .env, network, Telegram, wallet |
| Second process to wallet | A second bot or script could sign around the in-process nonce lock | Transaction signing |
| Tracked source to outside assistants | One-way disclosure for the second opinion | Tracked source files only |
| Parallel writers to the audit register | Many slices feed one register | Findings, severities, decision cards |
| Phase commits to git history | Secrets or rewrites introduced by the phase | Commits, sealed revision |

---

## Threat Register

29 rows are closed with partial proof; their evidence cell says PARTIAL and names the limit.

| Threat ID | Plan | Category | Severity | Disposition | Status | Evidence |
|-----------|------|----------|----------|-------------|--------|----------|
| T-22-01 | 22-01 | Tampering | high | mitigate | closed | scripts/backup-state.ts:869-905 before/after hashes fail a torn snapshot; self-check case d :1154; no better-sqlite3 import (comment only :64) |
| T-22-02 | 22-01 | Tampering | medium | mitigate | closed | backup-state.ts:873 staging, :949 rename; no-overwrite case e :1164; repo/OneDrive refusal :515-527, case g :1197 |
| T-22-03 | 22-01 | Information disclosure | high | mitigate | closed | Walk limited to ignition, data, bot-state bak (backup-state.ts:555-560); counts 10+6+1 in backup-record.json; has_env_file false in safe01-offmachine.json. PARTIAL: the no-env-path assertion is the 22-01 plan verify, not --verify; manifest not re-read (backup folder off limits) |
| T-22-67 | 22-01 | Repudiation | high | mitigate | closed | git: df33999 parent is 23a6461 (phase_start_sha); backup-tool commit 3f380bf recorded separately in backup-record.json and inside the range |
| T-22-68 | 22-01 | Tampering | medium | mitigate | closed | backup-state.ts:354 refuses links, :564-618 expected set with git-tracked + mandatory files, :910-914 staging equals source; cases h, i, j :1224-1241 |
| T-22-SC | 22-01 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; git shows no package-lock commit in phase range and a scripts-only package.json diff; AC-02 pass |
| T-22-04 | 22-02 | Elevation of privilege | high | mitigate | closed | TOOL.json pinned SHA, verify-asset output, exe_sha256, committed_to_repo false, no tracked binary; fixture-check.ts:349 refuses a different exe; nac01-backup-scan.json:6999 operator_approval. PARTIAL: approval interpreted by the orchestrator from pasted firewall output (operator_typed_token null) |
| T-22-05 | 22-02 | Information disclosure | medium | mitigate | closed | Firewall rule read-backs in nac01-backup-scan.json:6923-6997 and safe01-offmachine.json network_boundary; forbidden flags listed in TOOL.json:52-53 and absent from recorded scanner_args; proxies recorded as belt only |
| T-22-06 | 22-02 | Information disclosure | high | mitigate | closed | scripts/nac01-exact-value-check.ts:32-37 output shape, :287-306 hashes + enum only. PARTIAL: "agent ran only --self-test" is a process record (safe01 exact_value_check.run_by), not code-provable |
| T-22-69 | 22-02 | Spoofing | high | mitigate | closed | fixture-check.ts:570 hit key is line + columns; same-line cases :769, :908; archive case :812; requireProvenFixtures :1030-1033; binary_file_gap covered by checker binary case nac01-exact-value-check.ts:455-474 |
| T-22-SC | 22-02 | Tampering | high | mitigate | closed | Same evidence as T-22-04 (TOOL.json provenance, nac01-backup-scan.json operator_approval). PARTIAL: approval interpreted from pasted firewall output |
| T-22-07 | 22-03 | Information disclosure | high | mitigate | closed | safe01-offmachine.json decision: scanner + exact-value results shown before upload; operator chose "google drive"; USB option in the record |
| T-22-08 | 22-03 | Tampering | medium | mitigate | closed | safe01-offmachine.json: downloaded sha256 equals record, cmp identical, 17 manifest entries, 0 mismatches, zone id shows a real download |
| T-22-09 | 22-03 | Information disclosure | medium | mitigate | closed | safe01-offmachine.json exact_value_check holds enum results and hashes only |
| T-22-71 | 22-03 | Spoofing | high | mitigate | closed | safe01-offmachine.json six D-22 keys on both targets; TARGET hashes equal backup-record.json; CHECKER sha 703fd9ad re-hashed live by this audit (sha256sum) and equal |
| T-22-SC | 22-03 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-10 | 22-04 | Repudiation | medium | mitigate | closed | check.ts:350-354 null-response rule, :653 AC-39 uniqueness; dated records in .planning/audit/escalations |
| T-22-11 | 22-04 | Tampering | medium | mitigate | closed | One file per item; check.ts:834-835 prefix ownership, :839 and :859 uniqueness, :699 references, NAC-09 :243, NAC-10 :319, NAC-12 :380-393 |
| T-22-72 | 22-04 | Repudiation | high | mitigate | closed | lib.ts:317 rejects glob/brace, :350 single enumerator, :560-563 snapshot equality; slices.json files_at_base + counts; check.ts:725-728 and :926-928 universe at base and HEAD |
| T-22-73 | 22-04 | Repudiation | medium | mitigate | closed | check.ts:350-354; self-test case 13 :1391. PARTIAL: the tool requires an evidence field but cannot prove text is verbatim from the operator |
| T-22-SC | 22-04 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-12 | 22-05 | Information disclosure | high | mitigate | closed | core.cjs:1239-1249 scrub and sentinels; fs block :688-697 per protected root :331-357; vitest.config.ts:10 envDir false, no dotenv import; RED 22-08-1, 22-08-2 |
| T-22-13 | 22-05 | Tampering | high | mitigate | closed | core.cjs:897-961 addon Database wrapper, install throws on failure; RED 22-08-3; ledger db-tripwire 21 |
| T-22-14 | 22-05 | Information disclosure | high | mitigate | closed | core.cjs:989 opts.path test, :1172-1189 connect/DNS/UDP wrappers, :612 fork keeps Telegram deny; ac19 nonLoopbackAllowed 0, telegramAllowed 0. PARTIAL: fork half proven only by Hardhat-free rehearsal (UFV-01..03, fork-acceptance.json) |
| T-22-63 | 22-05 | Elevation of privilege | high | mitigate | closed | core.cjs:64 FORK_SHELL_KEYS, :1228-1256 captured once, re-applied in fork mode only; ledger stores key + state; childRails.test.ts:211 pin. PARTIAL: fork project rehearsal/unit only (UFV-01, UFV-02) |
| T-22-74 | 22-05 | Tampering | high | mitigate | closed | core.cjs:655-760 FS_PATH_APIS + installFsBlocks; selfcheck record 10 :476; residual documented :38; RED 22-08-7; ledger data-access-blocked 24 |
| T-22-75 | 22-05 | Repudiation | medium | mitigate | closed | ledgerRun.ts:6, :72-82 run folders; :209-254 summary with projects and workersByProject |
| T-22-76 | 22-05 | Information disclosure | medium | mitigate | closed | core.cjs:1148-1189 dgram deny; selfcheck record 11 :507; RED 22-08-9; ledger udp-deny 2 |
| T-22-SC | 22-05 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-15 | 22-06 | Tampering | high | mitigate | closed | forensic-db.ts:17 E never opened; :1196-1312 source and E hashes; forensic-summary.json e_unchanged, source_unchanged true. PARTIAL: backup --verify result is in the 22-06 plan verify and SUMMARY only (backup folder off limits, not re-run) |
| T-22-16 | 22-06 | Information disclosure | medium | mitigate | closed | forensic-summary.json:155-156 report outside repo with sha256; register holds counts and classified rows |
| T-22-77 | 22-06 | Spoofing | high | mitigate | closed | forensic-db.ts:43-59 classes, :773-776 attribution, self-test S/P/U around :1508-1515; ESC-FORENSIC-01 operator reply on record |
| T-22-SC | 22-06 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-18 | 22-07 | Information disclosure | high | mitigate | closed | git show 93f8189 lists six ignition/deployments paths only; od21-record.json staging command; NAC-02 pass in phase-end-checks.json |
| T-22-19 | 22-07 | Tampering | medium | mitigate | closed | od21-record.json pre-commit rehash 10/10 and blob = manifest; IGN_AC07 pass |
| T-22-SC | 22-07 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-20 | 22-08 | Tampering | high | mitigate | closed | verify-prod-untouched.ts wrapper on all 27 recorded RED commands and ac19; dbTripwireSetup.test.ts:73 fake-root gate, :10 read-only real opens. PARTIAL: "every run" is shown for recorded runs only |
| T-22-21 | 22-08 | Information disclosure | medium | mitigate | closed | All 27 recorded RED vitest commands name one test file; netDeny targets 192.0.2.1/.invalid only; forkRails.fork.test.ts has no connection target |
| T-22-22 | 22-08 | Tampering | medium | mitigate | closed | Proof files log checkout + empty status; 22-14-2 records before/after sha; no RED marker in src, test or scripts; 22-14-1 and review proofs neutralised nothing |
| T-22-64 | 22-08 | Elevation of privilege | medium | mitigate | closed | spawnRailedChild.ts:295-309 inheritedEnv refusals; :367 NODE_OPTIONS last; probes/childProbe.cjs:41-55 redaction |
| T-22-78 | 22-08 | Elevation of privilege | high | mitigate | closed | spawnRailedChild.ts:234-292 limit list; core.cjs:1262-1276 re-validates in child; RED 22-08-8 |
| T-22-79 | 22-08 | Repudiation | medium | mitigate | closed | verify-prod-untouched.ts:674 passes run id; :278-298 checks summary run id, projects, per-project workers |
| T-22-SC | 22-08 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-23 | 22-09 | Tampering | high | mitigate | closed | dbPath.ts:149 read-only probe, :240-241 newer schema refused in every mode, :273-275 re-check on write handle; RED 22-09-2 |
| T-22-24 | 22-09 | Tampering | high | mitigate | closed (accepted, AR-22-01) | Boot refusal is present (dbPath.ts:229-237), but typed confirmation exists only on the replace path (db-init.ts:150-154). A missing target is created with no prompt (db-init.ts:156; dbInit.test.ts:63 case a). Accepted: the code follows locked decision D-08, which asks for typed confirmation only when replacing a file. |
| T-22-25 | 22-09 | Tampering | high | mitigate | closed | db.ts:17-20 tripwire before openGuardedDb; dbPath.ts:96; other src opens are lock file and read-only probe; RED 22-09-1 |
| T-22-80 | 22-09 | Tampering | high | mitigate | closed | dbPath.ts:254-278 fileMustExist, dev+ino equality, user_version re-read; raceHookForTests parameter only; RED 22-09-4 |
| T-22-81 | 22-09 | Tampering | medium | mitigate | closed | db-init.ts:144-147 and :65 refusals, :94-115 temp build + rename; dbInit.test.ts cases e-g :121-160 |
| T-22-SC | 22-09 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-26 | 22-10 | Information disclosure | high | mitigate | closed | notifier.ts:44-45, :66, :103 refuse before axios.post inside the try; RED 22-10-1, 22-10-2; ledger notifier-refused 6. PARTIAL: fork half is rehearsal only (UFV-03) |
| T-22-27 | 22-10 | Information disclosure | high | mitigate | closed | Five gated sites: config.ts:5, notifier.ts:7, pause.ts:33, resume.ts:30, preflight.ts:27; dotenvSrcSkip.test.ts:103-135 control children; RED 22-10-3, 22-10-4. Note: scripts/deliberate-buy.ts:43 is an ungated sixth site, not loaded by any test |
| T-22-70 | 22-10 | Repudiation | medium | mitigate | closed | probes/dotenvProbe.ts:25-27 correct paths, :45 exit 4; behavioural pause/resume/preflight cases in dotenvSrcSkip.test.ts |
| T-22-SC | 22-10 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-28 | 22-11 | Information disclosure | high | mitigate | closed | spawnSites.test.ts AST gate, ALLOWED_FILES :44-48; RED 22-11-1. PARTIAL: allowlist holds selfcheck.cjs beside the one named exemption (plain Node, minimal env :106) |
| T-22-29 | 22-11 | Information disclosure | medium | mitigate | closed | test/fork/helpers/forkRpcUrl.ts:17-25 shell-only, no fallback, clear error; RED 22-11-2 |
| T-22-65 | 22-11 | Information disclosure | medium | mitigate | closed | forkShellOnly.test.ts:318-365 scans plus main-process closure of both configs; RED 22-11-4 |
| T-22-82 | 22-11 | Information disclosure | high | mitigate | closed | hardhatChildEnv.ts:31-43; test/fork/setup.ts:15-20; hardhatChildEnv.test.ts:85-101 AST check; RED 22-11-3. PARTIAL: no real Hardhat launch, unit proof only, UFV-04 owned by Phase 25 |
| T-22-83 | 22-11 | Elevation of privilege | medium | mitigate | closed | spawnSites.test.ts:29-34 bans, :182-206 ten seeded forms, cluster tested :209 |
| T-22-SC | 22-11 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-30 | 22-12 | Tampering | high | mitigate | closed | singleton.ts:24-74; registered at detector.ts:194, exitEngine.ts:1423, exitManager.ts:16, nonceAuthority.ts:45; RED 22-12-1 covers all four, 22-12-2 epoch |
| T-22-31 | 22-12 | Tampering | medium | mitigate | closed | forceConsistentCasingInFileNames in tsconfig.json:9, tsconfig.bot.json:11, dashboard/tsconfig.json:14; test/unit/guards/tsconfigCasing.test.ts |
| T-22-84 | 22-12 | Repudiation | medium | mitigate | closed | probes/duplicateLoadProbe.cjs:17-20 exact code + alias; inputs/reset-files-base.json frozen set; test-identity.json frozen_reset_not_passed 0 |
| T-22-SC | 22-12 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-32 | 22-13 | Tampering | high | mitigate | closed | processLock.ts:42, :73, :144-145, :182-195 pinned exclusive lock; PROCESS_LOCK codes refuse start; RED 22-13-1, 22-13-2 |
| T-22-33 | 22-13 | Elevation of privilege | high | mitigate | closed | src/bot.ts:2 first import guard, :2361-2363 refusing main block; guards/directEntry.ts; mainEntry.test.ts:215; RED 22-13-3 |
| T-22-34 | 22-13 | Denial of service | medium | mitigate | closed | processLock.test.ts:130-136 force-kill then next acquire succeeds |
| T-22-85 | 22-13 | Tampering | high | mitigate | closed | src/bot.ts:2; directEntry.ts imports only fs and path; mainEntry.test.ts:188-238 including ordering proof; RED 22-13-3 |
| T-22-86 | 22-13 | Repudiation | medium | mitigate | closed | processLock.test.ts:149-194 READY handshake, barrier, ATTEMPT-before-RELEASED, overlap count |
| T-22-SC | 22-13 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-35 | 22-14 | Repudiation | medium | mitigate | closed | .github/workflows/test.yml:25 runs check:vi-mock; test/fixtures/viMockGate; RED 22-14-1; violations registered in AUD-TESTQ-002 and AUD-TESTU-023 |
| T-22-87 | 22-14 | Repudiation | medium | mitigate | closed | scripts/check-vi-mock-paths.ts:122-126 installed resolvers, :164-179 binding-aware detection; RED 22-14-2 |
| T-22-SC | 22-14 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-36 | 22-15 | Tampering | high | mitigate | closed | ac19-run.json manifest_match true, data_diffs empty, listing unchanged, allows 0, verdict untouched; no src or test change since run |
| T-22-37 | 22-15 | Repudiation | medium | mitigate | closed | inputs/rails-test-edits.json 16 entries; no added skip/todo/only in test diff; 16 AUD-TESTQ findings cite the edits |
| T-22-88 | 22-15 | Repudiation | medium | mitigate | closed | .planning/audit/tools/test-identity.ts; inputs/test-identity.json missing 0, not_executed 0, frozen 37 |
| T-22-89 | 22-15 | Information disclosure | medium | mitigate | closed | verify-prod-untouched.ts:303+ net-watch; ac19-run.json net_watch ok, 106 samples; evidence_basis. PARTIAL: sampled by design, can miss short connections |
| T-22-SC | 22-15 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-38 | 22-16 | Tampering | high | mitigate | closed | capture-baselines.ts:21-26, :294-310 export-only refusals, no data folder or env files, :407 railed explicit --project collection |
| T-22-39 | 22-16 | Tampering | medium | mitigate | closed | capture-baselines.ts:184-223 hashes, :895 NAC-08 self-assert, :334-340 per-entry junctions |
| T-22-90 | 22-16 | Repudiation | medium | mitigate | closed | baselines/before/meta.json measured_trees and per-output labels; capture-baselines.ts:686-689 committed pre-rail blob; :296 env-file allow list |
| T-22-SC | 22-16 | Tampering | low | accept | closed | Acceptance written in plan register (read-only npm queries); NAC-08 self-assert in capture-baselines.ts:895; no package-lock commit in phase range |
| T-22-40 | 22-17 | Repudiation | medium | mitigate | closed | Findings use path:line@sha (check.ts:275, :317, :462); NAC-09 :243. PARTIAL: P9 slip, auditors were given SUMMARYs; NAC-09 catches citations only (22-ORCHESTRATOR-NOTES.md:28) |
| T-22-41 | 22-17 | Tampering | medium | mitigate | closed | AC-33 commits_with_paths_outside_planning empty; recomputed with git, audit-wave commits by subject touch only .planning |
| T-22-SC | 22-17 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-42 | 22-18 | Repudiation | medium | mitigate | closed | Same code-reference rules and NAC-09 for EXIT findings. PARTIAL: P9 slip, citation scan only |
| T-22-43 | 22-18 | Tampering | medium | mitigate | closed | AC-33 empty and recomputed with git |
| T-22-SC | 22-18 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-44 | 22-19 | Repudiation | medium | mitigate | closed | Same code-reference rules and NAC-09 for ANTIRUG findings. PARTIAL: P9 slip, citation scan only |
| T-22-45 | 22-19 | Tampering | medium | mitigate | closed | AC-33 empty and recomputed with git |
| T-22-SC | 22-19 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-46 | 22-20 | Repudiation | medium | mitigate | closed | Same code-reference rules plus ethers@6.16.0 library refs in AUD-TX findings; NAC-09. PARTIAL: P9 slip, citation scan only |
| T-22-47 | 22-20 | Tampering | medium | mitigate | closed | AC-33 empty and recomputed with git |
| T-22-91 | 22-20 | Repudiation | high | mitigate | closed | slices.json TX literal entries, files_at_base 11; lib.ts enumerator; plan 22-20 verify names seven files. PARTIAL: slices.json anchors holds three; the seven are in the plan verify only |
| T-22-SC | 22-20 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-48 | 22-21 | Repudiation | medium | mitigate | closed | Same code-reference rules and NAC-09 for DB findings. PARTIAL: P9 slip, citation scan only |
| T-22-49 | 22-21 | Information disclosure | medium | mitigate | closed | SEAL.json scan non_public 0 over the register commits; AUD-DB findings cite key names. PARTIAL: "never read" is a process claim, not code-provable |
| T-22-SC | 22-21 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-50 | 22-22 | Repudiation | medium | mitigate | closed | Same code-reference rules and NAC-09 for API and DASH findings. PARTIAL: P9 slip, citation scan only |
| T-22-51 | 22-22 | Tampering | medium | mitigate | closed | AC-33 empty and recomputed with git |
| T-22-92 | 22-22 | Denial of service | high | transfer | closed | ESC-PRE-04 ruling; AUD-API-001 (S1) od_ref OD-64; OD-64 needed_by Phase 24 capital discussion (AUDIT-05) |
| T-22-SC | 22-22 | Tampering | low | accept | closed | Acceptance written in plan register; dashboard deps read only; no package-lock commit in phase range |
| T-22-52 | 22-23 | Repudiation | medium | mitigate | closed | ledger/TESTU.json quality_label on 102 of 102 rows with findings; consumption by Phase 23/28 is future work |
| T-22-SC | 22-23 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-53 | 22-24 | Repudiation | medium | mitigate | closed | ledger/TESTI.json quality_label on all 45 test-file rows; ESC-RAILS-01 tier immediate |
| T-22-SC | 22-24 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-54 | 22-25 | Tampering | high | transfer | closed | AUD-SCRIPTS-002 file:line evidence, od_ref OD-68; Phase 29 HYG-03 owner (REQUIREMENTS.md:141); ESC-SCRIPTS-01 ruling. PARTIAL: hold-lock fix is a recommendation; operator chose to decide in Phase 29 |
| T-22-55 | 22-25 | Information disclosure | medium | mitigate | closed | AUD-CONTRACTS-001 registered; test/fork/setup.ts uses buildHardhatChildEnv; AC-08 pass. PARTIAL: child env unit-proven only (UFV-04) |
| T-22-93 | 22-25 | Tampering | high | mitigate | closed | AUD-SCRIPTS-002.json:122-151 hold-lock with race stated; decisions/proposed/SCRIPTS-01.json; processLock.ts:31-34; ESC-SCRIPTS-01 tag premise-challenge:D-06 |
| T-22-SC | 22-25 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-56 | 22-26 | Information disclosure | high | mitigate | closed | history-scan.json and phase-scan.json --redact args, raw_report_dir outside repo, no value keys in the scan JSON |
| T-22-57 | 22-26 | Tampering | high | mitigate | closed | signing-census.ts; census/signing-sites.json review_note on every unlocked/unknown site; ESC-CENSUS-01 and ESC-SCRIPTS-01 |
| T-22-94 | 22-26 | Repudiation | high | mitigate | closed | signing-census.ts:45-49 rule; kinds separated; reconciliation 23 = 23; four ContractFactory.deploy sites. PARTIAL: SIG-019 (src/bot.ts:223, status unknown) was excluded by an auditor override, so unknown reads 0 |
| T-22-SC | 22-26 | Tampering | low | accept | closed | Acceptance written in plan register (scanner verified in 22-02); no package-lock commit in phase range |
| T-22-58 | 22-27 | Information disclosure | high | mitigate | closed | SEND-LIST.txt 49 src files in five slices; operator decision "both" in MERGE.json. PARTIAL: the host probe also sent package.json to OpenAI (MERGE.json:62-66), outside the five slices |
| T-22-59 | 22-27 | Elevation of privilege | medium | mitigate | closed | CONFINEMENT.json docker run: -C /work, read-only mount, --ephemeral, no other host mounts; host sandbox flags alone failed the read probe, so Docker is the real boundary |
| T-22-95 | 22-27 | Information disclosure | high | mitigate | closed | CONFINEMENT.json codex host fail then docker pass; agy excluded by ruling "codex a, agy c". PARTIAL: the failed probe itself sent package.json to OpenAI; no operator acknowledgement of that found in escalations or OPERATOR-DECISIONS.md |
| T-22-SC | 22-27 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-60 | 22-28 | Repudiation | medium | mitigate | closed | CONSOLIDATION.json; PROTOCOL.md:53 never renumber; assign-cards.ts:333; check.ts:731-790; render.ts:6 |
| T-22-96 | 22-28 | Repudiation | high | mitigate | closed | lib.ts:364 checkUniverse over full tree + scope.json; check.ts:725-728, :699 references, :775+ duplicates, :563-575 discovery |
| T-22-SC | 22-28 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; no package-lock commit in phase range; AC-02 pass |
| T-22-61 | 22-29 | Information disclosure | high | mitigate | closed | phase-scan.json range to sealed_sha, 0 hits over 7.2 MB; SEAL.json non_public 0; seal-verify.ts :10, :493. PARTIAL: seal-verify not re-run here (repo programs off limits); SEAL VALID is recorded in the 22-29 SUMMARY only |
| T-22-62 | 22-29 | Tampering | high | mitigate | closed | inputs/judgment-reviews.json 28 hunks covering all 16 changed src files; D-24 byte-identity re-run; census 23 at base and HEAD |
| T-22-66 | 22-29 | Tampering | high | mitigate | closed | phase-end-checks.json IGN_AC07 pass at 47153be; git shows no ignition change from there to HEAD and a clean status |
| T-22-97 | 22-29 | Repudiation | high | mitigate | closed | Sealed 93d9029 before scan; all later paths are exempt (seal-verify.ts:487-519). PARTIAL: SEAL.json is itself exempt and exempt_paths is not pinned; d9f2533 widened it post-seal for 22-VALIDATION.md (disclosed in SEAL.json) |
| T-22-98 | 22-29 | Repudiation | medium | mitigate | closed | fork-acceptance.json ruling, d57568c before seal; five UFV and AUD-TESTQ-030..035 owned by Phase 25. PARTIAL: rehearsal evidence only, UFV-04 no rehearsal; UFV-05 uses a fake RPC |
| T-22-SC | 22-29 | Tampering | low | accept | closed | Acceptance written in plan register and 22-SPEC.md:121; AC-02 commits_touching empty; no package-lock commit in phase range |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-22-01 | T-22-24 | The bot refuses to start on a missing, empty or uninitialised database. `npm run db:init` is the only creation path, prints the target and refuses a file holding data. Typed confirmation applies only when replacing an empty file, as locked decision D-08 specifies; the row's wording was broader than D-08. | Operator, reply verbatim: Accept | 2026-11-09 |

*Accepted risks do not resurface in future audit runs.*

---

## Flags Outside the Threat Register

| Flag | Detail | Owner |
|------|--------|-------|
| Temp copy of the database | The startup probe copies a WAL-mode database to the OS temp folder. A crash, or a cleanup failure since commit 5378478, can leave that copy behind. It holds trade data, no keys. No threat id covers it, and the register was already sealed when this was found. | Phase 24 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-09 | 126 | 125 | 1 | gsd-security-auditor |
| 2026-11-09 | 126 | 126 | 0 | operator ruling on T-22-24 (accepted) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-09
