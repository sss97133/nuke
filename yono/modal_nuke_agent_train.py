"""
Nuke Agent — Fine-tune Qwen2.5-7B on Modal A100 with QLoRA

Trains a domain-specific LLM that knows:
- Nuke platform architecture (edge functions, pipelines, schemas)
- Vehicle data verification (provenance, VIN decode, modification detection)
- Collector vehicle domain knowledge (makes, models, pricing, market)

Usage:
    modal run yono/modal_nuke_agent_train.py
    modal run yono/modal_nuke_agent_train.py --epochs 3 --batch-size 4
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

volume = modal.Volume.from_name("yono-data", create_if_missing=True)


@app.function(
    image=image,
    gpu="A100",
    timeout=86400,  # 24h
    volumes={"/data": volume},
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
    """Train Nuke agent on A100 with QLoRA."""
    import torch
    from datetime import datetime
    import json

    print("=" * 60)
    print("NUKE AGENT TRAINING")
    print(f"Base model: {model_name}")
    print(f"GPU: {torch.cuda.get_device_name()}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    print(f"Config: epochs={epochs}, batch={batch_size}, grad_accum={gradient_accumulation}")
    print(f"LoRA: rank={lora_rank}, alpha={lora_alpha}")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 60)

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

    print(f"\nTraining data: {train_count} examples")
    print(f"Validation data: {val_count} examples")

    # ---- Load model with 4-bit quantization ----
    print("\nLoading model with 4-bit quantization...")
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

    # Print model size
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"Model loaded: {total:,} params, {trainable:,} trainable ({100*trainable/total:.2f}%)")

    # ---- Configure LoRA ----
    print("\nConfiguring LoRA...")
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
    print(f"LoRA applied: {trainable:,} trainable params ({100*trainable/total:.2f}%)")

    # ---- Load and format dataset ----
    print("\nLoading dataset...")
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

    print(f"Train examples: {len(tokenized['train'])}")
    print(f"Val examples: {len(tokenized['validation'])}")

    # ---- Training ----
    print("\nStarting training...")
    from transformers import TrainingArguments, Trainer

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

    print("\n" + "=" * 60)
    print("TRAINING COMPLETE")
    print(f"Output: {output_dir}")
    print(f"Loss: {train_result.training_loss:.4f}")
    print(f"Runtime: {train_result.metrics.get('train_runtime', 0):.0f}s")
    print("=" * 60)

    return metadata


@app.function(
    image=image,
    gpu="A100",
    timeout=7200,
    volumes={"/data": volume},
    memory=65536,
)
def merge_and_export(run_id: str, model_name: str = "Qwen/Qwen2.5-7B-Instruct"):
    """Merge LoRA weights and export full model for serving."""
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import PeftModel

    run_dir = f"/data/nuke-agent-runs/{run_id}/final"
    output_dir = f"/data/nuke-agent-merged/{run_id}"

    print(f"Loading base model: {model_name}")
    base_model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
    )

    print(f"Loading LoRA adapter: {run_dir}")
    model = PeftModel.from_pretrained(base_model, run_dir)

    print("Merging weights...")
    model = model.merge_and_unload()

    print(f"Saving merged model to: {output_dir}")
    os.makedirs(output_dir, exist_ok=True)
    model.save_pretrained(output_dir)

    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    tokenizer.save_pretrained(output_dir)

    volume.commit()
    print("Done! Merged model saved.")
    return {"output_dir": output_dir}


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
    epochs: int = 3,
    batch_size: int = 2,
    lora_rank: int = 64,
    run_id: str = "",
):
    """
    Nuke Agent Training on Modal

    Usage:
        modal run yono/modal_nuke_agent_train.py
        modal run yono/modal_nuke_agent_train.py --action train --epochs 3
        modal run yono/modal_nuke_agent_train.py --action list
        modal run yono/modal_nuke_agent_train.py --action merge --run-id 20260305_...
    """
    if action == "train":
        print("Starting Nuke Agent training...")
        result = train_nuke_agent.remote(
            epochs=epochs,
            batch_size=batch_size,
            lora_rank=lora_rank,
        )
        import json
        print(f"\nResult: {json.dumps(result, indent=2)}" if result else "Training failed")

    elif action == "list":
        runs = list_agent_runs.remote()
        print("Nuke Agent training runs:")
        for r in runs:
            print(f"  {r.get('run_id')}: loss={r.get('train_loss', '?'):.4f}, "
                  f"examples={r.get('train_examples', '?')}, "
                  f"epochs={r.get('epochs', '?')}")

    elif action == "merge":
        if not run_id:
            print("Error: --run-id required for merge action")
            return
        result = merge_and_export.remote(run_id=run_id)
        print(f"Merged: {result}")
