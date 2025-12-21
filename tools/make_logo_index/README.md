# Vehicle Makes + Logos Index (Historical)

This tool builds a **single, searchable index of vehicle makes** (brands + manufacturers, including defunct) and their **logo assets**, intended for **internal design reference**.

It pulls:
- Makes/manufacturers from **Wikidata** (SPARQL)
- Logo files via the **Wikimedia Commons** `Special:FilePath` endpoint (Wikidata property `P154`)

## Usage

From repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r tools/make_logo_index/requirements.txt

python tools/make_logo_index/index_makes_logos.py \
  --out /Users/skylar/nuke/tmp/make_logo_index \
  --limit 2000
```

To also download logo files (recommended to keep downloads capped):

```bash
python tools/make_logo_index/index_makes_logos.py \
  --out /Users/skylar/nuke/tmp/make_logo_index \
  --limit 2000 \
  --download \
  --max-downloads 500
```

Optional: request rasterized thumbnails (useful for consistent sizing in design comps):

```bash
python tools/make_logo_index/index_makes_logos.py \
  --out /Users/skylar/nuke/tmp/make_logo_index \
  --limit 2000 \
  --download \
  --max-downloads 500 \
  --width 512
```

## Output

All output is written under `--out` (recommended under `tmp/`, which is gitignored).

- `index.json`: full structured dataset (best for programmatic usage)
- `index.csv`: flattened table (best for quick browsing / Sheets)
- `logos/`: downloaded logo assets (only if `--download`)

The index includes:
- **historical fields**: `inception`, `dissolved`, `start_year`, `end_year`, `start_decade`
- **status**: `active` / `defunct` / `unknown`
- **provenance**: Wikidata URL, Commons file page, Commons download URL, local file SHA256 (if downloaded)

## Notes on trademarks and licensing

Many vehicle logos are **trademarks**. This tool records provenance and sources, but **does not grant usage rights**.

Before using a logo in anything public/commercial:
- Check the **Commons file page** for licensing and restrictions
- Confirm trademark usage rules for your jurisdiction and use-case


