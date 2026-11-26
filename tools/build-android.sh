#!/bin/sh
# Builds the KJT Invest APK.
# Needs (Ubuntu/Debian): sudo apt install aapt dalvik-exchange zipalign apksigner android-sdk-platform-23 default-jdk
# Usage: tools/build-android.sh <version> <keystore> <password-file>
set -e
VER="$1"; KS="$2"; PASSFILE="$3"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK=/usr/lib/android-sdk
JAR="$SDK/platforms/android-23/android.jar"
B="$ROOT/build/android"
rm -rf "$B"; mkdir -p "$B/res" "$B/classes" "$B/assets"
cp -r "$ROOT/src/www" "$B/assets/www"
aapt2 compile --dir "$ROOT/android/res" -o "$B/res.zip"
aapt2 link -I "$JAR" --manifest "$ROOT/android/AndroidManifest.xml" -A "$B/assets" -o "$B/base.apk" "$B/res.zip"
mkdir -p "$B/stubs"
javac -nowarn -source 8 -target 8 -bootclasspath "$JAR" -d "$B/stubs" $(find "$ROOT/android/stubs" -name '*.java') 2>&1 | grep -v -E 'warning|^Picked' || true
javac -nowarn -source 8 -target 8 -bootclasspath "$JAR" -cp "$B/stubs" -d "$B/classes" $(find "$ROOT/android/src" -name '*.java') 2>&1 | grep -v -E 'warning|^Picked|^1 warning' || true
[ -f "$B/classes/today/knowingjesus/invest/MainActivity.class" ] || { echo "Java build failed"; exit 1; }
/usr/lib/android-sdk/build-tools/debian/dx --dex --min-sdk-version=26 --output="$B/classes.dex" "$B/classes"
cp "$B/base.apk" "$B/unaligned.apk"
(cd "$B" && zip -q -X unaligned.apk classes.dex)
zipalign -f -p 4 "$B/unaligned.apk" "$B/aligned.apk"
OUT="$ROOT/dist/kjt-invest-$VER.apk"
mkdir -p "$ROOT/dist"
apksigner sign --ks "$KS" --ks-pass "file:$PASSFILE" --out "$OUT" "$B/aligned.apk"
apksigner verify --print-certs "$OUT" | head -3
echo "Built $OUT"
