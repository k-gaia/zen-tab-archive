#!/usr/bin/env bash
# Downloads Zen, Sine's bootloader + engine into a scratch dir and exports
# paths via $GITHUB_ENV for the later steps. Versions for Sine come from
# workflow env (SINE_BOOTLOADER_TAG, SINE_ENGINE_TAG).
set -euo pipefail

TAG="${ZEN_TAG_INPUT:-}"
if [ -z "$TAG" ]; then
  TAG=$(gh release view --repo zen-browser/desktop --json tagName -q .tagName)
fi
echo "Testing against Zen $TAG"

W="$RUNNER_TEMP/zen-ci"
mkdir -p "$W"
cd "$W"

curl -fsSL -o zen.tar.xz \
  "https://github.com/zen-browser/desktop/releases/download/$TAG/zen.linux-x86_64.tar.xz"
tar -xJf zen.tar.xz

ZEN_BIN=$(find "$W" -type f -name zen -perm -u+x | head -1)
if [ -z "$ZEN_BIN" ]; then
  echo "Could not locate the zen binary after extracting $TAG" >&2
  exit 1
fi
ZEN_DIR=$(dirname "$ZEN_BIN")

curl -fsSL -o program.zip \
  "https://github.com/sineorg/bootloader/releases/download/$SINE_BOOTLOADER_TAG/program.zip"
curl -fsSL -o profile.zip \
  "https://github.com/sineorg/bootloader/releases/download/$SINE_BOOTLOADER_TAG/profile.zip"
curl -fsSL -o engine.zip \
  "https://github.com/CosmoCreeper/Sine/releases/download/$SINE_ENGINE_TAG/engine.zip"

unzip -oq program.zip -d "$ZEN_DIR"

PROFILE="$W/profile"
mkdir -p "$PROFILE/chrome"
unzip -oq profile.zip -d "$PROFILE/chrome"
unzip -oq engine.zip -d "$PROFILE/chrome"

GECKO_TAG=$(gh release view --repo mozilla/geckodriver --json tagName -q .tagName)
curl -fsSL -o geckodriver.tar.gz \
  "https://github.com/mozilla/geckodriver/releases/download/$GECKO_TAG/geckodriver-$GECKO_TAG-linux64.tar.gz"
tar -xzf geckodriver.tar.gz
echo "GECKODRIVER_PATH=$W/geckodriver" >> "$GITHUB_ENV"

echo "ZEN_TAG=$TAG" >> "$GITHUB_ENV"
echo "ZEN_BIN=$ZEN_BIN" >> "$GITHUB_ENV"
echo "PROFILE_DIR=$PROFILE" >> "$GITHUB_ENV"
