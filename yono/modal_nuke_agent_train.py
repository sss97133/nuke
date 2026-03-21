"""
Nuke Agent — Fine-tune LLM on Modal A100 with QLoRA + Telegram Dispatch

Trains a domain-specific LLM that knows:
- Nuke platform architecture (edge functions, pipelines, schemas)
- Vehicle data verification (provenance, VIN decode, modification detection)
- Collector vehicle domain knowledge (makes, models, pricing, market)

Sends live progress updates to Telegram via dispatch.

Pipeline:
    1. Export data:  modal run yono/export_nuke_training_data.py
    2. Train:        modal run yono/modal_nuke_agent_train.py
    3. Merge:        modal run yono/modal_nuke_agent_train.py --action merge --run-id <id>
    4. Export GGUF:  modal run yono/modal_nuke_agent_train.py --action export-gguf --run-id <id>
    5. Pull local:   ollama create nuke-agent -f yono/Modelfile.nuke-agent

Usage:
    modal run yono/modal_nuke_agent_train.py
    modal run yono/modal_nuke_agent_train.py --epochs 5 --batch-size 4 --model Qwen/Qwen3-8B
    modal run yono/modal_nuke_agent_train.py --action list
    modal run yono/modal_nuke_agent_train.py --action merge --run-id 20260320_...
    modal run yono/modal_nuke_agent_train.py --action export-gguf --run-id 20260320_...
"""

import modal
import os

app = modal.App("nuke-agent-train")

# Container image with all ML dependencies
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install([
        "transformers>=4.45.0,<5.0",
        "datasets",
        "peft>=0.12.0",
        "bitsandbytes>=0.43.0",
        "trl>=0.18.0",
        "accelerate>=1.0.0",
        "sentencepiece",
        "protobuf",
        "scipy",
    ])
)

# Separate image for GGUF export (needs llama.cpp)
gguf_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "build-essential", "cmake")
    .pip_install([
        "torch",
        "transformers>=4.45.0,<5.0",
        "sentencepiece",
        "protobuf",
        "huggingface_hub",
    ])
    .run_commands(
        "git clone https://github.com/ggerganov/llama.cpp /opt/llama.cpp",
        "cd /opt/llama.cpp && cmake -B build && cmake --build build --config Release -j$(nproc)",
        "pip install /opt/llama.cpp/gguf-py",
    )
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)


def _send_telegram(message: str):
    """Send a Telegram dispatch notification."""
    import urllib.request
    import json
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not bot_token or not chat_id:
        return
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    data = json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "Markdown"}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[dispatch] Telegram failed: {e}")


def dispatch(msg: str):
    """Print and send to Telegram."""
    print(msg)
    _send_telegram(msg)


