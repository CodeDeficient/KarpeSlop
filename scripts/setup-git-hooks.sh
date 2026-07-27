#!/bin/sh

set -eu

repo_root=$(git rev-parse --show-toplevel)
hooks_path=$(git -C "$repo_root" rev-parse --git-path hooks)
case "$hooks_path" in
  /*) hooks_dir="$hooks_path" ;;
  *) hooks_dir="$repo_root/$hooks_path" ;;
esac
target="$hooks_dir/pre-push"

if [ -e "$target" ] || [ -L "$target" ]; then
  printf 'Refusing to replace existing hook: %s\n' "$target" >&2
  printf 'Chain %s into that hook manually; do not rerun this setup script.\n' "$repo_root/.githooks/pre-push" >&2
  exit 1
fi

cp "$repo_root/.githooks/pre-push" "$target"
chmod +x "$target"
printf 'Git pre-push hook installed at %s\n' "$target"
