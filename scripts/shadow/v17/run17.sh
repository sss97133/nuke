set -eo pipefail
cd /workspace/nuke-strategy/shadow/v17
echo "== A: unfiltered (v13b reproduction) $(date +%T)"
V17_DROP= bash pipe.sh
python3 eval_v13b.py v13brep sets_v11.npz fwdsets11_ ../v10/gbm_best.json 0 | grep all
mkdir -p repA && cp sets_v11.npz fwdsets11_*.npz repA/
echo "== B: v17 filtered $(date +%T)"
bash pipe.sh
python3 eval_v13b.py v17 sets_v11.npz fwdsets11_ ../v10/gbm_best.json 0 | grep all
echo "RUN17 DONE $(date +%T)"
