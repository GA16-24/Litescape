#!/usr/bin/env bash
# Runs a build, and again (up to 3 times) only if it failed on a download. A compile or test failure fails at once,
# so a flaky test can't pass on a retry. Maven hosts and the plugin portal drop some connections under load.
set -uo pipefail
log=$(mktemp)
for attempt in 1 2 3; do
  "$@" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  [ "$status" -eq 0 ] && exit 0
  grep -q -E 'Could not (resolve|GET|HEAD) |terminated the handshake|was not found in any of the following sources|Connection reset' "$log" || exit "$status"
  echo "::warning::A download failed (attempt $attempt of 3); running the build again"
done
exit "$status"
