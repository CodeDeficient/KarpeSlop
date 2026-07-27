#!/bin/sh

set -eu

repo_root=$(git rev-parse --show-toplevel)
git -C "$repo_root" config core.hooksPath .githooks
printf 'Git hooks installed from %s/.githooks\n' "$repo_root"
