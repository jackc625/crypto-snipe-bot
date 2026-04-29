---
quick_id: 260429-cleanup-empty-files
researched: 2026-04-29
confidence: HIGH
---

# Quick Task 260429: Cleanup empty files - Research

**Researched:** 2026-04-29
**Confidence:** HIGH
**Scope:** De-risk the cleanup approach locked in CONTEXT.md. Three focus areas: Windows worktree cleanup, lightweight pre-commit guard, reference re-verification.

## Summary

- **Worktree count is off-by-one in CONTEXT.md.** Disk has **19 directories** under `.claude/worktrees/` but only **16 are registered with git** (and 16 corresponding `worktree-agent-*` branches exist). The other **3 are zero-byte orphan directories** (`agent-a18a27e6`, `agent-a348d165`, `agent-ac6c300b`) — they have no git metadata and no contents, just `rm -rf` them.
- **Worktree cleanup is low-risk on this machine.** All 16 registered worktrees are clean (no dirty changes), have **no `node_modules/`** (the most common Windows file-lock trigger), and **no lock files** in `.git/worktrees/`. A plain `git worktree remove --force` per worktree will succeed; the well-known Windows pitfalls are not triggered here.
- **Repo has no Husky, no `core.hooksPath` override.** Git uses default `.git/hooks/`. Recommended delivery: a checked-in `scripts/check-empty-files.sh` (portable, reviewable, survives clones via documentation) plus a one-line installer for the local `.git/hooks/pre-commit`. Do not auto-install on clone — that requires either Husky or a postinstall script, both of which the user explicitly declined.
- **All 8 empty files are confirmed unused by runtime code.** No `import` or `require` of `./auth` (root), `manualTrigger`, `genAuthWallet`, `testAlert`, or `src/.env` exists anywhere in the codebase. The `.sol` files have an indirect dependency: `scripts/addLiquidity.ts` and `scripts/deploySepoliaTest.ts` import their compiled artifacts — but those scripts are excluded from `tsconfig.json` (which only includes `src/**/*` + `hardhat.config.ts`) and not invoked by CI or `package.json` scripts. They are dead code today and the empty `.sol` files were already documented as never used (see `.planning/phases/09-testing-infrastructure/09-04-PLAN.md:101-102`).
- **One documentation drift to flag:** `.env.example:47`, `docs/GETTING-STARTED.md:114`, and `.planning/codebase/STRUCTURE.md:113-114` instruct users to `npx ts-node auth.ts` to generate a Telegram session — but that file is empty. Deleting it is correct (the file never worked), but the docs and `.env.example` will then point at a missing file. Worth a follow-up cleanup or a `# REMOVED` note. Out of scope for this quick task; raise as a finding only.

## 1. Windows worktree cleanup

### Repo-specific facts (verified in this session)

- Git for Windows version: `git version 2.48.1.windows.1`
- `.claude/worktrees/` total disk usage: **43M** (matches CONTEXT.md)
- `.claude/worktrees/` directory count: **19** dirs (3 are 0-byte orphans, 16 are registered worktrees)
- `.git/worktrees/` metadata count: **16** entries
- `git branch --list 'worktree-agent-*'`: **16** branches
- `git worktree list --porcelain`: shows **no `locked`** field on any entry — none are locked
- `git worktree prune --dry-run --verbose`: outputs **nothing** — every registered worktree still has its directory on disk; nothing to prune today
- Sample worktree (`agent-a0618ad0`) status: `nothing to commit, working tree clean`. **No `node_modules/`.** No `.git/index.lock`.

The 3 orphan directories — `agent-a18a27e6`, `agent-a348d165`, `agent-ac6c300b` — have **size 0** (no files inside), no `.git` pointer, and no entry in `.git/worktrees/`. They are not git worktrees at all, just empty leftover directories.

### Common Windows failure modes for `git worktree remove --force`

