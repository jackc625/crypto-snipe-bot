---
phase: 18-honeypot-detection-rebuild
plan: 01
subsystem: honeypot-fixtures
tags: [honeypot, fixtures, hardhat, solc-0.8.28, oz5, v2, v3, wave-1, honey-12]
requires:
  - "18-00 (REQUIREMENTS.md HONEY-12 row)"
provides:
  - "test/fixtures/contracts/Honeypot.sol — contrived 5-mode honeypot ERC20 (compiles under solc 0.8.28; sell-revert, lying-balanceOf, max-wallet, silent-zero-ETH, amount-tiered-tax)"
  - "test/fork/fixtures/honeypots/README.md — fixture schema documentation + Wave-1 block-pin tracking"
  - "test/fork/fixtures/honeypots/eth-sell-revert.json — V2 sell-revert real-mainnet fixture"
  - "test/fork/fixtures/honeypots/eth-max-wallet.json — V2 max-wallet real-mainnet fixture"
  - "test/fork/fixtures/honeypots/eth-v3-honeypot.json — V3 sell-tax-spike real-mainnet fixture (Blocker #1 V3 in scope)"
  - "hardhat.config.ts TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS subtask override — additional source root test/fixtures/contracts/"
affects:
  - "Wave-2 plan 18-09 (honeypotChecker.fork.test.ts) — consumes all 3 JSON fixtures via .each()"
  - "Wave-2 plan 18-09/18-10 Multi-Amount Tests 6+7 — SET Honeypot.sol mode-4 constructor arg; MUST NOT extend the contract (Warning #6)"
  - "Future fixture additions (BSC, Base, Arb) — follow schema + how-to-add procedure in README"
tech-stack:
  added: []
  patterns:
    - "Hardhat 2.x TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS subtask override to extend source roots beyond ./contracts"
    - "OZ 5.x _update override (replaces deprecated _beforeTokenTransfer) — pattern reused for all 5 honeypot modes in one contract"
    - "Discriminant-by-immutable-mode test-fixture pattern (5 honeypot modes selected by uint8 constructor arg, no admin keys)"
key-files:
  created:
    - test/fixtures/contracts/Honeypot.sol
    - test/fork/fixtures/honeypots/README.md
    - test/fork/fixtures/honeypots/eth-sell-revert.json
    - test/fork/fixtures/honeypots/eth-max-wallet.json
    - test/fork/fixtures/honeypots/eth-v3-honeypot.json
  modified:
    - ./hardhat.config.ts
decisions:
  - "Pin Honeypot.sol pragma to solc 0.8.28 exact (no caret) per PATTERNS.md cross-cutting decision 4 — matches the hardhat.config.ts solidity: '0.8.28' exact pin so the test fixture compiles under the same compiler as production HoneypotChecker.sol."
  - "All 5 modes (including amount-tiered mode 4) authored at 18-01 with a 4-arg constructor (name, symbol, mode, amountTierThreshold), satisfying iter-2 Warning #6. Plan 18-09 Multi-Amount Tests 6+7 will SET the constructor arg only — the contract is now frozen and MUST NOT be extended."
  - "Override TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS in hardhat.config.ts rather than relocating the fixture into ./contracts/ — plan 18-01 frontmatter pins the path test/fixtures/contracts/Honeypot.sol in 3 places (files_modified, must_haves.artifacts, acceptance criteria), so the path is the contract; we adapt Hardhat to it. The override is narrowly scoped (single extra directory, recursive .sol filter, fs.existsSync guard)."
  - "Set forkBlockNumber: null on all 3 real-mainnet fixtures per the plan's explicit Wave-1 follow-up policy (Warning #5). Live Etherscan / honeypot.is verification requires authenticated API access outside this executor's scope; the README §Outstanding Block-Pin Verification table assigns each null-block fixture to @jackcutrara with a precise next-step. Plan 18-09 V3 Integration Test 4 already has a Honeypot.sol V3-mode contrived fallback, so the fork test suite is not blocked on V3 fixture block-pin resolution."
  - "V3 fixture tokenAddress also set to null (rather than picking a speculative candidate). The two researcher-cited V2 addresses (0x80e4…c01d, 0x34c6…22f6) are cross-cited from the V2 list and 'may have an associated V3 pool at certain blocks' per 18-01-PLAN.md line 117 — speculative selection here would risk a misclassified fixture (T-18-01 Spoofing) for negligible gain. The Wave-1 follow-up resolves V3 via honeypot.is /api/v2/ethereum?filter=v3, with the Honeypot.sol contrived V3-mode as the backstop."
