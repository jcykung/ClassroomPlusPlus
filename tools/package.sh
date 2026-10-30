#!/bin/sh
# Builds a Chrome Web Store upload archive containing only runtime files.
# Usage: sh tools/package.sh   ->   dist/classroom-plus-plus-<version>.zip
set -eu
cd "$(dirname "$0")/.."

VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUT="dist/classroom-plus-plus-$VERSION.zip"

mkdir -p dist
rm -f "$OUT"

zip -qr "$OUT" \
  manifest.json \
  background.js \
  popup.html popup.js \
  onboarding.html onboarding.js \
  changelog.html changelog.js \
  icons src

echo "Built $OUT"
python3 - "$OUT" <<'EOF'
import sys, zipfile
names = zipfile.ZipFile(sys.argv[1]).namelist()
print(f"{len(names)} file(s):")
for n in sorted(names):
    print("  " + n)
EOF
