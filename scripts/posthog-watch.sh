#!/bin/bash
# The PostHog cross-check, run BY HAND: `npm run posthog:watch`.
#
# QUIET WHEN THINGS ARE FINE. It notifies only when the comparison FAILS a criterion, or
# when PostHog has stopped arriving — never on a pass, or nobody reads the ones that matter.
# Every run is appended to the log either way, so a week can be read back at once.
#
# NOT SCHEDULED, and here is why, so nobody spends the afternoon again: macOS shields
# ~/Desktop from background jobs, and this repo lives there. A launchd agent cannot even
# READ this file — `/bin/bash: …: Operation not permitted` — though it can stat the folder,
# so the failure looks like nothing at all. Scheduling it needs Full Disk Access for
# /bin/bash (broad: every script on the Mac gets it) or the repo moved off the Desktop.
# Sam chose neither for now (2026-09-17).
#
# Exit codes from `npm run compare:posthog` (src/lib/compare-posthog.ts):
#   0  every criterion met
#   1  a criterion failed  -> notify
#   2  a side is empty     -> notify only after the grace period below, because the window
#                             excludes today and needs a few whole days before it says
#                             anything. An empty PostHog on day 10 IS the alarm: it means
#                             the mirror stopped and nobody would otherwise know.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 3

SLUG="${1:-skeen}"
LOG_DIR="$HOME/Library/Logs/lone-star"
LOG="$LOG_DIR/posthog-watch.log"
STARTED="$LOG_DIR/.posthog-watch-started"
GRACE_DAYS=3

mkdir -p "$LOG_DIR"
[ -f "$STARTED" ] || date +%s > "$STARTED"
started=$(cat "$STARTED")
days=$(( ( $(date +%s) - started ) / 86400 ))

out=$(/usr/bin/env PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" npm run --silent compare:posthog -- "$SLUG" 2>&1)
code=$?
verdict=$(printf '%s\n' "$out" | grep -m1 '^VERDICT:' || printf 'exit %s' "$code")

{
  printf '\n===== %s  exit=%s  day=%s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$code" "$days"
  printf '%s\n' "$out"
} >> "$LOG"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"PostHog cross-check\" sound name \"Basso\"" >/dev/null 2>&1
}

case "$code" in
  0) : ;;                                   # all good, stay quiet
  1) notify "${verdict//\"/}" ;;
  2) [ "$days" -ge "$GRACE_DAYS" ] && notify "No data: ${verdict//\"/}" ;;
  *) notify "The check could not run (exit $code). See the log." ;;
esac
exit 0
