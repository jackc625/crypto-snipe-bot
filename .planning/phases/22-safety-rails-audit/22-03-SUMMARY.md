---
phase: 22-safety-rails-audit
plan: 03
subsystem: security
tags: [safe-01, nac-01, backup, google-drive, betterleaks, d-22, d-10]
status: complete

requires:
  - phase: 22-safety-rails-audit (22-01)
    provides: verified local backup folder C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06 (MANIFEST 9e28e30f...151a, 17 entries) and archive crypto-snipe-bot-state-2026-11-06.tar.gz (sha256 4c8e9ab6...1d1a), backup-state.ts --verify
  - phase: 22-safety-rails-audit (22-02)
    provides: betterleaks v1.10.0 + three-pass fixture-check.ts --scan engine, FIXTURES.json config hashes, firewall rule csb-betterleaks-outbound-block, scripts/nac01-exact-value-check.ts
provides:
  - .planning/baselines/safe01-offmachine.json, SAFE-01 VALID (Google Drive copy proven from its downloaded bytes, scan clean, exact-value check bound to checker and target hashes)
affects: [22-07, 22-08, every Phase 22 audit plan, SAFE-01, NAC-01, AC-01, AC-03]

actuals:
  tokens: 3237
  tasks: 3
  commits: 1
plan_head_before: ce35f980f9e3c62078f448180c6d30eb3d6436b0
plan_head_after: 29cb75017f5fd6d3985fb47536746d9f39d2de0d

tech-stack:
  added: []
  patterns:
    - "Prove the off-machine copy from its downloaded bytes: hash equality, byte compare, full manifest re-verify on a temp extraction, re-scan; the browser's download tag (Zone.Identifier) is supporting evidence only"
    - "Cross-check a re-scan against the earlier scan of the same bytes: identical hit multiset and identical bytes-scanned counts"
    - "Record a download tag without its query string (it carries a file id and a session-bound token); keep host, path, issue time and a stream hash"

key-files:
  created:
    - .planning/baselines/safe01-offmachine.json
  modified: []

key-decisions:
  - "D-10 off-machine medium: google-drive (operator, verbatim: \"google drive\"), chosen at the blocking-human decision after the scan result and the operator's own clean exact-value result were in hand"
  - "D-22 exact-value check (operator-run against the real .env): all six D-22 keys no/no on folder and archive, 11 additional keys no, 6 unset, RESULT clean, no rulings needed; bound to checker sha256 703fd9ad...d947 (git blob 96532ba3) and both backup-record.json target hashes"
  - "The original archive's NTFS change time moving at 21:59:24 local was diagnosed, not dismissed: Chrome's upload picker created a Recent Items shortcut and Windows link tracking added an Object ID (metadata only); content hash unchanged"

patterns-established:
  - "SAFE-01 VALID record shape: medium, downloaded_path/sha256, manifest_verified_entries, mismatches, local_folder_reverified, scan{config_sha256, network_boundary}, exact_value_check{checker_sha256, targets, results, additional_results, result, rulings}"

requirements-completed: [SAFE-01]

coverage:
  - id: D1
    description: "Google Drive copy proven from its downloaded bytes: sha256 equals archive_sha256, byte-identical to the original, and every manifest entry re-verifies after extraction (17/17, 0 mismatches)"
    requirement: SAFE-01
    verification:
      - kind: other
        ref: "sha256sum <downloaded> == 4c8e9ab6...1d1a; cmp <downloaded> <original> identical"
        status: pass
      - kind: integration
        ref: "node node_modules/ts-node/dist/bin.js scripts/backup-state.ts --verify <downloaded archive> --expected-sha 4c8e9ab6...1d1a (Node 22.16.0): VERIFY OK, 17 entries"
        status: pass
    human_judgment: false
  - id: D2
    description: "Local dated folder re-verified unchanged; both copies hold ignition/deployments/chain-1, chain-11155111 and data/ and no .env (AC-01/AC-03)"
    requirement: SAFE-01
    verification:
      - kind: integration
        ref: "scripts/backup-state.ts --verify C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06: VERIFY OK, 17 entries, MANIFEST 9e28e30f...151a"
        status: pass
      - kind: other
        ref: "tar -tzf <downloaded archive> lists chain-1, chain-11155111, data/; no .env"
        status: pass
    human_judgment: false
  - id: D3
    description: "NAC-01 scan of the downloaded copy: fixture-proven configs, firewall rule re-checked, 426 hits, 0 non-public, hit set identical to the 22-02 archive scan"
    requirement: SAFE-01
    verification:
      - kind: integration
        ref: "fixture-check.ts --scan --target downloaded-archive=<downloaded> (RESULT CLEAN, exit 0)"
        status: pass
      - kind: other
        ref: "Get-NetFirewallRule csb-betterleaks-outbound-block read-back before the scan; exe sha256 16600f87...c6cf"
        status: pass
    human_judgment: false
  - id: D4
    description: "Operator exact-value result recorded and bound: six D-22 keys complete on both targets, enum values, no yes, checker hash and both target hashes match"
    requirement: SAFE-01
    verification:
      - kind: other
        ref: "22-03 Task 3 <automated> verify 1 (SAFE-01 VALID google-drive 17) and verify 2 (checker clean, data/.env untracked)"
        status: pass
    human_judgment: true
    rationale: "The result lines come from the operator's own terminal, relayed by the orchestrator; a human should confirm the recorded booleans match what they ran"

