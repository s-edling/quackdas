#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
EXT_DIR="$ROOT_DIR/browser-extension/firefox-observer"
DIST_DIR="$ROOT_DIR/dist/firefox-extension"

if [ ! -f "$EXT_DIR/manifest.json" ]; then
  echo "Missing extension manifest at $EXT_DIR/manifest.json" >&2
  exit 1
fi

VERSION=$(node -p "require('$EXT_DIR/manifest.json').version")
OUT_FILE="$DIST_DIR/quackdas-online-observation-$VERSION.xpi"

mkdir -p "$DIST_DIR"
rm -f "$OUT_FILE"

cd "$EXT_DIR"
zip -qr "$OUT_FILE" . \
  -x '*.DS_Store' \
  -x '__MACOSX/*'

echo "$OUT_FILE"