@app.function(
    image=image,
    gpu="A100",
    timeout=86400,  # 24h
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    memory=65536,  # 64GB RAM
)
def train_nuke_agent(
    model_name: str = "Qwen/Qwen2.5-7B-Instruct",
    epochs: int = 3,
    batch_size: int = 2,
    gradient_accumulation: int = 16,
    learning_rate: float = 2e-4,
    lora_rank: int = 64,
    lora_alpha: int = 128,
    max_seq_length: int = 4096,
):
    """Train Nuke agent on A100 with QLoRA. Sends progress to Telegram."""
    import torch
    from datetime import datetime
    import json

    gpu_name = torch.cuda.get_device_name()
    vram = f"{torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB"

    dispatch(
        f"🧠 *Nuke Agent Training Started*\n"
        f"Model: `{model_name}`\n"
        f"GPU: {gpu_name} ({vram})\n"
        f"Config: {epochs}ep × batch {batch_size} × grad_accum {gradient_accumulation}\n"
        f"LoRA: rank={lora_rank}, alpha={lora_alpha}\n"
        f"Time: {datetime.now().strftime('%H:%M:%S')}"
    )

    # Check training data exists
    train_path = "/data/nuke-agent/train.jsonl"
    val_path = "/data/nuke-agent/val.jsonl"

    if not os.path.exists(train_path):
        raise FileNotFoundError(
            f"Training data not found at {train_path}. "
            "Upload with: modal volume put yono-data training-data/nuke-agent/train.jsonl nuke-agent/train.jsonl"
        )

    # Count training examples
    with open(train_path) as f:
        train_count = sum(1 for _ in f)
    val_count = 0
    if os.path.exists(val_path):
        with open(val_path) as f:
            val_count = sum(1 for _ in f)

    dispatch(f"📋 Training data: {train_count:,} train, {val_count:,} val")

    # ---- Load model with 4-bit quantization ----
    dispatch(f"⏳ Loading `{model_name}` with 4-bit quantization...")
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from datasets import load_dataset

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
        dtype=torch.bfloat16,
    )

    model = prepare_model_for_kbit_training(model)

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    dispatch(f"✅ Model loaded: {total:,} params, {trainable:,} trainable ({100*trainable/total:.2f}%)")

    # ---- Configure LoRA ----
    lora_config = LoraConfig(
        r=lora_rank,
        lora_alpha=lora_alpha,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )

    model = get_peft_model(model, lora_config)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    dispatch(f"🔧 LoRA applied: {trainable:,} trainable params ({100*trainable/total:.2f}%)")

    # ---- Load and format dataset ----
    dataset = load_dataset("json", data_files={
        "train": train_path,
        "validation": val_path if os.path.exists(val_path) else train_path,
    })

    def format_chat(example):
        """Format messages into Qwen chat template."""
        messages = example["messages"]
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    dataset = dataset.map(format_chat, remove_columns=dataset["train"].column_names)

    def tokenize(example):
        result = tokenizer(
            example["text"],
            truncation=True,
            max_length=max_seq_length,
            padding="max_length",
        )
        result["labels"] = result["input_ids"].copy()
        return result

    tokenized = dataset.map(tokenize, remove_columns=["text"])

    dispatch(f"📊 Tokenized: {len(tokenized['train']):,} train, {len(tokenized['validation']):,} val")

    # ---- Training ----
    dispatch("🚀 *Training started!* Updates every 100 steps...")
    from transformers import TrainingArguments, Trainer, TrainerCallback

    class TelegramProgressCallback(TrainerCallback):
        """Send training progress to Telegram every N steps."""
        def __init__(self, notify_every=100):
            self.notify_every = notify_every
            self.start_time = None

        def on_train_begin(self, args, state, control, **kwargs):
            import time
            self.start_time = time.time()

        def on_log(self, args, state, control, logs=None, **kwargs):
            import time
            if state.global_step % self.notify_every != 0 or state.global_step == 0:
                return
            elapsed = time.time() - self.start_time if self.start_time else 0
            loss = logs.get("loss")
            lr = logs.get("learning_rate")
            epoch = logs.get("epoch")
            loss_str = f"{loss:.4f}" if isinstance(loss, (int, float)) else str(loss)
            lr_str = f"{lr:.2e}" if isinstance(lr, (int, float)) else str(lr)
            epoch_str = f"{epoch:.1f}" if isinstance(epoch, (int, float)) else str(epoch)
            dispatch(
                f"Step {state.global_step}/{state.max_steps} "
                f"| Epoch {epoch_str}/{args.num_train_epochs} "
                f"| Loss: {loss_str} | LR: {lr_str} "
                f"| {elapsed/60:.0f}min elapsed"
            )

        def on_evaluate(self, args, state, control, metrics=None, **kwargs):
            if metrics:
                eval_loss = metrics.get("eval_loss")
                el_str = f"{eval_loss:.4f}" if isinstance(eval_loss, (int, float)) else str(eval_loss)
                dispatch(f"Eval step {state.global_step}: loss={el_str}")

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = f"/data/nuke-agent-runs/{run_id}"

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        gradient_accumulation_steps=gradient_accumulation,
        learning_rate=learning_rate,
        weight_decay=0.01,
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=100,
        save_strategy="steps",
        save_steps=50,
        save_total_limit=3,
        bf16=True,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        optim="paged_adamw_8bit",
        report_to="none",
        dataloader_pin_memory=True,
        remove_unused_columns=False,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["validation"],
        callbacks=[TelegramProgressCallback(notify_every=100)],
    )

    # Train
    train_result = trainer.train()

    # Save final model
    final_path = f"{output_dir}/final"
    trainer.save_model(final_path)
    tokenizer.save_pretrained(final_path)

    # Save training metadata
    metadata = {
        "run_id": run_id,
        "base_model": model_name,
        "epochs": epochs,
        "batch_size": batch_size,
        "gradient_accumulation": gradient_accumulation,
        "learning_rate": learning_rate,
        "lora_rank": lora_rank,
        "lora_alpha": lora_alpha,
        "max_seq_length": max_seq_length,
        "train_examples": len(tokenized["train"]),
        "val_examples": len(tokenized["validation"]),
        "train_loss": train_result.training_loss,
        "train_runtime_seconds": train_result.metrics.get("train_runtime", 0),
        "completed_at": datetime.now().isoformat(),
    }
    with open(f"{output_dir}/metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    # Commit volume
    volume.commit()

    runtime_min = train_result.metrics.get("train_runtime", 0) / 60
    dispatch(
        f"🏁 *Nuke Agent Training Complete!*\n\n"
        f"Run: `{run_id}`\n"
        f"Loss: {train_result.training_loss:.4f}\n"
        f"Runtime: {runtime_min:.1f} min\n"
        f"Examples: {len(tokenized['train']):,}\n\n"
        f"*Next steps:*\n"
        f"1. Merge: `modal run yono/modal_nuke_agent_train.py --action merge --run-id {run_id}`\n"
        f"2. Export GGUF: `modal run yono/modal_nuke_agent_train.py --action export-gguf --run-id {run_id}`"
    )

    return metadata


@app.function(
    image=image,
    gpu="A100",
    timeout=7200,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    memory=65536,
)
def merge_and_export(run_id: str, model_name: str = "Qwen/Qwen2.5-7B-Instruct", checkpoint: str = ""):
    """Merge LoRA weights and export full model for serving."""
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import PeftModel

    # Try final/ first, then checkpoint, then latest checkpoint
    run_dir = f"/data/nuke-agent-runs/{run_id}/final"
    if checkpoint:
        run_dir = f"/data/nuke-agent-runs/{run_id}/{checkpoint}"
    elif not os.path.exists(run_dir):
        # Find latest checkpoint
        run_base = f"/data/nuke-agent-runs/{run_id}"
        checkpoints = sorted([d for d in os.listdir(run_base) if d.startswith("checkpoint-")])
        if checkpoints:
            run_dir = f"{run_base}/{checkpoints[-1]}"
            dispatch(f"No final/ dir, using latest checkpoint: {checkpoints[-1]}")

    output_dir = f"/data/nuke-agent-merged/{run_id}"

    dispatch(f"Merging LoRA weights\nRun: {run_id}\nAdapter: {run_dir}\nBase: {model_name}")

    base_model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
    )

    model = PeftModel.from_pretrained(base_model, run_dir)
    model = model.merge_and_unload()

    os.makedirs(output_dir, exist_ok=True)
    model.save_pretrained(output_dir)

    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    tokenizer.save_pretrained(output_dir)

    volume.commit()
    dispatch(f"✅ *Merge complete!*\nOutput: `{output_dir}`\nNext: `--action export-gguf --run-id {run_id}`")
    return {"output_dir": output_dir}


