"""
Nuke Agent LLM Server on Modal — Qwen2.5-7B + LoRA

Serves the fine-tuned Nuke vehicle intelligence agent.
Uses T4 GPU for 4-bit quantized inference (~4GB VRAM).

Deploy:
    modal deploy yono/modal_serve_llm.py

Get URL:
    modal app show nuke-agent-serve

Endpoints:
    GET  /health
    POST /chat    { messages: [{role, content}], max_tokens?, temperature? }
"""

import modal
from pathlib import Path

app = modal.App("nuke-agent-serve")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install([
        "transformers>=4.45.0,<5.0",
        "peft>=0.12.0",
        "bitsandbytes>=0.43.0",
        "accelerate>=1.0.0",
        "sentencepiece",
        "protobuf",
        "fastapi[standard]",
        "uvicorn",
    ])
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)


def _find_latest_run() -> str | None:
    """Find the latest completed LLM training run on the volume."""
    import os
    runs_dir = "/data/nuke-agent-runs"
    if not os.path.exists(runs_dir):
        return None

    runs = sorted(os.listdir(runs_dir), reverse=True)
    for run in runs:
        final_path = f"{runs_dir}/{run}/final"
        if os.path.exists(final_path) and os.path.exists(f"{final_path}/adapter_config.json"):
            return final_path
    return None


@app.function(
    image=image,
    gpu="T4",
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    min_containers=0,
    scaledown_window=300,  # Keep warm 5 min
    timeout=120,
)
@modal.asgi_app()
def fastapi_app():
    import json
    import os
    import time

    import torch
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    from peft import PeftModel

    api = FastAPI(title="Nuke Agent LLM Server")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Auth middleware
    _SIDECAR_TOKEN = os.environ.get("MODAL_SIDECAR_TOKEN", "")

    @api.middleware("http")
    async def auth_middleware(request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        if not _SIDECAR_TOKEN:
            return await call_next(request)
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {_SIDECAR_TOKEN}":
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)

    # Load model
    BASE_MODEL = "Qwen/Qwen2.5-7B-Instruct"
    model = None
    tokenizer = None
    adapter_path = None
    load_error = None
    started_at = time.time()

    try:
        print("[NUKE-LLM] Loading base model with 4-bit quantization...")
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )

        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            quantization_config=bnb_config,
            device_map="auto",
            trust_remote_code=True,
        )

        # Try to load fine-tuned LoRA adapter
        adapter_path = _find_latest_run()
        if adapter_path:
            print(f"[NUKE-LLM] Loading LoRA adapter from {adapter_path}")
            model = PeftModel.from_pretrained(model, adapter_path)
            print("[NUKE-LLM] LoRA adapter loaded.")
        else:
            print("[NUKE-LLM] No fine-tuned adapter found. Using base model.")

        model.eval()
        print("[NUKE-LLM] Model ready.")

    except Exception as e:
        load_error = str(e)
        print(f"[NUKE-LLM] Model load failed: {e}")

    # System prompt for the Nuke agent
    SYSTEM_PROMPT = """You are the Nuke Vehicle Intelligence Agent. You are an expert in collector vehicles, classic cars, and the automotive market.

Your capabilities:
- Deep vehicle analysis (make, model, year identification and market context)
- Comparable sales analysis with real auction data
- Condition assessment from descriptions and photos
- Modification detection and impact on value
- "What would it take" upgrade analysis
- Market positioning and pricing intelligence

When analyzing vehicles:
1. Identify the exact Y/M/M and its significance
2. Compare to similar vehicles that have sold recently
3. Assess condition based on available evidence
4. Provide actionable insights about value and potential

Be specific with numbers, dates, and sources. Reference real auction platforms (BaT, Cars & Bids, Mecum, RM Sotheby's). Give ranges, not single-point estimates."""

    @api.get("/health")
    def health():
        return {
            "status": "ok" if model is not None else "error",
            "model": BASE_MODEL,
            "adapter": adapter_path,
            "has_lora": adapter_path is not None,
            "error": load_error,
            "uptime_s": round(time.time() - started_at, 1),
            "gpu": torch.cuda.get_device_name() if torch.cuda.is_available() else None,
        }

    @api.post("/chat")
    async def chat(body: dict):
        """Chat with the Nuke Vehicle Intelligence Agent."""
        if model is None:
            return JSONResponse(
                {"error": "Model not loaded", "detail": load_error},
                status_code=503,
            )

        messages = body.get("messages", [])
        max_tokens = body.get("max_tokens", 2048)
        temperature = body.get("temperature", 0.7)

        if not messages:
            return {"error": "Missing messages"}

        # Prepend system prompt if not already present
        if not any(m.get("role") == "system" for m in messages):
            messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

        t0 = time.perf_counter()

        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

        inputs = tokenizer(text, return_tensors="pt").to(model.device)

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                temperature=temperature if temperature > 0 else None,
                do_sample=temperature > 0,
                top_p=0.9 if temperature > 0 else None,
                repetition_penalty=1.1,
            )

        # Decode only the new tokens (exclude input)
        new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
        response_text = tokenizer.decode(new_tokens, skip_special_tokens=True)

        ms = round((time.perf_counter() - t0) * 1000, 1)
        tokens_generated = len(new_tokens)

        return {
            "response": response_text,
            "tokens": tokens_generated,
            "ms": ms,
            "tokens_per_second": round(tokens_generated / (ms / 1000), 1) if ms > 0 else 0,
            "model": BASE_MODEL,
            "has_lora": adapter_path is not None,
        }

    return api
