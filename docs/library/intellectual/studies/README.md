# STUDIES

Empirical analyses of the Nuke platform's construction, evolution, and operations. These are not opinions — they are investigations based on measurable evidence: 13,758 prompts, 2,045 commits, 541 sessions, 965 hours of active work, and 141 days of continuous development. Each study presents its methodology, its data, its findings, and its conclusions.

---

## Contents

### [13,758 Prompts: An Empirical Analysis of AI-Assisted Platform Construction](13758-prompts-analysis.md)
Formal write-up of the complete prompt corpus analysis. 541 sessions, 13,758 prompts, 2,045 commits across 141 days. Session archetypes, focus metrics, frustration distribution, machine activation patterns, metaphor evolution, and desire clustering. The empirical study of how a provenance engine was built through human-AI collaboration.

### [Dead Features Autopsy: An Analysis of Abandoned Ideas](dead-features-autopsy.md)
Post-mortem analysis of nine features that were killed during the March 2026 platform triage. Betting, trading, vault, concierge, shipping, investor portal, and three others. Prompt-to-commit ratios as diagnostic indicators. Cost of conceptual dead weight. Warning signs for future zombie features. Lessons for vertical expansion.

### [Platform Triage: March 2026 Case Study](platform-triage-2026-03.md)
The March 2026 triage as a reproducible methodology for platform audits. 171 GB reduced to 156 GB. 464 edge functions reduced to 440. 131 cron jobs reduced to 112. Estimated $3,000/month burn reduction. What was cut, what was kept, why, and how to reproduce the process.

### [Vocabulary Evolution: How the Project's Language Changed Over 141 Days](vocabulary-evolution.md)
Analysis of how the project's technical vocabulary evolved across five months and 13,758 prompts. Replacement chains (scrape to extract to ingest to observe), formality arcs (7.1% profanity in October to 5.6% in March), the rise of structured prompting (0.9% to 39%), and the relationship between vocabulary sophistication and implementation quality.

---

*These studies are based on the analytical work produced in `/docs/writing/` during March 2026. They formalize and extend that work into citation-ready documents with methodology sections, finding discussions, and reproducibility notes.*

---

## Methodological Foundations

The quantitative methods used across these studies are the standard primitives of information retrieval, statistics, and representation learning — not ad hoc. Each citation below is web-verified.

