#!/bin/sh
# Publish a version to the beta copy (…/beta/) on the site branch: copies the app files of <ref> into beta/.
# Run on the site branch (claude/magical-bell-qcwse4), then commit and push. Usage: tools/beta.sh claude/bold-mendel-xi31j7
set -e
cd "$(dirname "$0")/.." || exit 1
REF=${1:?usage: tools/beta.sh <branch-or-commit>}
mkdir -p beta
for f in index.html style.css app.js cloud.js sw.js firebase-config.js manifest.webmanifest version.txt README.md; do
  git show "$REF:$f" > "beta/$f"
done
rm -rf beta/vendor beta/icons
git archive "$REF" vendor icons | tar -x -C beta
echo "beta/ now has $(cat beta/version.txt) from $REF"
