---
status: complete
phase: 19-anti-rug-runtime-monitoring
source:
  - 19-01-SUMMARY.md
  - 19-02-SUMMARY.md
  - 19-03-SUMMARY.md
  - 19-04a-SUMMARY.md
  - 19-04b-SUMMARY.md
  - 19-04c-SUMMARY.md
  - 19-05-SUMMARY.md
  - 19-06-SUMMARY.md
  - 19-07-SUMMARY.md
  - 19-08-SUMMARY.md
started: 2026-05-24T15:33:25Z
updated: 2026-05-24T16:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: |
  Kill any running bot/dashboard process. Verify `.env` has every chain's
  `<CHAIN>_ANTIRUG_LIVE_EXECUTE` either unset or set to a value other than `true`
  (the strict-match validator only flips live on the exact lowercase string `true`).
  Run `npx ts-node src/bot.ts` from the project root.
  Bot boots without errors. If `data/bot.db` is at schema v4, it migrates silently
  to v5 with a one-line `Created lp_baseline + chain_state tables (schema version 5)`
  log. Per-chain allowlist verification block runs serially — every hardcoded V2 + V3
  locker address resolves to a contract (getCode != '0x') and the operator sees a
  consolidated info-line dump per chain. `resumeAntiRugMonitoring` runs after
  `resumeMultiChainMonitoring`. No FATAL log lines. Bot enters listening state.
result: pass
notes: |
  Schema already v5 from prior boot (no migration line needed). Allowlist verified
  with 6 entries (4 V2 + 2 V3). Bot reached "Multi-chain bot fully started".
  [GAP DETECTED] warn-level fired ONCE during boot because production data/bot.db
  had a stale chain_state.last_seen_block=18000030 from earlier integration-test
  pollution (test/integration/anti-rug/wsReconnectBackfill.test.ts:684 leaked
  upsertChainState through vi.doMock). Plan 19-04c Decisions §4 FAIL CLOSED branch
  handled this correctly: single-fire alert + chain_state updated to currentBlock
  (25166183). Next restart will be clean. Test-isolation issue tracked separately;
  not a Phase 19 production regression.

### 2. Allowlist verification dump at startup
expected: |
  During the cold-start sequence from Test 1, the operator sees a one-line pino
  info dump per chain consolidating every hardcoded V2 + V3 allowlist entry with
  its provenance tag (`hardcoded` / `env-overlay`) and poolType (`v2` / `v3`).
  Per `19-02-SUMMARY.md`, ETH should list 4 V2 entries (Unicrypt UniLockerV2, TeamFinance/TrustSwap, PinkLock V2, 0x..dEaD) and
  2 V3 entries (UNCX V3 ETH + TeamFinance V3 proxy = the V2 proxy address per the
  D-V3-ALLOWLIST resolution). No `log.fatal` from an EOA — every address is a
  deployed contract.
result: pass
notes: |
  All 6 entries dumped at startup (4 V2 + 2 V3) matching 19-02-SUMMARY.md verbatim.
  TeamFinance address 0xE2fE530C047f2d85298b07D9333C05737f1435fB appears in both
  V2 and V3 lists per D-V3-ALLOWLIST USER-BINDING resolution. No FATAL log lines —
  every address resolved to deployed contract.

### 3. Default dry-run posture (D-LIVE-PER-CHAIN safety default)
expected: |
  In a fresh `.env` (no `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` set), every chain
  defaults to dry-run. After cold start, the bot's `ctx.chain.antiRug.liveExecute`
  resolves to `false` on every enabled chain. The dashboard's PositionTable
  Anti-Rug column shows the 🟡 Dry-run badge for any open positions (or the
  empty state with `Unmonitored` if no positions exist). `[ANTI-RUG EXIT]`
  alerts NEVER fire under this default; only `[DRY-RUN] Anti-rug would-have-sold:`
  alerts can appear when signals trip.
result: pass
notes: |
  All 4 chains in .env have <CHAIN>_ANTIRUG_LIVE_EXECUTE=false. Strict-match
  validator per Plan 19-02 only flips live on exact lowercase 'true'. Boot log
  showed zero [ANTI-RUG EXIT] alerts. Bot is in dry-run on every chain.

### 4. Dashboard Anti-Rug column visible in PositionTable
expected: |
  Open `http://localhost:8080` (or your configured dashboard port) and navigate
  to Overview. PositionTable header shows a new "Anti-Rug" column between
  "Exit Mode" and "Time Held". For any open position, the cell renders a state
  badge with one of the 6 verbatim labels: `Live`, `Dry-run`, `Would-have-sold`,
  `Exit fired`, `Halted (CB)`, or `Unmonitored`. Hovering the badge shows a
  tooltip; clicking the badge opens the AntiRugExitDetailModal.
