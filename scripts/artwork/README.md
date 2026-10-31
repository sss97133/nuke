# Identity emblem sources and vector derivatives

`vehicle_identity_marks` remains the shared make/model/series/trim catalogue.
`vehicle_identity_mark_assets` adds immutable source files and derived artwork
to that owner. It is not a new vehicle-photo library or a replacement catalogue.
Every public vehicle can call `vehicle_identity_artwork(vehicle_id)`; absent
verified artwork returns an empty `marks` array. Private/deleted records are not
returned by this public reader. The catalogue can also be reused by authorized
private consumers through the existing identity-mark resolver.

Originals live byte-for-byte in content-addressed filenames under `nuke_frontend/public/stacks/makes/emblems/`.
The database records their stable public asset paths, SHA-256 hashes, dimensions,
source context and known source URL/capture clock. Unknown publishers, dates and
year applicability remain unknown. Local desktop paths are not database URLs.
These references were supplied for the catalogue; they do not prove installation
on a photographed vehicle. The existing `body_emblems_badges` table remains the
owner of per-piece physical observations.

Each vector cites its original source row and its transformation parameters.
The supplied SVGs contain actual paths, without embedded raster images, external
dependencies or substitute-font lettering. They preserve source colors on both
themes. Tracing is an interpretation of a photograph, not a factory drawing.
The paired K5 source uses its upper example; the separate GM Restoration Parts
label is outside the black bowtie crop. Complete originals remain retained.

To reproduce a derivative on macOS with the already installed Potrace 1.16:

```sh
node scripts/artwork/trace-emblem.mjs original.jpg output.svg options.json
node --test scripts/artwork/emblem-assets.test.mjs
bash scripts/ci/run-db-contracts.sh test_vehicle_identity_mark_assets.sql
```

The options (`crop`, negative-space `clear` seeds and label) and resulting method
parameters are in `manifest.json`. Compare the result to the original at intended
display sizes on light and dark backgrounds. The tracing script changes neither
the source bytes nor model/year testimony. It has no network, paid inference or
database write path.

Registration is explicit through `record_vehicle_identity_mark_asset(jsonb)`;
only the service role can execute it, and it has no direct table write grant.
The migration registers this initial reference set through that writer. Later
corrections append a new row with `supersedes_id`; existing records are immutable.
An exact repeated id is idempotent, while different evidence under that id fails.

Artwork usability and applicability are separate. Linking to an identity mark
requires recorded applicability evidence. The per-vehicle reader additionally
requires a vetted catalogue match, known vehicle year/model, usable artwork and
an active original. Drafts and withdrawn/superseded revisions cannot display.
The initial references have no asserted fitment bindings. This adds source
custody and reusable rendering assets; fleet artwork coverage is unmeasured.
