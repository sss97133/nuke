set -eo pipefail
cd /workspace/nuke-strategy/shadow/v17
for s in mkcache.py dump5.py; do echo "== $s $(date +%T)"; bash guard.sh python3 $s 2>&1 | tail -3; done
for c in 2024-07-01 2025-01-01 2025-07-01; do echo "== fwd $c $(date +%T)"; bash guard.sh python3 fwd_sets11.py $c 2>&1 | tail -2; done
bash guard.sh python3 eval_v13b.py v17fix sets_v11.npz fwdsets11_ ../v10/gbm_best.json 0 | grep -E "all|GUARD"
echo "RERUN DONE $(date +%T)"
