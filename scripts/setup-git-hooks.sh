#!/bin/sh

set -eu

repo_root=$(git rev-parse --show-toplevel)
hooks_path=$(git -C "$repo_root" rev-parse --git-path hooks)
case "$hooks_path" in
  /*) hooks_dir="$hooks_path" ;;
  *) hooks_dir="$repo_root/$hooks_path" ;;
esac
target="$hooks_dir/pre-push"

mkdir -p "$hooks_dir"

if [ -e "$target" ] || [ -L "$target" ]; then
  printf 'Refusing to replace existing hook: %s\n' "$target" >&2
  if grep -q 'Managed by KarpeSlop setup-git-hooks.sh.' "$target" 2>/dev/null; then
    printf 'It is already a KarpeSlop hook. To update it, follow the update steps in the README; do not chain it.\n' >&2
  elif [ -e "$target.local" ] || [ -L "$target.local" ]; then
    printf '%s also exists, so the existing hook cannot be moved there. Merge the two by hand first.\n' "$target.local" >&2
  else
    printf 'To keep it, move it to %s and rerun this script.\n' "$target.local" >&2
    printf 'The KarpeSlop hook runs pre-push.local after its branch check, with the same input.\n' >&2
    printf 'Do not call the KarpeSlop hook from your own hook: if yours reads stdin first, the check sees no refs.\n' >&2
  fi
  exit 1
fi

cp "$repo_root/.githooks/pre-push" "$target"
chmod +x "$target"
printf 'Git pre-push hook installed at %s\n' "$target"
