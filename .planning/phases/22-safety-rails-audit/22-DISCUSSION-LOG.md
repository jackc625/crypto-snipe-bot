# Phase 22: Safety Rails & Audit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-06
**Phase:** 22-safety-rails-audit
**Mode:** discuss, `--analyze` (trade-off table before each question), research-before-questions on
**Areas discussed:** Rail choke points, Boot guards, Backup/forensics/baselines, Audit method & register, Audit timing, Thresholds list scope, How to audit test code

---

## Rail choke points

### Where are the rails enforced?
| Option | Description | Selected |
|--------|-------------|----------|
| Both layers | Setup-layer interception (env-independent) + VITEST-gated src checks; RED proof per layer | ✓ |
| Checks in src/ only | VITEST-gated checks in db.ts / notifier.ts; deleting VITEST disables them | |
| Test-setup only | Intercept in setupFiles; children need a separate solution | |

**User's choice:** Both layers (recommended).

### How is the dummy test env built?
| Option | Description | Selected |
|--------|-------------|----------|
| Scrub then replace | Delete every app key, load committed test/.env.test sentinels, sync test vs .env.example | ✓ |
| Overlay only | Set dummy values for needed keys; shell leftovers leak | |
| Overlay + .env block | Blocks the file, not shell leftovers | |

**User's choice:** Scrub then replace (recommended).

### How do rails reach spawned child processes?
| Option | Description | Selected |
|--------|-------------|----------|
| Helper + preload | spawnRailedChild() with sentinel-only env + NODE_OPTIONS --require rails preload; grep test bans raw spawn | ✓ |
| Sanitized env + temp cwd | No network deny in children | |
| Rely on src/ checks | Children still read the real .env | |

**User's choice:** Helper + preload (recommended).

### What happens when a rail blocks something?
| Option | Description | Selected |
|--------|-------------|----------|
| Prod-like + ledger | Fail the way prod fails, record in ledger, run summary, register offending tests | ✓ |
| Throw + fail the run | Changes control flow under test; forces test fixes in Phase 22 | |
| Block silently | Fails AC-16/AC-19 observability | |

**User's choice:** Prod-like + ledger (recommended).

---

## Boot guards

### Duplicate-load guard vs. Vitest module resets
| Option | Description | Selected |
|--------|-------------|----------|
| Strict + epoch sentinel | Alias always throws; same-path re-eval throws unless whole graph reset; no Vitest internals | ✓ |
| Path-alias guard only | Zero test friction; misses same-path re-evaluation | |
| Strict + test-runner hook | Coupled to Vitest internals Phase 25 upgrades | |

**User's choice:** Strict + epoch sentinel (recommended).
**Notes:** Scout found Vitest 4.1.1 resets the module graph between test files in a reused worker (globalThis persists), widening the problem beyond the 37 explicit-reset files.

### Process lock primitive
| Option | Description | Selected |
|--------|-------------|----------|
| SQLite file lock | better-sqlite3 exclusive lock; OS-released, atomic, synchronous, no new deps | ✓ |
| Named pipe / abstract socket | OS-released, atomic, async, platform-split | |
| PID file + liveness | Not OS-released; stale-file / PID-reuse handling | |

**User's choice:** SQLite file lock (recommended).

### Where the lock is acquired
| Option | Description | Selected |
|--------|-------------|----------|
| New src/main.ts entry | Lock before requiring bot.ts; bot.ts no longer self-starts; start command changes | ✓ |
| First import in bot.ts | Tests importing bot.ts would take the lock unless a VITEST bypass | |
| Inside startMultiChainBot() | Second process already migrated the DB before refusing | |

**User's choice:** New src/main.ts entry (recommended).

### Explicit DB creation action
| Option | Description | Selected |
|--------|-------------|----------|
| npm run db:init | Dedicated script; refuses non-empty file; --replace-empty for 0-byte/v0 | ✓ |
| --init-db flag on the bot | Boot-safety flag on trading entry (D-ROLLBACK pattern) | |
| DB_ALLOW_CREATE env var | Bypass env var (P5) | |

**User's choice:** npm run db:init (recommended).

---

## Backup, forensics, baselines

### Off-machine destination
| Option | Description | Selected |
|--------|-------------|----------|
| OneDrive, plain | (Recommended at the time — premise wrong) | |
| OneDrive, encrypted | Encrypted archive in OneDrive | |
| USB drive | Offline; none mounted | |
| OneDrive + USB | Two off-machine copies | |

**User's choice:** Free text — "I don't use onedrive. What is this?"
**Notes:** Claude checked: OneDrive not running, no account signed in; the folder exists only because Windows keeps Desktop/Documents there, so it is local-only. Claude acknowledged the recommendation was based on an unverified assumption, explained the options plainly, and the operator chose **Google Drive** ("drive").

### Drive upload + verify method
| Option | Description | Selected |
|--------|-------------|----------|
| Web upload + download-back | One dated .tar.gz; operator uploads and downloads back; script verifies downloaded bytes | ✓ |
| Google Drive for desktop | App install; immediate verify only proves local cache | |
| Claude via Drive connector | Untested for binaries; likely unavailable to executors | |

