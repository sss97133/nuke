"""
LLM Inference Server on Modal — Qwen2.5-7B for batch extraction

Serves an OpenAI-compatible API on a T4 GPU using transformers.
Our scripts can call this as --provider modal.

Cost: T4 = $0.59/hr. $50 budget = ~85 hours = ~25K+ extractions.

Deploy:
    cd /Users/skylar/nuke && modal deploy yono/modal_vllm_serve.py

Get URL:
    modal app show nuke-vllm

Test:
    curl <url>/health
    curl -X POST <url>/v1/chat/completions -H "Content-Type: application/json" \
      -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
"""

import modal

app = modal.App("nuke-vllm")

MODEL_ID = "Qwen/Qwen2.5-7B-Instruct"
MODEL_REVISION = "main"

def _download_model():
    """Download model weights at image build time."""
    from huggingface_hub import snapshot_download
    snapshot_download(MODEL_ID, revision=MODEL_REVISION)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install([
        "transformers>=4.45.0",
        "accelerate>=1.0.0",
        "bitsandbytes>=0.43.0",
        "sentencepiece",
        "protobuf",
        "fastapi[standard]",
        "huggingface_hub",
        "hf_transfer",
    ])
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .run_function(_download_model)
)

MINUTES = 60


@app.function(
    image=image,
    gpu="T4",
    timeout=20 * MINUTES,
    scaledown_window=5 * MINUTES,
    min_containers=0,
    max_containers=2,  # 2 containers for concurrent mining + extraction
)
@modal.asgi_app()
def serve():
    import time
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    from fastapi.middleware.cors import CORSMiddleware

    api = FastAPI(title="Nuke LLM Server")
    api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    started_at = time.time()
    print(f"[LLM] Loading {MODEL_ID} with 4-bit quantization...")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
    )
    model.eval()

    load_time = time.time() - started_at
    print(f"[LLM] Model loaded in {load_time:.1f}s")

    @api.get("/health")
    def health():
        return {
            "status": "ok",
            "model": MODEL_ID,
            "uptime_s": round(time.time() - started_at),
            "load_time_s": round(load_time, 1),
            "gpu": torch.cuda.get_device_name() if torch.cuda.is_available() else None,
        }

    @api.get("/v1/models")
    def list_models():
        return {"data": [{"id": "qwen2.5-7b", "object": "model"}]}

    @api.post("/v1/chat/completions")
    async def chat_completions(request: Request):
        body = await request.json()
        messages = body.get("messages", [])
        max_tokens = min(body.get("max_tokens", 2048), 4096)
        temperature = body.get("temperature", 0.1)

        if not messages:
            return JSONResponse({"error": "messages required"}, status_code=400)

        t0 = time.perf_counter()

        text = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
        )
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=6144).to(model.device)
        input_len = inputs["input_ids"].shape[1]

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                temperature=max(temperature, 0.01),
                do_sample=temperature > 0,
                top_p=0.9 if temperature > 0 else None,
                repetition_penalty=1.05,
                pad_token_id=tokenizer.pad_token_id,
            )

        new_tokens = outputs[0][input_len:]
        response_text = tokenizer.decode(new_tokens, skip_special_tokens=True)
        completion_tokens = len(new_tokens)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        return {
            "id": f"chatcmpl-modal",
            "object": "chat.completion",
            "model": "qwen2.5-7b",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": response_text},
                "finish_reason": "stop",
            }],
            "usage": {
                "prompt_tokens": input_len,
                "completion_tokens": completion_tokens,
                "total_tokens": input_len + completion_tokens,
            },
            "_meta": {
                "elapsed_ms": round(elapsed_ms),
                "tokens_per_sec": round(completion_tokens / (elapsed_ms / 1000), 1) if elapsed_ms > 0 else 0,
            },
        }

    return api
