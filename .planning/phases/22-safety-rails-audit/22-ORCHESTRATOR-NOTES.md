# Phase 22 orchestrator carry-forward notes

Written 2026-11-09 at the pause after plan 22-10 (21/29 plans done). These are the obligations the execute-phase orchestrator picked up from executor reports and operator checkpoints. They existed only in a session scratchpad until now.

**How to use this file:** give each executor only the lines for its own plan. Do NOT list this whole file as required reading for 22-28 or 22-29 — it paraphrases findings, and PROTOCOL.md P9 (line 23) keeps auditors anchored on code and the register, not on narrative. This file is never evidence.

## Applies to every remaining executor

- Node 22.16.0 by absolute path (`C:\Users\jackc\AppData\Local\nvm\v22.16.0\node.exe`, D-21). No `npm install`/`ci`/`rebuild`. No Hardhat. Never boot `src/bot.ts`. Never read the real `.env`. Never open live `data/` through SQLite (P3).
- Every Vitest run is wrapped: `scripts/verify-prod-untouched.ts --manifest C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06/MANIFEST.json` (the wrapper also sets `CSB_RAIL_RUN_ID`). Named files only until 22-15 owns the first full-suite run.
- Any run showing live data changed, a non-loopback allowance, a real `.env` read, or an undenied Telegram attempt: stop at once, run nothing further, return a checkpoint.
- Operator commands are ONE LINE (chain with `&&` / `;`), plain language. Multi-line pastes get mangled on the operator's machine.
- The secret-read guard (`~/.claude/hooks/gsd-secret-read-guard.js`) has a local exemption for exactly `test/.env.test`. A GSD update erases it. Never broaden it.
- Stay on branch `phase-22-safety-rails-audit` until it merges. Checking out `main` deletes 6 ignition files from the working tree (STATE.md has the restore steps).
- Never stage `.planning/phases/22-safety-rails-audit/.review-diagnostics/` (pre-existing, untracked).
- Register conventions: `owner_phase` is a non-empty STRING (`check.ts:304`); thresholds files may be a bare array or `{rows, discovery}` (PROTOCOL line 119); rediscovered items link via `resolved_items`; orchestrator/executor context goes in `ruling_note` or recommendation text, never in operator fields; operator replies are recorded verbatim.

## 22-28 (consolidation) — next to run

- **MUST (promised to the operator):** re-grade all 43 findings where codex said S1 and the register says S2/S3/S4 against the code at the audit base, accepting neither side. List: `MERGE.json` `consolidation_required` / `severity_disagreements` (43 external findings on 39 register entries, 19 unique new). Named examples: AUD-TX-020, AUD-EXIT-020, AUD-TX-012, AUD-TX-019. Anything moving up to S1 goes to the operator as a batch.
- Raise AUD-BUY-007 to S1 and attach ESC-CENSUS-01 (operator ruling "keep s1"); AUD-CENSUS-002 is its duplicate (5 merge items: evidence, reported_by, severity, merge note, escalation).
- Update AUD-EXIT-014's status: 22-19 confirmed by code reading that a refused rug escape never fires again (AUD-ANTIRUG-004).
- Link AUD-TX-009 and AUD-ANTIRUG-002 via `related` (same uncaught-crash class; fixes belong together with OD-6). AUD-ANTIRUG-011 and AUD-EXIT-013 are the same wrong-DEX defect; decide the merge.
- TH-EXIT-23 is wrong: `MEV_SELL_MAX_PRIORITY_FEE_GWEI` never caps private sells (AUD-TX-010). The bloXroute latest-attempt-only trace in `sweep/TX.json` cell C07 answers AUD-BUY-002's open `bloxroute.ts` item.
- Number proposed cards BUY-09 and DB-07.
- Consolidation scripts must accept both thresholds layouts and string `owner_phase`.
- Consolidation-stage `check.ts` already showed 201 failures before this plan: expected, since consolidation has not run.
- **Record two deviations:** (1) P9 slip — the orchestrator listed phase SUMMARYs as required reading for the 22-17..22-22 auditors. Checked 2026-11-07: all slices pass `check.ts`; no finding cites a SUMMARY/VERIFICATION doc. Residual risk is soft anchoring only. (2) D-14 only partly covered: codex only (Docker, no tools, code embedded in the prompt); agy excluded by operator ruling "codex a, agy c".

## 22-11 to 22-16

