# photo_cli

Minimal, local-first CLI to ingest, cluster, suggest, review, and organize vehicle photos.

## Install

Create a venv and install deps:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

```bash
python -m tools.photo_cli <root> <command> [options]
```

- `root`: a directory where the SQLite DB and outputs will live

### Commands
- `initdb`: create the SQLite database
- `ingest <inbox> [--recursive]`: scan a folder of images and record basic EXIF
- `cluster [--time-mins 45 --dist-m 150]`: group photos into sessions by time+GPS
- `seed <vehicle> <images...>`: seed a known vehicle with representative images
- `suggest [--topn 3]`: generate per-photo suggestions (baseline heuristic)
- `review [--limit 100]`: terminal review; accept top suggestion, skip, or type a new vehicle name
- `organize [--copy]`: move/copy assigned photos into `Vehicles/<slug>/`

## Roadmap / extensions
- CLIP embeddings for visual similarity
- OCR for plates/VINs
- Interior/exterior/engine/parts classifier
- LLM reasoning over feature JSON
- EXIF/XMP keyword writing
