#!/usr/bin/env python3
"""
lean-image-analyze.py — the SCALE path for image analysis: one direct API call per image,
no agent harness.

Why this exists: the deep-analysis drain runs `claude --print` (the Claude Code agent),
which prepends ~20k tokens of system prompt + tool definitions to EVERY call — measured
2026-06-22, that overhead was ~95% of the per-image cost, not the image. This analyzer
talks to the Messages API directly: a short cached system prompt + one downscaled image +
a JSON verdict out. ~20x leaner, and it records the REAL per-image token cost.

Levers (the three that move $/image):
  --model      claude-haiku-4-5-* | claude-sonnet-4-6 | claude-opus-4-8   (6-17x swing)
  --max-dim    downscale long edge before send (image tokens scale with pixels)
  prompt cache the verdict-schema system block is marked cache_control (90% off after 1st)

Modes:
  --estimate                 project $/image and $/million across models x downscale, from
                             first principles (no API spend). Accurate cost answer NOW.
  --vehicle-id <uuid> [...]  run real analysis -> verdicts JSONL compatible with
                             deep-image-analysis-byok.mjs ingest (same schema + provenance).

Env (run mode): ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
Deps: pip install requests Pillow pillow-heif
Pricing: USD per 1M tokens; VERIFY against current Anthropic pricing before trusting $.
"""
import os, sys, io, json, base64, argparse, time

PRICES = {  # (input, output, cache_read) USD / 1M tokens — verify before trusting
    "claude-haiku-4-5-20251001": (1.0, 5.0, 0.10),
    "claude-sonnet-4-6":         (3.0, 15.0, 0.30),
    "claude-opus-4-8":           (15.0, 75.0, 1.50),
}
MODELS = list(PRICES)

# Compact verdict contract (engineering-manual Ch.19). Cached as the system block.
SYSTEM = (
 "You are an expert vehicle build analyst. Output ONE compact JSON object, no prose, no code fences. "
 "Fill every field from the image; use \"unknown\" when not determinable. Schema: "
 '{"scene_type":"engine_bay|body_exterior|body_interior|undercarriage|data_plate|receipt_document|'
 'paint_booth|wheel_assembly|shop_context|off_property|unknown",'
 '"build_phase_guess":"discovery|teardown|metalwork|paint_prep|paint_application|mechanical_assembly|'
 'wiring|interior|final_assembly|drivable|show_finish|unknown",'
 '"camera_pose":{"framing":"short phrase","azimuth_deg":0,"elevation_deg":0,"distance_est":"~Nm"},'
 '"components_seen":[{"label":"","confidence":0.0,"bbox":[x1,y1,x2,y2],"part_number_guess":null}],'
 '"text_regions":[{"text":"","confidence":0.0,"bbox":[x1,y1,x2,y2]}],'
 '"state_observations":{"rust_severity":"none|surface|pitting|perforation|unknown",'
 '"paint_state":"bare_metal|primer|sealer|base|clear|aged|unknown","completeness":"stripped|partial|assembled|unknown","damage_callouts":[]},'
 '"presence":{"person":false,"dog":false,"place_hint":null},'
 '"narrative_one_line":"one sentence","intent":"labor|inspection|parts_sourcing|documentation|unknown",'
 '"intent_confidence":0.0,"confidence":0.0}. '
 "bbox coordinates are 0-999 (TWVP). Conditional focus: data_plate/receipt -> text_regions is primary "
 "(VIN/serial/part#); engine_bay/undercarriage/interior -> components_seen; body_exterior -> camera_pose+paint."
)
PROMPT_TOKENS_EST = 520   # ~system size; measured against tokenizer ballpark
OUTPUT_TOKENS_EST = 700   # a full structured verdict

def est_image_tokens(max_dim, aspect=0.75):
    # Anthropic vision ≈ (w*h)/750. Downscaled long edge = max_dim, short = max_dim*aspect.
    return round((max_dim * (max_dim * aspect)) / 750)

