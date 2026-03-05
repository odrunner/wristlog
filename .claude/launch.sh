#!/bin/bash
# Sync latest project files to /tmp/wristlog_static, then serve them

SRC="/Users/ozgurdogan/Documents/Claude project/watch tracker"
DST="/tmp/wristlog_static"

mkdir -p "$DST"

# Copy all app assets (app.html is served as index.html)
cp "$SRC/app.html"      "$DST/index.html"
cp "$SRC/manifest.json" "$DST/manifest.json"  2>/dev/null || true
cp "$SRC/sw.js"         "$DST/sw.js"          2>/dev/null || true
cp "$SRC/icon.svg"      "$DST/icon.svg"       2>/dev/null || true

# Copy data file if it exists
[ -f "$SRC/wristlog-data.json" ] && cp "$SRC/wristlog-data.json" "$DST/wristlog-data.json"

exec python3 /tmp/wristlog_serve.py