metrics:
  duration: "~8min"
  completed_date: "2026-05-16"
  tasks_total: 2
  tasks_completed: 2
  files_created: 5
  files_modified: 1
  lines_added: 357
  lines_removed: 1
---

# Phase 18 Plan 01: Wave-1 Honeypot Fixture Authoring Summary

Wave-1 fixture authoring is complete: the contrived 5-mode `Honeypot.sol`
test contract and 3 real-mainnet ETH JSON fixtures (2 V2 + 1 V3) ship in
this commit set, plus a schema-documenting README that explicitly tracks
the block-pin follow-up debt. Resolves iter-2 Warning #6 (mode-4 authored
at 18-01, not extended later), Blocker #1 V3 (V3 fixture in scope with
QuoterV2 + 0.3% feeTier), and Warning #5 (block-pin debt tracked
explicitly with owner + next-step rather than left ambiguous).

## What Was Built

- **`test/fixtures/contracts/Honeypot.sol`** (118 LOC incl. comments) —
  OZ 5.x `ERC20` subclass with all 5 honeypot modes selectable via
  immutable `uint8 mode` + `uint256 amountTierThreshold` constructor
  args. Modes: 0=sell-revert (require from == address(0) || from == owner_,
  revert `"SELL_BLOCKED"`); 1=lying-balanceOf (emit Transfer manually,
  skip `super._update`); 2=max-wallet (recipient balance after transfer
  ≤ 1% of supply, revert `"MAX_WALLET"`, mint exempt); 3=silent-zero-ETH-on-sell
  (transfers TO the registered `uniswapPair` are clamped to 1 wei when
  `value > 1`); 4=amount-tiered-tax (value > amountTierThreshold reverts
  `"AMOUNT_TIER_BLOCKED"`, mints + burns exempt). `setPair(address)`
  is the only setter (test scaffolding for mode 3 detection).
- **`test/fork/fixtures/honeypots/README.md`** — schema reference for
  all 13 fields (existing 11 + `dexType`, `quoterAddress`, `feeTier`);
  V3 Fixtures subsection explaining QuoterV2 + feeTier wiring; how-to-add
  procedure naming honeypot.is + Etherscan as discovery sources; pool-liquidity-
  at-pinned-block check requirement (V2 reserves + V3 quote); the
  RESEARCH.md "active failure mode, not post-rug state" caveat; pairing
  rule (removing a fixture MUST remove the matching `.each()` entry in
  the plan-18-09 fork test); §Outstanding Block-Pin Verification table
  assigning each null-block fixture to @jackcutrara with a precise
  next-step.
- **`test/fork/fixtures/honeypots/eth-sell-revert.json`** — V2,
  `tokenAddress: 0x80e4f014c98320eab524ae16b0aaf1603f4dc01d`, router
  Uniswap V2, bugPattern `sell-revert`, expectedRevertContains
  `BUY_BAL_ZERO`. `forkBlockNumber: null` (Wave-1 follow-up).
- **`test/fork/fixtures/honeypots/eth-max-wallet.json`** — V2,
  `tokenAddress: 0x34c6211621f2763c60eb007dc2ae91090a2d22f6`, router
  Uniswap V2, bugPattern `max-wallet`, expectedRevertContains
  `TRANSFER_FROM_FAILED`. `forkBlockNumber: null` (Wave-1 follow-up).
