# Field Note: Why Standalone GPU Workers Cost 10x More Than HTTP Serving

**Date**: 2026-03-20
**Context**: Building `modal_description_discovery.py` to clear 235K description backlog
**Cost of learning this**: $13.70 (1,000 vehicle test run)

---

## What Happened

Built a Modal app that loads Qwen2.5-7B directly in each worker container using `transformers.AutoModelForCausalLM` + `model.generate()`. Ran 1,000 vehicles across 10 T4 containers. Cost: $13.70. Extrapolated to 235K: $3,220.

The existing approach — JS script calling the Modal vLLM HTTP server (`modal_vllm_serve.py`) with 8 parallel requests — processes the same work for ~$1.20/1K.

**10x cost difference for the same model on the same GPU.**

## Why

`transformers.generate()` processes one sequence at a time. Each container gets one request, generates one response (~20-50s), then takes the next. 10 containers = 10 concurrent generations. That's it.

The vLLM HTTP server (or any proper inference server) batches multiple requests and shares the KV-cache across concurrent generations. 2 containers handling 8 concurrent requests each = 16 concurrent generations, with much higher GPU utilization because the memory bandwidth is shared.

The difference is not the model or the GPU. It's **inference scheduling**. `generate()` is a synchronous call that monopolizes the GPU for one request. Inference servers like vLLM, TGI, or llama.cpp with batching multiplex the GPU across requests.

## The Rule

**Never use `transformers.generate()` in production batch workloads.** It's fine for testing, prototyping, and single-request scenarios. For anything over 100 items, use an inference server (vLLM, TGI, or at minimum, a FastAPI wrapper with request queuing).

The standalone worker pattern IS useful for non-LLM GPU work (image classification, GLiNER NER extraction, model training) where each item is truly independent and quick. For LLM text generation, always go through a batching server.

## What Survived

The `modal_description_discovery.py` file is still useful as a self-contained batch tool for smaller runs where you don't want to spin up the vLLM server. But for the 235K backlog, the JS script + vLLM HTTP server is the right architecture.
