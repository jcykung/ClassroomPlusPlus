#!/bin/sh
# Runs the Classroom++ fixture in headless Chrome and reports PASS/FAIL.
# Usage: sh tests/run.sh   (override the binary with CHROME=/path/to/chrome)
set -eu
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="$(mktemp -t classroompp-test).html"

"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --virtual-time-budget=8000 \
  --dump-dom "file://$PWD/tests/classwork-fixture.html" > "$OUT"

# Pull the #results text out of the dumped DOM.
python3 - "$OUT" <<'EOF'
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r'<div id="results">(.*?)</div>', html, re.S)
text = (m.group(1) if m else 'NO RESULTS FOUND')
text = re.sub(r'<[^>]+>', '', text)
print(text.strip())
sys.exit(0 if 'ALL TESTS PASSED' in text else 1)
EOF
