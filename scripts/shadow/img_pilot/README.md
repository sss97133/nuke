# image condition pilot (img-cond-rubric-v1), run 45a75120-55a1-4c57-b23a-cec396ea87cc

- Sample: 300 L1 cars from the fwd 2025-07 window, stratified by v20 predicted-value tertile x top-5 segment (seed 26). Up to 8 listing photos each (2,388 downloaded).
- Rubric: rubric_v1.json. Zero-shot CLIP ViT-B-32 (laion2b) prompts tied to the Hagerty #1-#4 condition definitions (cited), plus original-vs-modified prompts.
- Cost: 0.29 s/car scoring (CPU, 2 threads), about 0.47 s/car download, 0.64 MB/car. Peak RSS 1,325 MB.
- Held-out (heldout.py, 10-fold x 20 repeats, median/Huber residual correction on v21 blend): no MdAPE gain; see heldout_v1*.json.
- Scores are in public.shadow_image_condition_scores (additive, with run_id and confidence). Nothing live.
