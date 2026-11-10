# Image keys build design, 2026-11-10 (one design, judged; not verified, not built)

Written by a read-only agent for the owner direction of 2026-11-10 (`docs/ledger/theory/data-machine.md`, "Image
analysis is the model asking"). Three designers were commissioned; two stopped when the account ran out of usage,
so this is one design, not the winner of a comparison. Two adversarial judges then read it against the code and
each scored it 6 of 10. **Read `2026-11-10_image-keys-build-design-judgment.md` first**: it lists what is false in
this file, what must be fixed, and a different first pull request (scripts only, no migration).

It was written for the vehicle measured first that day ("the first vehicle" below, 47 photos). The owner then named
another vehicle as the proof vehicle (the card and C17 say which). Nothing here was run against production. An
audit output, not active guidance: verify before acting (`docs/ledger/README.md`).

---

# The map asks, photos answer: design from the three live mechanisms

This copy is in the repository; vehicle ids, the private facts file and model names were removed from it. What it
says about the first vehicle is no more than the C17 entries of this date already state. It is read-only work on
the checkout at commit `b1c354579`. Every claim about code is marked **read** (the file was opened; path:line given)
or **inferred**; every claim about production comes from what was read on 2026-11-10 20:10-20:41 UTC, or is listed
in section 14 as a fact that still has to be read.

## 0. Summary

The starting point was: `observation_properties` is the map, `evidence_judgment_requests` is the question store,
`ingest-observation` with witnesses is the landing, and the three fit together as one system. The repository already
declares this (`docs/ledger/CAPABILITY_MAP.md:127`, `docs/ledger/theory/data-machine.md:19-63`, read). I tested it against
parts, states and imperfections. It holds as a skeleton and fails in nine exact places. Each failure has a small change.

What holds:
- A property row is the right home for "one thing that can be asked" (a measure with a closed answer).
- The question store has the right lifecycle: raise, claim, answer in a fixed shape, retire, reopen by reader version.
- The writer already puts `property_id` and `descriptor_id` in real columns and the photo in `observation_witnesses`.
- `schema_proposals` is the growth path and has an apply function for property rows.

What does not hold, and the change (details in section 1):
1. A property row cannot say which values it allows or what each value looks like. Add one column, `value_spec`.
2. A discriminator is only the name of a JSON key. The values have no home. Part keys live in `subject_taxonomy`
   (106 rows today), which has no alias memory. Add `subject_taxonomy_aliases`, the same shape as its two siblings.
3. Kinds of imperfection do not belong in the property registry. They live in `condition_taxonomy`, which the writer
   already resolves into `vehicle_observations.descriptor_id`, and which text claims already use. The property row lists
   which of them photos are asked about.
4. The writer does not validate against the registry for a new key. A list typed into the function refuses it first.
   Admit by registry row, and enforce the row's rules in a trigger so every writer obeys them.
5. The question store's two guards are hard-wired to one question kind. Make them dispatch by kind.
6. Nothing in the repository answers a question. Add one worker for the Mac lane.
7. One observation has one witness. "One claim with thirteen proofs" is a fold over thirteen answer rows, not a row.
8. A lane cannot supersede an observation (the function needs the owner's session). A re-read is handled in the fold,
   and a withdrawn question drops its answer out of every count.
9. The proposal path cannot add a part, an imperfection kind or a value, and approval is a migration. Add two proposal
   types and three apply branches; while a finer key waits, the datum lands on the nearest existing key.

Count of new things (section 12): 1 table, 1 column, 1 trigger, 8 SQL functions, 0 edge functions, 1 worker script with
1 library file. Four existing SQL functions and one edge function are extended. Nine pull requests, seven migrations.

The first vehicle costs no paid API call and no new deep read: at most 11 text-only calls and an expected 12 to 20 photo calls on
the owner's subscription (hard caps 20 and 47).

---

## 1. Testing the starting point

| Mechanism | Tested against | Result | Exact place it breaks | Change |
|---|---|---|---|---|
| `observation_properties` as the map | a state of a part ("hood in primer") | Half holds. The measure fits a property row. Its values do not. | The table has no column for allowed values (the facts read from production on 2026-11-10 (C17) column list). They are prose in `description` (`20261003001412_cached_image_property_keys.sql:13-19`, read) and are typed again in `ingest-observation/imageProperties.ts:6-10`, `scripts/lib/image-property-projection.mjs:4-8`, `20261004064216_cached_image_source_ancestry.sql:94` and its CASE arms, `20261030171525_connect_registered_profile_source_claims.sql:63-65`, `reviewedAnalysis.ts:32-34` (all read). | Column `observation_properties.value_spec jsonb`: the values, what each looks like, what part of the car the property applies to. |
| | where a part key lives | Does not hold. | `discriminator_key` is "the top-level key in structured_data that identifies the claim" (`scripts/discovery/fixtures/vehicle_canonical_20260517.sql:38-39`, read). No table holds the values and no writer checks them. | Part keys are rows of `subject_taxonomy`. The property row says `subject.key = part_key`. A trigger checks the value. Alias memory is a new table. |
| | a kind of imperfection | Does not hold as a property. | An open, growing list of kinds is a dimension, not a measure. `condition_taxonomy` already is that dimension and has a real column on the log: `vehicle_observations.descriptor_id` (`20261001140000_c26_condition_claims_notation.sql:59-70`, read), resolved by the writer (`ingest-observation/index.ts:961-975`, read). | One property, `part_imperfection` (present / absent), whose `value_spec` lists the descriptor keys photos are asked about. The kind is the descriptor. |
| | "the writer validates against it" | Does not hold for a new key. | `index.ts:979-984` refuses any `property_key` that is not in a code list before the registry is read; `imageProperties.ts:68-71` repeats it (read). A property approved through `schema_proposals` cannot land without a deploy. | Admit a property whose registry row carries `value_spec.enforce = true`. Enforce values and keys in a `BEFORE INSERT` trigger on `vehicle_observations`. |
| | growth through `schema_proposals` | Half holds. | `fn_schema_proposal_apply` applies `add_property`, `add_observation_kind`, `add_source` only (`20261011223810_schema_proposal_retry_and_progress.sql:126-275`, read; every other type gets "Auto-apply skipped ... requires manual application by a curator", `:268-274`). No type exists for a part key, a descriptor or a new value. Approval "stays a human act: one INSERT into schema_proposal_reviews, run as postgres" (`20261007100000_schema_proposal_apply_add_source.sql:46-51`, read). | Two proposal types (`add_subject`, `add_descriptor`) and an apply branch each, plus an apply branch for `modify_property` that appends a value. Approval stays as it is (owner decision 1). |
| `evidence_judgment_requests` as the closed-question store | a second question kind | Does not hold until two functions change. | `evidence_judgment_ineligibility` returns `unknown_question_kind` for anything but `receipt_part_visible` (`20261111210500_receipt_work_reconciliation.sql:408`), so `claim_evidence_judgments` skips it (`:605`); `evidence_judgment_answer_problems` refuses it (`:623`) (read). | Both functions dispatch by `question_kind`. Two kinds added: `photo_map_answer`, `map_placement`. |
| | who answers | Nothing in the repository. | `claim_evidence_judgments` and `answer_evidence_judgment` have no caller outside the SQL contract test (grep, read). The 158 answered rows in production were written by something not in this checkout (inferred). | One worker script for the Mac lane. |
| | agreement between readers | Does not hold in this store. | One row holds one answer; an older answer moves to `answer_history` only on reopen (`:685-719`, read). | The store records asking and answering. Agreement is computed over the landed observations. |
| `ingest-observation` with witnesses as the landing | one claim, thirteen proofs | Does not hold as one row. | The trigger writes exactly one witness per observation, from `structured_data.image_id`, role `derived` (`20261002213353_enforce_atomic_image_witnesses.sql:45-71`, read). | One answer row per photo. The claim is a fold over rows that share a key. |
| | the existing keyed path for photo readings | Closed to owner photos. | `ingest_cached_image_property_batch` refuses a vehicle that is not public (`20261004064216:127`), an image that is not a BaT or Craigslist URL (`:133`) and any key but three (`:94`) (read). The CLI mode that feeds it has no other route (`scripts/deep-image-analysis-byok.mjs:1238-1277`, `image-property-projection.mjs:98-133`, read). | Land through the single-claim path of `ingest-observation`. |
| | a corrected reading replaces the first | Not by a lane. | `supersede_observation` requires `auth.uid()` (`20260709140000_supersede_observation.sql:47-51`, read). A service-role job has none. | The fold takes the newest answer per reader, photo and claim. A reopened or withdrawn question removes its answer from every count. The log keeps all rows. |
| | resolving a label to a key | Not in the writer. | `descriptor_key` is matched against `condition_taxonomy.canonical_key` only; `condition_aliases` is not read (`index.ts:961-967`, read). | One resolver function used before the writer. The writer accepts canonical keys only. |

---

## 2. THE MAP (answer 1)

### 2.1 Where each thing lives

| Thing | Home | Key | Why this one | What is added |
|---|---|---|---|---|
| A part of a car | `subject_taxonomy` (106 rows, dot keys with side: `door.front.driver`, `glass.windshield`, `engine.valve.cover`; columns `subject_key`, `display_name`, `domain`, `category`, `side`, `parent_subject_id`, `canonical_angles`, `is_active`: `docs/library/reference/dictionary/tables.md:6636-6658`, read) | `subject_key` (text), `subject_id` (uuid) | The only vehicle-independent list of places on a car that has side, a parent chain and "which views show it". Two image tables already hold foreign keys to it (`20261008004000_describe_image_coordinate_observations.sql:93-96`, read). | Rows (hood, bed, tailgate, cab seams, mouldings, felts ...). No column. |
| Other spellings of a part | new `subject_taxonomy_aliases` | `alias_key` (normalised label) to `subject_id` | Its two sibling dimensions each have exactly this table: `angle_aliases` (`20251216000001_angle_pose_observations_v1.sql:24-29`, read) and `condition_aliases` (299 rows). `subject_taxonomy` is the one without. | The table. |
| A state of a part (paint stage, assembly, wear) | `observation_properties`: one row per kind of state | `property_key` | The writer resolves it to `vehicle_observations.property_id`; `schema_proposals` can add one; the existing fold `vehicle_canonical` partitions on it. | Rows: `part_paint_stage`, `part_assembly_state`, `part_wear_state`. |
| The possible values of a state, and what each looks like | `observation_properties.value_spec` (new column) | value key inside the row | One place the writer, the question builder and every reader read. Replaces the prose and the hand-kept copies. | The column. |
| A kind of imperfection | `condition_taxonomy` (202 rows) | `canonical_key` (text), `descriptor_id` (uuid) | Real foreign key on the log, resolved by the writer today, with alias memory (`condition_aliases`), and shared with text claims from listings (C26). A photo answer and a seller's sentence about the same flaw meet on one key. | Rows for paint-process flaws (orange peel, crazing, rust bleed, torn label ...). |
| Which imperfections a photo is asked about, and what each looks like | `value_spec` of the property `part_imperfection` | list of descriptor keys | `condition_taxonomy` holds about 90 fragments parsed from a manual (the facts read from production on 2026-11-10 (C17)). Asking from the whole table would ask junk. The list in the property row is the curated, growing set. | Row `part_imperfection`. |

### 2.2 What is not chosen, and what happens to it

Nothing below is deleted or retired (liveness rule 1). Each stays what it is.

- `component_assembly_map` (3 rows): its `possible_states` mix four different dimensions in one list (location, coating,
  repair, completeness: `20251206_component_assembly_map.sql:55`, read), it is scoped to 1973-87 trucks (`:67-68`), it has
  no key, no writer validates against it and no proposal type grows it. Its content is used twice as seed: its
  `state_indicators` text becomes the first `looks_like` text of the paint and assembly values (for example `in_primer`:
  "gray primer visible, no color paint, taped edges", `:61`), and its `sub_components` lists become the first part keys
  under door, front clip, bed and seat (`:54, :77, :96, :116`). It is not read at run time in this build.
- `component_definitions` (16 rows): a catalogue of part designs for one make and year range (which grille a 1977 has).
  That is a different grain from "the hood of this truck". A design can point at a part key later.
- `condition_component_definitions`, `condition_knowledge`: reference text of mixed quality. Not read in this build.
- The 113 digital-twin tables: one table per part with the state as a column. This is the shape the owner called the scar.
- `image_question_answers` (1,021 rows): an earlier answer store. Its columns `validated_by_receipt`, `validated_by_user`,
  `is_consensus_answer` name exactly the levels of proof this design computes in a fold. Its question keys are made up per
  photo and its rows are outside the observation log. Its rows are retained readings that the same harvest can key later.
- `attribute-registry.ts` (cockpit checklist in code): a second registry. Untouched.

### 2.3 The owner's two rules

- "Never baked as schema categoricals": no enum type, no CHECK list of states, no table per category. A value, a part and
  a kind of imperfection are each a row or an element of a row, added through `schema_proposals`. The schema gains one
  generic column and one alias table, once.
- "A table is born attached, described, owned and read": `subject_taxonomy_aliases` is attached by foreign key to
  `subject_taxonomy.subject_id` (and to the judgment that decided it), described by `COMMENT ON`, owned by a
  `pipeline_registry` row naming `record_map_alias`, and read by `map_resolve_key` and the question builder.

### 2.4 The shape of `value_spec`

```json
{
  "spec_version": 1,
  "enforce": true,
  "choice": "one",
  "ask": "What paint stage is the {part} in?",
  "subject": {"key": "part_key", "table": "subject_taxonomy", "domains": ["exterior"]},
  "witness": "image",
  "values": [
    {"key": "bare_metal", "label": "Bare metal", "looks_like": ["bright or grey steel", "sanding or grinder marks", "no coating"]},
    {"key": "primer", "label": "Primer", "looks_like": ["flat grey, buff or red-oxide coat", "no gloss", "tape lines or sanding scratches"],
     "does_not_establish": "a respray"},
    {"key": "sealer", "label": "Sealer"}, {"key": "base", "label": "Colour coat"}, {"key": "clear", "label": "Clear coat"}, {"key": "aged", "label": "Aged finish"}
  ]
}
```

For `part_imperfection` the same shape with `"choice": "many"`, `"presence": ["present", "absent"]`, and each element of
`values` carrying `"key"` = a `condition_taxonomy.canonical_key`, `"descriptor": true`, `"looks_like"`, `"severity"` (the
words allowed for that kind) and `"domains"` (which parts it can be asked of).

The three whole-photo properties that exist today (`image_visible_rust_severity`, `image_visible_paint_stage`,
`image_visible_assembly_state`) get a `value_spec` holding the values their description already states, with
`"enforce": false`. Nothing about them changes; their values stop being prose.

### 2.5 The seed map (data, in one migration, as approved proposals)

Four properties: `part_paint_stage` (bare_metal, primer, sealer, base, clear, aged: the vocabulary the registry already
uses for whole photos), `part_assembly_state` (absent, stripped, partial, assembled), `part_wear_state` (fresh,
serviceable, worn, failed), `part_imperfection` (present, absent, with a descriptor). All `data_type enum`, `category
condition`, `applies_to_kinds {condition}`, `cardinality multi`, `discriminator_key claim_key`, `namespace_request core`.

Part keys: the panel-level parts every vehicle of a body style has, taken from the lists already in the repository
(`component_assembly_map.sub_components`), written in the naming the 106 existing keys use. Window felts are in the door
list there (`weatherstrip_window`, `:54`), so the first acceptance question has its key from day one.

Imperfection kinds: the paint and body flaws a photo can show. Existing descriptors are reused where they exist
(`exterior.metal.oxidation` and `exterior.paint.fading` are already on the first vehicle's older rows per the facts read from production on 2026-11-10 (C17)).

The exact lists are written after reading the 106 keys and the 202 descriptors (section 14). The shape does not depend on them.

---

## 3. THE QUESTIONS (answer 2)

### 3.1 One function builds the list

`photo_map_questions(p_vehicle_id uuid, p_image_ids uuid[] DEFAULT NULL) RETURNS SETOF jsonb`, `STABLE`, `SECURITY
DEFINER`, service role only. Each returned row is ready for the existing `raise_evidence_judgment(p_row, p_run_id)`
(`20261111210500:465-503`, read). No reader, script or prompt file holds a list of parts, states or flaws. Every lane
(the Mac today, an edge function or the phone later) gets the same list for the same photo.

One question is one photo, one part, one property. Inputs, all registry rows or stored rows:

| Input | Read from | What it decides |
|---|---|---|
| The map | `observation_properties` rows with `value_spec.enforce`, `namespace = 'core'`, `ratified_at` set, `deprecated_at` null | Which properties exist, their values and what each looks like |
| This vehicle and its kind | `vehicles` (year, make, model, body_style) | Put into each question so the reader knows what it is looking at |
| What earlier readings said | Current `vehicle_observations` of the vehicle: stored deep readings (`structured_data.analysis_kind = 'image_deep_byok'`, their `components_seen[].label` resolved by `map_resolve_key`) and already-landed part answers (index `idx_vehicle_observations_property (vehicle_id, property_id)`, `20261109000056:39`, read) | Which parts are worth asking about, and which claims still have one reader |
| Point of view | `image_photo_zones(angle, vehicle_zone, scene_type, apple_ml_labels)` and `image_photo_end(angle, vehicle_zone)` (`20261111210500:99-125`, read) against `subject_taxonomy.canonical_angles` and `side` | Which parts this photo can show |
| The job in hand | From pull request 9: `receipt_work_lines(vehicle)` line descriptions resolved to part keys | Adds parts a receipt names, for photos taken on or after the purchase date |
| What was already asked | `evidence_judgment_requests` by `vehicle_id` (index `evidence_judgment_requests_vehicle`, `:376`, read) | Never ask the same question of the same photo twice |

### 3.2 Which parts a photo is asked about

A part is in view for a photo when one of these is true:
1. A stored reading of that photo named the part (the label resolves to a key). This is the strongest signal and is free.
2. The part has a claim on this vehicle, and the photo's zones intersect the part's `canonical_angles`, and the part's
   `side` does not contradict the photo's end or side when those are known.
3. (pull request 9) A receipt line names the part, the photo is dated on or after the purchase, and rule 2's view test passes.

### 3.3 Which questions are worth a model call

A photo is asked again only where the answer changes something:
- **Second reader.** A claim has answers from one reader only. Ask the other reader on at most two of its photos (the two
  where the stored reading gave the largest box). A claim seen in thirteen photos costs two calls, not thirteen.
- **Gap.** A stored reading named a part in this photo and said nothing about a state that applies to it, and no other
  photo of the same capture day already answers it from two readers.
- **Disagreement.** Two readers gave different values for one claim. Ask once more on a photo neither has answered.
- Never: a question already pending, claimed or answered for this photo; a photo that fails the frame rule (3.5).

### 3.4 The question never contains an earlier answer

Earlier readings choose which part and which property to ask. They are never quoted in the question. The paint question
lists every value. The imperfection question lists every kind that applies to the part's domain, not the one that was
claimed. A second reader that was told the first answer is not a second reader. A contract test asserts that no string
from a prior answer appears in `params`.

### 3.5 One row in `evidence_judgment_requests` per question

| Column | Value |
|---|---|
| `department` | `photo_map` |
| `question_kind` | `photo_map_answer` |
| `subject_table`, `subject_id` | `vehicle_images`, the photo's id |
| `vehicle_id`, `user_id` | the vehicle; the photo's owner |
| `params` | `{property_key, part_key, part_label, choice, allowed: [{key, label, looks_like}], ask, vehicle: {year, make, model, body_style}, why_asked, view: {zones, end}, asked_of: "pixels", map_hash}` |
| `answer_schema` | built by code from the same `value_spec` (section 4) |
| `priority` | the same number for every question of one photo, so one photo's questions are claimed together |
| `dedupe_key` | sha256 of department, kind, photo id, `question_hash` (the convention at `scripts/receipt-work/reconcile-receipt-work.mjs:63-64`, read) |
| `question_hash` | sha256 of the canonical `params` and `answer_schema`: a changed value list is a new question, and the old one is retired with `retire_kind = 'content_changed'` through the existing `retire_evidence_judgment` |
| `producer_agent`, `producer_script`, `producer_version`, `run_id` | the worker, signed `<git sha>:<script>` as the receipt producer does |

Frame rule: the existing `receipt_work_frame_eligible(vehicle_images)` (`:143-151`, read): dated, approved by the vision
gate, not sensitive, not a duplicate, not superseded, not a document, not redacted, not a screenshot or reference picture.
It is checked when the question is built, again at claim and again at answer, as the store does for receipt questions.

---

## 4. THE ANSWERS (answer 3)

### 4.1 The closed shape

```json
{
  "seen": "yes",
  "values": [{"key": "primer", "bbox": [120, 80, 870, 540], "confidence": 0.86, "severity": null,
              "quote": "flat red-brown coat across the panel, no gloss"}],
  "other": []
}
```

- `seen`: `yes`, `not_visible` (the part is not in the frame) or `cannot_tell` (it is in the frame and the photo does not
  settle the question). These are the owner's yes, no and cannot see, with "no" kept apart from "not in the picture".
- `values[].key`: one of `params.allowed`. `choice one`: exactly one element when `seen = yes`. `choice many`: zero or
  more; zero means none of the listed kinds is present on the part.
- `bbox`: where in the photo, `[x1, y1, x2, y2]` on the 0-999 grid the store already uses (`:636-643`, read).
- `confidence`: 0 to 1. `quote`: one sentence on what in the frame shows it. `severity`: one of the words the kind allows.
- `other`: things seen on the part that are not on the list, as `{label, bbox}`. This is the only free text. It never
  lands; it goes to section 6.
- Who answered and from what: the store's own columns `answer_agent`, `answer_model`, `answer_version`, `answered_at`,
  `claimed_by`, plus `params.asked_of`.

`evidence_judgment_answer_problems` refuses anything else: a key outside `params.allowed`, two values on a single-choice
question, a value with `seen` other than `yes`, a malformed box. "A malformed answer is refused, not coerced" is the
store's rule today (`:586-587`, read).

### 4.2 What the store keeps and what the log keeps

Every answer stays in `evidence_judgment_requests`, including `not_visible` and `cannot_tell`. That is the record of what
was asked of which photo; it stops re-asking and it is the denominator for coverage. Only an answer with `seen = yes`
becomes testimony in `vehicle_observations` (section 7). "Unknown is an answer" is kept; it is not written as a fact
about the vehicle.

### 4.3 The second question kind: placing a stored phrase on the map

`map_placement` is the closed decision "is this the same as one of these, broader than what was said, or new". It is
asked of text, never of a photo.

| Column | Value |
|---|---|
| `subject_table`, `subject_id` | `vehicle_observations`, the stored reading that first held the phrase (or `receipt_items` and the line, pull request 9) |
| `params` | `{phrase, phrase_norm, ask: ["part"] or ["part", "what"], vehicle, part_candidates: [{key, label, parent}], what_candidates: {properties: [{property_key, values}], kinds: [{key, label}]}}` |
| `dedupe_key` | sha256 of department, kind, vehicle id, `phrase_norm`, `ask`. The same phrase in thirteen readings is one question. |
| answer | `{about_vehicle: true, part: {match: "exact" or "broader" or "none", key, finer_label}, what: {match, property_key, value, descriptor_key, finer_label, severity}, confidence}` |

Every key in the answer must be one of the candidates in `params`; the validator refuses any other.

---

## 5. FACT (answer 4)

### 5.1 One claim, many proofs

A claim is identified by: vehicle, property, part key, and for an imperfection the descriptor. Thirteen photos showing
the hood in primer are thirteen rows in `vehicle_observations`, each with the same `property_id` and the same
`structured_data.part_key`, each with its own `observation_witnesses` row. The fold groups them: one claim, thirteen
proof photos. Nothing is copied into a claims table. The owner's rule for labels applies: the claim and its level of
proof are computed when read.

### 5.2 The fold

`vehicle_part_claims(p_vehicle_id uuid, p_as_of timestamptz DEFAULT now()) RETURNS SETOF jsonb`. It reads rows with
`ingested_at <= p_as_of`, so the state at any earlier moment can be replayed from the log.

Per claim it returns: current value; the values seen on each capture day (from the witness photo's `taken_at`, read at
query time, never baked into the row); number of photos; the readers (model and prompt); proof photo ids with boxes;
answers that disagree; receipt lines on the same part; the owner's word if given; and the level of proof.

Rules inside the fold:
- **A reader re-reading a photo**: the newest answer per reader, photo and claim counts. Both rows stay in the log.
- **A withdrawn or reopened question**: a row counts only while its question is `answered` (join on
  `structured_data.judgment_id`). When a reader version is rolled back with the existing
  `reopen_evidence_judgment_answers(version, reason)`, its answers leave every count and every reader at once. When a
  photo is later marked sensitive, a duplicate or superseded, the public branch of every reader stops showing it at
  read time (section 8.1 tests the photo itself), and the worker's next run retires its questions with the store's
  existing `retire_kind = 'frame_withdrawn'` (`20261111210500:372`, read), which removes them for the owner's counts too.
- **An answer landed on a broader key and later on a finer one** (section 6.5): counted once, at the finer key.

### 5.3 Levels of proof, and what carries each

| Level | Rule | Existing rows that carry it |
|---|---|---|
| read | one reader, one photo | one `vehicle_observations` row and its witness |
| repeated | one reader, two or more photos, same value on the same capture day | `count(distinct observation_witnesses.image_id)` |
| agreed | two or more independent readers give the same value, no unresolved disagreement on that day | distinct `structured_data.reader` (model and prompt); a reading harvested from the deep read and a pixel answer from the Mac reader are two readers |
| validated (reachable from pull request 9, when receipt lines are placed on part keys) | repeated or agreed, and a receipt line resolves to the same part (or its parent) with a date consistent with the photos | `receipt_items` through `receipt_work_lines(vehicle)`; the existing `receipt_part_visible` answer when one exists; the line's description resolved by `map_resolve_key` |
| confirmed by the owner | the owner's own word on the same keys | a `vehicle_observations` row from source `owner-input`, `extraction_method = 'owner_confirmed_v1'` (the method `agent-chat/index.ts:433-441` already writes, read), which gets the +0.30 at `ingest-observation/index.ts:1165` |
| disputed (a flag, not a level) | answers for one claim and day differ | both rows, shown side by side |
| rejected by the owner | his word says no | `extraction_method = 'owner_rejected_v1'`; the claim is shown as rejected and leaves every count of facts |

### 5.4 What is never promoted automatically

- No model answer reaches "validated" or "confirmed". Validation needs a receipt row. Confirmation needs the owner's
  signed-in session: the writer admits `owner_confirmed_v1` on a part property only when the caller is a user who owns
  the vehicle (`writeGuard.ts:55-59` gives the caller kind, read), and refuses it from the service role.
- Every model answer keeps `agent_inferred = true`, so its `confidence_score` stays at or below 0.6 (`index.ts:1176-1179`, read).
- Nothing here writes `vehicles` columns, `field_evidence`, `component_events`, `work_sessions`,
  `vehicle_change_claims` or any digital-twin table.
- "Replaced", "repaired" and "installed" are never asserted from photos alone. The fold reports that a state differs
  between two dated sets of photos. A purchase is never read as an installation (the deep-read prompt's own rule).

### 5.5 A later photo showing the opposite: the repair

Using what exists, in two steps.

1. **Recorded as testimony, at once.** The later photo's answer is a new row with the same claim key and a different
   value (`part_imperfection = absent`, or `part_paint_stage = clear`). Nothing is superseded: supersession in this log
   means a corrected reading, not a physical change. The fold returns the claim with two periods and a `change` object:
   from value, to value, last photo before, first photo after, proofs on each side.
2. **Shown in an existing consumer.** When a change has photos on both sides, the worker writes one `work_record`
   observation under the existing `visual_work_v1` contract through `ingest-observation`: `visual_sources` with roles
   `before` and `after`, title built from the keys ("Hood: primer to clear"). That contract (source `internal-inference`, `extraction_method = 'visual_work_v1'`, confidence at or below 0.6, one to
   twelve `visual_sources`: `20261110053000_visual_work_receipt_text.sql:31-50`, read) has a reader and a page and no
   producer today (`20261109235000_visual_work_build_log_reader.sql:139-205`, `useVisualWork.ts:28`, read). The reader
   already refuses a before photo later than its after photo (`20261110053000:72-73`) and promotes nothing.

The durable change claim (`vehicle_change_claims` kind `repair`, `paint`, `body`, `part_installed`, with
`vehicle_change_claim_support` rows citing each photo: `20261021220000_image_evidence_tables.sql:362-419`, read) is the
third step, taken when its writers exist. The writers migration `20261021221000` is not in this checkout (`ls`, read) and
`AGENTS.md` says it is not live until it deploys. When it is, the worker calls `propose_change_claim` and
`propose_claim_support`, and the owner decides with `decide_evidence`. This build does not depend on it.

The first vehicle cannot show a change from its own data: all 47 photos carry one date and the deep reader noted the stamps look
batch-written (the facts read from production on 2026-11-10 (C17)). The change path is proven on a fixture in CI and on the first vehicle only if its other 34 photos carry
other dates (section 14).

---

## 6. CONSISTENCY (answer 5)

The owner's caution: "if it writes too much and wrong and new every time". The mechanics below make the same thing land
on the same key whoever the reader is.

### 6.1 Lookup order (one function, used by every lane)

`map_resolve_key(p_dimension text, p_label text) RETURNS TABLE(key text, id uuid, via text)`; `p_dimension` is `part` or `kind`.
1. The label is already a canonical key (`subject_taxonomy.subject_key` with `is_active`, or
   `condition_taxonomy.canonical_key` with `deprecated_at` null, following `replaced_by_descriptor_id`). `via = 'key'`.
2. The normalised label (`map_label_norm`: lower case, every run of non-alphanumerics to one space, trimmed) is in the
   alias table: `subject_taxonomy_aliases` or `condition_aliases`. `via = 'alias'`.
3. Nothing. The caller goes to 6.3.

The writer never resolves aliases. It accepts canonical keys only, and the trigger checks them. An alias can never
become a second key for the same thing.

### 6.2 Alias memory

`subject_taxonomy_aliases(id, alias_key, subject_id → subject_taxonomy, decided_by_judgment_id → evidence_judgment_requests,
created_by, created_at, retired_at)`, unique on `alias_key` where `retired_at` is null. For kinds, the existing
`condition_aliases(alias_key, descriptor_id, taxonomy_version, created_at)`.

Written only by `record_map_alias(p_dimension, p_label, p_key, p_judgment_id, p_created_by)`: it checks that the named
judgment is an answered `map_placement` whose answer says `match = exact` with that key. An alias that already points at
the same key returns `unchanged`. One that points elsewhere raises: a conflict is never overwritten. A wrong alias is
retired by a migration (`retired_at`), after which the label can be decided again.

A label that names a side as left or right is not stored as an alias, because which side that is depends on the vehicle.
It is decided per vehicle and remembered in that vehicle's placement question.

### 6.3 The closed decision

When the lookup finds nothing, the worker raises one `map_placement` question (4.3). The candidates are built by code:
every active part key in the domains the properties apply to, shown as key, label and parent; every value of every
property; every kind listed in `part_imperfection`. The reader may only pick from them or say none.

- `exact`: call `record_map_alias`. The next reader that meets this spelling gets the key from the lookup and never asks.
- `broader`: the reading is finer than any key. Go to 6.4 and 6.5.
- `none`: nothing on the map is even a parent. Go to 6.4 and park the datum.
- `about_vehicle = false` (a floor jack, a garage door): remembered in the question; never asked again for this vehicle.

The decision is asked once per vehicle and phrase. Its answer is stored with model, version and time. A bad run of
placements is undone with the store's own `reopen_evidence_judgment_answers`, and by 5.2 everything landed from it
leaves the counts.

### 6.4 Writing the place

A new key is proposed by code, not by the model. The model chose the parent from the list; the code builds the key as
parent key, a dot, and the label's remaining words in their order, joined by underscores. The same label under the same
parent always gives the same key.

Before proposing, a second closed check runs in the same batch: "is `<label>` the same thing as any of these ten?", the
ten being the keys that share a word with the label or sit under the chosen parent. Only two "no" answers lead to a proposal.

One row goes into `schema_proposals`:

| Column | Value |
|---|---|
| `proposal_type` | `add_subject` (a part), `add_descriptor` (a kind of imperfection), `modify_property` (a new value of a state), or the existing `add_property` (a new kind of state) |
| `payload` | `{key, parent_key, label, side, canonical_angles, aliases: [phrase_norm], looks_like: [...]}`; for a value: `{property_key, add_value: {key, label, looks_like}}` |
| `evidence` | `[{observation_id, vehicle_id, sample_value: phrase, observed_via: "map_placement", judgment_id, image_id, observed_at}]`, the item shape `api-v1-events/index.ts:339-345` uses (read) |
| `motivating_observation_ids` | the stored readings that held the phrase: the reading that forced it |
| `motivating_pending_claim_ids` | the parked rows, when there are any |
| `proposed_by_agent_key` | `<git sha>:<script>` |
| `status` | `open` |

An open proposal for the same type and key is cited again, not duplicated (`api-v1-events/index.ts:327-358`, read).
Approval is the existing review insert. On approval the new apply branch inserts the `subject_taxonomy` or
`condition_taxonomy` row, its aliases, and for a kind or a value the element in the property's `value_spec`.

A new shape (a new property, a column, a table, an observation kind) is never written at run time. It goes through a
migration, as it does today.

Three guards against writing too much: a cap of ten new proposals per vehicle per run, after which the worker parks and
stops proposing; no new top-level keys at run time; and the number "new keys per hundred answers" in the measure
(section 11), which should fall as vehicles are added.

### 6.5 What happens to a datum while its place is pending

- **A broader key exists** ("surface rust at the upper cab seam" when only the cab has a key): the answer lands now on
  the broader key, with `structured_data.finer_label` holding the reader's words and `pending_proposal_id` pointing at
  the proposal. It is keyed, connected and proven today, at a coarser grain. When the finer key is approved, the worker
  lands the same answer again at the finer key (a new `source_identifier`; same `judgment_id`), and the fold counts it once.
- **No broader key exists**: the datum is parked in the existing `pending_claims` table with `proposal_id`, `status =
  'awaiting_proposal'`, `attempted_property_key`, `attempted_value`, `attempted_structured_data` (the columns
  `api-v1-events/index.ts:394-406` writes, read). Its source text stays where it was, in the stored reading. After
  approval the worker lands it.
- In neither case is the reading lost, guessed or stored under an invented key.

---

## 7. LANDING (answer 6)

### 7.1 The writer

Every row goes through `POST /functions/v1/ingest-observation` (single-claim path), called by the worker with the service
key under `dotenvx`. No raw insert, update or delete on `vehicle_observations` or `observation_witnesses`.

Two changes make it accept the new keys, and no key is typed into either:
1. `ingest-observation/index.ts:979-984` and `imageProperties.ts:68-71`: also admit a `property_key` whose registry row
   has `value_spec.enforce = true` (the lookup at `:985-987` selects `value_spec` too). A caller that sends
   `extraction_method = 'owner_confirmed_v1'` or `'owner_rejected_v1'` on such a property must be a signed-in user who
   owns the vehicle; the function writes his user id into `observer_raw.owner_user_id` from the token, not from the body.
2. Trigger `trg_enforce_registry_property`, `BEFORE INSERT ON vehicle_observations FOR EACH ROW WHEN (NEW.property_id IS
   NOT NULL)`, function `enforce_registry_property()`. For a property whose `value_spec.enforce` is true it refuses the
   row unless: the value is one of the spec's values (or `present` / `absent`); `structured_data.part_key` is an active
   `subject_taxonomy.subject_key`; `claim_key` equals the part key (states) or part key, a bar, and the descriptor's key
   (imperfections); a property whose values are descriptors has `descriptor_id` set to one of them; `structured_data`
   has `image_id` when the spec says the witness is an image; and a model's row names a `judgment_id` that is an answered
   question of this vehicle. Rows of every other property return untouched. This is the gate every writer passes,
   including SQL batch writers that never go through the edge function.

### 7.2 The row for one pixel answer

Request:

| Field | Value |
|---|---|
| `source_slug`, `kind` | `photo_pipeline`, `condition` (the source and kind the deep read uses: `reviewedAnalysis.ts:108`, read) |
| `vehicle_id` | the vehicle |
| `property_key` | `part_paint_stage`, `part_assembly_state`, `part_wear_state` or `part_imperfection` |
| `descriptor_key` | for `part_imperfection`: the kind, for example `exterior.metal.oxidation` |
| `observed_at` | the question's `answered_at` (stable, so a retry is a duplicate) |
| `source_identifier` | `photo_map_answer_v1:<judgment id>:<value key>:<part key>` |
| `content_text` | built from labels: "Hood: paint stage primer" |
| `agent_inferred`, `defer_analysis` | `true`, `true` |
| `agent_model`, `extraction_method`, `raw_source_ref` | the answering model; `photo_map_answer_v1`; `evidence_judgment_requests:<id>` |
| `structured_data` | `{"<property_key>": "<value>", "property_key", "part_key", "claim_key", "image_id", "image_region": {"label", "bbox"}, "severity", "judgment_id", "answer_basis": "pixels", "reader": {"model", "prompt": "photo_map:<map_hash>"}, "confidence", "quote", "finer_label", "pending_proposal_id", "analysis_kind": "photo_map_answer", "claim_role": "inferred", "observed_at_basis": "answer_recorded_at", "capture_at": null, "limitation": "One reader's answer about one photo."}` |

Rows written:
- One `vehicle_observations` row: `property_id` set by the writer, `descriptor_id` set for an imperfection,
  `content_hash` from `observationContentHash` (`_shared/observationContentHash.ts:9-24`, read), `confidence_score` at or below 0.6.
- One `observation_witnesses` row, written by the existing trigger: `(observation_id, image_id, witness_role = 'derived')`.
  The trigger aborts the insert if the photo belongs to another vehicle (`20261002213353:59-61`, read).

A second POST of the same answer returns `duplicate: true` and the same `observation_id` (`index.ts:1026-1034`, read).

### 7.3 The row for a harvested answer

The same row, with: `extraction_method = 'photo_map_harvest_v1'`; `agent_model` = the stored reading's own model
(the stored reading's model on the first vehicle); `observed_at` = the stored reading's `ingested_at`; `raw_source_ref =
'vehicle_observations:<stored reading id>'`; `structured_data.answer_basis = 'stored_reading'`; `reader = {model, prompt:
'byok_v3_camera_pose_2026-05-23', observation_id}`; `placed_by = {judgment_id, model, version}`; `source_text` = the
reader's own phrase; `judgment_id` = the placement question; `bbox` only when the stored reading gave one for that part.
`image_id` is the stored reading's photo, so the witness row is that photo. Who looked at the pixels (the deep reader)
and who placed the words on the map (the worker's model) stay two separate, named things.

### 7.4 Other rows

- `evidence_judgment_requests`: through `raise_evidence_judgment`, `claim_evidence_judgments`,
  `answer_evidence_judgment`, `retire_evidence_judgment` (existing, service role, top-level RPC).
- `image_stage_receipts`: through the existing `record_image_stage_receipt(image, 'map_answers', 1, outcome, ...)`
  (`20261113110000:179-201`, read), one per photo shown to a model. The stage is one new row in `image_pipeline_stages`
  with `required = false`, so the reconciler never queues it; the ledger then says which photo was asked under which version.
- `subject_taxonomy_aliases`, `condition_aliases`: through `record_map_alias`.
- `schema_proposals`, `pending_claims`: inserts by the worker. Both are the proposal layer, not testimony
  (`api-v1-events/index.ts:279-280`, read; neither is in the testimony list of `.claude/rules/db-safety.md`).

---

## 8. READERS (answer 7)

### 8.1 The shared part of every query

Current answers about parts, with their photo, as the caller is allowed to see them. The public branch states the whole
visibility test; it mirrors the existing witness policy (`20261021000000_derived_witness_policy_reads_public_view.sql:7-23`,
read) and adds `deleted_at` and `listing_kind`.

```sql
WITH part_answers AS (
  SELECT o.id AS observation_id, o.vehicle_id, p.property_key, t.canonical_key AS kind_key,
         o.structured_data->>'part_key'                                      AS part_key,
         o.structured_data->>p.property_key                                  AS value,
         coalesce(o.structured_data#>>'{reader,model}',  o.agent_model)      AS reader_model,
         coalesce(o.structured_data#>>'{reader,prompt}', o.extraction_method) AS reader_prompt,
         o.extraction_method, w.image_id, i.taken_at, o.structured_data->'image_region'->'bbox' AS bbox
  FROM   public.observation_properties p
  JOIN   public.vehicle_observations o ON o.property_id = p.id AND o.is_superseded = false
  JOIN   public.vehicles v             ON v.id = o.vehicle_id
  LEFT JOIN public.condition_taxonomy t ON t.descriptor_id = o.descriptor_id
  LEFT JOIN public.observation_witnesses w ON w.observation_id = o.id AND w.witness_role = 'derived'
  LEFT JOIN public.vehicle_images i        ON i.id = w.image_id AND i.vehicle_id = o.vehicle_id
  LEFT JOIN public.evidence_judgment_requests j ON j.id = (o.structured_data->>'judgment_id')::uuid
  WHERE  p.value_spec #>> '{subject,key}' = 'part_key'
    AND  (o.extraction_method IN ('owner_confirmed_v1', 'owner_rejected_v1') OR j.status = 'answered')
    AND  ( auth.role() = 'service_role'
        OR auth.uid() IN (v.user_id, v.owner_id, v.uploaded_by)                -- the owner reads his own, private or not
        OR ( v.is_public = true AND v.deleted_at IS NULL AND coalesce(v.listing_kind, '') <> 'non_vehicle_item'
             AND public.observation_is_public(o.kind, o.structured_data)
             AND EXISTS (SELECT 1 FROM public.vehicle_images_public ip
                          WHERE ip.id = w.image_id AND ip.vehicle_id = o.vehicle_id
                            AND coalesce(ip.is_sensitive, false) = false
                            AND public.vehicle_image_gallery_eligible(ip.*)) ) )
)
```

### 8.2 Q1: Mustangs whose window felts were replaced during a restoration, with photographic proof

```sql
, felt AS (SELECT subject_key FROM public.subject_taxonomy
            WHERE is_active AND (subject_key = 'door.window.felt' OR subject_key LIKE 'door.window.felt.%'))
, a AS (SELECT * FROM part_answers
         WHERE property_key = 'part_wear_state' AND part_key IN (SELECT subject_key FROM felt)
           AND image_id IS NOT NULL AND taken_at IS NOT NULL)
, swap AS (                       -- worn on an earlier day, fresh on a later day, the same felt
  SELECT old.vehicle_id, old.part_key,
         max(old.taken_at)::date AS last_seen_worn, min(new.taken_at)::date AS first_seen_fresh,
         array_agg(DISTINCT old.image_id) AS before_photos, array_agg(DISTINCT new.image_id) AS after_photos,
         count(DISTINCT new.reader_model || ' / ' || new.reader_prompt) AS readers_after
  FROM a old JOIN a new ON new.vehicle_id = old.vehicle_id AND new.part_key = old.part_key
                       AND new.taken_at::date > old.taken_at::date
  WHERE old.value IN ('worn', 'failed') AND new.value = 'fresh'
  GROUP BY 1, 2)
SELECT v.id, v.year, v.make, v.model, s.*,
       (SELECT count(DISTINCT x.part_key) FROM part_answers x      -- "during a restoration", computed, not stored
         WHERE x.vehicle_id = s.vehicle_id AND x.part_key <> s.part_key
           AND x.taken_at::date BETWEEN s.last_seen_worn AND s.first_seen_fresh) AS other_parts_photographed_in_window,
       (SELECT jsonb_agg(jsonb_build_object('receipt_item_id', r.item_id, 'purchase_date', r.anchor_date,
                                            'description', r.description))
          FROM public.receipt_work_lines(s.vehicle_id) r
         WHERE r.line_kind = 'part'
           AND EXISTS (SELECT 1 FROM public.map_resolve_key('part', r.description) k
                        WHERE k.key = s.part_key OR s.part_key LIKE k.key || '.%')) AS receipt_lines
FROM swap s JOIN public.vehicles v ON v.id = s.vehicle_id
WHERE v.make ILIKE 'ford' AND v.model ILIKE '%mustang%';
```

"Replaced" is returned as its evidence: photos of the felt worn, photos of it fresh on a later day, and any receipt line
for a felt. "During a restoration" has no stored entity anywhere in the model (`model.json` finding 9, read); the query
returns how many other parts were photographed inside the same window and the reader applies a threshold (owner decision 5).

### 8.3 Q2: a Porsche that has a specific imperfection

```sql
SELECT a.vehicle_id, v.year, v.model, a.part_key, a.kind_key,
       count(DISTINCT a.image_id) AS photos,
       count(DISTINCT a.reader_model || ' / ' || a.reader_prompt) AS readers,
       min(a.taken_at) AS first_seen, max(a.taken_at) AS last_seen,
       jsonb_agg(DISTINCT jsonb_build_object('image_id', a.image_id, 'bbox', a.bbox)) AS proofs
FROM part_answers a JOIN public.vehicles v ON v.id = a.vehicle_id
WHERE a.property_key = 'part_imperfection' AND a.value = 'present'
  AND a.kind_key = $1                                           -- for example 'exterior.paint.crazing'
  AND ($2::text IS NULL OR a.part_key = $2 OR a.part_key LIKE $2 || '.%')
  AND v.make ILIKE 'porsche'
GROUP BY 1, 2, 3, 4, 5;
```

### 8.4 Q3: that imperfection was repaired, and it is now this restored Porsche

```sql
, flaw AS (SELECT * FROM part_answers WHERE property_key = 'part_imperfection' AND kind_key = $1
                                        AND image_id IS NOT NULL AND taken_at IS NOT NULL)
SELECT was.vehicle_id, v.year, v.model, was.part_key, was.kind_key,
       max(was.taken_at)::date AS last_seen_present, min(now_.taken_at)::date AS first_seen_absent,
       array_agg(DISTINCT was.image_id)  AS before_photos,
       array_agg(DISTINCT now_.image_id) AS after_photos,
       count(DISTINCT now_.reader_model || ' / ' || now_.reader_prompt) AS readers_after,
       NOT EXISTS (SELECT 1 FROM flaw again WHERE again.vehicle_id = was.vehicle_id AND again.part_key = was.part_key
                    AND again.value = 'present' AND again.taken_at > min(now_.taken_at)) AS still_absent_in_latest_photos
FROM flaw was
JOIN flaw now_ ON now_.vehicle_id = was.vehicle_id AND now_.part_key = was.part_key
              AND now_.taken_at::date > was.taken_at::date
JOIN public.vehicles v ON v.id = was.vehicle_id
WHERE was.value = 'present' AND now_.value = 'absent' AND v.make ILIKE 'porsche'
GROUP BY 1, 2, 3, 4, 5;
```

The vehicle is the same `vehicle_id` before and after; merges keep lineage (`model.json` finding 0, read). "Absent" is a
landed answer only when the part was in view and the reader did not select the kind, and only for a kind that has a
claim on that part. A photo in which the part is not visible lands nothing.

### 8.5 The functions that serve them, and who may call them

| Function | Serves | Callable by | Notes |
|---|---|---|---|
| `vehicle_part_claims(p_vehicle_id, p_as_of)` (pull request 5) | one vehicle: every claim with proofs, level of proof, changes | `authenticated` and `service_role`. Not `anon` in this build. | `SECURITY DEFINER`. Applies 8.1. The owner sees everything on his vehicle. Another signed-in user sees only rows that pass the public branch. Uses `idx_vehicle_observations_property (vehicle_id, property_id)`. |
| `part_claim_search(p_property_key, p_part_key, p_value, p_descriptor_key, p_then_value, p_make, p_model, p_limit)` (pull request 9) | the three questions across vehicles (Q1: `part_wear_state`, `door.window.felt`, `worn`, then `fresh`, Ford, Mustang. Q2: `part_imperfection`, kind, `present`, Porsche. Q3: the same with then `absent`) | the same | Applies 8.1. Needs the index below to start from the key instead of from the vehicle. |
| `photo_map_enrichment(p_vehicle_id, p_user_id, p_as_of)` (pull request 5) | the measure (section 11) | `service_role`; the owner for his own id | |
| `photo_map_questions(p_vehicle_id, p_image_ids)` (pull request 4) | the worker | `service_role` | |

Index for the cross-vehicle reader (pull request 9), built the way the property index was rebuilt
(`20261011225339_repair_retained_property_index.sql:6-27`, read: autocommit, 120 s ceiling, an idle-lane guard):

```sql
CREATE INDEX CONCURRENTLY idx_vehicle_observations_part_claim
  ON public.vehicle_observations (property_id, (structured_data->>'part_key'), descriptor_id)
  WHERE property_id IS NOT NULL AND is_superseded = false AND structured_data ? 'part_key';
```

Private photos stay private in three layers: the judgment store is service-role only (`20261111210500:379-383`, read);
`vehicle_observations` rows follow the existing row policy (owner, or a public vehicle and `observation_is_public`:
`20260928233000_observation_privacy_marking.sql:59-74`, read); the readers add the photo test. One gap exists today and
this build must not widen it: on a public vehicle a `condition` row about a photo that is not public is itself readable
through the row policy, as the 47 deep-read rows are now. So the worker lands an answer only when the vehicle is private
or the photo passes the public test; otherwise the answer waits in the judgment store (owner decision 3).

### 8.6 Where the owner sees the first vehicle

With no frontend change, after the first landing:
- The vehicle profile's observation timeline, which lists the vehicle's current observations for its owner
  (`nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx:311-321`, read). Each answer appears as its
  `content_text` ("Hood: paint stage primer").
- The field drill: `get_field_provenance(vehicle, 'part_paint_stage')` returns every answer under `image_observations`
  with its photo, reader and `image_region.label` (`20261002213353:89-228`, read; hook `useFieldProvenance.ts:171`). This is
  the consumer C17 names as the one verified image-to-reader path.

Pull request 8 adds a "Parts" block to the existing evidence view
(`nuke_frontend/src/pages/vehicle-profile/VehicleEvidenceView.tsx`, whose field list is five fixed fields at `:12-18`,
read): one row per claim from `vehicle_part_claims`, with value, level of proof, photo count, the proof photos, any
disagreement, and a yes / no for the owner.

---

## 9. HARVEST BEFORE SPEND (answer 8)

### 9.1 Order of work on the first vehicle

1. **Resolve what was already read (no model).** From the 47 stored deep readings: the component labels (126 spellings)
   and the damage callouts (30). Each goes through `map_resolve_key`. Anything the seed map and aliases already know costs nothing.
2. **Place the rest (text only).** One `map_placement` question per unresolved phrase for this vehicle. Answered in
   batches by `claude -p` on the Mac, with no image. Exact matches become aliases. Finer and new things become proposals.
3. **Land the harvest (no model).** For every stored reading that holds a placed callout: one observation, attributed
   to the deep reader and its prompt, witnessed by that reading's photo. "Hood in red oxide primer" in thirteen readings
   becomes thirteen rows on one claim from one placement decision.
4. **Ask photos (pixels), only by the rules of 3.3.** One call per photo, all of that photo's questions together.
5. **Land the pixel answers.**

The three closed fields each stored reading already has for the whole photo (`paint_state`, `rust_severity`,
`completeness`) are not re-landed here. They are whole-photo values, their existing projection path is closed to owner
photos (section 1), and they stay as they are: the unchanged control (section 11).

Not harvested in this build: the 54 `image_condition_observations` rows (their zones are coarse and often wrong per
the facts read from production on 2026-11-10 (C17)), the 42 `image_work_extractions` rows, the 44 classifier rows. They are retained readings a later run can
place the same way. The 15 open questions the deep reader left are kept as they are; the ones a photo cannot answer
become questions to the owner in pull request 8.

### 9.2 Model calls for the first vehicle, by kind

| Kind | Model and lane | Count | Basis |
|---|---|---|---|
| Deep read of a photo | none | 0 | harvested from what is stored |
| Paid API call of any kind | none | 0 | the Mac reader refuses an API key (`subscription-frame-classifier.mjs:28`, read) |
| Text-only placement of component labels | `claude -p`, sonnet, owner's subscription, no image | at most 6 | 126 distinct spellings at 25 per call; fewer after the seed map resolves the common ones |
| Text-only placement of damage callouts | same | at most 3 | 30 callouts at 10 per call |
| Text-only second check before a new key | same | at most 2 | batched |
| Photo questions | `claude -p`, sonnet, one photo per call, about 8 s each (the facts read from production on 2026-11-10 (C17)) | expected 12 to 20 | about 13 claims at up to 2 photos each, less where one photo covers several claims, plus gaps |
| Hard caps (worker flags and config) | | 20 text, 47 photo | one call per photo at the very most |

The counts are estimates until the dry run prints the exact plan; the dry run makes no call and is the first thing the worker does.
At 20 photos a fire and one fire every 600 s, the first vehicle finishes in two or three fires.

---

## 10. RUNTIME AND ORDER (answer 9)

### 10.1 What runs where

| Piece | Where | Why there |
|---|---|---|
| Registry column, alias table, resolver, proposal types, trigger, the two store guards, the question builder, the fold, the measure | migrations (CI on merge) | this session has no service key |
| Admission of registry-specified properties | edge function `ingest-observation` (CI deploys the changed folder) | the one sanctioned writer |
| Asking, answering, landing | `scripts/photo-pipeline/map-question-worker.mjs` with `scripts/lib/map-answers.mjs`, run by `subscription-reader-batch.sh` on the owner's Mac | the only place that has both a model (`claude -p` under his login) and the service key (`subscription-reader-batch.sh:39`, read) |
| Parts block and the owner's yes / no | frontend pull request, Vercel | |

The worker holds no vocabulary. It renders each photo's prompt from the question rows: a fixed envelope (answer only
JSON; choose only listed keys; not in the frame is `not_visible`; cannot decide is `cannot_tell`; give a box) and, per
question, the `ask` text, the part label and the allowed values with their `looks_like` lines. It reuses the frame
reader's `claude -p` call (`subscription-frame-classifier.mjs:56-70`), its download and convert steps, and the receipt
typing in `stage-queue.mjs` (a usage limit ends the batch instead of failing every photo). The name avoids "reader" on
purpose: the guardrail refuses a new photo reader (`check-capability-before-mint.mjs "photo-map-reader"` returns STOP; run 2026-11-10).

Switch and scope: `platform_config` row `photo_map` = `{"enabled": false, "max_text_calls": 20, "max_photo_calls": 20,
"max_new_proposals": 10}` (the table and pattern of `image_stage_reconciler`, `20261113110000:161-165`, read). The
vehicles to work on come from an environment variable in the Mac's `.env`, not from the repository, so no vehicle id is
committed. With the switch off or no vehicle named, the worker exits before doing anything.

Noticing failure: the worker prints a one-line count summary and posts it through `record_reader_heartbeat`, whose list
of reader names gains this one (`20261112120000_subscription_reader_heartbeat.sql:26`, `reader-heartbeat.mjs:27`, read).
`photo_map_enrichment` reports `stalled = true` when the switch is on and questions have waited more than an hour with
no answer. Adding it to the 40-minute watch waits until the lane is standing work (section 13).

### 10.2 Pull requests, in order

Each is safe to deploy alone. One migration per pull request.

| # | Title | Contains | Safe because | What the owner can see after it |
|---|---|---|---|---|
| 1 | `feat(db): value specs on properties and part alias memory` | Migration: `observation_properties.value_spec`; `subject_taxonomy_aliases`; `map_label_norm`, `map_resolve_key`, `record_map_alias`; proposal types `add_subject`, `add_descriptor` and three apply branches in `fn_schema_proposal_apply` (md5-guarded, as `20261011223810:12-18` does); `value_spec` filled on the three whole-photo properties with `enforce false`; the column and the table recorded as approved `add_column` and `add_table` proposals, the way `20261006213000:64-99` and `20261007014500:96-122` do | nothing reads the column or the table yet | the three existing photo properties with their values as data instead of prose; the alias table in the atlas, attached, described and owned |
| 2 | `data(observation_properties): seed part properties, parts and flaw kinds` | Migration: proposals and their review rows for four properties, the seed part keys, the seed kinds, seed aliases | registry rows only; no writer admits them yet | the map as rows: every part, every state with what it looks like, every kind of imperfection |
| 3 | `feat(ingest-observation): admit properties by registry row` | Migration: `enforce_registry_property` and its trigger. Edge function: the admission change and the owner-word check. Contract tests: an unregistered part key is refused; a value outside the list is refused; a service-role caller cannot write the owner's word | the trigger fires only for rows with a `property_id` and acts only on `enforce` properties; nothing sends them yet | the CI contract output |
| 4 | `feat(evidence_judgment_requests): photo map and placement question kinds` | Migration: both guard functions dispatch by kind (md5-guarded); `photo_map_questions`; stage row `map_answers` (`required false`); `platform_config.photo_map` (off); the heartbeat name | the receipt branch is the old body unchanged; no producer raises the new kinds yet | `select * from photo_map_questions('<his truck>')`: the questions the map would ask of each photo and why, before any spend |
| 5 | `feat(db): part claims fold and enrichment measure` | Migration: `vehicle_part_claims`, `photo_map_enrichment` | read-only functions | the first vehicle's "before": zero keyed answers and zero claims over its 47 read photos, replayable by date |
| 6 | `feat(photo-pipeline): map question worker for the mac lane` | Scripts and tests; a third step in `subscription-reader-batch.sh`; the name in `reader-heartbeat.mjs` | exits while the switch is off | the dry-run plan in the Mac log: how many text calls and photo calls it would make |
| 7 | `feat(db): switch the photo map on` | Migration: `photo_map.enabled = true`. The first vehicle is named on the Mac. | caps; one vehicle | harvest lands within one fire: claims with their proof photos in `vehicle_part_claims`, on the profile timeline and in the field drill; then the second reader's answers; the "after" measure |
| 8 | `feat(frontend): parts and proofs on the vehicle evidence view` | The Parts block, the owner's yes / no, a filter so part answers do not crowd the timeline | reads one function | the first vehicle's claims on the site with photos |
| 9 | `feat(db): find vehicles by part claim` | Migration: `part_claim_search` and the index. Worker: receipt lines placed on part keys | read-only function; concurrent index | the three questions as one call across his vehicles, with receipts beside the photos |

Pull requests 3 and 4 do not depend on each other and can be reviewed in parallel; 7 waits for 1 through 6.
Before every migration push: `gh run list --workflow supabase-deploy.yml` idle, `scripts/hooks/pre-push`, one migration
in the commit. After every deploy: verify live, then say which stage was reached.

---

## 11. PROOF (answer 10)

### 11.1 The measure

"Enrichment" is read from the database by `photo_map_enrichment(p_vehicle_id, p_user_id, p_as_of)`. Clock: rows with
`ingested_at <= p_as_of`; the function returns `as_of` and its own name. Population and denominators are returned with
every numerator.

| Number | Definition |
|---|---|
| population | photos in scope: for a vehicle, its `vehicle_images` rows; for a user, his photos from the index-only `idx_vehicle_images_capture_ledger` |
| eligible | those that pass `receipt_work_frame_eligible` |
| asked | photos with at least one `photo_map_answer` question, by status; and photos with a `map_answers` stage receipt |
| keyed answers | current observations with one of the part properties, a part key and a witness photo in the population (rows; a processing count) |
| **claims** | distinct vehicle, property, part key, descriptor among keyed answers. Repeats are folded here: thirteen rows are one claim. |
| **connected claims** | claims that meet something else on the same key: a second photo, a second reader, a receipt line on the same part, a text claim on the same descriptor for the same vehicle, the owner's word. Returned with the count of each kind of connection. |
| **proven claims** | claims by level of proof (read, repeated, agreed, validated, confirmed) and how many are disputed |
| photos contributing | photos that witness at least one keyed answer, over eligible |
| answers not landed | `not_visible`, `cannot_tell`, held for privacy, parked for a pending key |
| new keys per hundred answers | proposals filed in the window over answers given; aliases recorded |

Fleet-wide later, without a table scan: every number comes from rows that carry a part property. The per-user form walks
the property index over keyed rows only, and the photo denominators come from the capture-ledger index (about 32 thousand
entries per `20261113110000:9`, read). A fleet report leads with the whole owner-photo population and its date, then the
eligible, the gained and the remaining, as the fleet-relative contract requires.

### 11.2 The comparison C17 requires

Same retained evidence: the 47 photos that have a deep reading. Their ids are fixed in a private manifest on the Mac
(`~/nuke-logs/photo-map/<run>/manifest.json`), not in the repository.

| Step | Prior state (as of T0, before pull request 7) | This method (as of T1) |
|---|---|---|
| The measure | `photo_map_enrichment(the first vehicle, as_of T0)`: 0 keyed answers, 0 claims. the facts read from production on 2026-11-10 (C17) already reads 0 observations with a descriptor or property key on the whole vehicle. | the same call at T1 |
| The three questions, on this truck | "Which parts are in primer, with photos"; "does it have surface rust at the upper cab seam, with photos": no query can be written; the words are inside 47 JSON blobs | `vehicle_part_claims(the first vehicle)` returns them as rows with photo ids |
| Changed claims traced into an existing consumer | `get_field_provenance(the first vehicle, 'part_paint_stage')` and `(..., 'part_imperfection')`: no image observations | the same calls return each answer with its photo; three cited photos are opened to confirm they load, as the 2026-10-04 C17 check did |
| A disagreement case | none can exist | at least one claim where the two readers differ is shown as disputed, not hidden; if none occurs on the first vehicle, the fixture shows it |
| An unknown case | not recorded | at least one `cannot_tell` and one `not_visible` answer are in the store and are not in the log |

Unchanged control, checked before and after with the same queries and compared by hash:
- The 94 witnessed observations that already exist for these photos: same ids, same `content_hash`, none superseded.
- `get_field_provenance(the first vehicle, 'color')` and `get_image_deep_analysis` for three of the photos: byte-identical output.
- The whole-photo properties and the classifier's rows for these photos: untouched.
- A second owner vehicle that was not named to the worker: its observation count and its measure do not move.
- The first vehicle's 34 photos outside the manifest: no question, no answer.

Rewritten text, row counts and confidence are not offered as proof. Two more checks are:
- **Held-out correctness.** After landing, twenty claims are drawn at random by a query, and the owner (or a reviewer he
  names) marks each right or wrong in the Parts block. The number wrong is reported as the correction cost.
- **Consistency.** The placement step is run a second time on a copy of the same phrases with the alias table as it
  stands. It must ask zero new questions and propose zero new keys.

The first vehicle is validation scope. Every report says so and gives the fleet line first: owner photos in the library, how many
are eligible, how many have been asked, how many claims exist, and the backlog.

---

## 12. Count of new things

| Kind | New | Extended, not new |
|---|---|---|
| Tables | 1: `subject_taxonomy_aliases` | |
| Columns | 1: `observation_properties.value_spec` | |
| Triggers | 1: `trg_enforce_registry_property` on `vehicle_observations` | |
| SQL functions | 8: `map_label_norm`, `map_resolve_key`, `record_map_alias`, `enforce_registry_property`, `photo_map_questions`, `vehicle_part_claims`, `photo_map_enrichment`, `part_claim_search` | 4: `fn_schema_proposal_apply`, `evidence_judgment_ineligibility`, `evidence_judgment_answer_problems`, `record_reader_heartbeat` |
| Edge functions | 0 | 1: `ingest-observation` (admission) |
| Scripts | 2 files: `scripts/photo-pipeline/map-question-worker.mjs`, `scripts/lib/map-answers.mjs` (and their tests) | 2: `subscription-reader-batch.sh`, `reader-heartbeat.mjs` |
| Indexes | 1 (pull request 9) | |
| Registry rows (data) | 4 properties, 2 proposal types, 2 question kinds, 1 stage, 1 config row, the seed parts, kinds and aliases | |
| Frontend | 1 block in an existing view | |

Why each new object, when something existing was near:
- `value_spec`: the registry has nowhere to hold a value list; the alternative is the five hand-kept copies that exist now.
- `subject_taxonomy_aliases`: `condition_aliases` and `angle_aliases` point at other tables; a label cannot be stored as
  a second `subject_taxonomy` row without becoming a second key. (`subject_aliases` as a name trips an unrelated entry in the guardrail; the longer name is clear.)
- The trigger: a rule that lives only in an edge function is not enforced for a SQL writer. `AGENTS.md` asks for the
  constraint that implements an invariant to be named.
- The fold and the measure: no existing reader groups observations by part. `vehicle_canonical` returns one winner per
  key, not the proofs.

---

## 13. LIMITS, RISKS, OWNER DECISIONS (answer 11)

### 13.1 What this build does not do

- It does not read photos that have no stored reading, except by the same questions once a vehicle is named. It does
  not sweep a library. Choosing which vehicle is next is not designed here.
- It does not give a point on the body (the x, y, z anchor columns stay empty). Place is a part key and a box in the photo.
- It does not create a restoration as an entity, a work order, a work session or a change claim.
- It does not say who did work, what it cost, or that a bought part was fitted.
- It does not make listing photos askable. Every reading lane still requires an owner photo.
- It does not change the classifier, the deep read, the phone, or any of the five older reader tables.
- "Agreed" means two different models with different prompts at different times. Both are from one vendor. It is not
  ground truth; the owner's sample is the check.
- The job in hand shapes the questions only from pull request 9 (receipt lines). Work orders are not read.
- The body style of the vehicle does not yet filter parts. A part is asked about only when a reading named it, a claim
  exists, or a receipt names it, so a bed is not asked of a coupe; but the map itself does not say "pickups only".

### 13.2 Risks

| Risk | What limits it |
|---|---|
| The map grows wrong, too fast or differently each time (the owner's own caution) | canonical keys only at the writer; keys built by code; two closed checks before a proposal; cap of ten per run; aliases written only from an exact match; the number "new keys per hundred answers"; a consistency rerun that must ask nothing |
| One wrong placement lands on thirteen photos at once | the second reader is asked without being told; a disagreement shows as disputed; `reopen_evidence_judgment_answers` removes the whole placement run from every count without deleting a row |
| Part answers crowd the profile timeline, which shows the newest 200 observations | check on the first vehicle after the harvest; pull request 8 adds the filter; if it is bad, 8 moves before 7 |
| A private photo's finding becomes readable on a public vehicle | the worker holds such answers in the service-only store (8.5) |
| The first vehicle's photo dates are batch-stamped | the fold shows capture days as stored and marks a single-day vehicle as having no time axis; corrections belong to `image_capture_time_claims`, not to this build |
| A trigger on the largest testimony table | fires only for rows with a `property_id`, acts only on `enforce` properties, a few primary-key reads; created under a short `lock_timeout` like the witness trigger |
| Replacing four live functions | each replacement is guarded by the md5 of the body it replaces; the live bodies are read first (section 14) |
| The subscription runs out of compute | caps; a usage limit ends the batch (`stage-queue.mjs`); unanswered questions stay pending |
| The frame rule excludes some the first vehicle photos (not gate-approved, or undated) | they are reported as ineligible with the reason, never skipped silently |
| `subject_taxonomy` holds keys that are not parts (documents, work, damage) | each property's `value_spec.subject.domains` names the domains it applies to |

### 13.3 Decisions that are the owner's, with the default that lets work continue

1. **Who approves a new part, kind or value, and how fast.** Default: aliases are recorded automatically. New keys are
   filed as proposals and approved the way proposals are approved today, in a batch, with his yes; until then the datum
   lands on the nearest existing key or is parked. Nothing waits on him to keep data flowing. The alternative he can
   switch to later: let the apply branch run automatically for a leaf key under an existing parent that passed both
   closed checks.
2. **The seed map.** Default: approve the four properties and the seed lists as proposed in pull request 2. Each is a
   row that can be deprecated.
3. **Whether anyone but the owner can read part claims.** Default: owner and service role only in this build; answers
   about a non-public photo on a public vehicle are held. A public reader is a later, separate change.
4. **Switching it on for the first vehicle** (pull request 7). Default: on, for this one vehicle, with caps of 20 text calls and
   47 photo calls in total.
5. **What "during a restoration" means for Q1.** Default: a rule at query time (at least three other parts photographed
   in a changed state inside the same window, or a work order covering it). No new table.

---

## 14. Facts that must be read from production before the code is written

None changes the shape above.

- The first vehicle: `vehicles.is_public`; for the 47 photos `vision_gate_status`, `taken_at`, `is_sensitive`, public eligibility;
  the dates of the other 34 photos; the count of linked receipt lines.
- `subject_taxonomy`: the 106 keys with `domain`, `category`, `side`; the format of `canonical_angles` on the 15 filled rows.
- `condition_taxonomy`: the keys that exist for paint and rust; which `taxonomy_version` holds the manual fragments.
  `condition_aliases`: whether `taxonomy_version` has a foreign key.
- `schema_proposals`: the live CHECK on `proposal_type`; the columns of `schema_proposal_reviews`; what
  `trg_schema_proposal_evidence` requires; the columns and constraints of `pending_claims`.
- The md5 of the live bodies of `fn_schema_proposal_apply`, `evidence_judgment_ineligibility`,
  `evidence_judgment_answer_problems`, `record_reader_heartbeat`.
- `observation_sources`: that `photo_pipeline` supports kind `condition` and `owner-input` supports it; their trust scores.
- Whether the writers migration of the image evidence store (`propose_change_claim`) is live.
- `pg_indexes` for `vehicle_observations` (is `idx_vobs_structured_data_gin` still there) and the table's row count, to
  time the index in pull request 9.
- That the row policy lets the owner read his vehicle's observations from the profile timeline today.

---

## 15. Code claims verified by opening the file

All **read**.

- A code list refuses an unlisted `property_key` before the registry is consulted: `supabase/functions/ingest-observation/index.ts:979-984`; `imageProperties.ts:68-71`.
- The registry lookup selects `id, property_key, applies_to_kinds, namespace, deprecated_at`: `index.ts:985-987`.
- `descriptor_key` resolves against `condition_taxonomy.canonical_key` only: `index.ts:961-975`.
- The insert sets `descriptor_id` and `property_id`: `index.ts:1248-1249`. Duplicate by content hash returns the same id: `index.ts:1009-1034`.
- Agent answers are capped at 0.6; the owner's confirmation adds 0.30: `index.ts:1176-1179`, `1165`.
- Value lists are typed in code: `imageProperties.ts:6-10`; `scripts/lib/image-property-projection.mjs:4-8`.
- The batch path admits only public vehicles, BaT or Craigslist images and three keys: `supabase/migrations/20261004064216_cached_image_source_ancestry.sql:94, 127, 133`; `ingest-observation-batch/cachedProperties.ts:55, 68`.
- One witness per observation, role `derived`, same vehicle enforced: `20261002213353_enforce_atomic_image_witnesses.sql:45-71, 78-81`.
- `get_field_provenance` returns witnessed observations for any key present in `structured_data`: `20261002213353:89-228`.
- The question store: table `20261111210500_receipt_work_reconciliation.sql:337-383`; raise `:465-503`; retire `:506-528`; claim `:588-615`; answer `:650-681`; reopen `:685-719`; both guards hard-wired `:408`, `:623`; frame rule `:143-151`; zones of a frame `:99-125`.
- The producer's question shape and dedupe key: `scripts/receipt-work/reconcile-receipt-work.mjs:33-73`.
- `fn_schema_proposal_apply` branches and the property insert: `20261011223810_schema_proposal_retry_and_progress.sql:126-275`; approval by a postgres insert: `20261007100000_schema_proposal_apply_add_source.sql:46-51`; proposal types added by migration: `20261006213000_key_auction_event_identities.sql:64-99`, `20261007014500_stack_registry.sql:96-122`.
- Parking an unknown key in `pending_claims` beside an open proposal: `supabase/functions/api-v1-events/index.ts:282-411`.
- `discriminator_key` is the name of a JSON key and `vehicle_canonical` partitions on it: `scripts/discovery/fixtures/vehicle_canonical_20260517.sql:35-76`; `20261011050753_retained_native_description_year_projection.sql:622-646`.
- `supersede_observation` needs the caller's `auth.uid()`: `20260709140000_supersede_observation.sql:35-51`.
- The row policy and privacy marking: `20260928233000_observation_privacy_marking.sql:36-74`; the witness policy: `20261021000000_derived_witness_policy_reads_public_view.sql:6-23`.
- The stage ledger registry, receipts and writer: `20261113110000_image_stage_receipts_reconciler.sql:64-86, 90-117, 179-201`; the config row pattern `:161-165`.
- The Mac lane: `scripts/photo-pipeline/subscription-reader-batch.sh:33-56`; `subscription-frame-classifier.mjs:28, 56-70, 138`; heartbeat names `reader-heartbeat.mjs:27`, `20261112120000_subscription_reader_heartbeat.sql:26`.
- The deep read's stored shape and source: `supabase/functions/photo-pipeline-orchestrator/reviewedAnalysis.ts:14, 31-34, 49-59, 107-122`.
- `component_assembly_map`: `supabase/migrations/20251206_component_assembly_map.sql:10-40, 54-66, 110-128`.
- The descriptor column on the log: `20261001140000_c26_condition_claims_notation.sql:59-70`. Alias table pattern: `20251216000001_angle_pose_observations_v1.sql:24-29`.
- The change-claim tables exist and their writers migration does not: `20261021220000_image_evidence_tables.sql:362-419`; `ls supabase/migrations | grep 2026102122` shows one file.
- The visual work contract, its reader and its page: `20261110053000_visual_work_receipt_text.sql:17-73`; `20261109235000_visual_work_build_log_reader.sql:139-205`; `nuke_frontend/src/pages/vehicle-profile/hooks/useVisualWork.ts:28`.
- The owner's confirmation pattern: `supabase/functions/agent-chat/index.ts:427-446`. Caller kinds: `supabase/functions/_shared/writeGuard.ts:55-59`.
- Owner surfaces: `nuke_frontend/src/pages/vehicle-profile/ObservationTimeline.tsx:311-321`; `hooks/useFieldProvenance.ts:171`; `VehicleEvidenceView.tsx:12-18`.
- The declared direction: `docs/ledger/theory/data-machine.md:3-87`; `docs/ledger/CAPABILITY_MAP.md:127-128`.

**Inferred**, not read: that the 158 answered receipt questions were written by something outside this checkout; that
`photo_pipeline` supports kind `condition` in production (the deep read lands with it); the columns of
`subject_taxonomy` and `condition_aliases` (from the dictionary snapshot `docs/library/reference/dictionary/tables.md:3984-4011, 6636-6658`,
not from a migration).