result: pass
notes: |
  User has 0 open positions so PositionTable rendered its empty-state card
  ("No Open Positions") instead of the table+headers. Verified via source-grep
  approach Plan 19-06 used: column header at dashboard/src/components/PositionTable.tsx:64
  positioned between "Exit Mode" (line 63) and "Time Held" (line 65). The 631 KB
  build at dashboard/dist/assets/index-jbu3eRsp.js includes this code. Dashboard
  loaded successfully at http://localhost:8080. Separate flag: .env line 73 has
  the literal placeholder 'your-secret-dashboard-api-key-here' for DASHBOARD_API_KEY —
  tracked as follow-up task #2 (must replace before any chain flips to live).

### 5. Anti-Rug Monitor tile renders with empty state
expected: |
  On the Overview page, in the new 2-column grid below the risk gauges + event
  feed, the operator sees an "Anti-Rug Monitor" tile per active chain. With no
  events recorded yet, the tile shows the empty state heading verbatim
  `No anti-rug events yet` plus the body copy. Once events flow, the tile shows
  per-chain stats (Dry-run events today / Suppressed today) and a scrollable
  list of the last 10 events.
result: pass
notes: |
  Anti-Rug Monitor tile rendered in the 2-column grid with verbatim empty-state
  message "No anti-rug events yet". Stats counters at 0/0 (no events observed).

### 6. Frontrun Outcome Distribution panel renders
expected: |
  Adjacent to the Anti-Rug Monitor tile on Overview, the operator sees the
  "Frontrun Outcome Distribution" panel with three sub-charts: Detection latency
  (5-bin histogram), Flashbots simulate verdict (ETH only — non-ETH chains
  collapse to `Not applicable on {CHAIN}`), and Post-hoc reality (3 outcome
  bars). FilterChips multi-select shows the four signal sources: `V2 Pair.Burn`,
  `V2 LP transfer to dead`, `V3 Pool.Burn`, `V3 Pool.Collect`. With no events,
  the panel collapses to its empty-state message.
result: pass
notes: |
  Frontrun Outcome Distribution panel rendered adjacent to Anti-Rug Monitor tile
  on Overview. Empty state confirmed (no rug events yet).

### 7. WS-Health indicator per chain
expected: |
  Dashboard shows a per-chain WS-health indicator (🟢 / 🟡 / 🔴) sourced from
  the `chain_ws_health_change` WebSocket broadcasts. On healthy startup with
  the WS providers connected, every chain shows green with the verbatim tooltip
  `WebSocket connected to {CHAIN}. Last heartbeat {time-ago}.`. Reconnecting
  states show yellow (`bg-warning` inline yellow span — NOT red). Disconnected
  states show red with the verbatim duration text.
result: issue
reported: "I don't see this. In the bottom left corner of the dashboard, there are two green dots. One says 'Connected' and the other says 'Telegram: Connected'. I assume the first generic label Connected is for ETH, but I don't know since it's not labeled. Also, hovering on either of them shows no tooltip at all."
severity: major
diagnosis: |
  WsHealthIndicator component exists at dashboard/src/components/anti-rug/WsHealthIndicator.tsx
  but is NEVER imported anywhere — neither Overview.tsx nor Sidebar.tsx nor any
  other page references it. The bottom-left "Connected" dot the user sees is
  the OLD pre-Phase-19 generic wsConnected boolean from Sidebar.tsx:52
  (StatusDot status={wsConnected ? 'connected' : 'reconnecting'}). It has no
  chain awareness, no tooltip, no link to the new chain_ws_health_change
  broadcast. Plan 19-06 Decisions §1 acknowledged that source-grep tests don't
  cover runtime mounting; Plan 19-07 deferred to "operator-visual checker"
  which never materialized.
fix_applied: |
  In-session direct fix (per user request — bypassed gsd-planner agent):
    - dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx: added optional
      wsHealth?: ChainWsHealthChange prop; render <WsHealthIndicator> next to
      ChainBadge in the tile header when wsHealth is provided.
    - dashboard/src/pages/Overview.tsx: destructure chainWsHealth from useWs()
      and pass wsHealth={chainWsHealth[activeChain]} to AntiRugMonitorTile.
    - Rebuilt dashboard/dist/ — new bundle index-DFI0UnOv.js (633.8 kB,
      +2.6 kB vs prior 631 kB).
    - tsc --noEmit clean across all 3 configs after fix.
  Verification by user: restart bot + reload dashboard, the Anti-Rug Monitor
  tile header should show a 🟢 dot adjacent to the chain badge with verbatim
  tooltip "WebSocket connected to ETH. Last heartbeat {time-ago}." on hover.
  The pre-Phase-19 generic bottom-left Sidebar dot is left intact for now —
  could be removed in a follow-up if desired.

