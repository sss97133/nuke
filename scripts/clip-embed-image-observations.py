#!/usr/bin/env python3
"""
clip-embed-image-observations.py — fill image_observations.embedding_clip_vitb32.

The image engine (image_observations) has the HNSW index and tiered analysis rows,
but no embeddings = no visual search. This is the missing generator (none existed in
the repo; the old ones lived in the offline YONO sidecar). It runs LOCAL CLIP
ViT-B/32 on Apple MPS — zero API cost, 512-d, matching the column + existing rows.

Embeddings are tier-0 RECALL infrastructure (labeled as such), never a truth claim —
identity/attribution still comes from the Claude/human tiers. This only powers search.

Images are pulled through Supabase's render endpoint (JPEG, HEIC-safe, ~336px, low
egress), encoded, L2-normalized (cosine), and written back via PostgREST.

Run UNSANDBOXED (needs network):
  dotenvx run -- python3 scripts/clip-embed-image-observations.py --limit 50
  dotenvx run -- python3 scripts/clip-embed-image-observations.py --all
"""
import os, sys, time, argparse, io
import requests
import numpy as np

AP = argparse.ArgumentParser()
AP.add_argument("--limit", type=int, default=50)
AP.add_argument("--all", action="store_true", help="loop until no null-embedding active rows")
AP.add_argument("--batch", type=int, default=25)
args = AP.parse_args()

URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not URL or not KEY:
    print("missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr); sys.exit(1)
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def render_url(image_url: str) -> str:
    # object/public → render/image/public, force JPEG thumbnail (HEIC-safe, small)
    if "/storage/v1/object/public/" in image_url:
        u = image_url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/")
        sep = "&" if "?" in u else "?"
        return f"{u}{sep}width=336&height=336&resize=contain"
    return image_url

print("loading CLIP ViT-B/32 (openai) ...", flush=True)
import torch, open_clip
device = "mps" if torch.backends.mps.is_available() else "cpu"
model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32-quickgelu", pretrained="openai")
model = model.to(device).eval()
print(f"model ready on {device}", flush=True)

def fetch_batch(n):
    # Driven by get_clip_embed_batch RPC (migration 20260618010000): null-embedding active engine
    # rows that have a USABLE source (non-empty http url OR a local file path), ordered + bounded.
    # The old raw is.null PostgREST query returned empty-url rows that broke the loop and never
    # converged; the RPC excludes orphan rows so --all drains cleanly.
    r = requests.post(
        f"{URL}/rest/v1/rpc/get_clip_embed_batch",
        headers={**H, "Content-Type": "application/json"},
        json={"p_limit": n}, timeout=60)
    r.raise_for_status()
    out = []
    for row in r.json():
        out.append((row["obs_id"], row.get("image_url") or "", row.get("storage_path") or ""))
    return out

def load_image(image_url, storage_path):
    from PIL import Image
    if image_url:
        rr = requests.get(render_url(image_url), timeout=60)
        if rr.status_code != 200 or not rr.content:
            rr = requests.get(image_url, timeout=90)  # fall back to original bytes
            rr.raise_for_status()
        return Image.open(io.BytesIO(rr.content)).convert("RGB")
    # no remote url — read the local file (gopro frames live on disk, image_url='')
    if storage_path and os.path.exists(storage_path):
        return Image.open(storage_path).convert("RGB")
    raise FileNotFoundError(f"no usable source (url empty, local path missing: {storage_path[:60]})")

def embed(image_url, storage_path=""):
    img = load_image(image_url, storage_path)
    t = preprocess(img).unsqueeze(0).to(device)
    with torch.no_grad():
        f = model.encode_image(t)
        f = f / f.norm(dim=-1, keepdim=True)
    return f[0].detach().cpu().numpy().astype(np.float32)

def write(obs_id, vec):
    lit = "[" + ",".join(f"{x:.6f}" for x in vec.tolist()) + "]"
    r = requests.patch(
        f"{URL}/rest/v1/image_observations",
        headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"},
        params={"id": f"eq.{obs_id}"},
        json={"embedding_clip_vitb32": lit}, timeout=60)
    r.raise_for_status()

done = fail = 0
remaining = args.limit if not args.all else 10**9
while remaining > 0:
    rows = fetch_batch(min(args.batch, remaining))
    if not rows:
        break
    for obs_id, image_url, storage_path in rows:
        t0 = time.time()
        try:
            vec = embed(image_url, storage_path)
            write(obs_id, vec)
            done += 1
            print(f"  OK  {obs_id[:8]}  {int((time.time()-t0)*1000)}ms  dim={vec.shape[0]}", flush=True)
        except Exception as e:
            fail += 1
            print(f"  FAIL {obs_id[:8]}  {str(e)[:100]}", flush=True)
        remaining -= 1
        if remaining <= 0:
            break

print(f"\ndone={done} fail={fail}", flush=True)