- **Document-frequency / term-specificity (IDF)** — `vocabulary-evolution.md` counts terms by distinct prompts containing them and treats rarer terms as higher-signal: inverse document frequency. [sparckjones1972idf], applied to query scoring by [ramos2003tfidf]
- **Herfindahl-Hirschman Index as a focus/concentration metric** — `13758-prompts-analysis.md` computes per-session focus as HHI of the category distribution (1.0 = single category; <0.4 flagged "thrashing"). [hirschman1964paternity]
- **Chance-corrected agreement (Cohen's κ)** — classifier-vs-human validation (87% on 200 labeled prompts) and multi-model agreement should report against chance-corrected agreement, since raw percent overstates reliability under skewed priors. [cohen1960kappa]
- **Precision / recall / F-measure** — `description-extraction-quality.md` frames correct vs. malformed extractions in retrieval-evaluation terms. [vanrijsbergen1979ir]
- **CLIP image-text joint embeddings** — matching a photo to a listing description is the contrastive image-text alignment task. [radford2021clip]
- **Perceptual / DCT-based image hashing (pHash)** — near-duplicate detection over the 1M+ image corpus. [zauner2010phash]

### Bibliography

1. **[sparckjones1972idf]** Karen Spärck Jones (1972). *A Statistical Interpretation of Term Specificity and Its Application in Retrieval*. Journal of Documentation 28(1), 11-21. https://doi.org/10.1108/eb026526
2. **[hirschman1964paternity]** Albert O. Hirschman (1964). *The Paternity of an Index*. American Economic Review 54(5), 761-762. https://www.jstor.org/stable/1818582
3. **[cohen1960kappa]** Jacob Cohen (1960). *A Coefficient of Agreement for Nominal Scales*. Educational and Psychological Measurement 20(1), 37-46. https://doi.org/10.1177/001316446002000104
4. **[vanrijsbergen1979ir]** C. J. van Rijsbergen (1979). *Information Retrieval (2nd ed.)*. Butterworths, London.
5. **[radford2021clip]** Radford, Kim, Hallacy, Ramesh, Goh, et al. (2021). *Learning Transferable Visual Models From Natural Language Supervision*. ICML (PMLR 139), arXiv:2103.00020. https://arxiv.org/abs/2103.00020
6. **[zauner2010phash]** Christoph Zauner (2010). *Implementation and Benchmarking of Perceptual Image Hash Functions*. MSc thesis, Hagenberg. https://www.phash.org/docs/pubs/thesis_zauner.pdf
7. **[ramos2003tfidf]** Juan Ramos (2003). *Using TF-IDF to Determine Word Relevance in Document Queries*. First **Instructional** Conf. on Machine Learning (iCML — a Rutgers tutorial venue, **not** ICML).

*Verification note: all seven confirmed real. ⚠️ [ramos2003tfidf] is the* Instructional *Conference (iCML), NOT the International Conference on Machine Learning (ICML) — do not conflate.*

---

## Mecum caption and original-audio discovery assay — 2026-10-02

The first cached [Kissimmee broadcast](https://www.youtube.com/watch?v=c9fxArnD3IY)
contains 2,964 timed automatic-caption cues and 49,114 word tokens in a 22,028-second
video. An offline pass through the existing `scripts/mecum-video-analyzer.ts` owner
discovers caption/category grains for references, history, details, evaluative language,
prices, outcomes, cadence and verbal room descriptions. These are review candidates,
with caption indexes, source links, method, frozen capture clock and text hashes. Raw
captions stay in the INTERNAL cache. No database writer runs in this lane.

Version 1 produced 2,540 candidate grains, 223 bounded review groups and 18 transition
leads. A deterministic scope audit inspected 60 distinct cues: first/middle/last hits in
eight categories, five year-keyword hits, eight unhit captions, all 18 transition leads,
all five literal next-car expressions and two numeric ambiguity probes. Six of 24
category draws were overbroad; two of five year draws referred to the event or racing
history. Six of eight unhit captions contained recoverable avenues: platform and
presenter context, weather, ordered-together/color relationships, less formulaic opinion
and broadcast closing. These small, overlapping samples do not estimate global
precision or recall. A manufacturer excitement slogan is evidence of branding, rather
than a measurement of crowd emotion; keeping its context allows a later property fold.

The audit found all five literal next-car expressions missing from the transition grammar.
Version 2 retains them even without a make/year keyword: four add a grain and one
enriches an existing grain. Revised yield is 2,544 grains and 23 transition leads, with
223 review groups. Future previews and rhetorical references remain unresolved leads;
no group has a measured auction boundary or resolved chassis. Ten parser assays cover
technical numbers, historic sale scope, duplicate caption onsets, replay identity,
bounded intervals, unknown roles and next-car navigation.

A separate acquired WAV measured 99.9735 seconds despite a requested 92-second cut.
Local CPU/int8 `faster-whisper` base.en yielded 18 segments and 210 timestamped words in
3.559 seconds, with no paid model API calls. Twenty-three language candidates were
assayed. Six distinctive text anchors suggest a clip origin near 2509.72 seconds,
but the verified origin remains unknown: approximate caption/ASR onsets cannot prove
the sample mapping. File-relative timestamps are preserved. Foreground ASR does not
prove absence of background chant or crowd reaction. Speaker identities, accepted
bids, bid velocity and crowd emotion remain unverified.

Reproduce with `npm run mecum:transcript-discovery -- --transcript <INTERNAL-cache.json>
--output-dir <artifact-directory>`; optional `--audio-assay` with `--audio-source-receipt`, `--miss-audit` and
`--baseline-report` consume source receipts. `--evidence-module` validates review
payloads with the existing broadcast receipt contract without posting them. Artifacts
for this assay live under `output/mecum/audio-discovery/`: `latest.json`, versioned
reports, source-keyed candidates, review windows and `bounded-miss-audit.json`. The
baseline audit references the exact transcript SHA-256. Further assays should expand
platform/relationship vocabulary, review numeric speech and annotate accepted bids
and overlapping speaker turns from aligned original audio/video.

### Durable source-loop follow-up

The same analyzer now accepts `--manifest`, `--cache-dir` and `--output-dir`, with
optional bounded `--watch` and anonymous `--acquire-captions --yt-dlp-bin <existing-tool>`.
Limits constrain distinct new sources attempted (including failures), source-media
hours, candidate rows, retry attempts and runtime. One source/hash/discovery-version
checkpoint records normalized INTERNAL evidence, immutable report/grain files, replay
digest, pending review work and error/retry receipts. Signals stop after the current
source; a dead-process lease is recoverable. Source dates remain unknown unless
explicitly supplied; the frozen cache-read timestamp is separate from cache mtime,
publication and event time. Completed artifact hashes are checked on resume.

The initial six-cache batch yielded 8,850 candidates and 184 review work items across
RM Sotheby's, Barrett-Jackson, Broad Arrow and Bonhams. A separate process resumed all
six checkpoints and added zero rows. Six loop assays exercise original JSON3 indexes,
frozen-clock restart, new-byte revisions, complete-source row-budget holds, finite retry
exhaustion and unhit review sampling; two additional assays check source limits and
dead/live leases. A process generates candidates and review tasks; it does not modify
or release its own code, post production rows, or promote keywords to verified facts.
The demonstrated improvement remains the source-scope audit followed by the tested
next-car revision and its versioned comparison.

An additional Broad Arrow WAV/ASR assay contains price/closing language rather than
the selected Mecum commentary/specification foreground. Eight review avenues include
stated bid acknowledgement versus asks, bidder participation and representation,
increment rejection, closing calls, gesture cautions and a numeric ASR inconsistency.
Clip-origin estimates remain unverified. These observations motivate new property
semantics and targeted listening; they do not establish accepted-bid velocity.

The selected 30-source caption pass subsequently settled at 22 completed sources
across five publishers: 76,662 cached caption cues, 512,662 word tokens, 27,325 review
candidates and 732 pending source-scope work items. All 22 replay digests passed.
Seven acquisition routes exhausted three bounded attempts: three caption-route
failures and four sources returned no selected English captions. One source was
upcoming. These outcomes are explicit adapter/access holds; they do not establish
that audiovisual evidence is absent. Both bounded workers exited when their source
attempt budgets settled. Reports, retained input hashes and source outcomes are
linked in `output/mecum/audio-discovery/loop-final-receipt.json`. No candidates were
posted to production, and no paid model API calls were made by this loop.
