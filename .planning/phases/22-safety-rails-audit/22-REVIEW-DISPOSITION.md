---
phase: 22
review: 22-REVIEW.md
titles: json
findings:
  - id: WR-01
    severity: warning
    disposition: open
    title: "A set `VITEST` variable turns off production DB guards and Telegram alerts"
  - id: WR-02
    severity: warning
    disposition: open
    title: "The lock folder moves with `HOME` / `USERPROFILE`, so a second bot can run on the same wallet"
  - id: WR-03
    severity: warning
    disposition: open
    title: "`LOG_LEVEL` from `.env` now takes effect on the live bot, which the phase did not declare"
  - id: WR-04
    severity: warning
    disposition: open
    title: "A failed temp-folder cleanup in the DB probe stops the bot from starting"
  - id: WR-05
    severity: warning
    disposition: open
    title: "The Vitest DB tripwire misses a `data` folder that is a junction or symlink"
  - id: WR-06
    severity: warning
    disposition: open
    title: "A failed baseline collection is recorded as zero tests and passes the NAC-04 gate"
  - id: WR-07
    severity: warning
    disposition: open
    title: "The CI `test` job has no timeout"
  - id: IN-01
    severity: info
    disposition: open
    title: "`process.loadEnvFile()` is not covered by the `.env` rail"
  - id: IN-02
    severity: info
    disposition: open
    title: "`spawnRailedChild`'s path limit does not resolve links"
  - id: IN-03
    severity: info
    disposition: open
    title: "`capture-baselines --out` with no value writes to the committed baseline folder"
  - id: IN-04
    severity: info
    disposition: open
    title: "The net-watch early-exit check cannot fire"
open: 11
total: 11
recorded: 2026-11-09T05:45:21.475Z
---

# Phase 22: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| WR-03 | warning | open | - |
| WR-04 | warning | open | - |
| WR-05 | warning | open | - |
| WR-06 | warning | open | - |
| WR-07 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
