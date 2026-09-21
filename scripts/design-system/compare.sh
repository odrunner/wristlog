#!/bin/zsh
# Before/after harness for design-system changes. "old" = a git ref, "new" = the working tree.
#   compare.sh static [ref]                     computed styles of every static element, both themes (JS off)
#   compare.sh landing [ref]                    the landing screen only — must print 0 differences
#   compare.sh screen <page> '<selector>' [ref] a tab on mocked data: item heights, overflow, screenshots
#   compare.sh modals '<id,id|ALL-EXCEPT:id>' [ref]
#   compare.sh force '<page-id,page-id>' [ref]  pages the mock cannot reach: reveal everything, diff every box
#   compare.sh shadows [ref]
# Needs the dev server on :3000. Output (PNGs) goes to $OUT (default: a temp dir, printed at the end).
set -e
R="${0:A:h}/../.."; D="${0:A:h}"; MODE="$1"; shift
OUT="${OUT:-$(mktemp -d)}"; C="$OUT/cmp"; export PATH=/opt/homebrew/bin:$PATH; cd "$R"
case "$MODE" in static|landing|shadows) REF="${1:-HEAD}";; screen) REF="${3:-HEAD}";; *) REF="${2:-HEAD}";; esac
mkdir -p "$C/old/p" "$C/old/profile" "$C/new/p" "$C/new/profile"
for p in index.html p/index.html profile/index.html design-system.css; do git show "$REF:$p" > "$C/old/$p"; cp "$p" "$C/new/$p"; done
run() { cp "$D/$1" "$2"; shift; local f="$1"; shift; node "$f" "$@"; local rc=$?; rm -f "$f"; return $rc; }
case "$MODE" in
  static)  run ds-cmp.mjs .ds-cmp.mjs "$C";;
  landing) run ds-landing.mjs .ds-landing.mjs "$C";;
  screen)  run _ds-screen-cmp.mjs e2e/_ds-screen-cmp.mjs "$C/old" "$OUT" "$1" "$2";;
  modals)  run _ds-modal-cmp.mjs e2e/_ds-modal-cmp.mjs "$C/old" "$OUT" "$1";;
  force)   run _ds-force-cmp.mjs e2e/_ds-force-cmp.mjs "$C/old" "$OUT" "$1";;
  shadows) run _ds-shadow-cmp.mjs e2e/_ds-shadow-cmp.mjs "$C/old" "$OUT";;
  *) echo "unknown mode"; exit 2;;
esac
echo "output: $OUT"