- 22-12 closes AUD-TX-004 (second lock-module copy); 22-13 closes AUD-TX-005 (second bot process). Reference them in the SUMMARYs; statuses stay with 22-28/22-29.
- 22-15 is the first full-suite run. 22-08 left the Vitest MAIN process unrailed on purpose (railing it would propagate to fork workers and scrub the fork shell keys). Covered by: config loads no `.env`; main imports only config + ledger globalSetup; the wrapper hashes `data/` around the run. **Remaining gap: main-process outbound network is not blocked — 22-15's OS-level connection check must cover it.**
- The post-merge `npm test` gate stays skipped until 22-15 lands. Build gate is the three `tsc --noEmit` checks (root, bot, dashboard); `npm run build` writes `dist/`.

## 22-29 (phase-end re-audit and seal)

- The AC-07 node one-liner aborts with `ENOBUFS` (1 MiB `execSync` limit vs 3.87 MB build-info files). IGN_AC07 needs a larger `maxBuffer` (64 MiB worked) or streaming.
- Confirm the 22-09 temp-copy WAL probe is acceptable (Threat Flags in 22-09-SUMMARY). Residual: if the copy fails with `-wal` and `-shm` present, the probe falls back to a direct read-only open that can rewrite `-shm`.
- Register UFV-03 (real fork-project run of the notifier refusal, owner Phase 25, from 22-10). UFV-01/-02 are in `.planning/audit/inputs/unrun-fork-verifications.json`.
- AUD-OD21-001 (ignition CRLF-on-checkout and branch-switch hazard) is routed to Phase 25.
- The rail tests' own deliberate denials appear in the ledger's denying-test-file list: not test-quality findings.
- 22-10 slip: `node_modules/.bin/vitest --version` was run once, unwrapped, on Node 24. Version print only; `data/` verified equal afterwards.
- Line endings: `.planning/audit/**` is pinned LF. `scripts/nac01-exact-value-check.ts`, `test/.env.test` and `test/rails/*` are not (hash the git blob if pinning).
- Tell the phase verifier about the P9 slip and the partial D-14 coverage. The 22-27 host containment probe sent `package.json` (dependency names and scripts only) to OpenAI.

## Later phases

- **Phase 23 work list:** AUD-TESTI-020 enumerates all 39 money-path S0/S1 findings, caught/not-caught by integration or fork tests (none caught on the real path; 5 asserted as correct). Front of queue per the orchestrator's advice to the operator: AUD-BUY-002, AUD-EXIT-002/-013/-015, AUD-DB-002. AUD-TESTU-003/-004 (nonce-lock tests stay green if INT-NONCE-SELL returns) need a RED-proven test.
- **Phase 24:** AUD-ANTIRUG-002 and AUD-API-008 are proven and small; early fixes. AUD-DB-002 means OD-25 must be decided treating daily-loss and exposure limits as NOT working. Secret handling: AUD-DB-009, AUD-DB-010, AUD-TX-014 (card TX-04; persisted logs are only the three `data/*capture*.log` files, proven free of those exact values by the 22-03 check).
- **Phase 29 (HYG-03), pending operator decision:** card SCRIPTS-01 (signer exclusion, D-06 premise challenged) deferred by the operator ("Acknowledge. Decide in phase 29"). Orchestrator recommended hold-lock. Decide together with BUY-01. D-06 wording unchanged until then.

## How the orchestrator built executor prompts

`workflow.use_worktrees` is false, so every plan runs sequentially on the main checkout. `executor_model` is `opus`, so `model="opus"` is passed.

Each prompt carried: `[gsd:dispatch phase="22" plan="22-NN"]`; the `<sequential_execution>` block; the `<project_root_pin>` guard bound to `C:/Users/jackc/WebstormProjects/crypto-snipe-bot`; plan-specific `<required_reading>` and `<orchestrator_notes>`.

Deviation from the spec: the workflow says to inline `execute-plan.md`, `summary.md`, `checkpoints.md`, `worktree-path-safety.md` and `executor-examples.md` (about 128 KB per prompt). Prompts instead list them by absolute path under `<execution_context>` and require a full Read. Add `tdd.md` for TDD-applicable plans.

For continuations after a checkpoint, a fresh agent gets the completed-tasks table, the operator's reply verbatim, and the predecessor's notes. Each plan's dispatch is preceded by `query dispatch-isolation --raw --phase 22 --plan 22-NN --force-isolation none`.
