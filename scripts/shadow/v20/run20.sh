set -e -o pipefail
cd /workspace/v20
for s in load18 targets18 feat18 feat4_18 sets18 attrs18 sel18 eval18 eval19; do echo "== $s $(date +%T)"; bash guard.sh python3 $s.py; done
echo ALLDONE