duration: 4min
completed: 2026-11-07
---

# Phase 22 Plan 03: SAFE-01 Off-Machine Copy Verified From Downloaded Bytes Summary

**The Google Drive copy was downloaded into a fresh folder and proven byte-for-byte: hash `4c8e9ab6...1d1a`, 17/17 manifest entries, and a clean three-pass scan whose hits match the original exactly. The operator's exact-value check (all six D-22 keys `no` on both targets) is bound to the committed checker and these bytes. SAFE-01 is VALID.**

## Performance

- **Duration:** 4 min of continuation-executor time for Task 3 (start 2026-11-07T03:02:05Z, end 2026-11-07T03:06:18Z). This does not count the operator time at the Task 1 decision and the Task 2 upload/download.
- **Tasks:** 3 of 3 (Task 1 decision and Task 2 human action by the operator; Task 3 by this executor)
- **Files:** 1 created

## Accomplishments

- **Download location checked.** The download sits at `C:\Users\jackc\Downloads\csb-backup-check\crypto-snipe-bot-state-2026-11-06.tar.gz`. That is not the original archive path. The folder (created empty by the predecessor at 02:57:32Z) holds only that one file, and no copy is left in the Downloads root.
- **Download tag (supporting evidence).** The file's Zone.Identifier stream reads:
  - Zone 3 (Internet), host `drive.usercontent.google.com` and path `/download`, which is Google Drive's download server.
  - The download token was issued at 02:59:53.234Z, 0.55 s before the file was created.
  - The query string is not stored, because it carries the Drive file id and a session token. The stream's SHA-256 is recorded instead.
- **Byte proof.** The download's SHA-256 equals `archive_sha256`. `cmp` shows it is byte-identical to the original, and the original's hash is unchanged.
- **Manifest re-verified.** `backup-state.ts --verify --expected-sha` on Node 22.16.0 extracted the download into a fresh temp folder and gave VERIFY OK: 17 of 17 entries, 0 mismatches, MANIFEST `9e28e30f...151a`. The temp folder was removed afterwards.
- **Local copy unchanged.** The dated folder verifies again (VERIFY OK, 17 entries). Both copies hold chain-1, chain-11155111 and data/, and neither holds a `.env`.
- **NAC-01 scan of the download.**
  - Before the run: exe hash `16600f87...c6cf` matched, the three config hashes and the FIXTURES hash matched the 22-02 proof, and the firewall rule read back the same as in 22-02 (enabled, Outbound, Block, exact program path, all profiles on, network Public).
  - Result: 426 hits, 0 non-public, 426 public-address, all `generic-api-key` in the three capture logs.
  - Cross-check: the hit multiset and the bytes read (8,216,629 per pass) are identical to the 22-02 scan of the original archive.
- **Exact-value result bound.**
  - The checker's working-tree SHA-256 is `703fd9ad...d947`, which equals the CHECKER line. The working tree is clean, and the git blob is `96532ba3`, the same as `hash-object`.
  - Both TARGET hashes equal `backup-record.json`.
  - The six D-22 keys are complete on both targets (12 cells), all `no`. The additional keys hold no `yes`, and `rulings` is empty.

## Task Commits

1. **Task 1: operator exact-value check and off-machine decision**: no commit. The plan gives Task 1 no file, so its record is carried into `safe01-offmachine.json` `exact_value_check` and `decision`.
2. **Task 2: operator upload to Google Drive and download into a fresh folder**: no commit (human action). Recorded in `safe01-offmachine.json` `upload_download`.
3. **Task 3: verify downloaded bytes, scan, bind exact-value result, record SAFE-01 VALID** - `29cb750` (feat)

**Plan metadata:** see the docs commits that follow this SUMMARY.

## Files Created/Modified

