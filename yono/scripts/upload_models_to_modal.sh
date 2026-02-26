#!/bin/bash
# Upload YONO ONNX models to Modal volume for production serving.
# Run after training any new models.
#
# Usage:
#   ./yono/scripts/upload_models_to_modal.sh

set -e

YONO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$YONO_DIR/models"

echo "Uploading YONO models to Modal volume 'yono-data'..."

for f in \
  yono_make_v1.onnx \
  yono_labels.json \
  hier_family.onnx \
  hier_labels.json \
  hier_american.onnx \
  hier_german.onnx \
  hier_japanese.onnx \
  hier_british.onnx \
  hier_italian.onnx \
  hier_french.onnx \
  hier_swedish.onnx; do
  SRC="$MODELS_DIR/$f"
  if [ -f "$SRC" ]; then
    echo "  uploading $f ($(du -sh "$SRC" | cut -f1))..."
    modal volume put yono-data "$SRC" "models/$f"
  fi
done

echo ""
echo "Done. Deploy with:"
echo "  modal deploy yono/modal_serve.py"
echo ""
echo "After deploy, set in Supabase:"
echo "  supabase secrets set YONO_SIDECAR_URL=<modal-web-endpoint-url>"
