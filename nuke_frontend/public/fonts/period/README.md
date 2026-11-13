# Period type: four families for the 1970s Pontiac Firebird header

Drawn for Nuke from period sources committed in `nuke_frontend/public/stacks/makes/`. Every glyph records how it was
made in its family's `*.provenance.json` sidecar:

- **traced**: outlined from the source pixels (potrace, then refit) or, in the Block, a construction fitted to
  them. Every traced glyph carries its IoU against the source mask.
- **derived**: built only from traced parts (mirrored, cut, recombined) by a written rule.
- **designed**: drawn by the family's rules where the sources show no such letter.

The names are descriptive. These are not official General Motors or Pontiac typefaces, and General Motors does not
endorse them. Pontiac, Firebird and Trans Am are trademarks of General Motors. Font software license: SIL OFL 1.1.

Nothing in the app loads these fonts yet. `period-fonts.css` declares the faces and the material classes.

## Build

```
tools/type/build.sh                    # all families -> <family>/<Stem>.otf, .woff2, .provenance.json
tools/type/build.sh --proofs DIR       # also writes the traced-over-photograph overlays to DIR
tools/type/build.sh --only trans-am-1973-decal
```

- **Requirements:** Python 3.13 with the packages pinned in `tools/type/requirements.txt` (the script creates
  `tools/type/.venv` with uv), and `potrace` 1.16 on the PATH (`brew install potrace`). The script stops if potrace is
  missing.
- **Reproducible:** builds are byte-identical, because the head dates are fixed and WOFF2 keeps them.
- **Validation:** `build.py` reopens each font with fontTools and checks that every claimed character maps to a
  glyph with an outline. It writes glyph count, cmap size and traced/derived/designed counts to `build-report.json`.
  The table below is copied from that file, and the file is the record.
- **Manifest:** the build also writes `manifest.json`: per family, its WOFF2 files (Regular first) and the characters
  its cmap draws. A `vehicle-identities.json` entry's `font` names a family in it. The vehicle identity loads that
  family's faces only when the entry matches, sets the recorded word in it once they load, and keeps the raster cutout
  for any word with a character the family does not draw.
- **Specimen:** `tools/type/specimen.py OUT --proofs DIR` writes the specimen page. It refuses any string whose
  characters a family does not map. `node tools/type/shoot.mjs OUT/specimen.html OUT`, run from `nuke_frontend/`,
  screenshots the page in light and dark and fails if any period font did not load.

## Families

| Family | Files | Glyphs (with .notdef) | cmap | traced | derived | designed | Traced fidelity (IoU) |
|---|---|---|---|---|---|---|---|
| Pontiac 1973 Block | Regular, Face | 45 | 70 | 7 | 1 | 35 | P .958 T .975 I .954 N .948 O .934 C .917 A .857 |
| Firebird 1971 Script | Regular | 39 | 38 | 6 | 17 | 14 | b .919 e .907 F .899 d .897 r .841 (flag trimmed) i .759 (ball drawn), against the chrome face |
| Trans Am 1973 Decal | Regular | 45 | 70 | 6 | 1 | 36 | S .946 N .930 T .921 A .921 M .920 R .910 |
| Pontiac 1973 Brochure Numerals | Regular | 30 | 28 | 15 | 9 | 4 | cover .974-.981, spread F r e b d .929-.955 |

Counts exclude `.notdef` and `space`. Block and Decal map lowercase to the capitals.

### Pontiac 1973 Block

- **Source:** OER K1049 tail-panel letters P O N T I A C (`pontiac-firebird-tail-letters-1970-1973*.{jpg,png}`).
- **Coverage:** A-Z, 0-9, `- . , & / ' "`.
- **Proportions:** extended. O is 1.73 H wide, P 1.79 H, A 1.91 H. I is a single 0.46 H stem.
- **Contrast:** vertical. Stems are 285-330 units and horizontals 200-210. Letters with three horizontals
  (E F B S 2 3 5 6 8 9) take 150 so their counters stay open. This is a system rule; the source has no such letter.
- **Diagonals:** they follow broad-pen logic. Falling strokes are heavy, rising strokes light, and a vertical that
  carries a heavy diagonal thins to 215.
- **Rounds:** superellipses, n 2.05 outside and n 3.2 for the slot-like counters.
- **Terminals:** cut square, with a 14-unit die radius on every corner.
- **Material:** chrome is two fonts with identical advances. **Regular** is the silhouette (the rim); **Face** is the
  same construction inset 30 units. `.period-chrome` stacks them with gradients and a drop shadow.

### Firebird 1971 Script

- **Source:** the 1971-81 fender emblem, OER 486904 (`pontiac-firebird-fender-script-1971-1981-cut.png`). v0.1
  traced the cutout, which runs past the dark bevel pair into the casting's side wall (a flat grey band, L about
  195, seen in perspective), so it set the casting, not the lettering. v0.2 traces the chrome face between the
  bevels: a 3x3 luminance range over 100 or L under 120 marks the bevel lines, the region between them is closed,
  hole-filled under 150 px and smoothed, and the mounting studs below the baseline are clipped. Stems are now 64
  units (about 8 px in the photograph) against about 14 px for the cutout.
