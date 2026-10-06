#!/usr/bin/env bash
# For each tier whose results file says ok:false, either comment on the open
# tracking issue for that tier or open a new one. Labels map to severity:
#   critical -> severity:critical
#   feature  -> severity:major
#   cosmetic -> severity:minor
set -uo pipefail

DIR="$1"
REPO="${GITHUB_REPOSITORY}"

label_for() {
  case "$1" in
    critical) echo "severity:critical" ;;
    feature)  echo "severity:major" ;;
    cosmetic) echo "severity:minor" ;;
  esac
}

for tier in critical feature cosmetic; do
  file="$DIR/$tier.json"
  [ -f "$file" ] || { echo "no results for $tier, skipping"; continue; }

  ok=$(jq -r '.ok' "$file")
  zen=$(jq -r '.zenTag' "$file")
  if [ "$ok" = "true" ]; then
    echo "$tier passed on Zen $zen"
    continue
  fi

  label=$(label_for "$tier")
  title="Zen compat [$tier]: failing checks on Zen $zen"
  body=$(jq -r --arg zen "$zen" '
    "Zen " + $zen + " failed these " + .tier + " checks:\n\n" +
    ([.results[] | select(.ok == false) | "- " + .name + (if .detail then " (" + .detail + ")" else "" end)] | join("\n"))
  ' "$file")

  gh label create "$label" --repo "$REPO" --color "d73a4a" --force >/dev/null 2>&1 || true

  existing=$(gh issue list --repo "$REPO" --label "$label" --state open \
    --search "Zen compat [$tier] in:title" --json number -q '.[0].number')

  if [ -n "$existing" ] && [ "$existing" != "null" ]; then
    gh issue comment "$existing" --repo "$REPO" --body "$body"
    echo "commented on #$existing for $tier"
  else
    gh issue create --repo "$REPO" --title "$title" --label "$label" --body "$body"
  fi
done
