# visual_identity_recheck_v1 — operator stage scripts

These are the exact stage scripts used for the first full pass on 12 Nov 2026 (AST). They read and write a local work
directory (`/workspace/sortrun/recheck14k` on the box) and make **no database writes**. The only write path is
`../visual_identity_recheck_v1.py hold` (dry run unless `--apply`, cap 50, `--granted-by` required, backup first,
`hold_vehicle_images_for_review` only).

| Stage | Script | Output |
|---|---|---|
| snapshot | (ledger via `capture_ledger_states`, rows via REST) | `ledger_start.json`, `meta.json`, `vehicles.json`, `links.json` |
| fetch | `fetch.py` | `img/<id>.jpg` (render width 360). Universe excludes `is_sensitive`, redaction, empty / non-storage url, and the privacy-exclude union |
| embed | `embed.py` (run with the local-analysis venv) | `clip.npz`, `clip_read.json` (local_image_analysis_v1 reader, CLIP ViT-B/32) |
| sheets | `sheets.py` + `sheets_lib.py` | `sheets/*.jpg`, `sheet_plan.json` (6 refs + ≤20 candidates; refs = capture-set-linked exteriors if ≥4, else CLIP-medoid exteriors) |
| calibrate | `calib_build.py`, then `look.py` with `VIR_PLAN=calib_plan.json VIR_OUT=callooks`, `second.py`, `calib_score.py` | frozen calibration (built before any verdict is read) |
| first look | `look.py W NW` | `looks_w*.jsonl` (prompt `vir1-sheet-20261112a`) |
| second look | `second.py W NW` | `second_w*.jsonl` (prompt `vir1-single-20261112a`, no first clue shown) |
| candidates | `visual_identity_recheck_v1.hold_candidates` | `hold_candidates.json` |

`claude -p` runs with `--allowedTools Read` and a scrubbed environment (no database or GitHub secret is passed to it).
