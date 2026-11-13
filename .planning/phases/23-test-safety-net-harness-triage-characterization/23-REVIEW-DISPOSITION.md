---
phase: 23
review: 23-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: fixed
    title: "AUD-ANTIRUG-001 waits for the bug's four reconnect loops, so the recommended single-loop fix stalls instead of reading \"looks fixed\""
  - id: CR-02
    severity: critical
    disposition: fixed
    title: "AUD-DB-001 reads any `restartGraph` failure as \"the limit is enforced\", including stop-step failures that happen before `abc` is applied"
  - id: CR-03
    severity: critical
    disposition: fixed
    title: "AUD-TX-002 / AUD-BUY-025 / AUD-EXIT-009 read \"lock released\" as fixed, which also passes the wrong fix the recommendation forbids (lock released with the stuck nonce still pending)"
  - id: CR-04
    severity: critical
    disposition: fixed
    title: "AUD-BUY-008 reads \"looks fixed\" after a V2-only fix; the V3 reconnect handler is never measured"
  - id: CR-05
    severity: critical
    disposition: fixed
    title: "AUD-EXIT-007 and AUD-EXIT-008 exercise only the dashboard force-sell caller; a fix there flips the marker while the other callers still strand the position"
  - id: CR-06
    severity: critical
    disposition: fixed
    title: "AUD-BUY-010 \"max-open-positions-overspent\" reads \"looks fixed\" when only the per-chain cooldown is reserved"
  - id: CR-07
    severity: critical
    disposition: fixed
    title: "One-shot faults let a retry-once \"fix\" read \"looks fixed\" while the fail-open or give-up path is still in the code"
  - id: CR-08
    severity: critical
    disposition: fixed
    title: "Signing census never judges \"delegations\": `sendTransaction` on a non-Signer type passes CI unlocked"
  - id: CR-09
    severity: critical
    disposition: fixed
    title: "Contract methods called through a value, `getFunction(...)` value or narrow-interface cast escape the census"
  - id: CR-10
    severity: critical
    disposition: fixed
    title: "The seal verifier trusts a mutable, always-exempt seal record, so a one-line edit turns tampering into SEAL VALID"
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "Every mined transaction succeeds. Receipt status, estimateGas and eth_callBundle ignore the scenario's own revert rules"
  - id: WR-02
    severity: warning
    disposition: fixed
    title: "The default scenario balance re-prices the bot's buys at current reserves and never subtracts a sell"
  - id: WR-03
    severity: warning
    disposition: fixed
    title: "FakeWebSocket differs from ws@8.17.1 on every path where the socket is not OPEN"
  - id: WR-04
    severity: warning
    disposition: fixed
    title: "An exception in an axios route handler is not a stray and reaches production as a network error"
  - id: WR-05
    severity: warning
    disposition: fixed
    title: "The DB capture fails any write inside `db.transaction`, so a correct atomic-write fix fails its tests instead of reading \"looks fixed\""
  - id: WR-06
    severity: warning
    disposition: fixed
    title: "restartGraph is not a process death. The old graph's error paths run with the database still open and log into the same scenario lists"
  - id: WR-07
    severity: warning
    disposition: fixed
    title: "The AUD-ANTIRUG-002 boot claim reads \"looks fixed\" for a fix that never reconnects at boot"
  - id: WR-08
    severity: warning
    disposition: fixed
    title: "AUD-ANTIRUG-018 reads \"looks fixed\" for a fix that jumps the cursor to the head and never scans the downtime gap"
  - id: WR-09
    severity: warning
    disposition: fixed
    title: "AUD-ANTIRUG-003 and AUD-ANTIRUG-004 wait for one exit-fired broadcast per dispatch log, so a dedupe-shaped fix stalls them"
  - id: WR-10
    severity: warning
    disposition: fixed
    title: "AUD-SCRIPTS-002 builds `correct` from `actual`, so a signing script that drops out of detection can read \"looks fixed\""
  - id: WR-11
    severity: warning
    disposition: fixed
    title: "AUD-BUY-002 claim `failed-row-not-resumed-after-restart` has bug-encoding plain expects before its marker"
  - id: WR-12
    severity: warning
    disposition: fixed
    title: "AUD-BUY-004's completion predicate times out for any fix that refuses the second handler after \"New pair detected\""
  - id: WR-13
    severity: warning
    disposition: fixed
    title: "\"Any floor above zero\" accepts a dust floor as fixed (AUD-BUY-003, AUD-EXIT-001)"
  - id: WR-14
    severity: warning
    disposition: fixed
    title: "AUD-BUY-028 reads \"looks fixed\" when any gate refuses, not just the lock gate"
  - id: WR-15
    severity: warning
    disposition: fixed
    title: "AUD-EXIT-002 and AUD-BUY-002 count an exit_state row, or any matching alert anywhere in the run, as \"protected\""
  - id: WR-16
    severity: warning
    disposition: fixed
    title: "AUD-EXIT-003 markers can be flipped by wrong fixes"
  - id: WR-17
    severity: warning
    disposition: fixed
    title: "AUD-EXIT-014 defines \"not refused at once\" as \"no broadcast within 2 s of virtual time\""
  - id: WR-18
    severity: warning
    disposition: fixed
    title: "AUD-BUY-001 can record the bug as still present under a correct fix (51 s window and clock skew)"
  - id: WR-19
    severity: warning
    disposition: fixed
    title: "Plain expectations about other findings make these tests fail when those findings are fixed"
  - id: WR-20
    severity: warning
    disposition: fixed
    title: "The AUD-BUY-011 dashboard fixture races for its port and never checks it reached its own server"
  - id: WR-21
    severity: warning
    disposition: fixed
    title: "AUD-BUY-005 proves one call site; a `.catch` there flips the finding while the other un-awaited sites still crash"
  - id: WR-22
    severity: warning
    disposition: fixed
    title: "AUD-BUY-027 proves only the V2 path; the V3 pool path has the same non-native selection"
  - id: WR-23
    severity: warning
    disposition: fixed
    title: "Census name lists miss other ethers signing APIs and indirect calls"
  - id: WR-24
    severity: warning
    disposition: fixed
    title: "Lock key is never tied to the signer, and any function named `withNonceLock` counts as the lock"
  - id: WR-25
    severity: warning
    disposition: fixed
    title: "Census scans only `.ts`/`.tsx`; `.mts`, `.cts`, `.js`, `.cjs`, `.mjs` under `src/` and `scripts/` escape, and the completeness check cannot see them"
  - id: WR-26
    severity: warning
    disposition: fixed
    title: "Real-path mock gate only reads files under `test/realpath/`, but real-path tests run code from outside that folder"
  - id: WR-27
    severity: warning
    disposition: fixed
    title: "Commit taxonomy lets a merge commit carry any recording edit, with exit 0"
  - id: WR-28
    severity: warning
    disposition: fixed
    title: "Recordings-compared counts any `compareRecording` call, even one whose mismatch is caught"
  - id: WR-29
    severity: warning
    disposition: fixed
    title: "Source-text gate misses `?raw` imports, `new URL(...)` paths and aliased read functions"
  - id: WR-30
    severity: warning
    disposition: fixed
    title: "No guard that every test file under `test/` belongs to a project CI runs"
  - id: WR-31
    severity: warning
    disposition: fixed
    title: "CI jobs lack `timeout-minutes`; contract jobs install unpinned Python tools"
  - id: WR-32
    severity: warning
    disposition: fixed
    title: "`--scan` still lists merges by first parent and ignores REVIEWED_HITS, so once the phase branch is merged, the record's own documented check reports INVALID"
  - id: WR-33
    severity: warning
    disposition: fixed
    title: "The recording guard exempts every `data` key, and every hash-named key, from the 64-hex secret rule in any entry kind"
  - id: WR-34
    severity: warning
    disposition: fixed
    title: "Non-hex secrets are caught only when they equal a test/.env.test sentinel exactly, and the allow-listed secret fields accept any non-sentinel value"
  - id: WR-35
    severity: warning
    disposition: fixed
    title: "Nothing scans a re-recorded file before it is committed or pushed; the guard runs only in CI, after the push"
  - id: WR-36
    severity: warning
    disposition: fixed
    title: "The write switch is a plain environment variable with no tie to the update command, so a lingering export silently re-records on every local run"
  - id: IN-01
    severity: info
    disposition: open
    title: "`newPendingTransactions` subscriptions are accepted and then never fed"
  - id: IN-02
    severity: info
    disposition: open
    title: "Relay acceptance does no nonce or chain check, and a stale relay transaction stays `accepted` forever"
  - id: IN-03
    severity: info
    disposition: open
    title: "`assertAllFaultsFired` checks only `fired === 0`"
  - id: IN-04
    severity: info
    disposition: open
    title: "The notifier mock drops the real dashboard broadcast and the display-name prefix"
  - id: IN-05
    severity: info
    disposition: open
    title: "Loopback records a stray when it answers a request whose client has gone, and calls it a \"push\""
  - id: IN-06
    severity: info
    disposition: open
    title: "loopbackChain's WebSocket handler has no try/catch, so a chain-side exception crashes the child as if it came from the bot"
  - id: IN-07
    severity: info
    disposition: open
    title: "loopbackChain `wsStartsClosed` uses a bind-close-rebind free port (TOCTOU)"
  - id: IN-08
    severity: info
    disposition: open
    title: "loadGraph's DB-path verification is partial"
  - id: IN-09
    severity: info
    disposition: open
    title: "`emitLogs` delivers logs for blocks already announced and changes mined receipts after the fact"
  - id: IN-10
    severity: info
    disposition: open
    title: "Synthesized older blocks have an inconsistent parent chain and cannot be found by hash"
  - id: IN-11
    severity: info
    disposition: open
    title: "The AUD-ANTIRUG-005 backfill claim rests on an event never happening, and its precondition does not check that the gate was scheduled"
  - id: IN-12
    severity: info
    disposition: open
    title: "AUD-API-001 counts any wallet sell as the operator's, and its emergency-sell name check is a substring match"
  - id: IN-13
    severity: info
    disposition: open
    title: "Under the AUD-ANTIRUG-018 fix, the range-limit fault never fires and afterEach adds a second error next to \"looks fixed\""
  - id: IN-14
    severity: info
    disposition: open
    title: "AUD-SCRIPTS-002's holds-lock check does not check which lock is taken"
  - id: IN-15
    severity: info
    disposition: open
    title: "AUD-API-008's free port is reserved and then released before the server binds it"
  - id: IN-16
    severity: info
    disposition: open
    title: "AUD-DB-004's \"durable record\" matches any row in any table that names the token"
  - id: IN-17
    severity: info
    disposition: open
    title: "Constant fields in `actual` add nothing to the proof"
  - id: IN-18
    severity: info
    disposition: open
    title: "Under the nonce-pinning fix, AUD-BUY-030's hold never fires and afterEach also fails"
  - id: IN-19
    severity: info
    disposition: open
    title: "AUD-BUY-006 depends on the listener starting and on the exact rejection log text"
  - id: IN-20
    severity: info
    disposition: open
    title: "AUD-BUY-007 treats a renamed or unexported simulateSell as fixed"
  - id: IN-21
    severity: info
    disposition: open
    title: "AUD-BUY-027 uses the \"New pair detected\" log as a proxy for \"processed as snipe\""
  - id: IN-22
    severity: info
    disposition: open
    title: "AUD-BUY-001 duplicates the crashRun.ts ledger helpers"
  - id: IN-23
    severity: info
    disposition: open
    title: "`--sole-run` does not confirm that the run it judges is the realpath step's run"
  - id: IN-24
    severity: info
    disposition: open
    title: "Floor-history check accepts any registered finding and reads the registry from the working tree"
  - id: IN-25
    severity: info
    disposition: open
    title: "Commit-taxonomy ID lookup checks only that a file exists"
  - id: IN-26
    severity: info
    disposition: open
    title: "`sourceGraph` misses some exports and dynamic imports, and resolves through `ts.sys`"
  - id: IN-27
    severity: info
    disposition: open
    title: "vi-mock specifier gate scans only `.ts/.mts/.cts` and ignores aliased `vi`"
  - id: IN-28
    severity: info
    disposition: open
    title: "CI Node is not pinned to the declared 22.16.0"
  - id: IN-29
    severity: info
    disposition: open
    title: "The combined merge listing misses a change a merge makes by taking a non-first parent's version, undone by a later merge"
  - id: IN-30
    severity: info
    disposition: open
    title: "seal-verify's git calls are not hardened against replace refs or local log config; a requested scan with no scanner counts as clean"
  - id: IN-31
    severity: info
    disposition: open
    title: "The normalizer's global regexes and its Error and class handling can erase real differences in future recordings"
