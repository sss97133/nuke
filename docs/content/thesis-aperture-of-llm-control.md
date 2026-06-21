# The Aperture of LLM Control

I cannot get a system to answer me honestly yet. That sentence is the thesis, not a disclaimer. Every model I run will, when it hits a hard fact it doesn't have, fabricate one. Fluent, confident, and wrong. And I have no clean way to stop it at the instant it happens. Before I tell you what I'm building, I want to be clear that it isn't finished. The honesty about that is the brand.

## The problem is not the size of the model

The instinct is to blame scale. Not enough compute, not enough data, not a big enough data center. That instinct is empirically wrong. Hallucination of rare facts has a *statistical floor*: a calibrated language model must hallucinate "arbitrary" facts at roughly the Good-Turing rate at which facts appear exactly once in training (Kalai & Vempala, *Calibrated Language Models Must Hallucinate*, STOC 2024). It persists because training and evaluation reward confident guessing over abstention. A model that bluffs out-scores one that says "I don't know" (Kalai et al., *Why Language Models Hallucinate*, 2025). And there's a hard-limit result arguing some hallucination is innate to the function class (Xu et al., *Hallucination is Inevitable*, 2024. Contested, cite as a preprint, not settled). Throwing FLOPs at the weights chases a floor the math says you can't break.

## Why the fix isn't in the weights

If honesty isn't a scale problem, it's a control-flow problem. And control flow lives at the boundary, not in the parameters. The cheap, model-agnostic levers already work: retrieval grounds at the boundary (Lewis et al., RAG, 2020); conformal abstention puts a *provable* bound on the error rate of a refuse-or-emit decision on a model you don't control (Abbasi-Yadkori et al., 2024). DeepMind's CaMeL (Debenedetti et al., 2025) is the architectural proof: capability security and taint tracking enforced *around* the LLM "without modifying the LLM itself," with guarantees that hold even if the base model is compromised. That is the aperture, built. For tool I/O. Mine is the aperture for free-text fact emission.

## The mechanism: slot → query → abstain

The **aperture of LLM control** is a model-agnostic, decode-time gate that wraps a frozen LLM. At every syntactic position where a referent is *mandatory*. Named entity, date, quantity, citation, identifier. It permits a token to pass only if that token is backed by a reachable external store. Otherwise it closes: the slot cannot be filled, and the system declares it cannot respond fully. It is grammar-constrained decoding whose mask is *provenance* rather than *schema*, keyed on *external source-availability* rather than the model's own confidence. The LLM is demoted to a fluency layer; its factual tokens are vetoed from outside.

The critical word is *external*. Every internal-state gate. Selective prediction (Geifman & El-Yaniv, 2017), semantic entropy (Farquhar et al., *Nature* 2024). Admits it cannot catch a confidently-wrong fact. The only signal robust to a confident hallucination is: does a reachable store back *this specific slot*, yes or no.

## The lineage

None of the primitives are mine. The enforcement machinery is grammar-constrained decoding (Geng et al., 2023), re-aimed from syntax to provenance. The right to abstain is a named, formal field (Wen et al., *Know Your Limits*, TACL 2025). Toolformer (Schick et al., 2023) learns *where* to call a tool. The closest prior art. But bakes it into weights as an optional, probabilistic call with no abstention contract. The philosophy is older still: Frege's 1892 sense/reference says "successor of 3" and "predecessor of 5" are two *senses* of one *reference* (4). Many ways to point at an idea, exactly the high-redundancy regime where attribution is easy. Kripke's a-priori/a-posteriori cut tells the harness *which* slots can be self-served (math, definitions. Reconstructable in-band) and which must fetch or abstain (empirical facts. No causal link, no honest in-band warrant).

## Where I actually am

Honest ledger: this is a position and a build path, not a result. The closest competitor, *Attribute First, then Generate* (Slobodkin et al., ACL 2024), already does slot-level, source-conditioned generation. But as a trained pipeline that assumes the source is given, with the model still the author. I differentiate on three axes (model-agnostic harness vs. Trained pipeline; abstain-on-no-source vs. Source-assumed-given; model-as-transport vs. Model-as-author). And I have to full-text-read it before I claim novelty.

## The white space

The four-way intersection nobody occupies: a syntactic fact-slot *trigger* + an external decode-time *enforcement* mask + a *gate signal* of pure source-availability + a *preventive, absolute* abstention contract. On a frozen black box. RAG grounds the whole prompt and, perversely, *reduces* abstention by inflating confidence. Abstention methods gate the whole answer. Grammar-constrained decoding enforces schema, never provenance. The fusion. Slot-level detection plus an external per-slot veto. Is the genuine gap. The novel core is the *detector*, not the retriever. If the detector is weak, the whole thing degrades to RAG with bolt-ons, and the dunk lands. So I'll publish the harness and the measured gap. What fraction of mandatory slots it binds, where it leaks. And a number that says exactly how honest "honest" is so far.

<!-- INTERNAL. Not for publish.
APERTURE ESSAY. Provenance & defensibility (workflow wf_0aff3056-b76, resumed; web-verified 2026-06-14).
35/36 citations verified against real URLs (arXiv/ACL/Nature/SEP/NeurIPS). All 4 adversarial verdicts: defensible=True after narrowing.
HOLD THE ALTITUDE (or you get dunked):
- Aperture = novel COMBINATION + reframing of 4 existing primitives (grammar-constrained decoding [Geng 2023] re-aimed at provenance; selective prediction/abstention; external source-availability gate; preventive absolute abstain), NOT a new primitive. Differentiate explicitly from Attribute-First (Slobodkin ACL 2024), FLARE, Mallen, Toolformer, RARR/ALCE, selective prediction/semantic entropy. CaMeL (DeepMind 2025) = boundary-enforcement precedent for tool I/O; aperture = same idea for free-text fact emission.
- Compute reframe: AIRTIGHT clause = monofact/Good-Turing floor means scale can't eliminate rare-fact hallucination (Kalai-Vempala STOC 2024, arXiv 2311.14648). HYPOTHESIS clause (label it as such) = the boundary harness is cheap/buildable at $200/mo; true for VERIFIABLE facts (Skylar's domain), not proven universally.
- Asymmetry: the plagiarism/hallucination dual is SKYLAR'S FRAMING (not a discovery); the "facts harder than ideas" half is backed by the monofact theorem.
- Frege: textbook-correct co-reference under distinct sense; SEP independently uses the 4 / 8/2 case. Kripke a priori/a posteriori cut = which slots self-serve vs must-fetch.
- NOT SHIPPED YET. The honest ledger (how far it actually gets) is the deliverable, not a solved claim.
-->
