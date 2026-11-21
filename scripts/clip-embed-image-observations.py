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
import os, sys, time, argparse, io, json, re
import requests
import numpy as np

AP = argparse.ArgumentParser()
AP.add_argument("--limit", type=int, default=50)
AP.add_argument("--all", action="store_true", help="loop until no null-embedding active rows")
AP.add_argument("--batch", type=int, default=25)
AP.add_argument("--dead-file", default=os.path.expanduser("~/nuke/logs/clip-embed-dead.json"),
                help="rows whose bytes could not be read, with when; '' keeps no memo")
AP.add_argument("--dead-hours", type=float, default=24.0, help="how long a row that failed is left alone")
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

# The model is loaded only when there is a row to embed: a scheduled fire that finds nothing costs one RPC, not a
# model load (the job runs every few minutes so a photo is embedded soon after it lands).
_clip = None
def clip():
    global _clip
    if _clip is None:
        print("loading CLIP ViT-B/32 (openai) ...", flush=True)
        import torch, open_clip
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32-quickgelu", pretrained="openai")
        model = model.to(device).eval()
        print(f"model ready on {device}", flush=True)
        _clip = (torch, model, preprocess, device)
    return _clip

# Rows whose bytes could not be read stay at the head of the RPC's order for good (a deleted object answers 400 on
# every fire). The memo leaves such a row alone for --dead-hours, then tries it again; a row that embeds is forgotten.
# Only a failure where storage itself says the object is not there (400 or 404 on the original; measured 2026-11-20:
# 180 of the 185 rows that failed in a full drain) is remembered across fires. Everything else is left for the next fire: a
# timeout, a refused connection, a 5xx, a failed write, and also bytes PIL cannot open. A phone original is often HEIC,
# which only the render endpoint can turn into a JPEG, so "cannot identify image" on the original can mean the render
# call failed that minute, and one bad minute must not park a fresh photo for a day.
def source_is_gone(e):
    resp = getattr(e, "response", None)
    return isinstance(e, requests.HTTPError) and resp is not None and resp.status_code in (400, 404)

def say(e):
    # the exception text can carry the object's address: say what failed, not where
    return f"{type(e).__name__} {re.sub(r'https?://[^ ]+', '<url>', str(e))[:80]}"
def load_dead():
    if not args.dead_file:
        return {}
    try:
        with open(args.dead_file) as f:
            memo = json.load(f)
        return {k: float(v) for k, v in memo.items() if isinstance(v, (int, float))}
    except Exception:
        return {}

def save_dead(memo):
    if not args.dead_file:
        return
    cutoff = time.time() - 7 * 86400
    try:
        os.makedirs(os.path.dirname(args.dead_file), exist_ok=True)
        tmp = args.dead_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump({k: v for k, v in memo.items() if v >= cutoff}, f)
        os.replace(tmp, args.dead_file)
    except Exception as e:
        print(f"  could not save the dead-row memo: {type(e).__name__}", flush=True)

def fetch_batch(n):
    # Driven by get_clip_embed_batch RPC (migration 20260618010000): null-embedding active engine
    # rows that have a USABLE source (non-empty http url OR a local file path), ordered + bounded.
    # The old raw is.null PostgREST query returned empty-url rows that broke the loop and never
    # converged; the RPC excludes orphan rows so --all drains cleanly.
    r = requests.post(
        f"{URL}/rest/v1/rpc/get_clip_embed_batch",
        headers={**H, "Content-Type": "application/json"},
        json={"p_limit": n}, timeout=90)
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
    torch, model, preprocess, device = clip()
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

def fetch_batch_resilient(n, retries=5):
    # a transient RPC ReadTimeout (DB busy, e.g. a concurrent reap) must NOT crash the whole --all
    # drain. Retry with backoff; if persistently failing, exit the drain gracefully (rc=0) so the
    # launchd job simply resumes on its next fire instead of dying.
    for attempt in range(retries):
        try:
            return fetch_batch(n)
        except Exception as e:
            print(f"  fetch retry {attempt+1}/{retries}: {str(e)[:90]}", flush=True)
            time.sleep(5 * (attempt + 1))
    print("  fetch failed after retries — DB busy; exiting drain gracefully (launchd resumes next fire)", flush=True)
    return []

done = fail = gone_n = 0
memo = load_dead()
# rows whose bytes could not be read, this run or within --dead-hours: the RPC keeps returning them, so ask past them
dead = {k for k, at in memo.items() if at >= time.time() - args.dead_hours * 3600}
skipped_dead = len(dead)
remaining = args.limit if not args.all else 10**9
while remaining > 0:
    rows = [r for r in fetch_batch_resilient(min(500, max(args.batch, remaining) + len(dead))) if r[0] not in dead][:min(args.batch, remaining)]
    if not rows:
        break
    for obs_id, image_url, storage_path in rows:
        t0 = time.time()
        vec = None
        try:
            vec = embed(image_url, storage_path)
        except Exception as e:
            fail += 1
            dead.add(obs_id)
            gone = source_is_gone(e)
            if gone:
                memo[obs_id] = time.time()
                gone_n += 1
            print(f"  FAIL {obs_id[:8]}  {'source gone' if gone else 'read failed, retried next fire'}: {say(e)}", flush=True)
        if vec is not None:
            try:
                write(obs_id, vec)
                done += 1
                memo.pop(obs_id, None)
                print(f"  OK  {obs_id[:8]}  {int((time.time()-t0)*1000)}ms  dim={vec.shape[0]}", flush=True)
            except Exception as e:
                fail += 1
                dead.add(obs_id)
                print(f"  FAIL {obs_id[:8]}  write failed, retried next fire: {say(e)}", flush=True)
        remaining -= 1
        if remaining <= 0:
            break

save_dead(memo)
print(f"\ndone={done} fail={fail}", flush=True)
print(json.dumps({"embedded": done, "failed": fail, "source_gone": gone_n, "left_alone_as_dead": skipped_dead,
                  "model_loaded": _clip is not None}), flush=True)