- `.planning/baselines/safe01-offmachine.json`: the SAFE-01 VALID record. It holds:
  - the medium and the operator's verbatim words;
  - the downloaded path, hash and byte-compare result;
  - provenance evidence (the download tag without its query, plus the diagnosed metadata anomaly);
  - the manifest verification (17/17, 0 mismatches) and the local folder re-verify;
  - the scan (config hashes, network boundary re-check, cross-check with 22-02);
  - `exact_value_check` (hashes and enum values only), `checker_sha256_working_tree`, `checker_git_blob` and `verified_at`.

Outside the repo, never committed: the raw redacted scan reports and `safe01-downloaded-archive-scan.json` (sha256 `e6cf3e75...6efc`) under `C:\Users\jackc\crypto-snipe-bot-backups\scans\2026-11-06\`.

## Decisions Made

- **Medium: google-drive.** The operator's verbatim choice was "google drive", made at the blocking-human decision with the scan result and their own clean exact-value result in front of them. OneDrive was not used (D-09).
- **Operator's Task 2 reply, verbatim: "done with chrome, nothing odd".** The operator did not type the path. The orchestrator found it with a read-only directory listing, and this executor confirmed it.
- **Download tag stored without its query string.** The query carries a Drive file id and a session-bound download token, which have no audit value. The host, path, token issue time and stream SHA-256 are enough to support provenance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extra provenance and cross-checks beyond the plan's minimum**
- **Found during:** Task 3
- **Issue:** The plan's proof is a hash match, the manifest verify and the scan. It does not confirm that the file came from Google (not a local copy), and it does not check that the re-scan matches the earlier scan of the same bytes.
- **Fix:** Recorded the Zone.Identifier evidence (redacted query), a `cmp` byte compare, a re-hash of the original, a `tar -tzf` contents check for AC-01/AC-03, and a hit-multiset and bytes-scanned cross-check against the 22-02 archive scan.
- **Files modified:** `.planning/baselines/safe01-offmachine.json`
- **Commit:** 29cb750

---

**Total deviations:** 1 auto-fixed (Rule 2).
**Impact on plan:** It only adds evidence. Nothing in the gate was loosened.

## Issues Encountered

- **Original archive metadata time moved (diagnosed, benign).**
  - What happened: the original archive's NTFS change time became 21:59:24 local while its content time stayed 19:50:50.
  - Cause: when the operator picked the file in Chrome's upload dialog, Windows created `Recent\crypto-snipe-bot-state-2026-11-06.tar.gz.lnk` (created 02:59:24.747Z). Distributed Link Tracking also gave the file an NTFS Object ID (`fsutil objectid query`).
  - What did not change: no extended attributes, no new data stream. The `.sha256` sidecar is untouched, the content hash is unchanged, and the dated folder still verifies.
- **No line for `TEST_WALLET_PRIVATE_KEY` in the operator's additional results.** This is expected. The checker prints an additional key only when it is present in `.env` (`isAdditionalKey` over `Object.keys(env)`), so that key is absent from the operator's `.env`.

## Known Stubs

None.

## User Setup Required

None. The firewall rule `csb-betterleaks-outbound-block` stays in place for 22-26 and 22-29. The Google Drive copy and `C:\Users\jackc\Downloads\csb-backup-check\` can stay. Deleting the local download folder does not affect SAFE-01, because the record holds its hash.

## Next Phase Readiness

- SAFE-01 is VALID. 22-07, 22-08 and the audit plans that depend on 22-03 can proceed.
- Remaining note from 22-02: the `core.autocrlf` / `.gitattributes eol=lf` pin for `.planning/audit/tools/betterleaks/**` is still pending for 22-26 and 22-29.

## Self-Check: PASSED

- FOUND: `.planning/baselines/safe01-offmachine.json`
- FOUND: commit 29cb750 on HEAD (`git rev-list --count ce35f98..HEAD` = 1 before this SUMMARY)
- Task 3 `<automated>` verify 1: `SAFE-01 VALID google-drive 17` (exit 0)
- Task 3 `<automated>` verify 2: checker unmodified; `git ls-files data .env` is empty (exit 0)
- Acceptance criteria:
  - `downloaded_sha256` equals `archive_sha256`: PASS
  - `manifest_verified_entries` 17 equals `manifest_entry_count` 17, with `mismatches` 0: PASS
  - six D-22 keys x 2 targets, all enum values, no `yes`, checker and target hashes bound: PASS
  - `git ls-files data .env` empty: PASS
- The record holds no `0x`+40-hex value, and every 64-hex string in it is a known SHA-256
