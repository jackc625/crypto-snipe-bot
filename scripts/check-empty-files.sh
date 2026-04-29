#!/usr/bin/env bash
# Block commits that include 0-byte (empty) files, except for explicit
# placeholder names (.gitkeep, .keep, .gitignore) which are intentional.
#
# Override: `git commit --no-verify` if you really want an empty file.
# Manual run: `bash scripts/check-empty-files.sh`
#
# ─────────────────────────────────────────────────────────────────────
# INSTALL (run once per clone):
#
#   printf '#!/usr/bin/env bash\nexec "$(git rev-parse --show-toplevel)/scripts/check-empty-files.sh"\n' \
#     > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
#
# UNINSTALL:
#
#   rm .git/hooks/pre-commit
#
# The hook is intentionally NOT auto-installed (`.git/hooks/` is per-clone
# and not tracked). If a hook framework is adopted later, point it at
# this script.
# ─────────────────────────────────────────────────────────────────────

set -eu

# Files that are intentionally empty.
# .gitkeep / .keep — standard placeholder convention
# .gitignore       — sometimes parent .gitignore files get touched empty
ALLOW_REGEX='(^|/)(\.gitkeep|\.keep|\.gitignore)$'

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