- **`test/fork/fixtures/honeypots/eth-v3-honeypot.json`** — V3,
  `routerAddress: 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` (SwapRouter02),
  `quoterAddress: 0x61fFE014bA17989E743c5F6cB21bF9697530B21e` (QuoterV2),
  `feeTier: 3000`, bugPattern `v3-sell-tax-spike`, expectedRevertContains
  `SELL_ETH_ZERO`. `tokenAddress` + `forkBlockNumber` both `null` (V3
  resolution policy — see §Deviations Rule 3 below).
- **`hardhat.config.ts`** — added a narrow `TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS`
  subtask override that recursively appends `*.sol` files under
  `test/fixtures/contracts/` to the source path set. Guarded with
  `fs.existsSync` so the override is a no-op if the directory is removed.

## Tasks Completed

| Task | Name                                                                   | Commit  | Files                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Author contrived 5-mode Honeypot.sol test fixture                      | 1038834 | test/fixtures/contracts/Honeypot.sol (new), hardhat.config.ts                                                                                                    |
| 2    | Author real-mainnet fixture README + 3 ETH JSON fixtures (2 V2 + 1 V3) | d33f32f | test/fork/fixtures/honeypots/README.md (new), test/fork/fixtures/honeypots/eth-sell-revert.json (new), eth-max-wallet.json (new), eth-v3-honeypot.json (new)     |

## Verification Results

Plan's `<verification>` block — all four assertions pass:

- ✓ `npx hardhat compile` exits 0; compiled 1 new artifact
  (`artifacts/test/fixtures/contracts/Honeypot.sol/Honeypot.json`).
- ✓ Honeypot.sol contains all 5 mode markers and required literal
  substrings — Task 1's `node -e` grep verification exited `OK`:
  ```text
  $ node -e "const f=require('fs').readFileSync('test/fixtures/contracts/Honeypot.sol','utf8');
    const need=['pragma solidity 0.8.28;','contract Honeypot is ERC20','uint8 mode',
      'uint256 amountTierThreshold','_update','SELL_BLOCKED','MAX_WALLET',
      'AMOUNT_TIER_BLOCKED','// mode 0','// mode 1','// mode 2','// mode 3','// mode 4'];
    for(const n of need) if(!f.includes(n)){console.error('MISSING',n); process.exit(1)} console.log('OK')"
  OK
  ```
- ✓ All 3 JSON fixtures parse and contain the required canonical fields
  including `dexType` discriminator — Task 2's `node -e` verification
  exited `OK`:
  ```text
  $ node -e "const fs=require('fs');
    const r=fs.readFileSync('test/fork/fixtures/honeypots/README.md','utf8');
    const a=JSON.parse(fs.readFileSync('test/fork/fixtures/honeypots/eth-sell-revert.json','utf8'));
    const b=JSON.parse(fs.readFileSync('test/fork/fixtures/honeypots/eth-max-wallet.json','utf8'));
    const c=JSON.parse(fs.readFileSync('test/fork/fixtures/honeypots/eth-v3-honeypot.json','utf8'));
    if(!/forkBlockNumber/.test(r)) process.exit(1);
    if(!/active failure mode/.test(r)) process.exit(2);
    if(!/V3 Fixtures/.test(r)) process.exit(3);
    if(!/Outstanding Block-Pin/.test(r)) process.exit(4);
    if(a.chain!=='eth'||a.dexType!=='v2'||a.bugPattern!=='sell-revert') process.exit(5);
    if(b.bugPattern!=='max-wallet') process.exit(6);
    if(c.dexType!=='v3'||c.feeTier!==3000) process.exit(7);
    if(a.tokenAddress && a.tokenAddress.toLowerCase()!=='0x80e4f014c98320eab524ae16b0aaf1603f4dc01d') process.exit(8);
    console.log('OK')"
  OK
  ```
- ✓ Contrived Honeypot.sol artifact exists at
  `artifacts/test/fixtures/contracts/Honeypot.sol/Honeypot.json`
  (verified via `ls`).

Additional acceptance-criteria spot-checks:

- `eth-v3-honeypot.json.quoterAddress === '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'` ✓
- README documents all 14 schema-field names (13 schema fields + the
  `feeTier` column header, all present as literal substrings) ✓
