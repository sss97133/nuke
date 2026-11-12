# Period type: four families for the 1970s Pontiac Firebird header

Drawn for Nuke from period sources committed in `nuke_frontend/public/stacks/makes/`. Every glyph records how it was
made in its family's `*.provenance.json` sidecar:

- **traced**: the source pixels outlined (potrace), refit, and scored against the source by IoU.
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
- **Specimen:** `tools/type/specimen.py OUT --proofs DIR` writes the specimen page. It refuses any string whose
  characters a family does not map. `node tools/type/shoot.mjs OUT/specimen.html OUT`, run from `nuke_frontend/`,
  screenshots the page in light and dark and fails if any period font did not load.

## Families

| Family | Files | Glyphs | cmap | traced | derived | designed | Traced fidelity (IoU) |
|---|---|---|---|---|---|---|---|
| Pontiac 1973 Block | Regular, Face | 45 | 70 | 7 | 1 | 35 | P .958 T .975 I .954 N .948 O .934 C .917 A .857 |
| Firebird 1971 Script | Regular | 39 | 38 | 6 | 17 | 14 | F .981 e .979 i .978 b .977 d .976 r .908 (flag trimmed) |
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

- **Source:** the 1971-81 fender emblem, OER 486904 (`pontiac-firebird-fender-script-1971-1981-cut.png`). The
  silhouette is the casting: its face is the bright chrome that photographs nearly white.
- **Coverage:** a-z, the capitals of the model names (E F G L M P T), and `. , - '`.
- **Slant:** 13.5 degrees (0.24 px/px), measured by column-projection variance. Every glyph is drawn upright and
  slanted at the end.
- **Style:** an italic slab script, not a pen script. Stems carry flat slab serifs, the i dots are balls, and the
  lowercase stands on one continuous baseline slab (105 units) that joins the word. Every lowercase carries the
  slab edge to edge, with a 6-unit overlap, so any two letters join.
- **Derived letters:** o is the b's bowl made symmetric. n, m, h and u reuse the r's stem and entry serif with the
  o's arch. a, q and g come from the d; p and l from the b; c from the o with the i's ball. E, L and T are the F's
  parts.
- **Designed letters:** G, P and M carry drawn bars, bowls and diagonals and are labelled designed. t, f, j, k, s, v,
  w, x, y and z are designed in the same stems, slab and slant.

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

## Sizes and weak points (v0.100)

- **Chrome:** reads at 24 px and up. Below that, the two-layer gradient turns to noise. Set plain fill
  (`color: currentColor`) under 24 px.
- **Decal:** the 60-unit channel is under one pixel at 14 px and fills in. The minimum size is 24 px, and 36 px for
  the header.
- **Decal textures:** the six traced letters keep the print's softened ends and the taper of their diagonals. The 39
  constructed glyphs are geometric with a print radius. They are close at header sizes and visibly different above
  96 px. The next pass is a hand redraw of the traces to the construction, or the taper added to the construction.
- **Decal figures:** 2, 4, 5 and 8 are the weakest drawings, from split skeletons with a junction blob at the 5.
- **Script slab:** the slab reads as an underline in long lowercase runs. The joins keep the small notches of the
  emblem's own feet.
- **Script capitals:** limited to E F G L M P T. A, S and the rest are not drawn. "Trans Am" in the script needs them.
- **Script r:** its flag is trimmed upright where it ran into the e (IoU .908 against the untrimmed source).
- **Block:** & and J are the weakest designed glyphs. M and W are wide. The C's width is a lower bound, because the
  photograph clips it.
- **Brochure numerals:** 5 has a junction blob, 8 has waist notches, 2 and 4 are tight, and the spread letters come
  from a 63 px source.
- **Not built:** COLRv1. Chrome is the CSS layering in `period-fonts.css`, which Safari and Chrome both render.
