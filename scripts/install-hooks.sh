#!/bin/sh
# Copies the versioned hooks into .git/hooks.
#
# Git does not version its own hooks: a fresh clone starts with none, and
# `npm run verify` goes back to being something to remember. This script is the
# one step that turns it into a constraint again, and it has to be run by hand
# once after cloning — there is no way to make Git do it on its own.

set -e

root=$(git rev-parse --show-toplevel)
source_dir="$root/scripts/hooks"
target_dir="$root/.git/hooks"

if [ ! -d "$source_dir" ]; then
    echo "install-hooks: $source_dir not found" >&2
    exit 1
fi

mkdir -p "$target_dir"

for hook in "$source_dir"/*; do
    name=$(basename "$hook")
    cp "$hook" "$target_dir/$name"
    chmod +x "$target_dir/$name"
    echo "install-hooks: $name installed"
done
