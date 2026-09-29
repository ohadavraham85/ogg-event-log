#!/bin/sh
# All version markers must agree: app.js APP_VER, sw.js CACHE, index.html (?v=, verChip, verLine), version.txt, README row.
cd "$(dirname "$0")/.." || exit 1
v=$(sed -n 's/.*APP_VER="\([0-9.]*\)".*/\1/p' app.js)
ok=0
grep -q "ogg-log-$v\"" sw.js                        || { echo "sw.js CACHE != $v"; ok=1; }
[ "$(tr -d '[:space:]' < version.txt)" = "$v" ]     || { echo "version.txt != $v"; ok=1; }
grep -q ">v$v<" index.html                          || { echo "index.html verChip != $v"; ok=1; }
grep -q "גרסה $v ·" index.html                      || { echo "index.html verLine != $v"; ok=1; }
[ "$(grep -o '?v=[0-9.]*' index.html | sort -u)" = "?v=$v" ] || { echo "index.html ?v= != $v"; ok=1; }
grep -q "^| $v |" README.md                         || { echo "README has no row for $v"; ok=1; }
[ $ok = 0 ] && echo "version $v OK"
exit $ok
