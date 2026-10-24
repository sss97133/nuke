# Image cross-check rule (pre-registered 2026-10-23 before held-out eval)
Source: listing gallery photos (vehicle_images, non-document, <=~16 spread by position), CLIP ViT-B/32 zero-shot (clip_zs_v1, prompts.json, sha in RULE.sha256).
Per image typed observations: rust, paint_damage, interior_wear, panel_mismatch, overspray = P(pos | pos,neg pair). Scene = argmax of 6 scene prompts.
Relevance: rust,paint_damage,panel_mismatch,overspray only on exterior/underside/wheel scenes; interior_wear only on interior scenes.
Car score per type = max over relevant images. flaw_visible = any of rust/paint_damage/interior_wear >= its threshold. repaint_visible = panel_mismatch or overspray >= threshold.
Split: sample340 order shuffled by seed 7; first 100 = dev (thresholds chosen to maximize balanced accuracy vs text), remaining 240 = held-out.
Agreement (condition): text grade>=3 <-> flaw_visible; grade<=2 <-> not flaw_visible. Agreement (repaint): text repaint=True <-> repaint_visible (only cars with a text repaint claim).
Pass: held-out n>=200 and agreement >=0.90. Also report balanced accuracy & majority baseline, because raw agreement can be inflated by class imbalance.
