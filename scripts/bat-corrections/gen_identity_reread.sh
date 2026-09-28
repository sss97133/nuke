#!/bin/bash
# gen_identity_reread.sh <out-dir>
# Settled BaT vehicles whose make/model came from the old title split, for a re-read through the deployed reader
# (extract-bat-core takes identity from the lot's slug / Make link since 24091e054, 2026-09-27 23:25Z).
# Classes, as measured 2026-09-27 22:28Z (2,739 rows): descriptor_make ("Coyote-Powered", "Modified", "1986.5"),
# split_make ('Alfa' / 'Romeo GTV'), second_word_model ('Romeo Spider Duetto'), no_make.
# Writes <out-dir>/identity_reread.json (id, url, make, model, sale_status, cls) and identity_reread_urls.txt
# for drive_reader.sh. Read-only. Recovered from the 2026-09-27 session transcript.
set -u
B=${1:?out-dir}
mkdir -p "$B"
Q=/Users/skylar/nuke/scripts/data/q.sh
DESC_MAKE="make ~* '-(powered|owned|mile|miles|kilometer|kilometers|swapped|built|driven|equipped)[,:]?\$' or make ~* '^(modified|custom|supercharged|turbocharged|restored|backdated|lifted|euro|jdm|japanese-market|no-reserve|one-owner|original-owner|single-family-owned|fuel-injected|pair|set|lot|group)[,:]?\$' or make ~ '^[0-9]'"
SPLIT_MAKE="make in ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC')"
SECOND_WORD="model ~* '^(benz|rover|romeo|martin|davidson|royce|healey|tomaso|general|camino)\\s'"
NO_MAKE="make is null or make = '' or lower(make) = 'unknown'"
$Q "set statement_timeout='55s'; select id, coalesce(bat_auction_url, listing_url) url, make, model, sale_status,
  case when $DESC_MAKE then 'descriptor_make' when $SPLIT_MAKE then 'split_make' when $SECOND_WORD then 'second_word_model' when $NO_MAKE then 'no_make' end cls
  from vehicles
  where deleted_at is null and (platform_source = 'bringatrailer' or listing_url ilike '%bringatrailer.com%')
    and coalesce(bat_auction_url, listing_url) ilike '%bringatrailer.com/listing/%'
    and sale_status is distinct from 'auction_live'
    and ($DESC_MAKE or $SPLIT_MAKE or $SECOND_WORD or $NO_MAKE)" > "$B/identity_reread.json"
python3 - "$B" <<'EOF'
import json, collections, sys
b = sys.argv[1]
d = json.load(open(f'{b}/identity_reread.json'))
if not isinstance(d, list):
    sys.exit(f'query failed: {str(d)[:300]}')
print('rows', len(d)); print(collections.Counter(r['cls'] for r in d).most_common())
open(f'{b}/identity_reread_urls.txt', 'w').write('\n'.join(r['url'] for r in d) + '\n')
EOF
