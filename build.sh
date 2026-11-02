#!/bin/sh
# src/ 의 확장 프로그램 파일만 묶어 release/autoplay-edupure-v<버전>.zip 을 만든다.
# 버전은 src/manifest.json 의 version 값을 따른다.
set -eu
cd "$(dirname "$0")"
VER=$(python3 -c "import json;print(json.load(open('src/manifest.json'))['version'])")
OUT="release/autoplay-edupure-v$VER.zip"
STAGE=$(mktemp -d)
mkdir -p release "$STAGE/autoplay-edupure"
cp src/manifest.json src/background.js src/content.js src/popup.html src/popup.js "$STAGE/autoplay-edupure/"
rm -f "$OUT"
(cd "$STAGE" && zip -qr -X "$OLDPWD/$OUT" autoplay-edupure)
rm -rf "$STAGE"
echo "만들어짐: $OUT"
unzip -l "$OUT"
