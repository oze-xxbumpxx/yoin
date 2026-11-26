#!/usr/bin/env bash
set -euo pipefail

sha="${1:?Expected the full tested SHA}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
script_dir="$(cd "$(dirname "$0")" && pwd)"
test "$(git -C "$script_dir/.." rev-parse HEAD)" = "$sha"

test -s dist/pwa/index.html
for name in api pre-sign-up notification-sender; do
  test -s "dist/lambda/$name/index.mjs"
done

mkdir -p dist/release
mkdir dist/release/lambda
cp -r dist/pwa dist/release/pwa
for name in api pre-sign-up notification-sender; do
  (cd "dist/lambda/$name" && zip -q "../../release/lambda/$name.zip" index.mjs)
done
(
  cd dist/release
  printf '%s\n' "$sha" > SHA
  find SHA pwa lambda -type f -print0 | LC_ALL=C sort -z | xargs -0 bash "$script_dir/sha256.sh" > SHA256SUMS
)
