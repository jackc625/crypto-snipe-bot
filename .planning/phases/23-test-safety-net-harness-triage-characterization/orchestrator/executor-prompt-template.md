<sequential_execution>
You are running as a SEQUENTIAL executor agent on the main working tree (set SEQUENTIAL=true in your Step 0 commit guard). No other executor runs while you do.
Use normal git commits (with hooks). Do NOT use --no-verify. Never amend a commit just to add a trailer.
Run the `<project_root_pin>` guard before your first Edit/Write and before every commit (#4254).
REQUIRED ORDER: Write SUMMARY.md -> commit -> only then any narration. No text between Write and commit.
Sequential mode: after the SUMMARY commit, update STATE.md and ROADMAP.md yourself (state advance, decisions, `roadmap update-plan-progress`) and commit them as `docs(23-NN): record plan progress and decisions in STATE and ROADMAP`, exactly as plans 23-05..23-30 did. Preserve every existing STATE.md Blockers/Concerns, Operating Notes and Decisions line; add, never drop.
Never stage `.planning/config.json` or `.planning/state.json`: both carry the operator's own uncommitted changes (codex review lane; GSD tools rewrite state.json updated_at). Leave them modified and unstaged.
</sequential_execution>

<project_root_pin>
Run this guard verbatim (bash) before your first Edit/Write and again before every commit, in the same cwd as that write or commit. On FATAL, halt and report.
```bash
@@ROOTPIN@@
```
</project_root_pin>

<execution_context>
These GSD files define how you execute the plan. READ EACH ONE IN FULL with the Read tool before starting Task 1 (they are not inlined here, by design, to keep the orchestrator inside its context budget across 31 plans). Do not start work until you have read all five:
- C:/Users/jackc/.claude/gsd-core/workflows/execute-plan.md
- C:/Users/jackc/.claude/gsd-core/templates/summary.md
- C:/Users/jackc/.claude/gsd-core/references/checkpoints.md
- C:/Users/jackc/.claude/gsd-core/references/worktree-path-safety.md
- C:/Users/jackc/.claude/gsd-core/references/executor-examples.md
This plan is not a TDD plan (phase.tdd-applicable = false); tdd.md is not required.
</execution_context>

<required_reading>
Read these files at execution start using the Read tool.
PROJECT_ROOT='C:/Users/jackc/WebstormProjects/crypto-snipe-bot'
- ${PROJECT_ROOT}/@@PHASE_DIR@@/@@PLAN_FILE@@ (Plan - THE plan you are executing)
- ${PROJECT_ROOT}/.planning/PROJECT.md
- ${PROJECT_ROOT}/.planning/STATE.md (read Operating Notes, Blockers/Concerns and EVERY [Phase 23] Decisions line: they are the harness contracts and operator rulings you must follow)
- ${PROJECT_ROOT}/.planning/config.json
- ${PROJECT_ROOT}/@@PHASE_DIR@@/23-CONTEXT.md, 23-SPEC.md, 23-RESEARCH.md, 23-PATTERNS.md, 23-VALIDATION.md
- ${PROJECT_ROOT}/@@PHASE_DIR@@/23-27-PLAN.md section "Harness Gap Procedure"
- ${PROJECT_ROOT}/.planning/audit/PROTOCOL.md (section 7 triage rules)
- Prior SUMMARYs in this phase (what is already built and the latest triage examples): @@PRIOR_SUMMARIES@@
- ${PROJECT_ROOT}/CLAUDE.md (if it exists) and ${PROJECT_ROOT}/.claude/skills/ or .agents/skills/ (if either exists)
</required_reading>

<operator_rules>
1. Node 22 only. Start EVERY shell command that runs node, npm, npx, ts-node, tsc or vitest with: export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH";  The global Node 24 cannot load better-sqlite3. Never run npm rebuild.
2. The bot is OFF for all of v7.0. Never boot src/main.ts or src/bot.ts, never run npm start, never send any request to a real network (no Flashbots, bloXroute, GoPlus, Telegram, RPC). The one approved Flashbots request (23-15) is spent; no further external request may be sent. Everything runs on the loopback harness.
3. No anomaly dismissal. Any NOTOK, error, warning, flaky result, timeout or output you did not expect must be diagnosed to a cause before you mark anything passed. Never call something "non-blocking" without investigating it.
4. NO SEVERITY STOPS. Operator standing instruction (2026-11-11, verbatim): "All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading". You apply a severity change yourself per PROTOCOL.md with reasoning and file:line evidence; you register a bug that is not in the register yourself, with your own grade, quoting this instruction; you list every such change under its own SUMMARY heading; you keep going.
5. STILL STOP (return a checkpoint, do not work around) for: a harness gap (follow the Harness Gap Procedure in 23-27-PLAN.md; test/realpath/harness/ is read-only for you); anything that overturns a plan's or a locked decision's premise; a NOT-A-BUG closure of an S0/S1 (D-11); an entry you cannot reproduce (AC-08); anything unsafe; and the plan's own checkpoints. When you return a checkpoint, explain every option in plain language (what it means, what happens next), with a recommendation.
6. Any command you ask the operator to run must be a single line (chain with && or ;).
7. The local secret-read guard exempts only test/.env.test. Never read .env or any other secret file.
</operator_rules>

<plan_notes>
Lessons and contracts from plans 23-01..23-30 (apply those that touch your work):
- MEMORY: this machine runs low on memory. Claude Code stops BACKGROUND shell commands when memory is low and the session is idle (the orchestrator's wave 9 gate was stopped twice). Run the full npm test and any long group run as a FOREGROUND command with a long timeout (up to 600000 ms). If a run is stopped anyway, say so; never report it as passed.
- RAILS: any change to a rail file or a rail gate allow-list (test/rails/**, test/unit/rails/**) beyond what 23-31 added (loadedModulesProbe on the spawn-site computed-require list) is a STOP: return a checkpoint; the rails are the operator's safety boundary.
- Conversion plans (23-19): follow 23-29's contract (-t is a regex; AssertionError + messageIncludes; FORBIDDEN_IN_MESSAGE exported from scripts/red-proof-conversions.ts; RED-OK / removal lines in --check-summaries form), 23-18/23-31/23-30 decisions (never rename a describe title: test-identity.ts honours only a test's own title; record title changes in rails-test-edits.json; private helpers through real exported callers; reuse test/helpers/sourceGraph.ts and test/integration/fixtures/loadedModulesProbe.ts). AC-37 exempts the 3 named dashboard tests. Manifest after 23-30: MANIFEST-OK rows 32 files 8 guards 1; 23-26 pins rows 36 files 11 guards 1.
- Triage outcomes are recorded ONLY with .planning/audit/tools/set-triage.ts (contract in STATE.md Decisions, 23-04 line). Gates: node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial (must PASS, fail 0) and --stage consolidation (PASS); --stage triage must also PASS (it first passed at 23-16 with TRIAGE-REVIEW-01); diagnose any FAIL you introduce.
- After any register change, re-render .planning/audit/AUDIT-FINDINGS.md with .planning/audit/tools/render.ts (as 23-05..23-07 did) and commit it with the register change. OPERATOR-DECISIONS.md and SEAL.json are not yours to change unless the plan says so.
- knownBug FIRST: in every triage test the knownBug(ctx, '<ID>', { claim, ... }) check comes before any assertion of bug detail, so a real fix fails as "looks fixed", never as an unexplained assertion. Prove EVERY claim against a temporary fix-shaped src/ mutation that makes it read "looks fixed", then restore src/ byte-for-byte (git -c core.autocrlf=false checkout -- <file>, confirm git hash-object equals the HEAD blob and git status --porcelain src is empty). Never commit a src/ change.
- Assert another finding's detail only in its own file: keep each test's setup facts valid under OTHER findings' fixes (a fix for finding X must flip only X's test).
- ethers JsonRpcProvider caches identical requests for 250 ms: bare-node tests through a real provider need cacheTimeout -1, and a re-check through the bot's provider can be answered from that cache.
- Settle subscriptions and held calls before teardown (FakeNode.failNext/hold handles must fire, or afterEach fails). 23-09 hit two unhandled rejections at teardown from an anti-rug re-subscribe still in flight after a buy; settleAntiRugArming (fixtures/AUD-TX-002-lock.ts) waits for it. A full run must end with 0 unhandled errors, and every warning or error line your tests produce must be accounted for (a registered finding, or the failure the test forces on purpose).
- Force races with holds, mined blocks and fake time, never sleeps; state an observation window as bounded ("did not happen within N minutes of fake time"), never as "forever".
- AUD-TESTI-028: realpath teardown runs only in setup.ts afterEach, which Vitest 4.1.1 skips when a file's own afterEach throws first. Never declare an afterEach that can throw in a test/realpath file.
- AUD-BUY-016 route limits: on base and Arbitrum a V2 buy cannot succeed on today's code (the V2 lock check asks GoPlus about the pair and skips). Use eth, or V3, when a test needs a landed buy.
- AUD-ANTIRUG-025: every boot that resumes an open position drops the anti-rug WebSocket subscription. Any test that restarts the graph and then expects anti-rug to fire must account for this (assert it only in AUD-ANTIRUG-025's own file; elsewhere arrange setup so it does not decide your result, and say how).
- AUD-TX-028 (found by 23-08): the bot's HTTP provider (src/utils/provider.ts:23) re-checks the chain ID on every call and ethers batches that check with the call that triggered it, so ONE held or stalled read on a chain's HTTP provider stalls EVERY later call on that chain (up to 300 s). When a test needs an operation held in flight, hold it somewhere that does not decide your result through this effect (23-08 held the in-flight exit at its Flashbots simulation, not at a read), and assert the stall itself only in AUD-TX-028's own file. If a plan's prescribed hold point is a provider read, say in your SUMMARY how you kept AUD-TX-028 from deciding the test.
- Editing an already-committed test file (for example adding a "closes-finding: <ID>" marker line) makes check.ts --stage partial fail until a reviewed re_audit row for that file reaches its new last-change SHA in the area ledger (.planning/audit/ledger/<AREA>.json). 23-11 added the TESTI.json row in its own commit first. Do the same for every existing file you edit, and say which ledger rows you added.
- A "fixed" outcome whose rail test is an integration test needs that test in the run evidence's passed_tests, so 23-16's run evidence must include an integration run; name such tests in your SUMMARY's "For 23-16" section.
- AUD-TESTI-029 (found by 23-13): when a realpath test times out, its leftover code keeps running into the next test in the same file, so later failures and errors in that file are reported against the wrong test. In any failing run, diagnose the FIRST failure in the file; do not read knock-on failures as separate problems.
- The AC-02 mock gate (scripts/check-realpath-mocks.ts) treats any identifier named vi or vitest as the Vitest global: never name a variable, parameter or env flag that way in test/realpath (23-13 renamed a VITEST flag in a fixture).
- Relay non-200 answers are available: a setRelay handler may return { http: { status, body, statusMessage?, headers? } } (harness commit 65172c9).
- Reusable triage fixtures already committed: test/realpath/triage/fixtures/AUD-BUY-011-dashboard.ts (drive the real dashboard API: real login, real routes, loopback port; see the 23-06 STATE.md line for its timing rules), fixtures/AUD-EXIT-001-sell-path.ts (sell side from mined transactions, foreignTrade, landNextSell, driveExits), fixtures/AUD-EXIT-002-position.ts (buy/arm helpers), fixtures/AUD-API-001-dashboard-sell.ts (dashboard force/emergency sells; driveChain, incomingHolder) and fixtures/AUD-EXIT-014-rug.ts (an in-flight exit held at its Flashbots simulation plus an anti-rug trigger), both from 23-08, fixtures/AUD-TX-002-lock.ts (graphWithNonceLock, probeWalletLock, pendingWindow, missBundlesUntil, settleAntiRugArming) and fixtures/AUD-TX-003-second-launch.ts (a second token launched on sushiswap-v2 on the same node and wallet), both from 23-09, and from 23-10: fixtures/AUD-API-002-restart.ts (bootListeners; a source-hash-pinned mirror of the private src/bot.ts onRestart, which fails "onRestart changed" on any edit of the original), fixtures/AUD-ANTIRUG-003-live.ts (live anti-rug gates, the breaker module, afterExitPoll, a bounded chain driver) and fixtures/AUD-ANTIRUG-018-range-limit.ts (a provider that refuses any eth_getLogs wider than 10 blocks, judged per request); and from 23-12 for child-process proofs: fixtures/loopbackChain.ts (a self-mining loopback chain for railed children) and fixtures/crashRun.ts (run a railed child to its end and read a crash signal only when the process actually ended). Reuse rather than duplicate; do not change their behavior for other files.
- Timing: before your SUMMARY, run the FULL railed suite once on Node 22: npm test (unit + integration + realpath, parallel). Plan 23-07 verified only isolated runs and two of its tests then timed out under the full parallel load. Any test of yours that takes more than half its time limit under the full run gets its own { timeout } with a comment stating the measured time (full-run and alone). Compare each time with the limit that actually applies: a test body against testTimeout (unit 5 s, integration and realpath 15 s, set in vitest.config.ts), a beforeEach/afterEach/beforeAll hook against hookTimeout (unset there, so Vitest 4.1.1's default 10 s); see deferred-items.md for the case 23-12 mis-measured. 23-12 also added crash-fixture child processes that slow the whole parallel run, so existing tests near their limits may now cross them; treat any such timeout as a finding to diagnose, not a flake. Report the full-run counts (files, passed, failed) and the ledger summary (nonLoopbackAllowed, telegramAllowed) in your SUMMARY.
- Cold imports (orchestrator, wave 6 gate, 00d5ef1): a test whose body does vi.resetModules() then await import("src/bot") (or the anti-rug detector) pays the cold module-graph compile against testTimeout: about 1 to 2 s alone, up to 10.7 s at the full run's peak. In a NEW test, do that first import in beforeAll/beforeEach (hookTimeout, 10 s) or give the test an explicit limit with measured times. deferred-items.md lists the 19 existing files with this pattern for Phase 28; do not edit them unless your plan touches them.
- The phase triage gate (check.ts --stage triage) now PASSES (23-16, TRIAGE-REVIEW-01). It must still pass after your plan: run it with partial and consolidation, and diagnose any FAIL you introduce.
- Also before your SUMMARY: tsc --noEmit on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json (all clean); npm run check:realpath-mocks and npm run check:vi-mock (0 violations); type-check your new triage files the way 23-07 did (scratch tsconfig extending the repo's); git status --porcelain src empty.
- Repeatability (AC-10): run your plan's test files three times with the JSON reporter and confirm identical tests and knownBug records.
response_language: not set (English).
</plan_notes>
