set -e
cd /workspace/nuke-strategy/shadow/v16
export V16_EVENTS=/workspace/v16/events.json
cp -n ../v15/meta_v11.npz . 2>/dev/null || true
for s in load_v11.py feat_v11.py feat4_v11.py mkcache.py dump5.py; do echo "== $s $(date +%T)"; python3 $s 2>&1 | tail -3; done
for c in 2024-07-01 2025-01-01 2025-07-01; do echo "== fwd $c $(date +%T)"; python3 fwd_sets11.py $c 2>&1 | tail -2; done
echo "PIPE DONE $(date +%T)"
