-- Additive: per-car free-text reason from the VLM image scorer pilot (img-cond-rubric-vlm-v2).
alter table public.shadow_image_condition_scores add column if not exists reason text;
alter table public.shadow_image_condition_scores add column if not exists originality_logit numeric;
