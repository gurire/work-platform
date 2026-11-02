#!/usr/bin/env bash
# SessionEnd hook: if the working tree has uncommitted changes, snapshot them to a
# wip/<branch>-<timestamp> branch on GitHub WITHOUT touching your working tree,
# index or current branch. Protects against losing work when a cloud session's
# machine is reclaimed. Restore with: git fetch origin wip/... && git checkout -p FETCH_HEAD
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0
[ -z "$(git status --porcelain)" ] && exit 0

branch="$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
stamp="$(date -u +%Y%m%d-%H%M%S)"
tmp_index="$(mktemp)"
trap 'rm -f "$tmp_index"' EXIT

# Build a commit from a throwaway index so the real index stays untouched.
# .gitignore still applies, so .env files and node_modules are never included.
export GIT_INDEX_FILE="$tmp_index"
git read-tree HEAD
git add -A
tree="$(git write-tree)"
unset GIT_INDEX_FILE
commit="$(git commit-tree "$tree" -p HEAD -m "WIP snapshot of $branch at $stamp (session ended)")"

if git push --quiet origin "$commit:refs/heads/wip/$branch-$stamp" 2>/dev/null; then
  echo "Saved uncommitted work to wip/$branch-$stamp" >&2
else
  echo "Uncommitted work NOT pushed (push failed). Snapshot commit: $commit" >&2
fi
exit 0