open: 31
total: 77
recorded: 2026-11-13T04:53:42.858Z
---

# Phase 23: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | fixed | 23-REVIEW-FIX.md |
| CR-02 | critical | fixed | 23-REVIEW-FIX.md |
| CR-03 | critical | fixed | 23-REVIEW-FIX.md |
| CR-04 | critical | fixed | 23-REVIEW-FIX.md |
| CR-05 | critical | fixed | 23-REVIEW-FIX.md |
| CR-06 | critical | fixed | 23-REVIEW-FIX.md |
| CR-07 | critical | fixed | 23-REVIEW-FIX.md |
| CR-08 | critical | fixed | 23-REVIEW-FIX.md |
| CR-09 | critical | fixed | 23-REVIEW-FIX.md |
| CR-10 | critical | fixed | 23-REVIEW-FIX.md |
| WR-01 | warning | fixed | 23-REVIEW-FIX.md |
| WR-02 | warning | fixed | 23-REVIEW-FIX.md |
| WR-03 | warning | fixed | 23-REVIEW-FIX.md |
| WR-04 | warning | fixed | 23-REVIEW-FIX.md |
| WR-05 | warning | fixed | 23-REVIEW-FIX.md |
| WR-06 | warning | fixed | 23-REVIEW-FIX.md |
| WR-07 | warning | fixed | 23-REVIEW-FIX.md |
| WR-08 | warning | fixed | 23-REVIEW-FIX.md |
| WR-09 | warning | fixed | 23-REVIEW-FIX.md |
| WR-10 | warning | fixed | 23-REVIEW-FIX.md |
| WR-11 | warning | fixed | 23-REVIEW-FIX.md |
| WR-12 | warning | fixed | 23-REVIEW-FIX.md |
| WR-13 | warning | fixed | 23-REVIEW-FIX.md |
| WR-14 | warning | fixed | 23-REVIEW-FIX.md |
| WR-15 | warning | fixed | 23-REVIEW-FIX.md |
| WR-16 | warning | fixed | 23-REVIEW-FIX.md |
| WR-17 | warning | fixed | 23-REVIEW-FIX.md |
| WR-18 | warning | fixed | 23-REVIEW-FIX.md |
| WR-19 | warning | fixed | 23-REVIEW-FIX.md |
| WR-20 | warning | fixed | 23-REVIEW-FIX.md |
| WR-21 | warning | fixed | 23-REVIEW-FIX.md |
| WR-22 | warning | fixed | 23-REVIEW-FIX.md |
| WR-23 | warning | fixed | 23-REVIEW-FIX.md |
| WR-24 | warning | fixed | 23-REVIEW-FIX.md |
| WR-25 | warning | fixed | 23-REVIEW-FIX.md |
| WR-26 | warning | fixed | 23-REVIEW-FIX.md |
| WR-27 | warning | fixed | 23-REVIEW-FIX.md |
| WR-28 | warning | fixed | 23-REVIEW-FIX.md |
| WR-29 | warning | fixed | 23-REVIEW-FIX.md |
| WR-30 | warning | fixed | 23-REVIEW-FIX.md |
| WR-31 | warning | fixed | 23-REVIEW-FIX.md |
| WR-32 | warning | fixed | 23-REVIEW-FIX.md |
| WR-33 | warning | fixed | 23-REVIEW-FIX.md |
| WR-34 | warning | fixed | 23-REVIEW-FIX.md |
| WR-35 | warning | fixed | 23-REVIEW-FIX.md |
| WR-36 | warning | fixed | 23-REVIEW-FIX.md |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| IN-06 | info | open | - |
| IN-07 | info | open | - |
| IN-08 | info | open | - |
| IN-09 | info | open | - |
| IN-10 | info | open | - |
| IN-11 | info | open | - |
| IN-12 | info | open | - |
| IN-13 | info | open | - |
| IN-14 | info | open | - |
| IN-15 | info | open | - |
| IN-16 | info | open | - |
| IN-17 | info | open | - |
| IN-18 | info | open | - |
| IN-19 | info | open | - |
| IN-20 | info | open | - |
| IN-21 | info | open | - |
| IN-22 | info | open | - |
| IN-23 | info | open | - |
| IN-24 | info | open | - |
| IN-25 | info | open | - |
| IN-26 | info | open | - |
| IN-27 | info | open | - |
| IN-28 | info | open | - |
| IN-29 | info | open | - |
| IN-30 | info | open | - |
| IN-31 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
