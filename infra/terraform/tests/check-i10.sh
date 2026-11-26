#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."
root="$PWD"
export CHECKPOINT_DISABLE=1 TF_IN_AUTOMATION=1
unset TF_WORKSPACE TF_CLI_ARGS TF_CLI_ARGS_init TF_CLI_ARGS_test

mkdir -p "$root/dist"
work="$(mktemp -d "$root/dist/i10.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
export TF_PLUGIN_CACHE_DIR="$root/dist/terraform-plugin-cache"
mkdir -p "$TF_PLUGIN_CACHE_DIR" "$work/release/lambda"
export TF_VAR_release_dir="$work/release"
printf '%s\n' '0123456789abcdef0123456789abcdef01234567' > "$work/release/SHA"
printf '%s\n' 'export const handler = () => null' > "$work/index.mjs"
for name in api pre-sign-up notification-sender; do
  (cd "$work" && zip -q "release/lambda/$name.zip" index.mjs)
done
(cd "$work/release" && bash "$root/scripts/sha256.sh" lambda/*.zip > SHA256SUMS)

terraform fmt -check -recursive infra/terraform
for scope in bootstrap environments/integration environments/production; do
  dir="infra/terraform/$scope"
  # Use a fresh data directory, never an initialized release backend.
  export TF_DATA_DIR="$work/${scope##*/}"
  terraform -chdir="$dir" init -input=false -backend=false -lockfile=readonly -no-color
  terraform -chdir="$dir" validate -no-color
  if [[ "$scope" == bootstrap ]]; then
    terraform -chdir="$dir" test -no-color
  else
    result="$work/${scope##*/}.jsonl"
    if ! terraform -chdir="$dir" test -json -verbose > "$result"; then
      jq -c 'select(.type == "diagnostic") | .diagnostic' "$result" >&2
      exit 1
    fi
  fi
done
node infra/terraform/tests/assert-i10.mjs "$work"
