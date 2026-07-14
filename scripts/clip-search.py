#!/usr/bin/env python3
"""
clip-search.py — prove the visual search payoff.
Encodes a text query with the SAME CLIP ViT-B/32 (quickgelu/openai) model used for the
image embeddings, then calls search_images_by_embedding() so text aligns to images.

  dotenvx run -- python3 scripts/clip-search.py "red mustang"
  dotenvx run -- python3 scripts/clip-search.py "white lifted chevy squarebody truck" --limit 10
"""
import os, sys, argparse, requests, torch, open_clip

AP = argparse.ArgumentParser()
AP.add_argument("query", nargs="+")
AP.add_argument("--limit", type=int, default=12)
args = AP.parse_args()
q = " ".join(args.query)

URL = os.environ["VITE_SUPABASE_URL"]; KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
device = "mps" if torch.backends.mps.is_available() else "cpu"
model, _, _ = open_clip.create_model_and_transforms("ViT-B-32-quickgelu", pretrained="openai")
model = model.to(device).eval()
tok = open_clip.get_tokenizer("ViT-B-32-quickgelu")
with torch.no_grad():
    f = model.encode_text(tok([q]).to(device))
    f = f / f.norm(dim=-1, keepdim=True)
vec = "[" + ",".join(f"{x:.6f}" for x in f[0].cpu().numpy().tolist()) + "]"

r = requests.post(f"{URL}/rest/v1/rpc/search_images_by_embedding",
    headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    json={"p_query": vec, "p_limit": args.limit}, timeout=60)
r.raise_for_status()
print(f"\nquery: {q!r}\n" + "-"*70)
for i, row in enumerate(r.json(), 1):
    veh = " ".join(str(x) for x in [row.get("v_year"), row.get("v_make"), row.get("v_model")] if x)
    print(f"{i:2}. sim={row['similarity']:.3f}  {veh or '(unattributed)'} · {row.get('v_color') or '—'} · {row['role']} · {row['observed_by']}")
