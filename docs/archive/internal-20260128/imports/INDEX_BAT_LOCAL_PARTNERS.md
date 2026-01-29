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

#### If your service role key is only stored in Edge Function secrets

If you **do not** have `SUPABASE_SERVICE_ROLE_KEY` locally (and it only exists as an Edge secret), use the Edge-based upsert path instead.

1) Deploy the Edge Function (one-time):

```bash
supabase functions deploy upsert-bat-local-partners --no-verify-jwt
```

2) Run the indexer using Edge upsert (requires only anon key for invocation):

```bash
npm run index:bat-local-partners -- --upsert-via-edge
```

Optional flags:

- `--limit 50` (process only first N parsed entries)
- `--no-json` (skip writing `data/bat/bat_local_partners.json`)
- `--url <custom>` (override source URL)

#### Runbook

For the full end-to-end flow (index → enrich → import) and production guidance, see:

- `docs/imports/BAT_LOCAL_PARTNERS_RUNBOOK.md`


