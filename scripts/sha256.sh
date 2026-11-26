#!/usr/bin/env bash
set -euo pipefail

if command -v sha256sum >/dev/null 2>&1; then
  exec sha256sum "$@"
fi
exec shasum -a 256 "$@"
