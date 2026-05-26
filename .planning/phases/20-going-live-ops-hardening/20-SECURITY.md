---
phase: 20
slug: going-live-ops-hardening
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-26
verified: 2026-05-26
register_authored_at_plan_time: true
audited_by: gsd-security-auditor (opus)
---

# Phase 20 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Phase 20 is the **go-live / ops-hardening** phase for a real-funds mainnet trading bot, so mitigations were verified at the code level (not rubber-stamped from plan-time dispositions). Register consolidated from the `<threat_model>` blocks of all 12 plans (20-00 … 20-11); every `mitigate` threat was confirmed present in implemented code by a `gsd-security-auditor` pass on 2026-05-26.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser → dashboard API | Untrusted cross-origin pages share the operator's browser + session cookie | session cookie (admin auth) |
| operator `.env` → bot boot | A misconfigured/default secret crosses into a live-funds admin surface | `DASHBOARD_API_KEY` (admin credential) |
| CLI shell → dashboard HTTP API | `pause`/`resume` CLI carries `DASHBOARD_API_KEY` in the axios body (never arg/log) | admin API key |
| operator → `POST /pause` body | `reason` is operator-supplied free text → persisted + rendered in dashboard | untrusted free text |
| WS broadcast → dashboard banner | Server pushes `pause_state_change` to authenticated clients only | pause state + reason (operator-tier) |
| pause-state SQLite → `bot.ts` hot path | Bot re-reads the pause flag at CP1/CP2/CP3 before fund-moving actions | capital-safety control flag |
| RPC provider → preflight checks | RPC responses are untrusted; preflight asserts shape before the live-gate decision | chain id, block timestamp |
| `process.env` → preflight cross-env | Cross-env validation reads env and blocks an unsafe live config (fail-closed) | chain/wallet/key config |
| schema-migration code → `data/bot.db` | v5→v6 migration runs on first boot post-merge; corruption = lost position-tracking | persistent trade/position state |
| operator → `chain_state.antirug_dry_run_started` | Operator can manually `UPDATE` to bypass the 7-day live-gate floor | live-gate timer (capital safety) |
| dev → CI | Test stubs run on every push; the CI gate bans `it.todo` | test integrity |
| operator (fresh clone) → live bot | Docs are the operator's only guide to a secure go-live config | runbook correctness (capital safety) |

---

## Threat Register

All threats CLOSED. Evidence is the concrete `file:line` / test located by the 2026-05-26 code-level audit.

### Mitigate (implementation verified present)

