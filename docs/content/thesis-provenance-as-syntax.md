# Provenance Is a Type, Not a Layer

An AI agent told me a 1977 Blazer was worth $85,100. There was no source attached to that number. For a second, I believed it. That second is the entire failure.

The number was real in the sense that it sat in a database column. But it was written from nowhere, by no one, with no method and no timestamp. And my dashboard code picked `current_value ?? purchase_price`, which meant the *unowned* number beat the one field that actually had a pipeline behind it. The architecture inverted trust by default. The agent didn't lie. The system let a sourceless fact be expressible, and so it got expressed.

## The problem is not behavior

The standard reading is: the model needs to cite better, or we need a detector. GPTZero coined "vibe citing" after big-name firms shipped reports stitched from fabricated references. One KPMG report had 5 of 45 citations correct, verified by the *Financial Times* ([The Register, 2026](https://www.theregister.com/ai-and-ml/2026/06/12/kpmgs-ai-report-turns-into-a-demo-of-ai-hallucinations/5255029)). The whole discourse organizes around catching the bad citation after the fact.

That's a depreciating arms race against a symptom. The disease is upstream: an unsourced claim is *constructible* at all. Asking a model to cite. In a system prompt, in a CLAUDE.md, in a "please verify" instruction. Is a behavioral hope. The illegal state is still representable, so it will eventually be constructed.

## Why the guarantee can't live in the model

Hallucination is not a capability gap you train away. Xu et al. Prove it's a structural inevitability for any general-purpose LLM ([*Hallucination is Inevitable*, 2024](https://arxiv.org/abs/2401.11817)). OpenAI locates the cause in incentives: training and evaluation reward confident guessing over abstention, so the generator's own objective tilts toward plausible-but-unsourced output ([*Why Language Models Hallucinate*, 2025](https://arxiv.org/abs/2509.04664)).

And the bolt-on fixes leak. A citation being *present* does not mean it's *load-bearing*: models post-rationalize. Write the answer, then shop for a plausible source. Wallat et al. Call this "correctness is not faithfulness" ([SIGIR ICTIR 2025](https://dl.acm.org/doi/10.1145/3731120.3744592)); PwC measured 94%+ link validity coexisting with 39. 77% factual accuracy. A passing citation metric is not a binding.

So the truth guarantee has to move *out* of the generator, to a different layer.

## The lineage: make illegal states unrepresentable

This move was made decades ago. Inside closed, deterministic systems. Yaron Minsky's maxim, "make illegal states unrepresentable," uses the type system so an invalid state can't be constructed at all ([Jane Street, 2011](https://blog.janestreet.com/effective-ml-revisited/)). Alexis King's "Parse, Don't Validate" sharpens the mechanic: validation checks then throws the evidence away; parsing preserves the gained knowledge *in the type* ([2019](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)). A relational database has refused to instantiate a row that violates a foreign-key constraint for forty years.

The transposition: a fact without its source-tuple. (value, source, method, observed_at, trust). Should not be low-quality output. It should be an ill-typed, *unconstructable* value.

## The proof: my system enforces it

This isn't theory. In Nuke, a number is that tuple, and the type makes "money without source" impossible to construct. Even an *absent* value carries provenance: `{ amount: null, source: 'vehicles.vin', method: 'absent', needs: 'capture VIN plate' }`. A bare number is, verbatim in my own rules, "a schema failure."

The enforcement lives at the boundary, not in a prompt. A PreToolUse hook (`block-god-writes.sh`) intercepts every SQL tool call *before execution*, greps it, and exits 2. A hard block. On any raw `INSERT` into eleven testimony tables, and on any `UPDATE`/`DELETE` against them. Writes are forced through a single front door; corrections go through supersession, never overwrite. The only escape is typing a literal bypass marker per call. Deliberate friction. The machine refuses the bad write even when the agent, holding a service-role key, tries it. Enforcement doesn't depend on the agent remembering the rule.

## The honest residue, and the white space

The obvious objection: you can't "refuse to compile" an English sentence. Correct. So you don't enforce on the model's free-text tokens. You enforce at the tool boundary, where the model is demoted from *author of a fact* to a referentially-transparent *transport* over an already-sourced store. The boundary is the compiler. (Claims that are genuine synthesis, with no upstream atom, still need a flag-or-retract default. This is a strictly stronger floor, not a proof of zero hallucination.)

The runtime machinery already exists. AgentSpec and ShieldAgent enforce hard invariants on agent actions ([2503.18666](https://arxiv.org/abs/2503.18666)). But aimed at *safety*, never provenance. The whole live discourse treats provenance as a *layer*: a detector, a runtime receipt, a post-hoc audit, an opt-in citation API. Nobody is arguing provenance should be *syntax*. A property of the data type, traveling with the datum across storage, recompute, and reuse.

Confidence scores are the wrong primitive. Provenance is the primitive: trust is reconstructed from lineage, never guessed from a probability. The unsourced claim should be a compile error. The harness I'm typing into doesn't enforce that. My system does. And finding bugs like this is worth talking about publicly.

<!-- INTERNAL. Not for publish.
PROVENANCE OF THIS THESIS (eating our own dogfood):
- Citations verified verbatim on disk/web this session (adversarial pass, 2026-06-14): block-god-writes.sh real (exit 2, 11 testimony tables, ALLOW_RAW_TESTIMONY_WRITE marker); Xu 2024 (2401.11817); OpenAI 2509.04664; Alexis King Parse-Don't-Validate 2019; Minsky make-illegal-states; KPMG/PwC numbers.
- TWO JOINTS A HOSTILE EXPERT WILL PUSH (longform keeps the nuance; don't let short-form overclaim past it):
  1. "structural NOT intelligence" is a false dichotomy. It's BOTH; defensible claim = the *guaranteeable* layer is structural.
  2. "type-layer provenance is novel" only in the PRECISE form: provenance as the datum's TYPE that travels (not a layer/receipt/audit) + model-as-transport + provenance-as-primitive-not-confidence. Loose "force a source field" = non-novel (constrained decoding already does it).
- WHITE SPACE / window: ~3-6 months; hijack the "vibe citing" meme as the on-ramp; disambiguate value-level evidentiary provenance from regulatory artifact-level (C2PA/EU AI Act) provenance.
-->