@app.function(
    image=gguf_image,
    gpu="A100",
    timeout=7200,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    memory=65536,
)
def export_gguf(run_id: str, quantization: str = "Q4_K_M"):
    """Export merged model to GGUF format for Ollama.

    After export, download from Modal volume and create Ollama model:
        modal volume get yono-data nuke-agent-gguf/<run_id>/nuke-agent-Q4_K_M.gguf ./
        ollama create nuke-agent -f yono/Modelfile.nuke-agent
    """
    dispatch(f"📦 *Exporting GGUF*\nRun: `{run_id}`\nQuantization: {quantization}")

    merged_dir = f"/data/nuke-agent-merged/{run_id}"
    if not os.path.exists(merged_dir):
        dispatch(f"❌ Merged model not found at `{merged_dir}`. Run merge first.")
        raise FileNotFoundError(f"Merged model not found: {merged_dir}")

    gguf_dir = f"/data/nuke-agent-gguf/{run_id}"
    os.makedirs(gguf_dir, exist_ok=True)

    import subprocess

    # Step 1: Convert HF model to GGUF fp16
    fp16_path = f"{gguf_dir}/nuke-agent-fp16.gguf"
    dispatch("⏳ Converting to GGUF fp16...")
    result = subprocess.run(
        ["python3", "/opt/llama.cpp/convert_hf_to_gguf.py",
         merged_dir, "--outfile", fp16_path, "--outtype", "f16"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        dispatch(f"❌ GGUF conversion failed:\n```\n{result.stderr[:500]}\n```")
        raise RuntimeError(f"GGUF conversion failed: {result.stderr}")

    fp16_size = os.path.getsize(fp16_path) / 1e9
    dispatch(f"✅ fp16 GGUF: {fp16_size:.1f} GB")

    # Step 2: Quantize to target format
    quant_path = f"{gguf_dir}/nuke-agent-{quantization}.gguf"
    dispatch(f"⏳ Quantizing to {quantization}...")
    result = subprocess.run(
        ["/opt/llama.cpp/build/bin/llama-quantize", fp16_path, quant_path, quantization],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        dispatch(f"❌ Quantization failed:\n```\n{result.stderr[:500]}\n```")
        raise RuntimeError(f"Quantization failed: {result.stderr}")

    quant_size = os.path.getsize(quant_path) / 1e9
    dispatch(
        f"✅ *GGUF Export Complete!*\n\n"
        f"File: `nuke-agent-{quantization}.gguf` ({quant_size:.1f} GB)\n"
        f"Location: `nuke-agent-gguf/{run_id}/`\n\n"
        f"*Download to local:*\n"
        f"```\nmodal volume get yono-data nuke-agent-gguf/{run_id}/nuke-agent-{quantization}.gguf /Volumes/NukePortable/ollama-models/\n```\n\n"
        f"*Create Ollama model:*\n"
        f"```\nollama create nuke-agent -f yono/Modelfile.nuke-agent\n```"
    )

    # Clean up fp16 intermediate
    os.remove(fp16_path)
    volume.commit()

    return {"gguf_path": quant_path, "size_gb": quant_size}


@app.function(
    image=image,
    volumes={"/data": volume},
)
def list_agent_runs():
    """List all Nuke agent training runs."""
    import json
    runs_dir = "/data/nuke-agent-runs"
    if not os.path.exists(runs_dir):
        return []

    runs = []
    for run in sorted(os.listdir(runs_dir)):
        meta_path = f"{runs_dir}/{run}/metadata.json"
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
            runs.append(meta)
    return runs


@app.local_entrypoint()
def main(
    action: str = "train",
    model: str = "Qwen/Qwen2.5-7B-Instruct",
    epochs: int = 3,
    batch_size: int = 2,
    lora_rank: int = 64,
    run_id: str = "",
    quantization: str = "Q4_K_M",
):
    """
    Nuke Agent Training Pipeline on Modal

    Usage:
        modal run yono/modal_nuke_agent_train.py
        modal run yono/modal_nuke_agent_train.py --action train --model Qwen/Qwen3-8B --epochs 5
        modal run yono/modal_nuke_agent_train.py --action list
        modal run yono/modal_nuke_agent_train.py --action merge --run-id 20260320_...
        modal run yono/modal_nuke_agent_train.py --action export-gguf --run-id 20260320_...
        modal run yono/modal_nuke_agent_train.py --action full --model Qwen/Qwen3-8B --epochs 5
    """
    import json

    if action == "train":
        print(f"Starting Nuke Agent training on {model}...")
        result = train_nuke_agent.remote(
            model_name=model,
            epochs=epochs,
            batch_size=batch_size,
            lora_rank=lora_rank,
        )
        print(f"\nResult: {json.dumps(result, indent=2)}" if result else "Training failed")

    elif action == "list":
        runs = list_agent_runs.remote()
        print("Nuke Agent training runs:")
        for r in runs:
            loss = r.get("train_loss", 0)
            loss_str = f"{loss:.4f}" if isinstance(loss, (int, float)) else str(loss)
            print(f"  {r.get('run_id')}: loss={loss_str}, "
                  f"model={r.get('base_model', '?')}, "
                  f"examples={r.get('train_examples', '?')}, "
                  f"epochs={r.get('epochs', '?')}")

    elif action == "merge":
        if not run_id:
            print("Error: --run-id required for merge action")
            return
        result = merge_and_export.remote(run_id=run_id, model_name=model)
        print(f"Merged: {result}")

    elif action == "export-gguf":
        if not run_id:
            print("Error: --run-id required for export-gguf action")
            return
        result = export_gguf.remote(run_id=run_id, quantization=quantization)
        print(f"GGUF export: {json.dumps(result, indent=2)}")

    elif action == "full":
        # Full pipeline: train → merge → export GGUF
        print(f"Full pipeline: train → merge → GGUF export")
        print(f"Model: {model}, Epochs: {epochs}")

        # Train
        train_result = train_nuke_agent.remote(
            model_name=model,
            epochs=epochs,
            batch_size=batch_size,
            lora_rank=lora_rank,
        )
        if not train_result:
            print("Training failed!")
            return

        rid = train_result["run_id"]
        print(f"\nTraining complete: {rid}")

        # Merge
        merge_result = merge_and_export.remote(run_id=rid, model_name=model)
        print(f"Merge complete: {merge_result}")

        # GGUF
        gguf_result = export_gguf.remote(run_id=rid, quantization=quantization)
        print(f"GGUF export: {json.dumps(gguf_result, indent=2)}")

    else:
        print(f"Unknown action: {action}")
        print("Valid actions: train, list, merge, export-gguf, full")
