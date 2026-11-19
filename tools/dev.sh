#!/usr/bin/env bash
# Envoltorio: la lógica vive en tools/dev.mjs (Linux, macOS y Windows).
exec node "$(dirname "$0")/dev.mjs" "$@"
