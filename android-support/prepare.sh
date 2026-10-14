#!/usr/bin/env bash
# Generates the Android project with Capacitor and applies our version and icon.
# Usage: APP_VERSION=1.23 VERSION_CODE=23 android-support/prepare.sh
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf android
npx cap add android
npx cap sync android

gradle=android/app/build.gradle
sed -i "s/versionCode [0-9]*/versionCode ${VERSION_CODE:-1}/" "$gradle"
sed -i "s/versionName \"[^\"]*\"/versionName \"${APP_VERSION:-dev}\"/" "$gradle"

# Use our icon at every density instead of the default Capacitor one.
res=android/app/src/main/res
rm -rf "$res"/mipmap-anydpi-v26
for dir in "$res"/mipmap-*; do
  cp public/icon-512.png "$dir/ic_launcher.png"
  cp public/icon-512.png "$dir/ic_launcher_round.png"
  rm -f "$dir/ic_launcher_foreground.png"
done

# Sign with the committed key so each new APK installs over the previous one.
mkdir -p ~/.android
cp android-support/debug.keystore ~/.android/debug.keystore

# Dark splash screen with our icon.
for f in "$res"/drawable*/splash.png; do
  case "$f" in
    *land*) cp android-support/splash-land.png "$f" ;;
    *) cp android-support/splash.png "$f" ;;
  esac
done
