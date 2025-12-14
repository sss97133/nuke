### Index: Bring a Trailer Local Partners (into `businesses`)

This repo can index the **Bring a Trailer Local Partners** directory page into the canonical org table: `public.businesses`.

Source page: `https://bringatrailer.com/local-partners/` ([Bring a Trailer Local Partners](https://bringatrailer.com/local-partners/))

#### What gets captured

For each Local Partner entry, the script extracts:

- **Partner name**
- **Location** (best-effort: `city`, `state`, `country`)
- **Partner website** (normalized to origin, stored in `businesses.website`)
- **BaT username + BaT member profile URL**
- **Stable facility key**: `businesses.geographic_key`
- **Discovery fields**:
  - `businesses.discovered_via = 'bat_local_partners'`
  - `businesses.source_url = 'https://bringatrailer.com/local-partners/'`
  - `businesses.metadata.bat_local_partners = { ... }`

#### Why `geographic_key` matters

Some brands may appear more than once (multiple locations). We avoid merging by website alone by using:

\(geographic\_key = slug(partner\_name) \| slug(city) \| state \| country\)

#### Run (dry-run + JSON snapshot)

From repo root:

```bash
npm run index:bat-local-partners
```

This defaults to **dry-run** and writes:

- `data/bat/bat_local_partners.json`

#### Run (write into Supabase)

Set environment variables (service role recommended):

- `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `VITE_SUPABASE_SERVICE_ROLE_KEY`)

Then run:

```bash
npm run index:bat-local-partners -- --upsert
```

Optional flags:

- `--limit 50` (process only first N parsed entries)
- `--no-json` (skip writing `data/bat/bat_local_partners.json`)
- `--url <custom>` (override source URL)


