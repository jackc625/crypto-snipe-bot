---
phase: 22
review: 22-REVIEW.md
titles: json
findings:
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "A set `VITEST` variable turns off production DB guards and Telegram alerts"
  - id: WR-02
    severity: warning
    disposition: deferred
    title: "The lock folder moves with `HOME` / `USERPROFILE`, so a second bot can run on the same wallet"
  - id: WR-03
    severity: warning
    disposition: fixed
    title: "`LOG_LEVEL` from `.env` now takes effect on the live bot, which the phase did not declare"
  - id: WR-04
    severity: warning
    disposition: fixed
    title: "A failed temp-folder cleanup in the DB probe stops the bot from starting"
  - id: WR-05
    severity: warning
    disposition: fixed
    title: "The Vitest DB tripwire misses a `data` folder that is a junction or symlink"
  - id: WR-06
    severity: warning
    disposition: deferred
    title: "A failed baseline collection is recorded as zero tests and passes the NAC-04 gate"
  - id: WR-07
    severity: warning
    disposition: deferred
    title: "The CI `test` job has no timeout"
  - id: IN-01
    severity: info
    disposition: deferred
    title: "`process.loadEnvFile()` is not covered by the `.env` rail"
  - id: IN-02
    severity: info
    disposition: deferred
    title: "`spawnRailedChild`'s path limit does not resolve links"
  - id: IN-03
    severity: info
    disposition: deferred
    title: "`capture-baselines --out` with no value writes to the committed baseline folder"
  - id: IN-04
    severity: info
    disposition: deferred
    title: "The net-watch early-exit check cannot fire"
open: 0
total: 11
recorded: 2026-11-09T05:46:23.855Z
---

# Phase 22: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | fixed | commit 5378478: src/main.ts refuses to start when VITEST is set; RED-proven |
| WR-02 | warning | deferred | Documented in src/utils/processLock.ts (5378478). Needs a second bot under another OS user or a changed HOME. Registered by 22-29; a machine-wide lock location is a design choice for Phase 24. |
| WR-03 | warning | fixed | commit 5378478: src/main.ts reads .env into a private object, so process.env and boot order are unchanged; RED-proven |
| WR-04 | warning | fixed | commit 5378478: cleanup failure no longer fails the probe; RED-proven |
| WR-05 | warning | fixed | commit 5378478: tripwire also compares the resolved data folder; RED-proven |
| WR-06 | warning | deferred | The false pass exists only in --phase before, which is complete; --phase after loads committed counts, so a failed collection fails NAC-04. Registered by 22-29. |
| WR-07 | warning | deferred | CI job timeout predates Phase 22. Registered by 22-29 for the CI work. |
| IN-01 | info | deferred | Info. Registered by 22-29. |
| IN-02 | info | deferred | Info. Registered by 22-29. |
| IN-03 | info | deferred | Info. Registered by 22-29. |
| IN-04 | info | deferred | Info. Registered by 22-29. |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
