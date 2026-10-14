#!/usr/bin/env bash
# Builds games/<slug>/game.html into its own offline Android app: <slug>.apk
# Usage: android-support/game-apk.sh <slug>
set -euo pipefail
cd "$(dirname "$0")/.."
slug="$1"
src="games/$slug/game.html"
[ -f "$src" ] || { echo "No $src"; exit 1; }

title=$(grep -o -i '<title>[^<]*</title>' "$src" | head -1 | sed -E 's#</?[tT][iI][tT][lL][eE]>##g' | sed -E 's/^ +| +$//g')
title=${title:-$slug}
app_id="io.github.bagietu.games.g$(echo "$slug" | tr -c 'a-z0-9\n' '_')"

rm -rf www-game && mkdir www-game
cp "$src" www-game/index.html

# A config just for this game (the game files are bundled, so it works offline).
cp capacitor.config.json capacitor.config.json.bak
jq -n --arg id "$app_id" --arg name "$title" \
  '{appId: $id, appName: $name, webDir: "www-game", android: {backgroundColor: "#000000"}}' > capacitor.config.json
trap 'mv capacitor.config.json.bak capacitor.config.json' EXIT

APP_VERSION="${APP_VERSION:-1.0}" VERSION_CODE="${VERSION_CODE:-1}" android-support/prepare.sh

(cd android && ./gradlew assembleDebug --no-daemon)
cp android/app/build/outputs/apk/debug/app-debug.apk "$slug.apk"
echo "Built $slug.apk ($title, $app_id)"
