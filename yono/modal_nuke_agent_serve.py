"""
Nuke Agent — Serve fine-tuned Qwen2.5-7B on Modal

OpenAI-compatible chat API for the domain-specific Nuke agent.

Deploy:
    modal deploy yono/modal_nuke_agent_serve.py

Get URL:
    modal app show nuke-agent-serve

CLI usage (after deploy):
    npm run nuke:chat
    npm run nuke:ask -- "What makes have the most vehicles?"
"""

import modal
import os

app = modal.App("nuke-agent-serve")

volume = modal.Volume.from_name("yono-data", create_if_missing=True)

SYSTEM_PROMPT = (
    "You are Nuke Agent, the AI assistant for the Nuke vehicle data platform. "
    "You have deep knowledge of collector vehicles, auction markets, data pipelines, "
    "and the Nuke platform architecture. Be concise, accurate, and actionable."
)


def _download_base_model():
    """Pre-download Qwen2.5-7B-Instruct into the image cache."""
    from transformers import AutoTokenizer, AutoModelForCausalLM
    import torch

    model_name = "Qwen/Qwen2.5-7B-Instruct"
    print(f"[Nuke Agent] Downloading {model_name}...")
    AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    )
    print("[Nuke Agent] Base model cached.")


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
    .run_function(_download_base_model)
)


@app.cls(
    image=image,
    gpu="A100",
    timeout=3600,
    volumes={"/data": volume},
    memory=65536,
    allow_concurrent_inputs=8,
    container_idle_timeout=300,
)
class NukeAgent:
    model = None
    tokenizer = None

    @modal.enter()
    def load_model(self):
        import torch
        from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
        from peft import PeftModel

        base_name = "Qwen/Qwen2.5-7B-Instruct"

        # Find latest training run
        runs_dir = "/data/nuke-agent-runs"
        merged_dir = "/data/nuke-agent-merged"
        adapter_path = None

        # Prefer merged model if available
        if os.path.exists(merged_dir):
            runs = sorted(os.listdir(merged_dir), reverse=True)
            if runs:
                merged_path = f"{merged_dir}/{runs[0]}"
                if os.path.exists(f"{merged_path}/config.json"):
                    print(f"[Nuke Agent] Loading merged model: {merged_path}")
                    self.tokenizer = AutoTokenizer.from_pretrained(merged_path, trust_remote_code=True)
                    self.model = AutoModelForCausalLM.from_pretrained(
                        merged_path,
                        torch_dtype=torch.bfloat16,
                        device_map="auto",
                        trust_remote_code=True,
                    )
                    print("[Nuke Agent] Merged model loaded.")
                    return

        # Fall back to base + LoRA adapter
        if os.path.exists(runs_dir):
            runs = sorted(os.listdir(runs_dir), reverse=True)
            for run in runs:
                final_path = f"{runs_dir}/{run}/final"
                if os.path.exists(f"{final_path}/adapter_config.json"):
                    adapter_path = final_path
                    break

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )

        self.tokenizer = AutoTokenizer.from_pretrained(base_name, trust_remote_code=True)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        base_model = AutoModelForCausalLM.from_pretrained(
            base_name,
            quantization_config=bnb_config,
            device_map="auto",
            trust_remote_code=True,
        )

        if adapter_path:
            print(f"[Nuke Agent] Loading LoRA adapter: {adapter_path}")
            self.model = PeftModel.from_pretrained(base_model, adapter_path)
            print("[Nuke Agent] Adapter loaded.")
        else:
            print("[Nuke Agent] No fine-tuned adapter found, using base model.")
            self.model = base_model

        self.model.eval()

    @modal.method()
    def chat(self, messages: list[dict], max_tokens: int = 1024, temperature: float = 0.7) -> str:
        import torch

        # Prepend system prompt if not present
        if not messages or messages[0].get("role") != "system":
            messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

        text = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = self.tokenizer(text, return_tensors="pt").to(self.model.device)

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                temperature=temperature,
                top_p=0.9,
                do_sample=temperature > 0,
                repetition_penalty=1.1,
            )

        # Decode only the new tokens
        new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
        return self.tokenizer.decode(new_tokens, skip_special_tokens=True)

    @modal.web_endpoint(method="POST")
    def api_chat(self, request: dict) -> dict:
        """OpenAI-compatible /chat endpoint."""
        messages = request.get("messages", [])
        max_tokens = request.get("max_tokens", 1024)
        temperature = request.get("temperature", 0.7)

        response = self.chat.local(messages, max_tokens, temperature)

        return {
            "choices": [{
                "message": {"role": "assistant", "content": response},
                "finish_reason": "stop",
            }],
            "model": "nuke-agent-qwen2.5-7b",
        }

    @modal.web_endpoint(method="GET")
    def health(self) -> dict:
        """Health check."""
        return {
            "status": "ok",
            "model": "nuke-agent-qwen2.5-7b",
            "has_adapter": hasattr(self.model, "peft_config") if self.model else False,
        }


@app.local_entrypoint()
def main(question: str = ""):
    """Quick test: modal run yono/modal_nuke_agent_serve.py --question 'What is YONO?'"""
    agent = NukeAgent()
    if question:
        response = agent.chat.remote([{"role": "user", "content": question}])
        print(response)
    else:
        print("Nuke Agent is ready. Use --question to ask something.")
        print("Deploy with: modal deploy yono/modal_nuke_agent_serve.py")