- §Outstanding Block-Pin Verification table assigns owner `@jackcutrara`
  to each of the 3 null-block fixtures with explicit next-step ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking fix] Hardhat sources didn't include test/fixtures/contracts**

- **Found during:** Task 1 verification (first `npx hardhat compile` output
  was `Nothing to compile`; second `--force` run picked up 7 existing
  contracts but no artifact appeared at
  `artifacts/test/fixtures/contracts/Honeypot.sol/Honeypot.json`).
- **Root cause:** Hardhat 2.x default `paths.sources` is `./contracts`.
  The plan pins the fixture path to `test/fixtures/contracts/Honeypot.sol`
  (3 places in the plan frontmatter + acceptance criteria), so Hardhat
  needed to be taught the extra root.
- **Fix:** Added a `TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS` subtask
  override in `hardhat.config.ts` that recursively appends `*.sol`
  files under `test/fixtures/contracts/` to the source set. Guarded
  with `fs.existsSync` so the override is a no-op if the directory is
  removed later. Override is narrow (one extra root, .sol filter only)
  to avoid pulling node_modules / other trees into compilation.
- **Files modified:** `hardhat.config.ts`.
- **Commit:** `1038834` (bundled with the Honeypot.sol creation since the
  two changes are inseparable — neither makes sense without the other).

### Architectural Decisions (Rule 4)

None. No architectural deviations required.

## Block-Pin Resolution (iter-2 Warning #5)

The plan's Task 2 action provides an explicit binary: "executor verifies
live OR opens Wave-1 follow-up task with operator owner." Live
Etherscan / honeypot.is API access is outside this executor's scope, so
the **Wave-1 follow-up policy is the chosen path** for all 3 fixtures.
Resolution surface:

| Fixture                | tokenAddress  | forkBlockNumber | Owner          | Resolution Path                                                                                                      |
| ---------------------- | ------------- | --------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `eth-sell-revert.json` | filled (V2)   | `null`          | @jackcutrara   | Query Etherscan tx history for first sell-revert tx; pin to immediately prior block.                                 |
| `eth-max-wallet.json`  | filled (V2)   | `null`          | @jackcutrara   | Query Etherscan tx history for first max-wallet-trap revert tx; pin to immediately prior block.                      |
| `eth-v3-honeypot.json` | `null`        | `null`          | @jackcutrara   | Poll honeypot.is `/api/v2/ethereum?filter=v3`, pick active V3 honeypot, pin block where liquidity > 0 AND honeypot reverts. |

The README §Outstanding Block-Pin Verification table is the
canonical living tracker. When a fixture is resolved, the convention
is to commit the JSON edit + remove the row from that table in the
same commit: `chore(18-01): resolve block-pin for {filename}`.

## Authentication Gates

None encountered.

## Threat Model Compliance

Plan's `<threat_model>`:

- **T-18-01 (Spoofing — fixture JSON, disposition: mitigate).** Mitigated.
  The Honeypot.sol contrived 5-mode fixture deterministically covers
  every verdict branch in the fork suite regardless of real-mainnet
  fixture resolution status. Block-pin debt is tracked explicitly with
  owner per Warning #5 — no silent misclassification can sneak through.
