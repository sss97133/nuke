# dHash parity verdict — iOS Swift vs cloud JS (Seam-2 gate)

**Date:** 2026-07-02
**Canonical:** `apps/nuke-capture-ios/Sources/NukeCapture/PerceptualHash.swift` (worktree `foundation-ios`)
**Method:** verbatim-copy Swift CLI vs sharp-based JS, 3 real JPEGs (1024×768, EXIF orientation 1) + 1 EXIF-orientation-6 variant; CG resampler reverse-engineered by impulse response (768 probes); CG gray conversion reverse-engineered by 23 solid-color probes. All artifacts in `/private/tmp/claude-501/-Users-skylar/5be6d6e1-bf63-40b1-81cb-26d06cb6e399/scratchpad/dhash/`.

## VERDICT: bit-exact parity REFUTED for pixel-recomputed cloud hashes

| Image | Swift (canonical) | Best stock-JS (sharp) | Hamming | JS w/ replicated stage-2+luma, ImageIO stage-1 | Hamming |
|---|---|---|---|---|---|
| IMG_0450.jpg | `0000e0abe5acd05a` | `00e0e2a7a5b4f43b` | 6–7 | `0000e0abe5acd05a` | **0** |
| IMG_0497.jpg | `931fd660540b5519` | `971b32c2160f1f1d` | 3–5 | `931fd660540b5519` | **0** |
| IMG_9254.jpg | `7ef96d6645bcbaa6` | `7f7f3f6341bc3ea0` | 5–7 | `7ef96d6645bcbaa6` | **0** |

- Naive JS dHash (vips/sharp resize + greyscale, the typical cloud implementation): hamming **14–16 of 64**. Useless for equality joins.
- Two of the three pipeline stages were solved to bit-exactness in JS (see spec below). The **sole remaining blocker is Apple ImageIO's thumbnail resampler** (stage 1): it matches no standard kernel — vs sharp lanczos2/lanczos3/cubic/mitchell/linear and vs plain box average (gamma or linear light), per-channel mean Δ≈4–9, max Δ≈41–82. That residual alone leaves hamming 3–7.
- With the ImageIO thumbnail supplied as input (dumped from Swift), the JS re-implementation of stage 2 + grayscale reproduced all three hashes **hamming 0** (all 72 gray values within ±2, no bit flips).

So: parity is achievable in principle only by replicating an undocumented, unversioned Apple resampler. Not achievable with stock JS tooling; any "close" reimplementation stays 3–7 bits off on identical source bytes.

## Exact algorithm spec (extracted + measured from the canonical Swift)

Pipeline: `source bytes → ImageIO thumbnail (EXIF-oriented, max 32) → CG stretch to 9×8 DeviceGray (.low) → 64 left>right comparisons → %016llx`.

1. **Decode + orientation:** `CGImageSourceCreateThumbnailAtIndex` with `kCGImageSourceCreateThumbnailWithTransform: true` — **EXIF rotation IS applied before hashing** (proven: byte-identical pixels retagged Orientation=6 hash `c3c9eda1c1d3c323` ≠ upright `0000e0abe5acd05a`). A cloud implementation MUST auto-orient (e.g. sharp `.rotate()`).
2. **Stage-1 resize:** `kCGImageSourceThumbnailMaxPixelSize: 32`, aspect **preserved** (1024×768 → 32×24; portrait → 24×32). Filter is **undocumented** — measurably sharper than box, not Lanczos-compatible (the parity blocker). Not-upscaling behavior for <32px sources untested.
3. **Stage-2 resize:** `CGContext.draw` of the thumbnail into a 9×8 `DeviceGray` context, `interpolationQuality = .low`, aspect **ignored** (full stretch). Measured by impulse response for 32×24→9×8: **2-tap horizontal point-bilinear** (no area averaging — aliasing preserved), sample positions quantized to **1/16 px and non-affine** (x-taps/weights per dst col c=0..8: `(1,225/256) (4,15) (8,193) (12,256) (15,~128) (19,256) (22,63) (26,241) (29,31)`, right tap = x+1 with 256−w); vertical lands exactly on source rows `3r+1`, weight 1.0. Geometry-dependent — portrait/odd aspects have their own (unmeasured) tap tables.
4. **Grayscale (solved exactly, 23/23 probes):** ICC sRGB→DeviceGray =
   `gray = round(255 · srgb_oetf( 0.2225·lin(R) + 0.7169·lin(G) + 0.0606·lin(B) ))`
   where `lin` = sRGB EOTF per channel. Weights are the Y row of the ICC (Bradford D50-adapted) sRGB→XYZ matrix — **not** Rec.601, **not** plain Rec.709-on-gamma. Any JS using `0.299R+0.587G+0.114B` on encoded values is wrong twice (weights and transfer domain).
5. **Bits:** row-major from top-left; per row r=0..7, compare col c to c+1 for c=0..7 (9th column is right-neighbor only): `bit = gray[r][c] > gray[r][c+1]` (strict >; ties → 0). MSB-first packing (`bits <<= 1; …|= 1`): bit 63 = (row 0, c0 vs c1).
6. **Hex:** `%016llx` — 16 lowercase hex chars, zero-padded.

## Bit fragility (why "close" isn't parity)

Margins |left−right| in the Swift 9×8 arrays: 2–7 of the 64 comparisons per image sit at margin ≤1 (IMG_0450 has 4 exact ties). Any ±1 gray perturbation anywhere upstream can flip those bits — equality joins tolerate zero perturbation.

## What this means for the Seam-2 bridge

Swift is canonical (seam agreement). Given the above:

1. **Device-computed hash is the identity; never recompute-and-equality-join in the cloud.** Cloud stores the iOS-computed hash as an opaque key. Anything the app touched gets its hash from the app.
2. **Cloud backfill (images that never passed through the app) cannot produce Swift-equal hashes from pixels.** If backfill must hash, use a fully-specified JS pipeline (auto-orient → resize max-32 aspect-preserved → 9×8 stretch → the exact luma above → same bit/hex packing; scripts in scratch dir) and mark rows with an algo tag (e.g. `dhash_js_v1`), matching across the seam only by **hamming distance, never equality**. Measured cross-implementation distance on identical bytes: 3–7. A join threshold of ~10 captures same-bytes pairs but sits inside the near-duplicate band (burst shots of the same scene) → ambiguous matches are possible; treat as candidate-match + confirm via `contentSha256` or metadata, not as identity.
3. **The only route to true cross-side equality** is making the canonical algorithm specifiable — e.g. exact integer box resize + the (now fully documented) luma — versioned as a v2 hash and recomputed on-device. That changes app code; owner decision, out of scope here.

## Caveats / residual risk

- Measurements are macOS CoreGraphics/ImageIO (same frameworks as iOS, but Apple does not guarantee cross-OS bit-stability of either resampler). Even Swift↔Swift hash stability across iOS versions is unverified — one more reason not to build equality joins on recomputation.
- Stage-2 tap table was measured for 32×24→9×8 only (all landscape 4:3 photos — the dominant camera case). Portrait (24×32→9×8) and odd aspects have different tables.
- Sources smaller than 32px, CMYK JPEGs, alpha PNGs untested.

## Artifacts (scratch, reproducible)

- `dhash.swift` — verbatim-algorithm CLI (+ `--gray` 9×8 dump)
- `diag.swift` — stage-1 thumbnail RGBA dump + luma probe table
- `cgprobe.swift` — 768-impulse response probe of CG `.low`
- `dhash.mjs`, `stage2.mjs`, `stage2b.mjs`, `final.mjs` — JS implementations + parity suites
