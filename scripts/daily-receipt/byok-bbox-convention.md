# BBOX COORDINATE CONVENTION (TWVP) — read before emitting ANY bbox

Every bbox is `[x1,y1,x2,y2]` in Thinking-with-Visual-Primitives space. The rules, exactly:

1. **Each axis normalizes INDEPENDENTLY to 0–999** over the image AS SHOWN (the exact frame you
   see with the Read tool, after any rotation):
   - `x = round(999 × pixel_x / displayed_WIDTH)`
   - `y = round(999 × pixel_y / displayed_HEIGHT)`
2. **Origin (0,0) is TOP-LEFT**; (999,999) is bottom-right. `x1 < x2`, `y1 < y2`, all within 0–999.
3. The two scales are **anisotropic**: 0–999 spans the full width AND separately the full height,
   whatever the aspect ratio. An object filling the bottom half of ANY frame is `y1≈500, y2≈999`.

## Worked examples — one per orientation

**LANDSCAPE 4032×3024** — a wheel spanning pixels x 1008→3024, y 1512→2722:
`x1=999·1008/4032=250, x2=999·3024/4032=749, y1=999·1512/3024=500, y2=999·2722/3024=899`
→ `bbox: [250,500,749,899]`

**PORTRAIT 3024×4032** — a door spanning pixels x 756→2268, y 2016→3629:
`x1=999·756/3024=250, x2=999·2268/3024=749, y1=999·2016/4032=500, y2=999·3629/4032=899`
→ `bbox: [250,500,749,899]` — note y divides by **4032 (the height)**, never by the width.

**ROTATED / SIDEWAYS frame** — if the frame displays sideways (rotation not applied), the axes
follow the DISPLAYED image anyway: x runs along what you see as horizontal, y along what you see
as vertical, divided by the displayed width/height respectively. Never "un-rotate" coordinates
back to sensor orientation.

## The three encodings that are WRONG (each observed in production — audit 2026-07-11)

1. **y normalized by width.** On a portrait frame every y shrinks (÷4032 becomes ÷3024-worth)
   and all boxes float ABOVE their objects. y divides by the HEIGHT. Always.
2. **Raw pixel coordinates.** `[120,80,430,300]` meant as pixels of a 640×480 render is not a
   TWVP box. Never emit pixels — always normalize each axis to 0–999.
3. **Uniform up-left shift.** Computing from remembered/thumbnail dimensions instead of the frame
   you actually Read shifts every box the same direction. Use the displayed dimensions of the
   image in front of you.

## Self-check before writing each verdict

Find the frame's most bottom-right element: if it touches the frame edge, its `x2`/`y2` must be
near 999. If every box you produced clusters in the top-left while objects fill the frame, you
normalized by the wrong dimension — recompute EVERY box in that frame, don't nudge one.