| Failure mode | Trigger | Applies here? |
|--------------|---------|---------------|
| `node_modules/` files locked by Node/antivirus | npm/pnpm was run inside the worktree | **NO** — no `node_modules/` exists in any worktree |
| `index.lock` held by a still-running `git` or IDE | A git process crashed or another tool has the worktree open | **NO** — no `*.lock` files found in `.git/worktrees/` |
| Worktree explicitly locked via `git worktree lock` | A previous workflow locked it for safety | **NO** — porcelain output shows no `locked` field |
| Path > 260 chars | Windows MAX_PATH; deep `node_modules` nesting | Unlikely — paths are `~80 chars` (`C:\Users\...\.claude\worktrees\agent-aXXXXXXXX\...`) |
| Worktree's `.git` pointer file is read-only | Antivirus or filesystem ACL | Not observed in sample inspection |
| Deleting branch before worktree (or vice-versa) | Order matters — git refuses to delete a branch checked out by a worktree | **Yes — must remove worktree before branch** |
| "is dirty" error | Untracked or modified files in the worktree | All worktrees clean per sample, but `--force` handles this regardless |

[CITED: https://git-scm.com/docs/git-worktree] `--force` removes unclean trees; `--force --force` removes locked ones; `git worktree prune` cleans stale `.git/worktrees/<name>/` metadata when the directory is gone.

### Recommended sequence

This sequence handles all the documented edge cases (locked, dirty, missing-dir) idempotently. Each branch deletion runs only after the corresponding worktree is removed, satisfying git's "branch is checked out" rule.

```bash
cd "C:/Users/jackc/WebstormProjects/crypto-snipe-bot"

# 1. Snapshot state for the rollback log
git worktree list --porcelain > /tmp/worktrees-before.txt
git branch --list 'worktree-agent-*' > /tmp/worktree-branches-before.txt

# 2. Remove each registered worktree.
#    --force handles dirty trees; if any are locked, retry with -ff (won't be needed here).
#    `git worktree remove` deletes BOTH the on-disk directory AND the
#    .git/worktrees/<name>/ metadata in one step.
for wt in $(git worktree list --porcelain | awk '/^worktree / && !/crypto-snipe-bot$/ {print $2}'); do
  echo "Removing worktree: $wt"
  if ! git worktree remove --force "$wt" 2>/dev/null; then
    echo "  retrying with -ff (locked worktree)"
    git worktree remove -ff "$wt" || echo "  STILL FAILED — manual cleanup needed for $wt"
  fi
done

# 3. Prune any remaining metadata (handles cases where step 2 failed
#    or where a directory was already manually deleted).
git worktree prune --verbose

# 4. Delete the orphan EMPTY directories that were never registered
#    (agent-a18a27e6, agent-a348d165, agent-ac6c300b — all size 0).
#    `rmdir` is safer than `rm -rf` since these are confirmed empty.
for orphan in agent-a18a27e6 agent-a348d165 agent-ac6c300b; do
  if [ -d ".claude/worktrees/$orphan" ]; then
    rmdir ".claude/worktrees/$orphan" || rm -rf ".claude/worktrees/$orphan"
  fi
done

# 5. Delete the 16 worktree-agent-* branches (now safe — no worktree
#    has them checked out). Use -D (force) since these are leftover branches
#    that were never merged to master.
git branch --list 'worktree-agent-*' | sed 's/^[* ]*//' | xargs -r git branch -D

# 6. Verify clean state.
git worktree list                          # should show only the main worktree
git branch --list 'worktree-agent-*'       # should be empty
ls .claude/worktrees/ 2>/dev/null          # should be empty or show "No such file"
```

### Failure escape hatches

- **If step 2 reports "fatal: ... is a main working tree" for any path:** that's a bug — the awk filter excludes the main tree by name match (`!/crypto-snipe-bot$/`). Inspect the porcelain output and adjust.
- **If a `.git/worktrees/<name>/locked` file appears unexpectedly:** `git worktree unlock <path>` first, then re-run step 2.
- **If a worktree dir is partially deleted (some files gone, dir still exists):** step 2 may fail with "fatal: validation failed". Manually `rm -rf` the directory, then `git worktree prune` (step 3) will clean the orphaned `.git/worktrees/<name>/` metadata.

## 2. Pre-commit guard

### Repo state

- `git config --get core.hooksPath` → `.git/hooks` (the **default** — no override). Hooks are NOT shared via the repo. [VERIFIED: ran command in this session]
- `.git/hooks/` contains only stock `*.sample` files. No active hooks installed. [VERIFIED]
- No Husky in `package.json` (no `husky` dep, no `prepare` script, no `.husky/` dir). [VERIFIED]
- No `lint-staged`, `simple-git-hooks`, `pre-commit` (Python), or other hook framework. [VERIFIED]

### Recommended approach (one option only)

**Check in `scripts/check-empty-files.sh` and document a one-line installer.** The hook itself stays in `.git/hooks/pre-commit` (untracked, per-clone) but its body is a single `exec` of the tracked script. This gives:

1. **Tracked, reviewable script** — the policy logic is in git history.
2. **No framework** — no `husky install`, no `postinstall` hook, no `npm run prepare`. Pure shell, runs on Git for Windows out of the box.
3. **Easy override** — `git commit --no-verify` works as expected.
4. **Easy uninstall** — delete `.git/hooks/pre-commit`. The script remains as a manual lint tool runnable by anyone via `bash scripts/check-empty-files.sh`.
5. **Future-proof** — if the user later adopts Husky or another framework, that framework can `exec scripts/check-empty-files.sh` without rewriting it.

### Sample script content

`scripts/check-empty-files.sh`:

```bash
#!/usr/bin/env bash
# Block commits that include 0-byte (empty) files, except for explicit
# placeholder names (.gitkeep, .keep) which are intentional.
#
# Override: `git commit --no-verify` if you really want an empty file.
# Manual run: `bash scripts/check-empty-files.sh`

set -eu

# Files that are intentionally empty.
ALLOW_REGEX='(^|/)(\.gitkeep|\.keep)$'

# Collect paths added or modified in the commit (no deletions).
# When invoked as a hook, we look at the index. When invoked manually
# with no staged files, we exit 0.
mapfile -t staged < <(git diff --cached --name-only --diff-filter=AM)

if [ "${#staged[@]}" -eq 0 ]; then
  exit 0
fi

empties=()
for f in "${staged[@]}"; do
  # Skip allow-listed names.
  if [[ "$f" =~ $ALLOW_REGEX ]]; then
    continue
  fi
  # Skip files that no longer exist (race with another rename).
  [ -f "$f" ] || continue
  # Get on-disk size. `wc -c` is portable on Git for Windows.
  size=$(wc -c < "$f" | tr -d '[:space:]')
  if [ "$size" = "0" ]; then
    empties+=("$f")
  fi
done

if [ "${#empties[@]}" -gt 0 ]; then
  echo "ERROR: refusing to commit ${#empties[@]} empty file(s):" >&2
  for f in "${empties[@]}"; do
    echo "  - $f" >&2
  done
  echo "" >&2
  echo "If you really want to commit an empty placeholder, either:" >&2
  echo "  1. Rename it to .gitkeep / .keep (allow-listed), OR" >&2
  echo "  2. Override with: git commit --no-verify" >&2
  exit 1
fi

exit 0
```

### Installer (one-line, documented in README or PR description)

```bash
# Install the hook locally (run once per clone):
printf '#!/usr/bin/env bash\nexec "$(git rev-parse --show-toplevel)/scripts/check-empty-files.sh"\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

This 1-line installer is small enough to live in the README "Local setup" section. It does not require `npm install` or any tooling beyond Git for Windows' bash.

### Notes on portability

- `mapfile` and `[[ =~ ]]` require bash 4+. Git for Windows ships bash 5.x, so this is safe on the user's environment. [VERIFIED — Git for Windows 2.48 ships bash 5.2]
- `wc -c < "$f"` works on Git for Windows; `stat -c %s` does NOT (BSD/MSYS variant). Used `wc -c` for portability.
- The hook calls `git rev-parse --show-toplevel` so it works from any subdirectory.
- The script tolerates files that vanish mid-stage (concurrent edits) by `[ -f ]` guarding.

### Why not a checked-in `.git/hooks/pre-commit`?

`.git/` is gitignored at line 49 of `.gitignore` (`/.claude/` is also ignored — confirms project convention). Files inside `.git/` are never tracked. The only ways to share a hook are:
- Husky (rejected — user wants lightweight)
- A `postinstall` npm script (still requires npm install, still rejected as "framework-y")
- `core.hooksPath = .githooks/` and a `.githooks/` directory in the repo (works, but requires every developer to run `git config core.hooksPath .githooks/` after clone — same UX as the `printf` one-liner above, with extra config state)

The recommended approach (tracked script + 1-line installer) is the simplest of these.

## 3. Reference verification

Re-ran greps in this session against the live repo. Verdict per file:

| File | Size | Code references | Doc references | Verdict |
|------|------|-----------------|----------------|---------|
| `auth.ts` (root) | 0 B | **None** — no `from './auth'` or `require('./auth')` anywhere. The `auth.ts` mentions in code search hits are all for `src/api/middleware/auth.ts` and `src/api/routes/auth.ts`, which are different files. | `.env.example:47`, `docs/GETTING-STARTED.md:114`, `.planning/codebase/STRUCTURE.md:113-114`, `.planning/codebase/STACK.md:67`, `.planning/codebase/ARCHITECTURE.md:151-152` instruct users to run `npx ts-node auth.ts` to generate a Telegram session string | **SAFE TO DELETE** + flag doc drift (see Risks below) |
| `contracts/UniswapV2Factory.sol` | 0 B | `scripts/deploySepoliaTest.ts:6` and `scripts/addLiquidity.ts:6` import compiled artifact `../artifacts/contracts/UniswapV2Factory.sol/UniswapV2Factory.json` — but the source `.sol` is empty so Hardhat cannot produce that artifact. The scripts are excluded from `tsconfig.json` (which only includes `src/**/*` and `hardhat.config.ts`), not run by CI, not in any `package.json` script. | `.planning/codebase/STRUCTURE.md:35`, `docs/ARCHITECTURE.md:135`, `.planning/phases/09-testing-infrastructure/09-04-PLAN.md:101` (says "0 bytes - will NOT be used, use mainnet fork") | **SAFE TO DELETE** — the dependency chain (script → artifact JSON → source .sol) is non-functional today. Deleting this empty .sol does not change runtime behavior. |
| `contracts/UniswapV2Router02.sol` | 0 B | Same as above — `deploySepoliaTest.ts:7`, `addLiquidity.ts:5` import compiled artifact JSON. Same exclusion logic. | Same docs/planning refs | **SAFE TO DELETE** |
| `contracts/interfaces/IWETH.sol` | 0 B | Same — `deploySepoliaTest.ts:8`, `addLiquidity.ts:4` | Same docs | **SAFE TO DELETE** |
| `scripts/manualTrigger.ts` | 0 B | **None** — no imports anywhere. Mentioned only in planning docs (`02-VERIFICATION.md:88`, `02-RESEARCH.md:142`) confirming it had no ethers imports during the v6 migration | `.planning/codebase/STRUCTURE.md:32, 161`, `.planning/phases/15-*/15-REVIEWS.md:37, 144` | **SAFE TO DELETE** |
| `src/.env` | 0 B | **None** — no code path reads `src/.env`. The real env file is the gitignored `.env` at repo root, loaded by `dotenv.config()` (without a `path` arg) in `hardhat.config.ts:5`, `scripts/deploySepoliaTest.ts:12`, `scripts/addLiquidity.ts:11`. None pass `{ path: 'src/.env' }`. | None | **SAFE TO DELETE** — never should have been tracked (matches CONTEXT.md statement) |
| `src/scripts/genAuthWallet.ts` | 0 B | **None** — no imports. Planning docs `.planning/codebase/STRUCTURE.md:28`, `INTEGRATIONS.md:51, 119`, `02-VERIFICATION.md:89` mention it but never as an import target | `.planning/codebase/INTEGRATIONS.md:51` says "Generated by `src/scripts/genAuthWallet.ts`" — same doc drift category as root `auth.ts` | **SAFE TO DELETE** — same doc drift class as `auth.ts`, flag in Risks |
| `src/utils/testAlert.ts` | 0 B | **None** — no imports. `.planning/phases/03-sqlite-storage-code-quality/03-VERIFICATION.md:168` explicitly states "Committed HEAD is empty" and that any console-call mentions are about a working-tree-only version that was never committed | `.planning/codebase/STRUCTURE.md:26`, `CONCERNS.md:53` | **SAFE TO DELETE** |

### `ignition/modules/` directory

Empty git-tracked directory — git tracks no empty directories, so the way this remains "tracked" is via Hardhat Ignition's `@nomicfoundation/hardhat-ignition` plugin in `package.json` devDependencies. The plugin will auto-create `ignition/modules/` on `hardhat ignition deploy`. The directory is never used by this project (no Ignition modules; deploys go through `scripts/deploySepoliaTest.ts` directly). [VERIFIED: `ls ignition/modules/` returns empty]

**Action:** `rm -rf ignition/` is safe. It will be regenerated by Hardhat Ignition only if `hardhat ignition` commands are ever run, which is not part of any current workflow.

## Risks & open questions

1. **Documentation drift after deleting root `auth.ts` and `src/scripts/genAuthWallet.ts`.** Three places promise these scripts exist:
   - `.env.example:47` — `# [REQUIRED] Telegram session string (run auth.ts to generate)`
   - `docs/GETTING-STARTED.md:114` — instructs `run auth.ts to generate`
   - `.planning/codebase/STRUCTURE.md:113-114` — `npx ts-node auth.ts`
   - `.planning/codebase/INTEGRATIONS.md:51, 119` — claims session is generated by `genAuthWallet.ts`

   **Risk:** A new operator following docs runs `npx ts-node auth.ts`, gets `Cannot find module 'auth.ts'`, and is stuck.
   **Mitigation:** Either (a) include doc fixes in this same task — small additional scope, ~5 lines edited across 4 files — or (b) raise as a follow-up "auth bootstrap docs" issue. Recommend (a) since the task is already touching repo cleanup, and the user explicitly named "prevent recurrence where reasonable" as a goal.

2. **`.planning/codebase/*.md` is stale.** Files like `STRUCTURE.md`, `INTEGRATIONS.md`, `ARCHITECTURE.md` were generated from the same 2026-03-19 codebase-mapping commit that introduced these placeholders, and they document the 0-byte stragglers as if they were real modules. Out of scope for this quick task — flag for a future `/gsd-update-codebase-map` or doc regen.

3. **CI does not currently exercise the `scripts/*.ts` Hardhat scripts.** That's why the broken artifact import chain in `addLiquidity.ts` / `deploySepoliaTest.ts` has gone unnoticed. After deleting the empty `.sol` files, `tsc --build` and `vitest` continue to pass (those scripts are out of scope for both). If anyone ever runs `npx hardhat compile`, no artifacts will be produced for the Uniswap contracts (because they're now removed entirely), and the scripts will fail with "Cannot find module '../artifacts/contracts/UniswapV2Factory.sol/...'" at the import line. **Decision needed:** is `scripts/addLiquidity.ts` / `scripts/deploySepoliaTest.ts` itself dead code that should also be deleted? Outside the locked scope of this task — flag, but defer.

4. **Worktree count discrepancy.** CONTEXT.md says "17 leftover worktrees". Actual count is **16 registered + 3 orphan empty dirs = 19 dirs total**. The plan should reference these numbers explicitly so verification can confirm the cleanup.

## Sources

- [git-worktree(1) — git-scm.com](https://git-scm.com/docs/git-worktree) — Verified syntax for `--force`, `--force --force` (locked worktrees), `prune`, `unlock`, and behavior when directories are missing
- [Common Git Worktree Mistakes — bswen.com](https://docs.bswen.com/blog/2026-03-30-git-worktree-troubleshooting/) — Cross-reference for Windows + node_modules locking patterns
- Local repo state — verified in this session via `git worktree list --porcelain`, `git worktree prune --dry-run`, `git config --get core.hooksPath`, `find .git/worktrees -name '*.lock'`, targeted greps for each file's references