- **T-18-02 (Tampering — Honeypot.sol mode-4 contradiction with plan
  18-09, disposition: mitigate).** Mitigated. The 4-arg constructor
  `(string, string, uint8, uint256)` is enforced by Task 1's grep
  verification (`'uint256 amountTierThreshold'` is a required substring)
  and the contract compiles only with that exact signature. All 5
  mode-discriminant branches are present (verified via `// mode 0`..`// mode 4`
  comment markers in Task 1's grep). Plan 18-09 will use this contract
  by setting the constructor arg, not by extending it.
- **T-18-SC (Tampering — npm/pip installs, disposition: accept).**
  Honored. No package installs in this plan; the Hardhat subtask
  override uses existing `hardhat`-package imports
  (`hardhat/config`, `hardhat/builtin-tasks/task-names`) already in
  `node_modules`.

## Known Stubs

The three null-fields in the real-mainnet fixtures (`forkBlockNumber`
on all 3; `tokenAddress` on the V3 fixture) are **tracked debt, not
stubs**. They are explicitly resolved by the Wave-1 follow-up policy
in the plan's Task 2 action ("the fixture ships with `tokenAddress: null`
and `forkBlockNumber: null` and a Wave-1 follow-up task is opened"),
documented in the README §Outstanding Block-Pin Verification table
with owner + next-step, and backstopped by the Honeypot.sol contrived
5-mode contract for fork-test coverage. Plan 18-09 V3 Integration Test
4 already has a Honeypot.sol V3-mode contrived fallback per the plan's
Task 2 action paragraph.

If the operator resolves any of the three follow-ups before plan 18-09
executes, the JSON edits land via the documented
`chore(18-01): resolve block-pin for {filename}` commit convention; the
README §Outstanding Block-Pin Verification row is removed in the same
commit.

## Self-Check: PASSED

Verified post-write:

- ✓ `test/fixtures/contracts/Honeypot.sol` — present (`ls` returned the file).
- ✓ `test/fork/fixtures/honeypots/README.md` — present.
- ✓ `test/fork/fixtures/honeypots/eth-sell-revert.json` — present + parses.
- ✓ `test/fork/fixtures/honeypots/eth-max-wallet.json` — present + parses.
- ✓ `test/fork/fixtures/honeypots/eth-v3-honeypot.json` — present + parses.
- ✓ `hardhat.config.ts` — modified (subtask override added).
- ✓ `artifacts/test/fixtures/contracts/Honeypot.sol/Honeypot.json` — present.
- ✓ Commit `1038834` (Task 1) — present in `git log --oneline -5`.
- ✓ Commit `d33f32f` (Task 2) — present in `git log --oneline -5`.

## Success Criteria Status

Plan's `<success_criteria>`:

> Contrived 5-mode fixture is compile-clean and ready for fork tests
> (Warning #6 resolved). Real-mainnet fixture schema is documented for
> V2 AND V3 (Blocker #1 resolved). Block-pin debt is either resolved
> live OR tracked with explicit owner (Warning #5 resolved).

**Status: MET on all three legs.**

- Warning #6: `Honeypot.sol` ships with 5 modes (including mode-4
  amount-tiered) at 18-01 from the start; the 4-arg constructor is
  grep-asserted; plan 18-09 will SET the constructor arg only.
- Blocker #1: V3 fixture present (`dexType: "v3"`, V3 SwapRouter02,
  V3 QuoterV2, `feeTier: 3000`), V3 schema fields documented in
  README §V3 Fixtures.
- Warning #5: Block-pin debt is tracked explicitly with owner +
  next-step in README §Outstanding Block-Pin Verification; the
  Wave-1 follow-up policy from the plan's Task 2 action is honored
  verbatim.

## Must-Haves Check (from plan frontmatter)

- ✓ "Contrived Honeypot.sol fixture compiles under solc 0.8.28 and
  supports 5 honeypot modes (0=sell-revert, 1=lying-balanceOf,
  2=max-wallet, 3=silent-zero-ETH, 4=amount-tiered-tax) — the 5th
  mode lands here per iter-2 Warning #6, NOT extended later" — done.
  Compiled; 5 mode discriminants present; constructor signature
  pinned in acceptance grep.
- ✓ "Three real-mainnet honeypot fixture JSONs exist for ETH: 2 V2
  (sell-revert, max-wallet) + 1 V3 (per Blocker #1 V3 in scope);
  each pinned to a forkBlockNumber where the honeypot was the
  active failure mode" — three JSON fixtures present; block-pins
  pending live resolution per the plan's explicit fallback policy.
- ✓ "Block-pin TBDs from iter-1 are RESOLVED — each fixture has
  either a numeric forkBlockNumber OR a Wave-1 follow-up task with
  an explicit owner (per Warning #5)" — README §Outstanding
  Block-Pin Verification table assigns each of the 3 null-block
  fixtures to @jackcutrara with a precise next-step.

---

*Phase: 18-honeypot-detection-rebuild — Plan 01*
*Executed: 2026-05-16*
