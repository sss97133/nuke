"""
St Barth Publication Vision OCR — Modal GPU Server (vLLM)

Runs Qwen2.5-VL-7B on A10G GPU via vLLM for fast, cheap vision analysis.
Exposes Ollama-compatible API so the existing analysis script works unchanged.

Deploy:
  cd /Users/skylar/nuke && modal deploy scripts/stbarth/modal_vision_server.py

Logs:
  modal app logs stbarth-vision-ocr

Cost: ~$1.10/hr (A10G GPU). 41K pages @ ~2-5s/page ≈ ~$30-40 total
      vs $414 for Haiku API, or $0 but 11-17 days local.
"""

import modal
import os

MODEL_ID = "Qwen/Qwen2.5-VL-7B-Instruct-AWQ"

# ---------------------------------------------------------------------------
# Image: CUDA base + vLLM 0.8.3 + pre-download model weights
# ---------------------------------------------------------------------------
def _patch_vllm_rope():
    """Fix vLLM 0.8.3 + transformers 5.x rope_scaling conflict for Qwen2.5-VL.

    transformers 5.x adds 'rope_type' alongside legacy 'type' in rope_scaling
    configs. vLLM's patch_rope_scaling_dict rejects configs with both fields.
    We patch it to prefer the legacy 'type' field and remove 'rope_type'.
    """
    import site
    import glob

    # Find the vLLM config file
    patterns = [
        "/usr/local/lib/python*/site-packages/vllm/transformers_utils/config.py",
    ]
    for sp in site.getsitepackages():
        patterns.append(f"{sp}/vllm/transformers_utils/config.py")

    config_file = None
    for pattern in patterns:
        matches = glob.glob(pattern)
        if matches:
            config_file = matches[0]
            break

    if not config_file:
        print("[VISION-OCR] WARNING: Could not find vllm config.py to patch")
        return

    src = open(config_file).read()

    # Find and patch the function — actual signature has type annotations
    old = "def patch_rope_scaling_dict(rope_scaling: Dict[str, Any]) -> None:"
    new = """def patch_rope_scaling_dict(rope_scaling: Dict[str, Any]) -> None:
    # PATCHED: resolve rope_type/type coexistence for Qwen2.5-VL
    # transformers 5.x adds rope_type='default' alongside legacy type='mrope'.
    # Fix: copy the legacy type value to rope_type, remove the legacy field.
    if "rope_type" in rope_scaling and "type" in rope_scaling:
        rope_scaling["rope_type"] = rope_scaling.pop("type")
        return

def _original_patch_rope_scaling_dict(rope_scaling: Dict[str, Any]) -> None:"""

    if old in src:
        patched = src.replace(old, new, 1)
        open(config_file, "w").write(patched)

        # Delete .pyc cache so Python recompiles from patched source
        import pathlib
        cache_dir = pathlib.Path(config_file).parent / "__pycache__"
        if cache_dir.exists():
            for pyc in cache_dir.glob("config*.pyc"):
                pyc.unlink()
                print(f"[VISION-OCR] Deleted stale bytecode: {pyc}")

        # Verify the patch by importing and checking
        import importlib
        import vllm.transformers_utils.config as cfg
        importlib.reload(cfg)
        test_rs = {"rope_type": "default", "type": "mrope"}
        try:
            cfg.patch_rope_scaling_dict(test_rs)
            print(f"[VISION-OCR] Patch verified — rope_type={test_rs.get('rope_type')}, type={'type' not in test_rs}")
        except (ValueError, KeyError) as e:
            print(f"[VISION-OCR] Patch verification FAILED: {e}")

        print(f"[VISION-OCR] Patched {config_file} — rope_scaling conflict fix applied")
    else:
        # Dump context around 'patch_rope_scaling' to find the actual signature
        lines = src.splitlines()
        for i, line in enumerate(lines):
            if "patch_rope_scaling" in line and "def " in line:
                print(f"[VISION-OCR] Found at line {i}: {line.strip()}")
        # Also check for the ValueError
        for i, line in enumerate(lines):
            if "rope_type" in line and "type" in line:
                context = lines[max(0,i-2):i+3]
                print(f"[VISION-OCR] rope_type context at line {i}:")
                for cl in context:
                    print(f"  {cl}")
                break
        print(f"[VISION-OCR] WARNING: Could not find patch target in {config_file}")


