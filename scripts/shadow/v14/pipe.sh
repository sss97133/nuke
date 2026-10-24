set -e
cd /workspace/nuke-strategy/shadow/v14
export LM_USABLE_DUMP=f039d43d-6c7a-4e4b-9560-54d7bc3543df,8cecc561-af89-4b6c-89d9-13a944e82f4a
for s in load_v11.py feat_v11.py feat4_v11.py mkcache.py dump5.py; do echo "== $s $(date +%T)"; python3 $s 2>&1 | tail -3; done
for c in 2024-07-01 2025-01-01 2025-07-01; do echo "== fwd $c $(date +%T)"; python3 fwd_sets11.py $c 2>&1 | tail -2; done
echo "PIPE DONE $(date +%T)"
