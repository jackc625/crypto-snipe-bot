---
quick_id: 260429-cleanup-empty-files
gathered: 2026-04-29
status: Ready for planning
---

# Quick Task 260429: Cleanup empty files and folders - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Task Boundary

The repository accumulated empty files and folders. The user wants two outcomes:
1. Identify the root cause (why these empties exist)
2. Clean up the repo, preventing recurrence where reasonable

Scope: git-tracked empty files, empty git-tracked directories, stale GSD agent worktrees under `.claude/worktrees/`, and a lightweight prevention measure.

Out of scope: gitignored build artifacts (`artifacts/`, `cache/`, `dist/`, `node_modules/`) — these are runtime-generated and re-created by tooling.

</domain>

<decisions>
## Implementation Decisions

### Cleanup scope
- **Delete all 8 empty git-tracked files:**
  - `auth.ts` (root — superseded by `src/api/middleware/auth.ts` and `src/api/routes/auth.ts`)
  - `contracts/UniswapV2Factory.sol`
  - `contracts/UniswapV2Router02.sol`
  - `contracts/interfaces/IWETH.sol`
  - `scripts/manualTrigger.ts`
  - `src/.env` (this should never have been tracked — root `.env` is the real one and is gitignored)
  - `src/scripts/genAuthWallet.ts`
  - `src/utils/testAlert.ts`
- **Also remove `ignition/modules/`** — empty Hardhat Ignition scaffolding directory, never used in this project.
- **Keep the 2 `.gitkeep` files** in `.planning/phases/14-*/` and `.planning/phases/15-*/` — these intentionally preserve archived phase directories.
- **Verification:** Confirmed via grep that none of the 8 files are imported anywhere in the codebase — references found are either to differently-named modules (e.g., `src/api/routes/auth.ts`, not the root `auth.ts`) or are mentioned only in planning/codebase-mapping docs.

### Stale worktrees
- **Use `git worktree remove --force` for each of the 17 leftover `.claude/worktrees/agent-*/` directories** — this is the clean path: removes the working directory, the `.git/worktrees/<name>/` metadata, and allows the corresponding `worktree-agent-*` branches to be deleted afterward.
- After removal, also run `git worktree prune` to catch any registrations whose dir is already gone, and `git branch -D worktree-agent-*` to clean the branches.
- Total cleanup: ~43MB on disk plus 17 stale git worktree registrations.

### Prevention
- **Add a lightweight pre-commit guard** that warns when staging 0-byte files, with `.gitkeep` and `.keep` allow-listed.
- Implementation: a simple shell check in a pre-commit hook (or a script callable from one). Husky is not currently in this repo, so a plain `.git/hooks/pre-commit` shell script or a checked-in `scripts/check-empty-files.sh` is sufficient. The user did not ask for full Husky setup — keep it minimal.
- The guard should *warn and block* — letting the user override with `git commit --no-verify` if they truly want an empty placeholder.

### Claude's Discretion
- **Pre-commit hook delivery format:** I will choose a plain `.git/hooks/pre-commit` script approach (since `.git/hooks/` isn't shared) plus a checked-in `scripts/check-empty-files.sh` companion that the user can install or that a future hook framework can wire up. This keeps the repo portable without forcing a hook framework.
- **Worktree branch naming:** Branches are named `worktree-agent-*` per `git worktree list` output — these will be deleted alongside the worktree directories.
- **Order of operations:** Worktree cleanup first (so file listings don't include worktree contents), then file deletions, then prevention measure, then commits.

</decisions>

<specifics>
## Specific Ideas

**Root cause** — All 8 empty git-tracked files were introduced in a single commit:

```
532b563 docs: map existing codebase  (2026-03-19)
```

This was the very first project commit. It pre-created placeholder files for every module the codebase mapping exercise *planned* to populate. Most of those placeholders (e.g., `src/bot.ts`, `src/utils/logger.ts`, `src/utils/notifier.ts`) were filled in during real implementation. The 8 stragglers are paths that turned out not to be needed — the implementation took different shapes (`src/api/middleware/auth.ts` instead of root `auth.ts`, etc.) but the empty placeholders were never deleted.

**Stale worktrees** — The 17 `agent-*` worktrees are leftover from prior `/gsd-execute-phase` or `/gsd-quick` runs where the worktree-cleanup step failed (likely interrupted sessions, Windows file locks, or old GSD versions before the cleanup hardening in step 6 of `quick.md`).

</specifics>

<canonical_refs>
## Canonical References

- Original mapping commit: `git show 532b563 --stat`
- Worktree workflow cleanup logic: `~/.claude/get-shit-done/workflows/quick.md` (Step 6 — has its own residual-cleanup branch)
- Project state: `.planning/STATE.md`

</canonical_refs>
