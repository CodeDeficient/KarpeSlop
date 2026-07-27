#!/bin/sh

set -eu

repo_root=$(git rev-parse --show-toplevel)
hooks_dir=$(git -C "$repo_root" rev-parse --git-path hooks)
target="$hooks_dir/pre-push"

if [ -e "$target" ] || [ -L "$target" ]; then
  if [ ! -L "$target" ] || [ "$(readlink "$target")" != "$repo_root/.githooks/pre-push" ]; then
    printf 'Refusing to replace existing hook: %s\n' "$target" >&2
    printf 'Chain %s into that hook manually, then rerun this setup script.\n' "$repo_root/.githooks/pre-push" >&2
    exit 1
  fi
fi

ln -sfn "$repo_root/.githooks/pre-push" "$target"
printf 'Git pre-push hook installed at %s\n' "$target"