def estimate():
    print(f"{'model':<28}{'max_dim':>8}{'img_tok':>9}{'$/image':>10}{'$/million':>12}")
    for m in MODELS:
        pin, pout, pcache = PRICES[m]
        for d in (512, 768, 1024, 1568):
            it = est_image_tokens(d)
            # system cached (cache_read), image + tiny user at input price, output at out price
            usd = (it*pin + 40*pin + PROMPT_TOKENS_EST*pcache + OUTPUT_TOKENS_EST*pout) / 1_000_000
            print(f"{m:<28}{d:>8}{it:>9}{('$%.5f'%usd):>10}{('$%.0f'%(usd*1_000_000)):>12}")
    print("\nNotes: system prompt assumed cache-hit (read price); first call in a run pays cache-write once.")
    print("Batch API halves input/output. Two-pass (cheap triage on all, deep on ~15%) cuts the blended rate further.")
    print("VERIFY PRICES against current Anthropic rates before quoting.")

def run(args):
    import requests
    from PIL import Image
    import pillow_heif; pillow_heif.register_heif_opener()
    AK = os.environ.get("ANTHROPIC_API_KEY")
    URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not AK: sys.exit("run mode needs ANTHROPIC_API_KEY")
    if not URL or not KEY: sys.exit("run mode needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    sb = requests.Session(); sb.headers.update({"apikey": KEY, "authorization": f"Bearer {KEY}"})
    q = (f"{URL}/rest/v1/vehicle_images?select=id,vehicle_id,image_url"
         f"&vehicle_id=eq.{args.vehicle_id}&image_url=not.is.null&is_superseded=eq.false"
         f"&ai_scan_metadata->byok_deep_analysis=is.null&limit={args.limit}")
    rows = sb.get(q, timeout=60).json()
    print(f"to analyze: {len(rows)}", file=sys.stderr)
    sink = open(args.sink, "w") if args.sink else sys.stdout
    pin, pout, pcache = PRICES.get(args.model, (3.0, 15.0, 0.30))
    tot_usd = 0.0; n = 0
    for r in rows:
        try:
            raw = sb.get(r["image_url"], timeout=60).content
            im = Image.open(io.BytesIO(raw)).convert("RGB"); im.thumbnail((args.max_dim, args.max_dim))
            buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
            b64 = base64.b64encode(buf.getvalue()).decode()
            body = {
                "model": args.model, "max_tokens": 1024,
                "system": [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
                "messages": [{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                    {"type": "text", "text": "Analyze this frame per the schema."}]}],
            }
            t0 = time.time()
            resp = requests.post("https://api.anthropic.com/v1/messages",
                headers={"x-api-key": AK, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json=body, timeout=120)
            resp.raise_for_status(); j = resp.json()
            txt = "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text")
            u = j.get("usage", {})
            it, ot = u.get("input_tokens", 0), u.get("output_tokens", 0)
            cr = u.get("cache_read_input_tokens", 0); cw = u.get("cache_creation_input_tokens", 0)
            usd = (it*pin + cr*pcache + cw*pin*1.25 + ot*pout) / 1_000_000
            tot_usd += usd; n += 1
            try: v = json.loads(txt[txt.find("{"):txt.rfind("}")+1])
            except Exception: v = {"_parse_error": txt[:200]}
            v["image_id"] = r["id"]; v["vehicle_id"] = r["vehicle_id"]
            v["provenance"] = {"agent_model": args.model, "agent_tier": "lean-api",
                "extraction_method": "lean_messages_api", "harness": "lean-image-analyze.py",
                "agent_duration_ms": int((time.time()-t0)*1000),
                "agent_cost_cents": round(usd*100, 5), "input_tokens": it, "output_tokens": ot,
                "cache_read_input_tokens": cr, "max_dim": args.max_dim, "cost_basis": "metered_api"}
            sink.write(json.dumps(v) + "\n"); sink.flush()
        except Exception as e:
            print("ERR", r["id"][:8], str(e)[:100], file=sys.stderr)
    if args.sink: sink.close()
    print(f"lean-analyze: {n} images, ${tot_usd:.4f} total, ${ (tot_usd/n if n else 0):.5f}/image", file=sys.stderr)

ap = argparse.ArgumentParser()
ap.add_argument("--estimate", action="store_true")
ap.add_argument("--vehicle-id"); ap.add_argument("--limit", type=int, default=20)
ap.add_argument("--model", default="claude-haiku-4-5-20251001")
ap.add_argument("--max-dim", type=int, default=1024)
ap.add_argument("--sink")
a = ap.parse_args()
if a.estimate: estimate()
elif a.vehicle_id: run(a)
else: ap.error("need --estimate or --vehicle-id")
