#!/usr/bin/env bash
# Envoltorio: la lógica vive en tools/setup.mjs (Linux, macOS y Windows).
exec node "$(dirname "$0")/setup.mjs" "$@"