**User's choice:** Web upload + download-back (recommended).

### Backup tool + manifest
| Option | Description | Selected |
|--------|-------------|----------|
| TS script + self-check | scripts/backup-state.ts; fixture self-check first; MANIFEST.json + SHA256SUMS | ✓ |
| PowerShell script | Not runnable in ubuntu CI | |
| One-off commands | Not re-runnable | |

**User's choice:** TS script + self-check (recommended).

### Forensic read of the uncheckpointed WAL
| Option | Description | Selected |
|--------|-------------|----------|
| Two-image diff | Evidence copy never opened; recovered throwaway copy serialized; 17:33 vs 20:25 diff | ✓ |
| Read-only open of copy | -shm may change, breaks AC-10 | |
| immutable=1 open | WAL contents not trustworthy (false negative) | |

**User's choice:** Two-image diff (recommended).

### Pre-rail collected test count
| Option | Description | Selected |
|--------|-------------|----------|
| Isolated export | git archive of pre-rail SHA outside repo, node_modules junctioned, no .env/data | ✓ |
| Static AST count | Approximate; NAC-04 would compare unlike counts | |
| vitest list + DB_PATH export | Loads real .env; one missed export opens the live DB | |

**User's choice:** Isolated export (recommended).

---

## Audit method & register

### Agent strategy
| Option | Description | Selected |
|--------|-------------|----------|
| Claude + cross-AI on capital | Claude on all areas; codex + agy independent code-only second opinion on 5 money slices | ✓ |
| Claude agents only | Single model family | |
| Cross-AI on every area | Most cost on low-capital areas | |

**User's choice:** First reply was free text — "What is this???? What are you talking about?????" Claude re-explained in plain language (what the audit is; codex = OpenAI's coding CLI, agy = Google's, both already installed and in the GSD review config; the choice is whether other AIs give a second opinion on the money code). Operator then chose **option 2** (Claude everywhere + codex and agy second opinion on the money code).

### Findings storage
| Option | Description | Selected |
|--------|-------------|----------|
| File per finding + script | Data file per finding in .planning/audit/; script renders Markdown and checks coverage | ✓ |
| One Markdown file | Agents collide; coverage checked by hand | |
| One big data file | Same collision problem | |

**User's choice:** File per finding + script (recommended).

### Escalation delivery
| Option | Description | Selected |
|--------|-------------|----------|
| Tiered | S0 / rail / test-origin rows / real secrets stop immediately; S1s batched per area at area completion | ✓ |
| Stop for each one | Possibly 20+ interruptions | |
| All at the end | Breaks same-session rule | |

**User's choice:** Tiered (recommended).

### Secret-scan tool
| Option | Description | Selected |
|--------|-------------|----------|
| gitleaks via Docker | Pinned image, --redact; Docker already running | |
| gitleaks Windows binary | Download the program directly | ✓ |
| Custom regex search | Misses many formats | |

**User's choice:** gitleaks Windows binary (operator choice over the Docker recommendation).

---

## Audit timing
| Option | Description | Selected |
|--------|-------------|----------|
| Same time | Audit concurrent with rails; ~8 rail-changed files re-checked on their diff | ✓ |
| After the rails | Each file audited once; slower | |

**User's choice:** Same time (recommended).

## Thresholds list scope
| Option | Description | Selected |
|--------|-------------|----------|
| Money + timing | Trading params + intervals, timeouts, confirm windows, retries, fee/gas multipliers, anti-rug thresholds; cosmetic excluded | ✓ |
| Money numbers only | Skips timing | |
| Every number in src/ | Noisy | |

**User's choice:** Money + timing (recommended).

## How to audit test code
| Option | Description | Selected |
|--------|-------------|----------|
| Bug hunt + quality label | 20-class sweep + per-file label (fakes its mechanism? hollow assertions? reaches real state?) | ✓ |
| Same bug hunt as src/ | Mostly "none"; misses fake tests | |
| Real-state reach only | Leaves fake tests unmapped | |

**User's choice:** Bug hunt + quality label (recommended).

---

## Claude's Discretion

- DB tripwire scope (`<repo>/data/` canonical-path match; per-worker temp DB under Vitest)
- Network-deny choke point and loopback definition; DNS deny
- Lock key (lowercase wallet address) and machine-global lock location
- Repo-root anchoring method; read-only `user_version` probe before any write
- `vi.mock` gate mechanics (TypeScript compiler API, resolution rules, CI step)
- Fork RPC variable name (`ETH_FORK_RPC_URL`, shell-only, `.env.example` entry)
- Finding ID scheme, severity rubric text, baseline output location
- Plan/wave decomposition and commit granularity

## Deferred Ideas

- Encrypting the off-machine backup (declined for now)
- Google Drive for desktop automation (not chosen)
- Second process-lock key on the DB path (outside SAFE-04 "same wallet"; audit to register as candidate)
- Signing scripts honoring the lock / kill-switch (Phase 29, HYG-03)
- Fixing tests flagged by the rail ledger / test-quality labels (Phase 28)
