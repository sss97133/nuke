set -eo pipefail
cd /workspace/nuke-strategy/shadow/v17
for s in load_v11.py feat_v11.py feat4_v11.py mkcache.py dump5.py; do echo "== $s $(date +%T)"; python3 $s 2>&1 | tail -3; done
for c in 2024-07-01 2025-01-01 2025-07-01; do echo "== fwd $c $(date +%T)"; python3 fwd_sets11.py $c 2>&1 | tail -2; done
echo "PIPE DONE $(date +%T)"