def _download_model():
    """Cache model weights into the image layer, patch config for vLLM compat."""
    import json
    from huggingface_hub import snapshot_download
    print(f"[VISION-OCR] Downloading {MODEL_ID}...")
    path = snapshot_download(MODEL_ID)
    print(f"[VISION-OCR] {MODEL_ID} cached at {path}")

    # Fix rope_scaling conflict: transformers 5.x adds 'rope_type' alongside
    # the model's existing 'type' field, causing vLLM to reject the config.
    config_path = f"{path}/config.json"
    with open(config_path) as f:
        config = json.load(f)
    rope = config.get("rope_scaling", {})
    if "rope_type" in rope and "type" in rope:
        print(f"[VISION-OCR] Patching rope_scaling: removing 'rope_type' (was '{rope['rope_type']}'), keeping 'type' ('{rope['type']}')")
        del rope["rope_type"]
        config["rope_scaling"] = rope
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)
    print("[VISION-OCR] Config ready.")

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.11"
    )
    .entrypoint([])
    .pip_install([
        "vllm==0.8.3",
        "transformers>=4.51.0,<5.0.0",   # 5.x breaks vLLM tokenizer compat
        "autoawq",                        # AWQ quantization support
        "qwen-vl-utils",
        "Pillow",
        "fastapi[standard]",
        "huggingface_hub",
    ])
    .run_function(_patch_vllm_rope)
    .run_function(_download_model)
)

app = modal.App("stbarth-vision-ocr")

# ---------------------------------------------------------------------------
# Web endpoint — Ollama-compatible API on A10G GPU via vLLM
# ---------------------------------------------------------------------------
@app.function(
    image=image,
    gpu="A10G",
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    scaledown_window=120,         # shut down 2 min after last request
    timeout=600,                  # 10 min max per request
)
@modal.asgi_app()
def web():
    import asyncio
    import time
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    from vllm import LLM, SamplingParams

    api = FastAPI(title="St Barth Vision OCR")

    # ── Auth (same pattern as YONO sidecar) ──
    _TOKEN = os.environ.get("MODAL_SIDECAR_TOKEN", "")

    @api.middleware("http")
    async def auth_middleware(request: Request, call_next):
        if request.url.path in ("/health", "/api/tags"):
            return await call_next(request)
        if _TOKEN:
            auth_header = request.headers.get("Authorization", "")
            if auth_header != f"Bearer {_TOKEN}":
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)

    # ── Load model with vLLM at container startup ──
    print(f"[VISION-OCR] Loading {MODEL_ID} with vLLM...")
    t0 = time.time()
    llm = LLM(
        model=MODEL_ID,
        max_model_len=16384,
        quantization="awq",
        dtype="float16",
        limit_mm_per_prompt={"image": 1},
        gpu_memory_utilization=0.90,
        max_num_seqs=4,
        enforce_eager=True,
    )
    print(f"[VISION-OCR] Model loaded in {time.time() - t0:.1f}s")

    # Thread pool for synchronous vLLM calls
    _executor = ThreadPoolExecutor(max_workers=1)

    # ── Endpoints ──

    @api.get("/health")
    def health():
        return {
            "status": "ok",
            "model": MODEL_ID,
            "backend": "vllm",
        }

    @api.get("/api/tags")
    def tags():
        """Ollama-compatible model list — lets existing scripts do health checks."""
        return {"models": [
            {"name": "qwen2.5vl:7b", "size": 14_000_000_000},
            {"name": MODEL_ID, "size": 14_000_000_000},
        ]}

    @api.post("/api/generate")
    async def generate(request: Request):
        """Ollama-compatible generate endpoint.

        Accepts: { prompt, images: [base64], options: { temperature, num_predict } }
        Returns: { response, model, total_duration }
        """
        body = await request.json()
        prompt = body.get("prompt", "")
        images_b64 = body.get("images", [])
        options = body.get("options", {})
        temperature = options.get("temperature", 0.1)
        max_tokens = options.get("num_predict", 2048)

        t_start = time.time()

        # Build OpenAI-format messages (vLLM chat API)
        content = []
        for img_b64 in images_b64:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"},
            })
        content.append({"type": "text", "text": prompt})

        messages = [{"role": "user", "content": content}]
        sampling_params = SamplingParams(
            temperature=max(temperature, 0.01),
            max_tokens=max_tokens,
        )

        def _run_inference():
            outputs = llm.chat(messages, sampling_params=sampling_params)
            return outputs[0].outputs[0].text

        loop = asyncio.get_event_loop()
        output_text = await loop.run_in_executor(_executor, _run_inference)

        duration_s = time.time() - t_start

        return {
            "response": output_text,
            "model": MODEL_ID,
            "total_duration": int(duration_s * 1e9),  # nanoseconds (Ollama compat)
        }

    return api