| Threat ID | Category | Component | Mitigation — Evidence | Status |
|-----------|----------|-----------|-----------------------|--------|
| T-20-W0-01 | Tampering | CI test gate | `.github/workflows/test.yml:30` bans `it/test/describe.todo` (`exit 1`); `it.skip` w/ reason allowed | closed |
| T-20-01 | Tampering | `db.ts` v5→v6 migration | `src/utils/db.ts:171-190` DDL in `db.transaction()`; `INSERT OR IGNORE` seed (181); PRAGMA `table_info` ALTER guard (185-188) | closed |
| T-20-W1-01 | Tampering | `data/bot.db` post-merge | `db.ts:29-30,194,197` `migrateSchema()` at load + `user_version` gate; rollback path `going-live.md:203` | closed |
| T-20-W1-02 | Info Disclosure | `pause_state.reason` write | `controls.ts:249` `sanitizeReason()` → `utils/honeypot/sanitize.ts:31-32,56-57` strips control+markdown chars, clamps 120ch (≤200 ceiling) | closed |
| T-20-W1-03 | Tampering | REQUIREMENTS scope | Doc-scope only (`.planning/` artifact, not shipped code) — no code surface | closed |
| T-20-W1-04 | DoS | DDL in transaction | `db.ts:185-188` PRAGMA-guarded ALTER is the fallback on re-run | closed |
| T-PRE-01 | Tampering | preflight bypass via env | `preflight.ts:40-42,677` no escape hatch; grep confirms no `SKIP_PREFLIGHT`; preflight always-on | closed |
| T-PRE-02 | Tampering | preflight false-pass (lagged block) | `preflight.ts:230-263` `checkRpcBlockAge` enforces per-chain `blockAgeToleranceSec` ceiling | closed |
| T-PRE-03 | Tampering | cross-env false-pass (dotenv timing) | `config.ts:2-4` `dotenv.config()` at top; preflight reads `process.env` lazily after | closed |
| T-20-03 | Capital safety | cross-env false-positive | `preflight.ts:421-535` `validateCrossEnvRules` pushes only on violation → passing combos empty fail list | closed |
| T-20-W2-02 | Capital safety | walletBalance check error | `preflight.ts:159,181-194` `getBalance` in try/catch → `passed:false` (fail-closed) | closed |
| T-20-W3-02 | DoS | antirug timestamp reset | `db.ts:576-581` `setAntirugDryRunStarted` `COALESCE` keeps first non-NULL value | closed |
| T-20-W3-03 | Tampering | timestamp precision | `Math.floor(Date.now()/1000)` integer seconds — SQLite INTEGER-safe (`preflight.ts:242,382`; `controls.ts:250`; `bot.ts:1048`) | closed |
| T-PAUSE-01 | Tampering | pause-state mutation race | `db.ts:560` single-row `UPDATE … WHERE id=1` under WAL (`journal_mode=WAL` :20) — atomic | closed |
| T-PAUSE-03 | TOCTOU | pause stale read CP1→CP2→CP3 | `bot.ts:358,390,416` (V2) + `647,697,715` (V3) fresh `getPauseState.get()` at each checkpoint | closed |
| T-20-04 | Operator fatigue | mid-run alert spam | `bot.ts:1046-1047` idempotence guard `if (currentPause.paused !== 1)` wraps set+checkpoint+broadcast+alert | closed |
| T-20-05 | Info Disclosure | CLI API key in arg list | `scripts/pause.ts:73,91-93,108` + `resume.ts:48,57-60` key from `process.env`, axios body only, never arg/log | closed |
| T-ENV-01 | Info Disclosure | API key leak in CLI logs | `pause.ts:99,112` log only `{status, body:response.data}` — apiKey is request-side, not logged | closed |
| T-20-01-EXT | Tampering | pause endpoint floods | `controls.ts:249` 120ch clamp; `db.ts:560` single-row idempotent UPDATE; no fan-out alert | closed |
| T-20-W4-01 | Tampering | preflight subprocess spawns bot | `scripts/preflight.ts:22` imports `preflightDryRun` directly; no `bot.ts`/`startMultiChainBot` import | closed |
| T-20-W6-01 | Spoofing | crafted WS msg claims paused | `api/ws/broadcaster.ts:39-50` broadcasts to `authenticatedClients` only; `handler.ts:54` rejects upgrade without valid session | closed |
| T-20-W6-02 | UI confusion | banner stale after reconnect | `PauseBanner.tsx:36,44` reads server-pushed `useWs().pauseState`; `GET /api/controls/pause` reconciliation (`controls.ts:294`) | closed |
| T-20-W6-03 | XSS | `reason` rendered in banner | `PauseBanner.tsx:79,81` React text-interpolation escapes HTML; no `dangerouslySetInnerHTML` | closed |
| T-DEL-01 | Info Disclosure | deleted briefing content | Root `HONEYPOT-SIM-BRIEFING.md` absent; content preserved in `.planning/phases/18-…/18-CONTEXT.md` | closed |
| T-20-W7-01 | Tampering | CI guard false-positive | `test.yml:44-45` exact `test ! -e GOING-LIVE.md` (existence, not glob) | closed |
| T-20-W7-02 | Repudiation | git mv loses history | `git log --follow -- docs/operations/going-live.md` traces rename commit `44de14f` | closed |
| T-20-W7-03 | Tampering | stale README link | `README.md:449,464` link to `./docs/operations/going-live.md`; root `GOING-LIVE.md` absent; CI guard prevents re-add | closed |
| T-20-08-01 | Spoofing/Elevation | CORS same-origin | `api/server.ts:100-144` same-origin via `new URL(origin).origin===requestOrigin` (113,126), else allowlist (133), else reject (138-140); `sameSite:'strict'` cookie 2nd layer (`auth.ts:68`) | closed |
| T-20-08-02 | Tampering | malformed Origin header | `server.ts:112-117,125-131` `new URL()` in try/catch → fall-through to rejection, never throws | closed |
| **T-20-08-03** | **Elevation of Privilege** | **default `DASHBOARD_API_KEY`** | **`preflight.ts:498-533` Rule 5: FATAL on placeholder/empty/`<16`-char key → `process.exit(1)` (684,720); bot refuses to boot** | **closed** |
| T-20-09-01 | Info Disclosure | connection-error log line | `pause.ts:130-158` + `resume.ts:93-119` payload `{url, code, cause}` only; apiKey never referenced | closed |
| T-20-09-02 | DoS (self) | wrong default port | `pause.ts:49-53` + `resume.ts:41-45` `resolveDashboardUrl()` derives from `DASHBOARD_HOST/PORT`, mirrors `server.ts:208-209` | closed |
| T-20-11-01 | Elevation of Privilege | undocumented strong-key req | `going-live.md:147` documents FATAL-exit on placeholder/empty/short key | closed |
| T-20-11-02 | Info Disclosure | `DASHBOARD_ALLOWED_ORIGINS` misuse | `going-live.md:151` + `.env.example:77-81` empty=same-origin default; warns against permissive wildcard | closed |

### Accept (documented risk — see Accepted Risks Log)