- **i ball:** the face mask cannot hold the i's ball (one bright highlight in a dark ring that does not close), so the
  trace kept only a spike and the neck and the i set dotless. The stem is traced to the x-height and the ball is an
  ellipse at its measured place and size (`I_BALL` in `families/script.py`); the i's IoU against the mask is .759.
- **Vertical metrics:** every period font has ascent 900, descent 250 and caps 700. Browsers round ascent and descent
  to whole pixels, so a font with another descent (the script had 280) sits up to a pixel off the shared baseline.
- **Fidelity:** the IoUs are measured against that face mask. They are lower than v0.1's cutout IoUs because the
  face edge is set by reflections, which the mask follows and the outline smooths.
- **Coverage:** a-z, the capitals of the model names (E F G L M P T), and `. , - '`.
- **Slant:** 13.5 degrees (0.24 px/px), measured by column-projection variance. Every glyph is drawn upright and
  slanted at the end.
- **Style:** a contrasted italic serif. Stems are 64 units, hairlines 34. Stems carry flat serifs, the i dots are
  balls, and the lowercase stands on a 48-unit baseline hairline that joins the word. Every lowercase carries the
  hairline edge to edge, with a 6-unit overlap, so any two letters join.
- **Derived letters:** o is the b's bowl made symmetric. n, m, h and u reuse the r's stem and entry serif with the
  o's arch. a, q and g come from the d; p and l from the b; c from the o with the i's ball. E, L and T are the F's
  parts.
- **Designed letters:** G, P and M carry drawn bars, bowls and diagonals and are labelled designed. t, f, j, k, s, v,
  w, x, y and z are designed in the same stems, hairline and slant.

### Trans Am 1973 Decal

- **Source:** this car's own fender decal (`pontiac-firebird-trans-am-style-owner-decal-cut.png`, from
  `vehicle_images` 9b8ec6d9-8e27-41f4-9428-5c025a1c46f0). The photograph is de-sheared by 0.33 px/px, and each letter
  is scaled to cap 700 on its own height (88 px at the T, 96 px at the M), which also removes the perspective.
- **Bands:** every stroke is a band 56 units wide. Strokes that are heavy in a broad-pen roman split into two bands
  with a 60-unit channel: T, R and E-like stems, the falling diagonals of A, N and M, the M's right stem, the R leg
  and the S. Light strokes stay single.
- **Rounds:** they split only on their heavy sides. The inner band is a full ring; the channel and outer band are
  crescents that run out at the top and bottom, as the traced R bowl does. O is 500 units wide, with the S and R.
- **Channels:** a channel runs on through the stroke it meets (it cuts the T's bar to the top).
- **Corners:** constructed glyphs carry a 16-unit print radius.
- **Figures:** split, after the Phoenix Graphix 400 decal.
- **Colour:** the outline carries none. `.period-decal` applies the decal orange.

### Pontiac 1973 Brochure Numerals

- **Source:** the 1973 Pontiac full-line brochure: the cover "Pontiac 1973" and the "Firebird" heading on pages
  10-11.
- **Figures:** lining, 720 tall against capitals of 700.
- **Strokes:** stems are waisted and flare into bracketed, cupped serifs. Stress is oblique and terminals are
  tapered beaks.
- **Derivations:** 0 is the o re-proportioned, 6 is the 9 turned, 8 is the 9's bowl doubled, and 5, 2 and 4 are
  built from 3, 7 and 1 parts.
- **Identity:** the brochure face may be a period phototype face; its identity is not confirmed.

## Sizes and weak points (v0.2)

- **Chrome:** reads at 24 px and up. Below that, the two-layer gradient turns to noise. Set plain fill
  (`color: currentColor`) under 24 px.
- **Decal:** the 60-unit channel is under one pixel at 14 px and fills in. The minimum size is 24 px, and 36 px for
  the header.
- **Decal textures:** the six traced letters keep the print's softened ends and the taper of their diagonals. The 39
  constructed glyphs are geometric with a print radius. They are close at header sizes and visibly different above
  96 px. The next pass is a hand redraw of the traces to the construction, or the taper added to the construction.
- **Decal figures:** 2, 4, 5 and 8 are the weakest drawings, from split skeletons with a junction blob at the 5.
- **Script joiner:** the baseline hairline still reads as an underline in long lowercase runs. The joins keep the
  small notches of the emblem's own feet.
- **Script edges:** the traced letters follow a face mask bounded by reflections, so their edges are slightly lumpy
  at display sizes above 96 px. The next pass redraws them to the measured stems.
- **Script capitals:** limited to E F G L M P T. A, S and the rest are not drawn. "Trans Am" in the script needs them.
- **Script r:** its flag is trimmed upright where it ran into the e (IoU .841 against the untrimmed face).
- **Block:** & and J are the weakest designed glyphs. M and W are wide. The C's width is a lower bound, because the
  photograph clips it.
- **Brochure numerals:** 5 has a junction blob, 8 has waist notches, 2 and 4 are tight, and the spread letters come
  from a 63 px source.
- **Qualifiers:** words such as "-Style" are set in the UI face, never a period face. Each period face sets only
  the lettering its source carries.
- **Not built:** COLRv1. Chrome is the CSS layering in `period-fonts.css`. On 2026-11-11 it rendered with all five
  faces loaded in Playwright Chromium and Playwright WebKit 26.5, light and dark. It was not checked on an iOS
  device.
