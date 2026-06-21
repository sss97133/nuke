#!/bin/bash
# Build K5_complete_wiring_diagram.pdf from the 7 loom WireViz SVGs.
# Re-run after regenerating any loom.
set -e
cd "$(dirname "$0")"

LOOMS=(
  "K5_engine_loom_wireviz_v16"
  "K5_exterior___body_wireviz_v4"
  "K5_interior___dash_wireviz_v4"
  "K5_chassis___underbody_wireviz_v4"
  "K5_audio_wireviz_v4"
  "K5_power___comm_wireviz_v4"
  "K5_misc_wireviz_v4"
)

PDFS=()
# Cover page first (regenerated each build via build_cover_page.py if available)
if [ -f K5_cover_page.svg ]; then
  rsvg-convert -f pdf -o K5_cover_page.pdf K5_cover_page.svg
  PDFS+=(K5_cover_page.pdf)
fi
for name in "${LOOMS[@]}"; do
  svg="${name}.svg"
  pdf="${name}.pdf"
  if [ ! -f "$svg" ]; then
    echo "WARN: $svg not found — skip"
    continue
  fi
  rsvg-convert -f pdf -o "$pdf" "$svg"
  PDFS+=("$pdf")
done

pdfunite "${PDFS[@]}" K5_complete_wiring_diagram.pdf
echo "→ K5_complete_wiring_diagram.pdf ($(du -h K5_complete_wiring_diagram.pdf | cut -f1), ${#PDFS[@]} pages)"