| Threat ID | Category | Component | Disposition | Status |
|-----------|----------|-----------|-------------|--------|
| T-20-W0-02 | Repudiation | test stubs | accept | closed |
| T-20-W0-03 | Info Disclosure | test fixtures | accept | closed |
| T-20-W2-01 | Info Disclosure | preflight RPC HEAD fingerprint | accept | closed |
| T-20-W3-01 | Tampering | manual `UPDATE chain_state` | accept | closed |
| T-KILL-CP3 | Capital safety | in-flight bundle after pause | accept | closed |
| T-BAL-01 | Capital safety | balance check race | accept | closed |
| T-PAUSE-02 | Tampering | direct DB write | accept | closed |
| T-20-W4-02 | DoS | pause_state table growth | accept | closed |
| T-20-W6-04 | Info Disclosure | banner reveals reason | accept | closed |
| T-20-W7-04 | DoS | going-live.md length | accept | closed |
| T-20-10-01 | Repudiation/availability | banner restyle visibility | accept | closed |

### Supply chain (zero new dependencies)

| Threat IDs | Category | Mitigation — Evidence | Status |
|------------|----------|-----------------------|--------|
| T-20-W0-SC, T-20-W1-SC, T-PRE-SC, T-20-W3-SC, T-20-W4-SC, T-20-W6-SC, T-20-W7-SC, T-20-08-SC, T-20-09-SC, T-20-10-SC, T-20-11-SC (×11) | Tampering | Only Phase-20 `package.json` change (commit `20f6ec2`) adds **3 `scripts` entries** (`preflight`/`pause`/`resume`), **zero** deps. `axios, cors, express, ws, better-sqlite3, helmet, cookie-parser, uuid, ethers` byte-identical between pre-Phase-20 (`7221643~1`) and HEAD | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-20-01 | T-20-W3-01, T-PAUSE-02 | DB-level tampering (manual `UPDATE chain_state` to bypass the 7-day live-gate floor; direct `pause_state` write) requires filesystem/DB-shell access — i.e. the private-key holder, who is already fully trusted. `checkAntiRugLiveGate` (`preflight.ts:344`) still enforces the floor on the value present. Per **D-ANTIRUG-LIVE-GATE-CODE** (trust operator + timer; FP review is operator judgment). | operator (plan-time) | 2026-05-26 |
| AR-20-02 | T-KILL-CP3, T-BAL-01 | A bundle already in flight when pause/undercut triggers may still land as an open position; the balance check has a bounded race between preflight pass and first snipe. **By design (D-KILLSWITCH-CP3):** CP3 is audit-log-only (`bot.ts:416-418,715-717`); the mid-run re-check (`bot.ts:1039-1059`) bounds the balance window; emergency-sell (`controls.ts:122`) is the orthogonal "close everything now" control. | operator (plan-time) | 2026-05-26 |
| AR-20-03 | T-20-W2-01 | Preflight RPC HEAD/health calls fingerprint bot existence to RPC/MEV endpoints. Pre-existing since Phase 4; the wallet/identity is already exposed via mainnet activity, so no incremental disclosure. | operator (plan-time) | 2026-05-26 |
| AR-20-04 | T-20-W6-04 | The pause `reason` is visible to all authenticated dashboard viewers. Dashboard already requires `DASHBOARD_API_KEY` login; operator-tier visibility is intended (D-PAUSE-UI). WS auth enforced at `handler.ts:54`. | operator (plan-time) | 2026-05-26 |
| AR-20-05 | T-20-W0-02, T-20-W0-03, T-20-W4-02, T-20-W7-04, T-20-10-01 | Low-severity by-design items: test stubs are documentation (no runtime surface, no real secrets); `pause_state` is bounded to one row by `CHECK(id=1)` (`db.ts:174`); runbook length is informational; the banner restyle keeps an unmistakable red alert (`PauseBanner.tsx:74-81`). | operator (plan-time) | 2026-05-26 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-26 | 56 | 56 | 0 | gsd-security-auditor (opus), verify-mitigations mode |

**Scope:** 34 mitigate + 11 accept + 11 supply-chain = 56 unique threats consolidated from 12 plan threat models. No SUMMARY raised a threat-flag escalation; the pre-existing test-mock failures noted during execution were resolved 2026-05-25 (full suite green: unit 57/57, integration 27/27). No implementation files were modified during the audit (read-only).

### Notes & Reconciliations

- **`sanitizeReason` is stronger than the plan-time contract.** Plans T-20-W1-02 / T-20-01-EXT / T-20-05 cited a "200-char" cap; the shipped sanitizer (`src/utils/honeypot/sanitize.ts:32,57`) clamps to **120 chars** *and* strips control + markdown special chars — within and stronger than the 200 ceiling. Reconciled in `controls.ts:13-14` and `going-live.md:398`. Treated CLOSED.
- **Non-blocking doc drift (not a registered threat).** `docs/operations/going-live.md:243` §9 ("Kill switch") still references `POST /api/controls/pause-snipes`; the implemented endpoint is `POST /api/controls/pause` (`controls.ts:234`), and the authoritative §"Pause/resume CLI usage" (lines 378-441) is correct. No registered threat depends on §9 accuracy and no capital-safety control is affected — worth a one-line doc fix but not security-blocking.
- **No unregistered attack surface.** Code-review follow-ups (CR-02 CORS scheme, CR-04 WAL-fsync, WR-01/02/03) map onto existing register threats (T-20-08-01, T-PAUSE-01); no new threat appeared without a mapping.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-26