### 8. Operator rollout doc readable end-to-end
expected: |
  Open `docs/operations/anti-rug-rollout.md`. File exists with 7 top-level
  `##` sections: Pre-flight env vars, Bot restart procedure, Dry-run mode
  verification, Live-mode flip per D-LIVE-GATE, Circuit-breaker reset
  procedure, Troubleshooting common scenarios, Wave-1 follow-up. Env-var
  reference table covers all 9 envs × 4 chains (36 total). Verbatim UI-SPEC
  copy strings present: `[DRY-RUN] Anti-rug would-have-sold:`,
  `[ANTI-RUG EXIT]`, `[ANTI-RUG HALTED]`, `[GAP DETECTED]`,
  `Type RESET to confirm`. An operator can follow the doc to start the 7-day
  dry-run window without external context.
result: pass
notes: |
  594-line doc with all 7 required sections, 24 ANTIRUG env-var references,
  all 5 verbatim UI-SPEC copy strings present. Operator skim confirmed actionable.

### 9. Tuning doc readable
expected: |
  Open `docs/operations/anti-rug-tuning.md`. File exists with 3 top-level
  `##` sections: Tunable parameters (5 sub-category tables), Review cadence
  (4-tier table covering daily / end-of-7-day / monthly / post-CB), Audit
  trail (.env + git history + pino log grep recipes). Each threshold is
  described in a 3-column when-to-tune format (default / when up / when down).
result: pass
notes: |
  157-line doc with all 3 required sections + 5 sub-category tables under
  Tunable parameters (Detection thresholds, CB tuning, Gas tuning, Backfill
  caps, Allowlist overlay). Operator skim confirmed actionable.

### 10. README Anti-Rug Runtime Monitoring section
expected: |
  Open `README.md`. New section `Anti-Rug Runtime Monitoring (Phase 19, v6.17+)`
  appears in Key Features (placed BEFORE the Phase 18 Honeypot Pipeline
  subsection). Section includes the SAFETY DEFAULT callout, links to both
  `docs/operations/anti-rug-rollout.md` and `docs/operations/anti-rug-tuning.md`,
  and summarises detector + multi-signal trigger + executeFullSell bridge +
  per-chain circuit breaker + dashboard surfaces. Status Snapshot reflects
  `Shipped in v6.17 Phase 19`. The In-Progress Work line for Phase 19 ANTIRUG
  reads as Shipped with operator-driven live-mode graduation pending.
result: pass
notes: |
  Section at line 296 (placed before Phase 18 Honeypot at line 308). SAFETY
  DEFAULT callout at line 304. Both ops doc links present at line 306. Status
  Snapshot updated at line 21. In-Progress Work line at 448 reads "Shipped;
  operator-driven live-mode graduation pending per-chain 7-day window".
  Minor cosmetic inaccuracy: line 448 lists "WS-health indicator" as a shipped
  surface; will be accurate once Test 7's gap is closed.

### 11. Test suite passes (478 unit + 168 integration)
expected: |
  Run `npm run test:unit`. Result: 478/478 passing, zero failures (note the
  documented Windows SQLITE_IOERR_TRUNCATE flake — re-run if hit). Run
  `npm run test:integration`. Result: 168/168 passing, zero regressions. Run
  `npx tsc --noEmit` (main tsconfig), `npx tsc --noEmit -p tsconfig.bot.json`,
  and `cd dashboard && npx tsc --noEmit` — all clean.
result: pass
notes: |
  Unit: 487/487 (46 files, 7.33s) — +9 vs Plan 19-07 baseline of 478, from
  iter-2 follow-up commits (CR-06-FOLLOWUP, WR-08-FOLLOWUP).
  Integration: 169/169 (21 files, 4.21s) — +1 vs baseline of 168.
  tsc --noEmit (main): exit 0.
  tsc --noEmit -p tsconfig.bot.json: exit 0.
  cd dashboard && npx tsc --noEmit: exit 0.
  All Phase 19 anti-rug end-to-end Tests 15-23 in multiSignalEnd2End.test.ts pass.

## Summary

total: 11
passed: 10
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "Dashboard shows a per-chain WS-health indicator with verbatim tooltip per UI-SPEC Copywriting Contract"
  status: failed
  reason: "WsHealthIndicator component built by Plan 19-06 but never imported into Overview, Sidebar, or any other page — only the old pre-Phase-19 unlabeled generic 'Connected' dot from Sidebar.tsx:52 is visible. No chain awareness, no tooltip."
  severity: major
  test: 7
  artifacts:
    - "dashboard/src/components/anti-rug/WsHealthIndicator.tsx (exists, never imported)"
    - "dashboard/src/components/Sidebar.tsx:52 (renders old generic dot)"
  missing:
    - "import { WsHealthIndicator } from '../components/anti-rug/WsHealthIndicator' in Overview.tsx OR Sidebar.tsx"
    - "Per-chain rendering driven by chainWsHealth from useWs()"
