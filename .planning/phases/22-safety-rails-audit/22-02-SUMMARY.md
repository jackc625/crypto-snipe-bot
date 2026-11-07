---
phase: 22-safety-rails-audit
plan: 02
subsystem: security
tags: [betterleaks, secret-scan, nac-01, d-22, sigstore, firewall, backup]
status: complete

requires:
  - phase: 22-safety-rails-audit (22-01)
    provides: verified SAFE-01 local backup folder C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06 and archive crypto-snipe-bot-state-2026-11-06.tar.gz (sha256 4c8e9ab6...1d1a), backup-state.ts --verify
provides:
  - betterleaks v1.10.0 outside the repo, provenance verified (pinned zip SHA-256 + gh release verify-asset), exe SHA-256 in TOOL.json
  - extended.toml (default ruleset + evm-private-key + telegram-string-session), known-public.toml (+ Hardhat #0 allowlist), public-address.toml (+ exact 0x+40hex allowlist)
  - fixture-check.ts three-pass classifier (non-public / known-public:hardhat-0 / public-address) with fixture mode and --scan mode
  - FIXTURES.json, 18/18 required cases passing (a-f, h-n + 5 engine checks), case g recorded detected=false
  - scripts/nac01-exact-value-check.ts (D-22 operator-run exact-value check, self-test 10/10)
  - nac01-backup-scan.json, NAC-01 scanner half CLEAN for both targets (852 hits, 0 non-public, 852 public-address)
  - ESC-SECRET-01 closed by the operator ruling "classify-addresses"
affects: [22-03, 22-26, 22-29, NAC-01, NAC-11, AC-35]

actuals:
  tokens: 107000
  tasks: 3
  commits: 3
plan_head_before: 19c766b85feb0e71ec4435545381688b3449fb25
plan_head_after: 93c150e21b3b830412db54f25aef3ba958e86eb0

tech-stack:
  added: [betterleaks v1.10.0 (external binary, never committed)]
  patterns:
    - "N-pass allowlist diff: each config is the previous config byte-for-byte plus one secret-targeted allowlist; a hit's label is the first pass that drops it; nothing is ever dropped from the report"
    - "Config pin: the scanner tool refuses to run unless each config's prefix relationship holds and the appended block is exactly the expected lines"
    - "Fixture values random at runtime, entropy-floored, never printed; mutation-test every new fixture case"

key-files:
  created:
    - .planning/audit/tools/betterleaks/TOOL.json
    - .planning/audit/tools/betterleaks/extended.toml
    - .planning/audit/tools/betterleaks/known-public.toml
    - .planning/audit/tools/betterleaks/public-address.toml
    - .planning/audit/tools/betterleaks/fixture-check.ts
    - .planning/audit/tools/betterleaks/FIXTURES.json
    - scripts/nac01-exact-value-check.ts
    - .planning/audit/inputs/nac01-backup-scan.json
    - .planning/audit/escalations/ESC-SECRET-01.json
  modified: []

key-decisions:
  - "ESC-SECRET-01 ruled by the operator, verbatim: classify-addresses. Hits whose flagged secret is exactly 0x + 40 hex are labelled public-address, kept listed, and do not count as non-public"
  - "public-address is implemented as a third scanner pass (public-address.toml = known-public.toml + one allowlist, regexTarget secret, ^0x[0-9a-fA-F]{40}$). The scanner's own capture group is what gets tested, and the tool never reads a secret value itself"
  - "NAC-01 scanner half is CLEAN: 852 hits on the dated folder and archive, 0 non-public, 852 public-address, at exactly the 852 locations escalated"
  - "betterleaks dir mode skips data/bot.db whole (byte-count proven). The operator-run D-22 exact-value check in 22-03 is the control for the SQLite files"

patterns-established:
  - "Escalation close-out: keep the as-created fields (items, summary, presented_at) unchanged; add operator_response verbatim, ruling, phase_continued, items_ref (commit-pinned) and a resolution block with hashed evidence"

requirements-completed: [SAFE-01, AUDIT-03]

coverage:
  - id: D1
    description: "betterleaks v1.10.0 provenance verified (pinned zip SHA-256, gh release verify-asset, exe SHA-256 in TOOL.json), binary kept outside the repo"
    requirement: SAFE-01
    verification:
      - kind: other
        ref: "sha256sum zip == bafd52ab...8468 && gh release verify-asset v1.10.0 <zip> -R betterleaks/betterleaks && sha256sum betterleaks.exe == TOOL.json exe_sha256"
        status: pass
      - kind: other
        ref: "git ls-files -- '*betterleaks_1.10.0*' '*betterleaks.exe' prints nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "Scanner configs and the three-pass classification proven on runtime-random fixtures, including the operator-required public-address negatives and positive"
    requirement: AUDIT-03
    verification:
      - kind: integration
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/betterleaks/fixture-check.ts --bin <exe> --out FIXTURES.json (RESULT PASS 18/18 required)"
        status: pass
      - kind: other
        ref: "mutation run: 7 mutants (3 regex-anchor, 3 classifier, 1 config-pin refusal) each caught"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-22 exact-value checker built and self-tested without reading the real .env"
    requirement: SAFE-01
    verification:
      - kind: unit
        ref: "node node_modules/ts-node/dist/bin.js scripts/nac01-exact-value-check.ts --self-test (SELF-TEST: PASS 10/10)"
        status: pass
    human_judgment: false
  - id: D4
    description: "NAC-01 scanner half: dated folder and archive scanned with fixture-proven configs; zero non-public hits; backup folder unchanged"
    requirement: SAFE-01
    verification:
      - kind: integration
        ref: "22-02 Task 3 <automated> verify (targets 2, hits 852, non-public 0)"
        status: pass
      - kind: integration
        ref: "scripts/backup-state.ts --verify <dated_folder> (VERIFY OK, 17 entries); archive sha256 unchanged"
        status: pass
    human_judgment: false
  - id: D5
    description: "ESC-SECRET-01 recorded and closed per D-16 with the operator's verbatim ruling"
    verification: []
    human_judgment: true
    rationale: "The escalation's validity rests on the operator's own ruling, relayed by the orchestrator; a human should confirm the recorded ruling text matches what they chose"

duration: 39min
completed: 2026-11-07
---

# Phase 22 Plan 02: Secret Scanner Provenance, Fixture Proof and NAC-01 Backup Scan Summary

**betterleaks v1.10.0 verified outside the repo and firewalled. A three-pass classifier (non-public, Hardhat #0 known-public, and the operator-ruled public-address label for an exact `0x`+40-hex value) is proven on 18 runtime-random fixture cases and 7 mutants. Both local backup targets scan clean: 852 hits, 0 non-public, 852 public addresses.**

## Performance

- **Duration:** 39 min of executor time (start 2026-11-07T00:56:25Z, end 2026-11-07T01:35:14Z), not counting the time spent waiting at the two operator checkpoints
- **Tasks:** 3 of 3 (Task 2 was the operator provenance and firewall checkpoint; Task 3 included the ESC-SECRET-01 decision checkpoint)
- **Files:** 9 created

## Accomplishments

- **Scanner provenance (D-17 amended).** The pinned zip SHA-256 `bafd52ab...8468` matches, `gh release verify-asset` succeeds, and the exe SHA-256 `16600f87...c6cf` is recorded in TOOL.json and re-checked before every run. The binary lives only in `C:\Users\jackc\tools\betterleaks-1.10.0\`.
- **Network boundary.** The operator created the Windows Firewall outbound-block rule `csb-betterleaks-outbound-block` for the exact exe path. It was read back three times (orchestrator, first scan, re-scan): enabled, Outbound, Block, Profile Any, all three profiles on, active network Public. The proxy variables are recorded as a belt only. `--validation` and `--trust-local-git-config` were never passed.
- **Configs proven on fixtures.** FIXTURES.json passes 18/18 required cases:
  - a-f, h, i: the original cases.
  - j-n: the operator-required public-address cases. A 64-hex value after `token:` stays non-public. So does an address followed by more characters, and an address at the end of a longer token. An exact address after `token` or `authAddress` is labelled public-address. When an address and a 64-hex secret share one line, they are split correctly.
  - Engine checks: config-prefix, report-fields, redaction (no planted value in any output), pass-subset, bytes-scanned.
- **Mutation proof of the new label.** Seven mutants were each caught:
  - Unanchored regex: fails j, k, l, n.
  - End anchor dropped: fails j, k, n.
  - Start anchor dropped: fails l.
  - Classifier ignores pass 3: fails m, n.
  - Pass 3 labelled as Hardhat: fails m, n.
  - Every removed hit labelled public-address: fails b, c.
  - Edited regex without the matching code change: refused by the config pin.
- **NAC-01 scanner half is clean.** Dated folder and archive each have 426 hits, 0 non-public and 426 public-address. All three passes read the same 8,216,629 bytes. The 852 hits sit at exactly the escalated (rule, file, line, column) locations. The backup folder still verifies (17 entries, MANIFEST `9e28e30f...151a`) and the archive SHA-256 is unchanged (`4c8e9ab6...1d1a`).
- **D-22 exact-value checker.** Committed and self-tested 10/10, including extra url-component, refusals and no-leak cases. It was run only with `--self-test` and never against the real `.env`.
- **ESC-SECRET-01 closed per D-16.** It holds the operator's response verbatim (`classify-addresses`), the option text, `phase_continued: true`, and a resolution block with the scan, fixture and config hashes. The as-created fields are unchanged.

## Task Commits

1. **Task 1: download/verify betterleaks, configs, fixture tool, D-22 checker** - `80e76cd` (feat)
2. **Task 2: operator provenance + firewall checkpoint**: no commit; recorded in nac01-backup-scan.json `operator_approval` / `network_boundary`
3. **Task 3 (first scan):** fixture proof + scan, 852 hits escalated as ESC-SECRET-01 - `549fd6b` (feat)
4. **Task 3 (after the ruling):** public-address label, new fixture proof, re-scan clean, ESC-SECRET-01 closed - `93c150e` (feat)

**Plan metadata:** see the final docs commit for this plan.

## Files Created/Modified

- `.planning/audit/tools/betterleaks/TOOL.json`: version, asset, asset SHA-256, checksums line, verify-asset output, exe path and SHA-256
- `.planning/audit/tools/betterleaks/extended.toml`: pass 1 config, the default ruleset plus `evm-private-key` and `telegram-string-session`
- `.planning/audit/tools/betterleaks/known-public.toml`: pass 2 config, extended plus the Hardhat #0 allowlist on the secret
- `.planning/audit/tools/betterleaks/public-address.toml`: pass 3 config, known-public plus the `^0x[0-9a-fA-F]{40}$` allowlist on the secret
- `.planning/audit/tools/betterleaks/fixture-check.ts`: fixture proof and `--scan` engine with three-pass classification and config pins
- `.planning/audit/tools/betterleaks/FIXTURES.json`: per-case results, three config SHA-256s and the exe SHA-256 (no values)
- `scripts/nac01-exact-value-check.ts`: operator-run D-22 checker
- `.planning/audit/inputs/nac01-backup-scan.json`: metadata-only scan result, including `network_boundary`, `operator_approval`, `public_address_label`, `supersedes` and `binary_file_gap`
- `.planning/audit/escalations/ESC-SECRET-01.json`: the immediate-tier escalation, now closed

## Decisions Made

- **Operator ruling on ESC-SECRET-01, verbatim: `classify-addresses`.** All 852 flagged values were `0x`+40-hex public Ethereum addresses after `token` (token contracts) or `authAddress` (the Flashbots signing address, not its key). They are now labelled public-address and stay listed.
- **The label is a third pass, not a classifier that reads source bytes.** The test runs on betterleaks' own capture group (the flagged secret) through an anchored allowlist. Our code never handles a secret value. The default ruleset and the default global filter are unchanged, and no config has a top-level `filter`. The pass-3 block is pinned line-for-line in `fixture-check.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `--scan` mode in fixture-check.ts**
- **Found during:** Task 1
- **Issue:** The plan ran the real scan by hand-invoking the exe. That allowed a scan with an unproven config, or a classification step different from the one the fixtures proved.
- **Fix:** One committed engine runs both fixtures and real scans. It refuses unless the exe, config and FIXTURES hashes match and every required case passes.
- **Commit:** 80e76cd

**2. [Rule 2 - Missing Critical] Extra scanner run flags**
- **Found during:** Task 1
- **Issue:** Exit code 1 is ambiguous (leaks versus errors), and inline or ignore-file allow markers in the target could hide findings.
- **Fix:** Every run uses `--exit-code 9 --ignore-gitleaks-allow --gitleaks-ignore-path <empty dir> --no-color`, an empty cwd, and a minimal environment.
- **Commit:** 80e76cd

**3. [Rule 1 - Bug] Known-public allowlist mechanism**
- **Found during:** Task 1
- **Issue:** A top-level `filter` in an extending config replaces the default global filter. That would silently change the default ruleset.
- **Fix:** Use a legacy `[[allowlists]]` block with an explicit `regexTarget = "secret"`. Fixture case c proves it cannot suppress a co-located secret.
- **Commit:** 80e76cd

**4. [Rule 2 - Missing Critical] Mutation testing**
- **Found during:** Tasks 1 and 3
- **Issue:** A green fixture run alone does not show that each case can fail.
- **Fix, Task 1:** 9 D-22 checker mutants and 2 classifier mutants, all caught.
- **Fix, Task 3 (after the ruling):** 7 mutants for the public-address label, all caught (listed above).
- **Commit:** 80e76cd, 93c150e

**5. [Operator ruling, authority: ESC-SECRET-01 `operator_response` "classify-addresses"] public-address classification label**
- **Found during:** Task 3. The first scan gave 852 non-public hits, all `generic-api-key` on `0x`+40-hex addresses in three `data/*capture*.log` files.
- **Change:**
  - New file `public-address.toml`, outside the plan's files_modified list.
  - `fixture-check.ts` changes: three-pass `classify()`, `PUBLIC_ADDRESS_BLOCK` config pin, fixture cases j-n, entropy-floored fixture generator, `pass-subset` replacing `pass2-subset`, a three-pass equal-bytes check, `--scan` requiring cases a-n, and a new `public_address_count`.
  - `FIXTURES.json` and `nac01-backup-scan.json` regenerated. The new `config_sha256` has three keys; `extended` and `known_public` are unchanged.
- **Verification:** fixtures 18/18, 7 mutants caught, re-scan 0 non-public / 852 public-address at the same locations.
- **Commit:** 93c150e

**6. [Rule 2 - Missing Critical] Entropy-floored fixture values**
- **Found during:** Task 3 (public-address cases)
- **Issue:** A random 40-hex value averages about 3.7 entropy against the default rule's 3.5 floor. An unlucky draw could make the positive or negative address cases pass or fail by chance.
- **Fix:** `randomHexStrong()` redraws until the `0x`-prefixed value scores at least 3.65.
- **Commit:** 93c150e

---

**Total deviations:** 5 auto-fixed (4 Rule 2, 1 Rule 1) plus 1 operator-ruled scope change.
**Impact on plan:** Every change tightens the false-clean defences (T-22-69). None widens what counts as clean beyond the operator's exact ruling.

## Issues Encountered

- **ESC-SECRET-01 (D-16 immediate tier):** the first scan's 852 non-public hits stopped the run at a blocking checkpoint. The operator ruled `classify-addresses`, the re-scan is clean, and the escalation is closed. Nothing was uploaded at any point.
- **SQLite gap:** betterleaks dir mode skips `data/bot.db` whole. Fixture case g shows `detected=false`, and the bytes scanned equal the text bytes exactly (1,670 in the fixture). In the backup, the -wal and -shm side files are read as bytes, but text rules do not reliably match binary content. The operator-run D-22 exact-value check in 22-03 (binary-SQLite self-test case) is the control for all three DB files.
- **Line-ending caveat:** `core.autocrlf=true`. The committed TOML, JSON and TS blobs are LF and their working copies match those hashes. A fresh checkout on this machine would convert them to CRLF, and the tools would then refuse (fail closed) on hash mismatch. A `.gitattributes` `eol=lf` pin for `.planning/audit/tools/betterleaks/**` is outside this plan's files_modified list. It is noted here for a later plan (22-26/22-29 reuse these configs).

## User Setup Required

None. The firewall rule `csb-betterleaks-outbound-block` stays in place for 22-03, 22-26 and 22-29. Remove it later with `Remove-NetFirewallRule -DisplayName "csb-betterleaks-outbound-block"`.

## Next Phase Readiness

- **22-03 can start.** Its gates read `nac01-backup-scan.json` (0 non-public) and `FIXTURES.json` `config_sha256` (now three keys). The 22-03 re-scan of the downloaded copy must run `fixture-check.ts --scan`, which applies the same three passes and labels.
- **Still needed in 22-03:** the operator runs the D-22 exact-value check (`scripts/nac01-exact-value-check.ts`) on the real `.env` against both targets. This covers the SQLite gap.

## Self-Check: PASSED

- FOUND: all 9 key files on disk
- FOUND: commits 80e76cd, 549fd6b, 93c150e on HEAD; evaluation-scope resolves 22-02 commits on this branch
- Task 1 acceptance re-run:
  - zip hash, verify-asset and exe hash: PASS
  - 0 tracked binaries; rule ids present; no bare 64-hex rule
  - 0 contiguous 64-hex runs in any TOML; 0 `dotenv.config`
  - D-22 self-test 10/10
- Task 3 acceptance re-run:
  - plan `<automated>` verify: targets 2, hits 852, non-public 0
  - `backup-state.ts --verify`: VERIFY OK
  - 0 tracked raw reports; archive hash unchanged
- No `0x`+40-hex value and no non-hash 64-hex run in any committed output

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-07*
