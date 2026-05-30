---
plan: 21-08
phase: 21-exit-engine-live-runtime-hardening
status: complete
completed: 2026-05-29
requirements: [EXIT-LIVE-06, EXIT-LIVE-07, EXIT-LIVE-11]
autonomous: false
---

# Plan 21-08 Summary — induced-RPC-drop + fresh-clone migration captures + EXIT-LIVE-11 consolidation

## Task 1 — observation captures (operator-confirmed real bot output)

Both run against the REAL code in isolation (throwaway Hardhat key, temp DB, no transaction,
prod DB/wallet untouched):

- **EXIT-LIVE-06** (chain-restart warning on induced RPC drop): drove the real
  `detector.ts` WS lifecycle (`startChainAntiRugListener`) on a live Alchemy WS, then induced a
  deterministic drop via `rawWs.terminate()` → captured `op:antirug.ws.disconnected`
  ("beginning reconnect loop", warn) → `op:antirug.ws.reconnected` ("re-subscribing +
  backfilling", info). Reconnected in ~1s.
- **EXIT-LIVE-07** (fresh-clone first-boot migration): fresh temp DB → real `db.ts migrateSchema`
  ran all 7 schema versions in order (v1 trades → … → v7 `exit_failure_count`/`exit_status`) →
  `PRAGMA user_version = 7`.

## Task 2 — EXIT-LIVE-11 consolidation

`.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` written, mirroring the
`v6.17-safety-bank-audit.md` analog: frontmatter (disposition_summary
`closed-live-artifact:6` / `closed-fork-only:1` / `stop-the-line:0`), ## Methodology, ## Per-Item
Findings (rows for EXIT-LIVE-01..07), ## Notes, ## Stop-the-Line Determination. Verify:
`grep -c "EXIT-LIVE-0"` = 19 (≥6). The EXIT-LIVE-02 fork-only closure is explicitly authorized
by ROADMAP sc-1(b) (quoted verbatim); every other item links a resolvable real artifact.

## Findings / deviations

- **EXIT-LIVE-07 `user_version` is 7, not the plan's stale "6"** — phase 21.2-03 advanced the
  schema (v7). A fresh boot correctly migrates to current (7); the requirement (fresh-boot
  migration runs + user_version reflects current schema) is satisfied. Documented in the
  evidence doc.
- **EXIT-LIVE-04 mapping came via the 21.1 reconcile late-inclusion path** (`mev.reconcile.included`),
  not a clean `flashbots.bundle.included` event — bundle landed one block late; the mapping is
  present + resolvable. Noted in the evidence doc.
- **Cosmetic dashboard display defect → phase 21.4 (non-blocking)** — `api/helpers/positions.ts`
  `queryPrice(buyAmountWei…)` foot-gun renders `Current 0.0000`; engine triggers are correct
  (ratio cancels). Root cause in resolved debug session `exit-no-sell-current-zero`.

## Stop-the-Line: none

The 21-07 capture anomaly (exit not firing + current=0) was investigated under D-STOP-THE-LINE
and ruled out as a capital-safety issue — correct stable-token hold + a cosmetic display bug. No
blocking decimal phase required; 21.4 is a non-blocking cosmetic follow-up.

## Self-Check: PASS

EXIT-LIVE-06/07 captured with real-code excerpts; EXIT-LIVE-11 consolidates all 6 deferred items
with ground-truth artifacts (+ the single authorized EXIT-LIVE-02 fork closure). FINAL Phase 21 plan.
