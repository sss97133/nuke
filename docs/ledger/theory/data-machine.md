# DATA MACHINE — theory card

## Image analysis is the model asking, owner direction 2026-11-10

Read this before any work that looks at a photo. It records one working session with the owner and what
was measured that day. His words are quoted in "The owner's words, 2026-11-10" below; the measurements
are in the case ledger under C17 for the same date. He closed the session with: "This is the only
conversation that matters and that we never backtrack from here and that any agents never has to do
what you did today."

**The finding.** Reading photos was never the missing part. On one owner vehicle (47 photos of one
capture day) five readers had run over eleven months, each writing its own words into its own table.
The most careful one recorded 30 damage callouts and 126 spellings of the vehicle's parts, and none of
its 47 observations carried a part, a condition key or a position. The model has the places: a
property registry, a proposal path that grows it, and a closed-question store with a fixed answer
shape. No reading is brought to them, and two of the three are narrower in code than they look (rule
5). A photo counted as analysed had added a sentence, the colour again and sometimes an angle.

**The model is the map, and it asks.** In the owner's words the data model is "the blue print the
hypothesis the mirror of how the data needs to be interpreted", and it is "shaped even to help find
what it's shaped to look for". A reader does not describe a photo. The registry says what can be
observed on a vehicle, the values each observation may take and what each looks like. The vehicle, the
job in hand, what earlier readings said and the view the photo shows choose which of those to ask. The
photo answers.

This is what "levels" means here. The first read gives the view. The view, the vehicle and the job choose
the questions. The answers choose the next questions. The stage ledger (`image_pipeline_stages`,
`image_stage_receipts`) records which level ran on which photo under which contract; it is not where a
level's result lives. A level's result is keyed observations, and the next level's questions are chosen
from them.

Rules for every agent and every reader. Each names its mechanism or says that none exists yet.

1. **A reading is finished when it is keyed, not when it is stored.** Keyed means an observation written
   through `ingest-observation` that carries a registered key (`property_key` from
   `observation_properties`, or `descriptor_key` from `condition_taxonomy`), names the part of the
   vehicle it is about, and has its photo as an `observation_witnesses` row. A description, a JSON value
   or a row in a reader's own table is retained input, not a finished reading. Mechanism: none yet;
   rule 7's measure is what makes it visible.
2. **Questions are derived, never typed.** The question list for a photo is built by code from registry
   rows. No reader carries its own vocabulary of types, parts, states or flaws. A repo read on
   2026-11-10 counted six hand-written photo contracts side by side. Mechanism: none yet.
3. **Answers are closed.** A value from the registry's list, not visible, or cannot tell; where in the
   photo; who answered, with which reader, from what. `evidence_judgment_requests` already has this
   shape for one question kind. Unknown is an answer and is stored. Mechanism: none for photos, and the
   writer does the opposite for the keys it admits: `imageProperties.ts` refuses a null value and any
   value outside its typed list, and the three registered photo keys say "Unknown is absent". So today
   "not visible" and "cannot tell" can be stored only as an answer in `evidence_judgment_requests`.
   Working default: the question and its closed answer, unknowns included, live in the question store;
   an answer with a listed value becomes a keyed observation. Readings harvested from earlier readers
   have no question and go straight to keyed observations.
4. **An answer is testimony.** "The yes/no is answers. And they become factual if handled right
   creating truth from a hallucination machine." One reader's answer is never a fact. It becomes one by
   agreement across photos and across independent readers, by a receipt, or by the owner's word at
   Sign. The same state seen in thirteen photos is one claim with thirteen witnesses. A later photo
   that shows the opposite records a change and leaves the earlier testimony in place. Mechanism: none
   yet. `observation_witnesses` is written only by the insert trigger `project_observation_image_witness`
   (20261002213353), which reads one `structured_data.image_id` and writes one row, so an observation
   has one photo. Thirteen sightings are thirteen keyed observations today, and "one claim" is a fold at
   read time over vehicle, key, part and value that no reader performs yet. Nothing records agreement
   between readers, a receipt's support or the owner's word on a claim, so no row is proven yet. Do not
   plan one observation with many witnesses: it has no writer.
5. **Where there is no place, the place is written, the same way every time.** "If there's no place to
   put the data it has to be written. That takes a certain degree of intelligence and most importantly
   consistency." Look first, in the registry and in every alias already recorded. If the thing is
   there, use its key. If it is not, file it through `schema_proposals` with the reading that forced
   it. Whether something is the same as an existing key is decided once, stored as an alias, and not
   decided again by the next reader. The owner's caution stands beside this rule: "The obvious problem
   of being able to write the data model side is if it writes too much and wrong and new every time
   ... if it's running we can fix it. If it never gets off the ground we can't." So it starts on one
   vehicle, and new keys per hundred readings is a number to watch fall. Mechanism, partial:
   `ingest-observation` refuses a `descriptor_key` that is not live in `condition_taxonomy`. For a
   `property_key` it is narrower than the registry: `imageProperties.ts` in that function admits three
   photo keys, with their allowed values typed in code, and two text readings, and `index.ts` refuses
   any other key before it looks at the registry. A key approved through `schema_proposals` therefore
   cannot land from a photo until that list is replaced by a read of the registry. The question store
   is the same: `evidence_judgment_ineligibility` (20261111210500) accepts one question kind. An alias
   memory for parts does not exist yet. How a place is proposed: a row in `schema_proposals`, inserted
   by a migration that cites the readings which forced it
   (`20261011073134_retained_engine_family_label_proposal.sql` is the pattern, and
   `20261011230939_retained_engine_family_intake.sql` the intake that followed). An agent files and
   never approves: approval is one row in `schema_proposal_reviews`, a human act. Draft first; file
   after the owner or the lead has seen the draft.
6. **Harvest before spend, and choose with prejudice.** Readings already paid for are keyed before any
   photo is read again. What is read next is chosen by what it is worth, inside a stated budget: "it's
   great if we have infinite compute. But if we don't we will not win." Date order belongs inside one
   subject once that subject is chosen. As the rule for a whole library the owner called it "a
   dangerous mode", and the change that made it the rule (#3313) was withdrawn unmerged. Mechanism: none
   yet, and what runs today is close to the mode this rule warns about, by upload date:
   `reconcile_image_stages` walks the account's library by `created_at` (newest uploads in the live
   lane, oldest by cursor in the backfill), `claim_image_stage_work` hands out at most 25 a claim, and
   a work item carries no vehicle, job or worth. The pace is settings, not a slow reader: the launchd
   interval (600 s), and `--limit 20 --concurrency 2` in `scripts/photo-pipeline/subscription-reader-batch.sh`.
   Each of those reads lands a description, a colour, text and sometimes an angle, and nothing keyed. A
   request to read faster, or to read everything oldest first, is answered with those facts and one
   question back to the owner: which vehicle or job first, and what budget on his subscription. Raising
   a setting is not the answer and neither is refusing. That the reader keeps running meanwhile is a
   default taken, not a ruling.
7. **The measure is what the model gained.** "The next bar that's more important the images being
   'analysed' is the enrichment of the data model which is the real measure ... That the observations
   connect." Report keyed, connected, proven rows gained, with repeats folded: the whole library and
   its clock first, any one vehicle after (the fleet-relative contract below applies). Photos read is
   a processing count. Mechanism: none yet; no reader reports this measure (`image_stage_coverage()` and
   `photo_land_progress.result` count flow and stored rows). Until one exists a report gives three
   counts, each beside the owner's `vehicle_images` total and the read time. *Keyed*:
   `vehicle_observations` rows, not superseded, with `property_id` or `descriptor_id` set and an
   `observation_witnesses` row on one of the owner's photos (the part cannot be counted until a part has
   a place). *Connected*, a working definition: keyed rows that fold with another keyed row on the same
   vehicle, key and value, or that a job, a receipt line or a change claim cites; give the folded claim
   count beside the row count. *Proven*: folded claims with two independent readers in agreement, a
   receipt, or the owner's decision; no store records any of these, so the count is zero by
   construction and is reported as zero, not left out. Baseline: 0 keyed of 488 witnessed observations
   on the proof vehicle (2026-11-10 21:33 UTC), and 0 of 94 on the vehicle measured first. The library
   was not measured. After the first landing: 446 keyed of 934 on the proof vehicle, folding to 181
   claims, 69 of them carried by two or more photos (2026-11-11 04:54 UTC,
   `scripts/photo-pipeline/keys-dry-run/fold.sql`; [`image-keys-test.md`](image-keys-test.md)).
8. **No new reader, prompt vocabulary or per-reader table for photos.** Extend the registry, the
   question store or the landing. Earlier attempts at this same idea are in the database and are not
   dead: `component_assembly_map` (a part, its states, what each state looks like),
   `image_question_answers` (1,021 answers with agreement and validation columns; a 2026-06-18 comment
   calls it empty and proposes dropping it, and it is not empty), the digital-twin component tables,
   and `docs/features/image-processing/CONTEXT_DRIVEN_PROCESSING.md`. Mechanism: the pull-request gate
   below, and `scripts/guardrails/check-capability-before-mint.mjs`, which reads the photo-reading rows
   of `docs/ledger/CAPABILITY_MAP.md` when an agent asks it.

**Keys and folds, for photos.** The owner: "the talk on keys and folds is essential to not lose", and of
the whole design, "the data acquires labels, keys, folds etc as connections are made". In this lane:

- A **key** is what lets two rows be about the same thing without anyone reading their words: the
  vehicle, the part of it, the state or flaw, the photo. A reading with words and no keys cannot be
  joined, counted or cross-examined. "Hood in red oxide primer", "red-primer hood" and "hood still in
  primer, not final paint" are one fact only once all three carry the same part key and the same value.
- A **fold** is the step that makes one claim out of many keyed rows, by rule and not by judgment: the
  same vehicle, part, property and value on the same capture day fold to one claim with every photo
  behind it. A later day with a different value does not edit that claim. It is a second claim, and
  the pair is the change: the repair, the repaint, the part replaced.
- Keys take judgment once and memory ever after. Whether a wording means an existing key, or needs a
  new one, is decided one time and stored; every later reader is given the decision. Without that
  memory the same part gets a new spelling from every reader: on the first vehicle measured, 186 part
  labels came in 126 spellings, and on the second 3,560 came in 2,678.
- Folds take no judgment at all, so they are database logic. An agent that folds by eye will fold
  differently tomorrow.
- A key that is stretched is worse than a key that is missing. The engine bay is not the brake
  booster. When no key is true the datum waits with a proposal, and the wait is visible.
- Tried by hand on the first vehicle: 30 callouts folded to about 13 claims, one of them carried by 13
  photos, and the two vocabularies could express 3 of the 13 without a new key. That ratio is the
  size of the work: most of what careful readings say has no place yet.

The procedure is the brief in `skills/image-keys/SKILL.md`.

**The proof vehicle.** The owner, 2026-11-10: "A better example to work on is the firebird ... I know we
need the pipeline to work but it has to be for the data we actually care about." The build is proved
on that vehicle (`20d21fb0-4651-4469-a0ba-e751309a1e54`; its state is in C17 for the same date), not on
the vehicle that was measured first. It is the vehicle with by far the most recent photos, it has
already been read by the most careful reader, and none of what was read is keyed, so the whole first
build there is keys and folds and needs no photo read again. What the reader happens to reach next in
upload order is not a reason to work on it.

**The gates.** The owner, the same day: "the architecture is the only thing that will ensure agents even
dumb ones don't fuck up". A rule above holds only where something refuses the wrong move. Everything a
photo reading does passes through four places. One has a gate. The other three are the build's
definition of done: no piece of the build is finished until its gate exists.

| Gate | Where | What it refuses | State |
|---|---|---|---|
| The pull request | `scripts/guardrails/no-new-photo-reader.mjs` and its test, run by `pre-deploy-check.yml` | a new table keyed by a photo, or a new edge function or script whose name says it reads photos, unless `photo-stores.allow.json` lists it with the owner's approval; and the removal of this direction, the keys and folds section or the "Reading photos" rule | built 2026-11-10; it reads names, CREATE TABLE text and headings, nothing deeper |
| The writer | `ingest-observation` | a photo reading that carries no registered key and no part: counted first, refused once the readers key what they write | not built |
| The scoreboard | one database reader over keyed, witnessed observations (the stage ledger's coverage reader is the thing to extend) | a progress number that is not computed from it | not built |
| The database | an event trigger in the manner of `view_write_guard` (20261014214500) | a photo-keyed table created without an approved `schema_proposals` row, a hand-applied one included | not built |

**The lane and who works it.** The card's team is lanes, each with a scoreboard, and image analysis had
neither. It is one lane, the image fold the case ledger already names among the substrates, and its
scoreboard is rule 7's measure. The owner, 2026-11-10: "hand the whole folds and keys stuff to a tested
dedicated agent ... configure a team". Inside the lane:

- **Keys** are a dedicated role with a fixed brief, [`skills/image-keys/SKILL.md`](../../../skills/image-keys/SKILL.md).
  It is handed statements, a registry snapshot and the decisions made so far; it returns keyed claims,
  proposals and its own decisions, and writes nothing. Any agent can be given the brief. What makes two
  runs agree is the stored decisions, not the agent, and [`image-keys-test.md`](image-keys-test.md)
  measures that.
- **The unit is one photo, and it is checked by code.** The owner: "it's really not batches. It's one at a
  time til done", and again: "the best type of batch is one at a time ... and then figuring out how to
  speed things up beyond one at a time ... if they can't do one, they definitely can't do [many]". One
  photo's statements go in, one keyed result comes out, and code refuses it unless every statement is
  accounted for, every quoted word is in the reading and every key is a registry key, a stored decision or
  a draft with its proposal. Anything larger is built only on a unit that passes, and is held to the same
  check photo by photo. Measured on the proof vehicle: one photo keyed in about 20 seconds; a single agent
  given 119 statements at once produced nothing in 21 minutes
  ([`image-keys-test.md`](image-keys-test.md), the 22:48 round).
- **What needs the whole set is a different harness.** The owner: "the thing kind of changes when you have
  to analyze batch contextual information but that's like a different approach a different harness."
  Three things need it: the shared decisions (without them two runs agreed on 11 of 32 claims, with them
  21 of 27), merging the names drafted in parallel, and the fold. None of them is the unit's job.
- **Folds** are database logic, not an agent: one claim per vehicle, part, property, value and capture
  day, with every photo as a witness.
- **Questions** are code that builds a photo's list from registry rows.
- **Gates** are built by whoever builds the piece they guard.
- **Approval and Sign** are the owner's. No agent approves a proposal or turns an answer into a fact.
- **The test** is the owner-voice test below, run after each piece.

**Acceptance.** Three questions, the owner's, must be queries that return vehicles with the photos that
prove the answer: (1) Mustangs whose window felts were replaced during a restoration; (2) a Porsche
that has a specific imperfection; (3) that imperfection was repaired and it is now this restored
Porsche. Proof on one vehicle is validation scope, not fleet coverage. Under C17's rule the comparison
is the same retained photos, the prior state against the new method, with changed claims traced into
an existing consumer and an unchanged control. The proof vehicle is where the method is proved, not
where the three questions are answered. The first proof is a question of the same shape on that
vehicle: a named state of a named part, returned with its photos. The three literal questions wait on
owner photos, since every reading lane skips listing photos: on 2026-11-10 the owner had photos on
three Mustangs and one Porsche (C17). Say which of the two a result is.

**Where the build starts.** Not started on 2026-11-10. This is a plan, not a record of work. A full design
and two adversarial judgments of it are in `docs/ledger/2026-11-10_image-keys-build-design.md` and
`...-judgment.md`; read the judgment first. Both judges put the same thing first: a pull request of
scripts only that harvests stored callouts onto condition keys, with no migration and no model call. Two agents
given only this card and the owner's one-line request arrived at the same first three steps. On the
proof vehicle named above:

1. Read the before state from production, with its clock. Partly done on 2026-11-10 (C17 holds the
   proof vehicle's counts and which Mustangs and Porsches have owner photos). Still to read: the paid
   readings waiting to be keyed across the library, by reader and month; every
   row of `observation_properties`, `condition_taxonomy`, `subject_taxonomy` and
   `component_assembly_map`; and rule 7's counts for the library.
   The ordered list is "To read from production" in `docs/ledger/2026-11-10_image-reading-map-critic.md`.
2. Harvest before spend. By code, fold the readings already paid for (the condition observations'
   callouts and the part labels) against the registries. The output is claims that have a key, claims
   that have no place, and `schema_proposals` drafts that cite the observations which forced them.
   `scripts/lib/image-property-projection.mjs` already turns three fields of a deep reading into
   registered property rows and is the thing to extend. Two limits read in its code: it defers a source
   row whose confidence is below 0.6, and a reviewed row cannot be above 0.6 (the guard in
   20261109213000), so run it dry first and read its deferred counts; and it lands through an intake
   that refuses any key but the same three. The fold of callouts and part labels is new code beside it,
   dry first: a file of claims and no rows.
3. Land what already has a key. A `descriptor_key` that is live in `condition_taxonomy` is admitted
   today with no code change, and its witness row follows from `structured_data.image_id`. No script
   sends one. The claims step 2 finds a descriptor for are the first keyed rows and move rule 7's first
   count off zero while the rulings below are pending. They name no part yet; say so in the report.
4. Make the landing read the registry. This is not one file. The three keys and their values are typed
   in `ingest-observation/imageProperties.ts` and checked again in `index.ts`; in
   `ingest-observation-batch/cachedProperties.ts`; in `scripts/lib/image-property-projection.mjs`; in
   the SQL intake `ingest_cached_image_property_batch` (20261004064216); and in the guard on projected
   rows inside `get_field_provenance` (20261109203000). A registry row has no column for allowed
   values, so that column is itself a proposal, and a key applied from a proposal is `pending` unless
   the proposal asks for `core`, which is the only namespace the intake admits.
5. Let the model ask: a question kind for a part's state in a photo, built from registry rows, in
   `evidence_judgment_requests`.
6. Readers for the three questions, then C17's comparison on the same photos.

Four things were read in the code that day and have to be settled before step 4. They are also the
first test of rule 5.

- **A part has no place.** `vehicle_observations` has no column for the part of the vehicle a row is
  about (`subject_type` admits vehicle, organization, user, asset and external identity), a registry
  row carries no list of allowed values and no part, and no property uses a part as its discriminator.
  This is the first thing to file through `schema_proposals`. Decide it once, here, before anyone files
  it: in the test of this card four agents put the part in four different places. The shapes the code
  allows: (a) a key on the observation that resolves against `subject_taxonomy`, the way
  `descriptor_key` resolves against `condition_taxonomy`; (b) the part as the property's
  `discriminator_key`, the way `image_id` is used today, with the key carried in `structured_data`;
  (c) one property per part and state, which multiplies the registry. Recommended, not ruled: (a),
  because finding vehicles by part is then an indexed column and it mirrors the condition key.
  **Owner ruling, 2026-11-11:** use (a), the existing taxonomy FK, with the existing observation
  intake, source witnesses and build-log fold. “That ghost is the data machine,” and “not a scrap
  file on local”: the model is the product, not a separate reconstructed BOM artifact. The prepared
  `component_subject_id` / `component_visible_present` increment follows that choice; its open
  proposals, curator review and deployment remain distinct stages. It has not established a full
  vehicle population or an installed-unit register.
- **There are two registries.** `observation_properties` in the database, and the code registry
  `supabase/functions/_shared/cockpit/attribute-registry.ts`, whose own comment records an earlier
  owner call ("registry code is source of truth, not a DB table") and which already asks for a
  condition cue as kind, severity, box and panel. Nothing joins them. This card takes the database
  registry for photo readings, because the writer checks against it and `schema_proposals` grows it;
  the owner has not ruled between them.
- **A keyed fact is its own observation.** The reviewed deep-reading row cannot carry a property key
  or a confidence above 0.6 (the guard in 20261109213000), so each keyed fact is a separate
  observation through `ingest-observation`, citing one photo.
- **Nothing in the repo answers a question.** The claim and answer functions of
  `evidence_judgment_requests` exist and no script, function or app calls them; the answers in
  production were written from outside the repo.

**First component contract, prepared 2026-11-11 (release held).** The existing
`ingest-observation` resolves `component_key` against active `subject_taxonomy` and retains the
original reviewed observation, scalar selector, SHA-256 and canonical image witness. A part-level
boolean means *visible present* or *explicitly absent in a qualified named view*. `not_visible`
and `cannot_tell` remain unanswered inspection questions. The analysis clock and photograph's
separate capture label are exposed; presence then is neither installation time nor current tested
condition. Re-keying the same retained scalar folds once and retains the derived observation IDs;
it is not independent agreement. Condition descriptors must match the component's subject domain
and category, rather than borrowing a whole-image assembly state.

The three initial source cases are a visible 78PRMJ battery with a matching receipt candidate,
an alternator with acquisition and test status unknown, and a windshield with silver-gray molding
beside a black-molding stock candidate. A shared SKU and position do not prove unit identity; color
difference alone does not prove a contradiction. Purchase candidates, reported work, later visible
condition and actual inspection remain independent dimensions. Current-source withdrawal or
supersession removes the qualified reading from `vehicle_build_log_public`, preserving testimony.
The implementation's local contracts cover the real handler, source guard, witness projection,
reader, concurrent withdrawal and false joins. They are not production or native-UI acceptance.

Expected population stays unknown until a source-attributed applicable template exists. The live
`component_assembly_map` inspected on this date has three GM-truck templates and none applicable to
the 1973 Firebird; it also has no reference-document FK. The next concrete input is the retained GM
1973 FS87/FT87 molding chart (printed “1973 MOULDING CHART PAGE 1”, PDF page 33), which distinguishes
five windshield-molding pieces. Its page and applicability must enter the existing reference/model
owners before it can establish expected slots. A manual's expected pieces do not establish parts
installed on this vehicle, and unknown applicability never becomes a completion percentage.

**Testing this card by acting as the owner.** The owner's test: send a new agent, with no memory, the
kind of message he would send, and see whether it goes where this card points or where the 2026-11-10
session went. The messages and the grading are kept out of a new agent's reading path on purpose; the
guardrails README says where they are. Run the test after any change to this section and after each
piece of the build. An agent that is being tested does not open it.

**What a person brings, and where it lives.** The owner describes how a person critiques the data:
"based on their understanding and their patterns and their training along with their experience and
the context of the situation but we have to build that as a system". Each has a home. On 2026-11-10
none was present when a photo was read.

| What the person brings | Where it lives | State read 2026-11-10 |
|---|---|---|
| Understanding: what a vehicle is, its parts and their states | `observation_properties`, `subject_taxonomy`, `component_assembly_map` | 47 properties, 5 about a whole photo and none about a part of the body; 106 places; 3 assemblies |
| Patterns: what each state or flaw looks like | `component_assembly_map.state_indicators`, `condition_component_definitions` | read by no reader |
| Training: reference knowledge | `condition_knowledge`, `component_definitions` | mixed; some of it is manual text parsed into fragments |
| Experience: what has been seen, and what people ask | listing photos and comments, `question_taxonomy` | not consulted when a photo is read |
| Context: this vehicle, this job, this day, this view | the vehicle, its jobs and receipts, capture sets, the first read's view | not handed to the reader |
| The critique: ask, answer, agree, fact | `evidence_judgment_requests`, `ingest-observation` with witnesses | one question kind; no photo reading goes through it |

## Construction direction, owner priority 2026-10-04

The worked examples below are a construction brief, not a ceiling or evidence that Nuke is complete.
Recurring engineering should develop missing structure and useful answers from existing testimony:
useful question → source testimony → canonical entity relationships → current/replayable measurement
→ reader or downstream consumer. Each bounded capability names its grain, keys, event and ingest
clocks, writer and executable acceptance assay. Extend this brief and the case ledger as behavior is
proved, retaining dated owner intent and exact implementation, test, merge, deployment and runtime
stages. A masked current reader may expose useful work history while lacking the clocks and fields
needed for a historical financial model; record that boundary rather than inventing the missing inputs.

**Schema-aware repair loop, owner clarification 2026-10-04.** Reusable configuration relations are
one application of the model's work. The worker must recognize relationships in retained evidence,
inspect existing structure and choose a useful repair across vehicles, identities, work, parts,
sales, comments and media. The owner should not need to supply each model's distinctions.

1. Start with a useful question and exact retained evidence. Name the entity, row grain, source
   region, event and recording clocks, and unresolved claims; preserve the wider candidate population.
2. Inspect the current atlas, property/catalog vocabulary, canonical writer and downstream owner.
   Decide whether the gap is capture, extraction, identity/property binding, state maintenance or
   reader exposure. A missing scalar or property FK on a multi-field envelope is not proof of lost data.
3. Produce a concrete repair: original evidence IDs, missing relationship, existing owning path,
   intended consumer and an executable acceptance case. Missing vocabulary uses the existing
   `schema_proposals` curator path. A diagnostic suggests work; it does not authorize a write.
4. Implement the authorized repair in its existing owner, preserving testimony, privacy, unknowns
   and explicit holds. Prove the same source-to-consumer case plus the relevant disagreement case.
5. Record delivery stages separately, then use the next observed gap to choose the next repair.
   Byte accounting, descriptor presence and a passing sample are not semantic or fleet completion.

**Correction as model development, owner clarification 2026-10-11.** An evolving knowledge graph
with LLM-assisted ETL is a fair baseline description, not evidence of a new capability. The stronger
claim is a repeated loop: identify a representation limit, extend its existing owner, connect retained
evidence and improve a downstream evaluation without introducing incoherence. A larger schema does
not establish that the machine compounds understanding rather than mistakes.

Keep four evidence stages distinguishable: captured observation, attributed claim, agent interpretation
with its method/version, and computed conclusion with its inputs/rules. Name the existing mechanism
that carries each distinction, or the missing mechanism; this requirement alone creates no schema.
When an interpretation is superseded, trace its affected relationships, measures and consumers and
verify their revised results. Preserve the original testimony and the inputs/method needed to replay
the earlier evaluation. A changed current answer and a reproducible earlier answer are separate proofs.

Model canonicalization needs a source-supported negative separation case. A spelling alias and a
broader browsing-family member are different relationships. Binding more names to one named model
does not establish identity accuracy; preserve unresolved names and the make-level market context.
An alias correction must revisit its materialized groups, saved price fits, normalizers and cohorts,
not merely replace the label printed by one consumer.
For enabled intake matching, aliases are literal references, adjacent digits keep distinct model
codes apart, and specificity comes from the alias that matched. Unknown reference-year bounds are
not a contradiction; explicit bounds still exclude a supplied year. Normalization confidence is a
mapping score, not physical-vehicle verification. Record held lookup paths and legacy callers that
have not adopted the repair, rather than claiming all-model or all-reader completion.
A long corrective fold must also preserve reader availability and replication. Diagnose repeated
blocking before retrying; compare identical source snapshots and output multiplicity when caching
repeated expressions. Preparing a private copy is not a completed build or a reader cutover.

Every claimed correction loop needs a plausible wrong interpretation, later discriminating evidence,
the same source-to-consumer assay and an unaffected counterexample. Contradiction may correctly withhold
an answer; withholding is not resolution. Repeated improvement needs separately selected held-out
evaluations, with correction cost, regressions and population coverage. Parser accuracy, schema growth,
a proposal approval and one passing fixture cannot substitute for that evidence. The bounded comparison
contract and its delivery limits are recorded in the case ledger, §12.

**Recursive refinement, owner clarification 2026-10-11.** Discussion must change the executable model
and the instructions that guide its next iteration. Re-run the original question after a repair, through
the sanctioned writer and the actual consumer. If registration succeeds but intake refuses the claim,
the next gap is admission; if admission succeeds but the reader drops its qualification, repair the
reader. A retry must validate the persisted result rather than equating an existing ID with success.
Keep a disagreement or withdrawal case beside each positive case. This is a method for choosing and
verifying authorized work, not standing permission for production DDL or autonomous vocabulary approval.

Artist, buyer and researcher are contextual descriptions supported by actions and relationships. They
are not necessarily permanent person types or onboarding categories. The engine-family intake case
below tests the repair method on an existing proposal; it does not implement that cross-domain role model.

**Fleet-relative reporting, owner correction 2026-10-11.** The owner requires the full lot as the
reference for data-model work. A small successful cohort does not establish a material fleet gain.
Lead each progress report with the whole-population coverage and the unaddressed scope; put sample
verification and implementation detail after them. When fleet coverage has not been measured, say so.

- Name the population, entity/row grain, filters, count method and measurement date. Distinguish all
  stored vehicle records from public, undeleted vehicle records and unresolved physical duplicates.
  Label an owner-supplied reference, cached count or catalogue estimate; do not present it as a live
  exact census or silently substitute a different population.
- Show full-population and eligible-population denominators together. Name admitted source families,
  supported properties/relationships and exclusions. An eligibility restriction does not remove the
  rest of the owner's data from the goal. Unknown eligible totals or fleet coverage remain unknown.
- Separate retained raw coverage, typed property/relationship coverage and actual consumer usability.
  Define each acceptance condition. Eleven supported fields are a narrow model slice, not a complete
  vehicle model; describing every table or JSON envelope does not model every stored record.
- Report net newly usable vehicle/property or relationship pairs, losses, changed resolutions and
  remaining backlog against the same defined population and baseline. Completed source-property work
  can revisit existing pairs; distinct vehicles touched do not establish complete modeled vehicles.
- A fixed cohort proves behavior on those IDs. State its size relative to the full population and its
  selection method; do not extrapolate its gain to the fleet or lead with its within-sample percentage.
  A reusable reader repair can affect other eligible records, but that reach must be measured separately.
- Give observed throughput, incoming eligible work and backlog trend when judging pace. An active job
  is not evidence of rapid coverage growth. Estimate completion time only for a known matching backlog,
  with the measurement window and assumptions; otherwise state that fleet completion time is unknown.

This is a reporting and acceptance requirement, not an implemented fleet assay. Reuse existing
count/fold/assay owners and dated receipts; do not manufacture a denominator, start a full-table scan
for each update or mint another dashboard. If a necessary measure is missing, name its existing owner
and the missing measurement before claiming fleet impact.

## Public-use readiness, owner correction 2026-10-12

The delivery goal is public exploration of trustworthy asset evidence: find an example, inspect
what supports its identity and configuration, navigate its presentations and history, and obtain
qualified comparisons or other declared answers. Define acceptance from those activities before
counting fields. Any registered binding, eleven filled fields, canonical-claim presence, described
tables and captured batches are processing diagnostics. None is a public-readiness headline.

### Measure delivered capabilities

| Public activity | Unit and population | Acceptance for a supported answer |
|---|---|---|
| Find and open an example | Public vehicle record; all public, undeleted vehicle records, with non-vehicle exclusions reported | Actual anonymous search/browse reaches the correct stable record and detail route; identity facets have attributed support; ambiguous identity remains visible without an invented physical-vehicle merge. |
| Inspect identity, configuration and condition | Record × declared question; all applicable public records, including ones lacking evidence | The reader exposes relevant retained claims/media and attribution, configuration context, units and clocks; conflicting claims and unknowns survive. Each displayed conclusion traces to its admitted inputs and method. A seller assertion remains an assertion. |
| Follow presentations, asking prices and history | Publicly eligible presentation/episode × question; include single-sighting episodes | Correct source/episode keys, original price/unit witnesses and ordered source/processing clocks reach the reader. Repeats are idempotent. One sighting yields one observation; duration needs its declared evidence. Observed span is a lower bound, disappearance is not a sale, and an earlier state excludes later evidence. |
| Compare examples and read market movement | Declared subject × comparison question, plus its candidate episode population | Reader returns qualifying members, exclusions, unresolved candidates, source/window coverage and matching rules. Amounts, currencies, asking prices, bids and sale outcomes remain distinct. A qualified measure requires the stated evidence and uncertainty; a browse group alone is insufficient. |
| Use a derived assessment or forecast | Eligible subject × versioned question × cutoff | Inputs and calculation are replayable; held-out evaluation against the declared baseline establishes the method's error/calibration in its intended population. Unsupported assessments stay unavailable. Shipping basic exploration does not certify an unvalidated forecast. |

A confirmed-sale movement fold must admit sale outcomes on their sale clocks. A classified
capture, asking amount or disappearance cannot enter its sale count, sold-dollar sum or sparkline;
keep those observations available through their presentation and supply readers.

These are separate capabilities with separate gates. Do not average them into a completeness
score. A record can support attributed inspection while its valuation is blocked. An unresolved
listing can support source history while physical-vehicle identity remains unresolved.

For every advertised capability, write a versioned acceptance specification with the required
evidence/relationships, eligible grain, public route/API, supported output, refusal conditions,
freshness limit, latency/error objective and assay method. Register it through existing stack and
assay owners. Test anonymous access, keyboard/navigation behavior and evidence drill-through,
not just an admin/service response or a dependency being present. Freshness and service objectives
must be explicit per capability before its release verdict; they are not established by this document.

### Readiness counts and release evidence

Every assessment partitions its declared eligible population into **ready**, **blocked** and
**not assessed**. The three counts must reconcile to that denominator. Not-applicable exclusions
are separate, rule-qualified counts beside the full population; absence of evidence does not make
a record inapplicable. Never drop unknown identity, missing fields, private-reader failures or a
failed page from the assessment silently. Private records remain outside public eligibility with
their count/unknown scope reported; this contract does not grant access to them.

Report public record reach separately from supported-answer coverage. Honest withholding can
pass a reader's refusal assay, but does not count as an available supported answer. Readiness is
the conjunction of the capability's evidence, identity/context, public delivery, freshness and
quality gates. An unassessed gate cannot pass. A useful headline is **ready answers / eligible
record-question pairs**, broken out by named question, with **ready records / full public record
population** for the stated capability. No complete-model percentage is defined by these counts.

Each report carries contract version, population/filter identity, grain, measurement window,
exhaustion status and evidence stage. Show full retained/public and capability-eligible populations
together, then ready/blocked/not-assessed counts and reason breakdowns. Compare the same manifest
and contract before/after: newly ready, regressed, net gain, new arrivals and departures are distinct.
Report remaining blockers, ready-output throughput, incoming work and backlog trend. A cached census
can anchor a dated population; a sample cannot replace its unmeasured readiness numerator.

Quality evidence includes independently checked attribution/unit/episode errors, contradictions,
held-out selection method and uncertainty, plus anonymous-reader success, response time and staleness
by relevant source/configuration strata. Zero errors in a small test is not fleet accuracy. Known
critical privacy leaks, wrong-entity attribution, unsupported factual output or future-evidence
leakage block the affected public release until repaired. Passing fixtures establishes their cases;
unmeasured correctness or service behavior remains unassessed, rather than a claimed production pass.

Measure source fidelity separately from physical truth: faithfully quoting an engine claim does
not establish the installed engine. Evaluate derived extraction/identity/condition judgments against
independent references with unresolved cases retained. Report both the tested population and its
relation to the full eligible population; give error bounds and untested strata. Require a passing
ordinary case, disagreement case, unknown case, private-record negative control and cutoff/replay
case for each applicable advertised output. A fallback answer cannot bypass the same evidence gates.

Keep blocked counts per gate and their intersections; one record may lack several relationships.
Choose deterministic repairs by the measured affected population and expected newly supported
answers, then verify actual net gain and regressions. Do not select work because a tiny fixture is
easy to finish. Reuse existing retained evidence, writers, folds and readers across the full eligible
population; no per-node LLM dependency or new population census per status update.

### Facebook acquisition and model acceptance

Facebook is a platform entity, not one feed or a vehicle population. Distinguish its channels
(Marketplace, groups and pages), geographic/search markets, publishers or account identities,
listing/post presentations, media, interactions and later sightings. A listing ID identifies a
source presentation; a physical-asset link needs separate evidence. The same asset can recur across
presentations and channels. Publisher identity, location, source assertions and promoted rank have
their own provenance. Vehicles are the present product scope, not the platform's complete ontology.

Define the acquisition objective as a versioned target inventory through existing source owners:
channel, geography/radius, category, query/filter, priority, access state, discovery/revisit cadence,
and evidence depth needed by the public question. Include intended but unconfigured, inaccessible
or held targets in the backlog. The owner's 1960–1990 preference prioritizes discovery and revisits;
it does not discard other observed vehicles or unknown years. A chosen search surface cannot silently
become the definition of the whole market.

| Measurement | Denominator and pass condition |
|---|---|
| Intended reach | All declared target scopes, including blocked/unconfigured channels and markets; report discovered, configured, visited within cadence and inaccessible separately. Target count does not measure inventory size. |
| Enumeration coverage | Source-ID manifest for each target/window, with pagination/continuation, filters, ranking/personalization and exhaustion evidence. Report observed keys, keys retained and unvisited pages/unknown tails. A displayed or exhausted personalized result set establishes that surface only, not all Facebook inventory. |
| Capture depth | All enumerated eligible listing/post IDs, plus the full retained source population assessed separately; required source text, media witnesses, original identities/clocks and acknowledged retention are checked per question. Missing media is not completed image evidence. |
| Repeat observation and freshness | All listings due under the declared revisit rule, including failed/blocked visits; report on-time retained revisits, stale/unvisited IDs and gaps. Preserve asking-price history and distinguish source event time, observation time and processing time. |
| Model and public answer coverage | Retained presentation/question population partitioned by the readiness gates above; report unresolved asset/publisher/context links and reader failures without suppressing useful source-level histories. Private capture availability is not anonymous public delivery. |

There are three different inventories: intended source scope, observed source keys in declared
surfaces, and retained database records. Reconcile them rather than substituting a new capture batch
for any of them. Database row estimates are discovery evidence until exact keys/grain are reconciled.
Do not divide repeated sightings by vehicle records or extrapolate a captured slice to platform size.
When the global platform denominator is unavailable, still report progress against the declared
target plan and retained backlog, with uncovered channels/markets explicit. This defines work to
reach; it does not authorize new access, source activation, public grants or release of existing holds.

### Implementation boundary

These are owner-directed acceptance criteria, not an implemented readiness census or a launch
certificate. Extend existing `db-stats`/SystemStatus, stack contracts/coverage and their assays,
`intake-reader-reconciliation.sql`, source target owners and canonical folds. The current intake
receipt reader establishes bounded acknowledged operations; stack dependency coverage establishes
declared structure. Neither presently supplies these whole-population public-readiness verdicts.
The next implementation must name missing gates and connect their evidence to existing consumers
before reporting a ready numerator. Preserve historical measurements with their original meanings.

The next checkpoint is a capability acceptance matrix: advertised question, owning reader/fold,
required evidence and relationships, public caller, population rule, freshness/service objectives,
assay and current ready/blocked/not-assessed status. Start with the existing public browse/detail,
evidence/history and market readers and their registered questions, rather than inventing a new
dashboard. Apply deterministic predicates in batches to retained populations, reconcile all pages
and failures, and independently check public delivery and semantic accuracy. For Facebook, pair
that matrix with the intended channel/market target manifest and the full retained presentation
backlog. Missing contracts and unconfigured targets are assigned work, not exclusions that improve
the percentage. This checkpoint must precede another headline about model coverage or pace.

The read-only `scripts/discovery/intake-reader-reconciliation.sql` locates gaps between retained
source, observation, fold and current reader. `configuration-catalog-relations.sql` drills existing
property/model/OEM relationships and proposes owned repairs. Both require explicit bounded inputs;
neither installs an autonomous worker, admits claims or qualifies valuation. See the database
operations manual for execution and acceptance boundaries.

Promoted by the owner on 2026-09-30 as "the absolute most important thing": the database structure, its vocabulary,
and how the owner and every agent talk about it. Read this before designing any table, feature, cohort or prediction.

**Owner positioning, 2026-10-07: observation, not knowledge.** "LLMs are taking up market share in
knowledge, but knowledge is not observation. Knowledge is hallucination, just like for humans: even the
smartest person can be wrong. What we're operating within is record-keeping and provenance, and that's
potentially the opposite of models." Do LLMs tell the future? Not from knowledge: prediction needs what
happened, as of when, processed as fast as it lands (an auction's last two minutes). Documentation should be
as current as the chain of thought: the record stays as up to date as an agent's reasoning, but it is what
happened. The README leads with a measured result, the live auction (case ledger §13.7).

**The model:** the internet publishes the raw material (listings, bids, comments, photos, results); Postgres is the
refinery. The machine has five layers, each defined inside the database itself so any agent can read it cold:

1. **The log.** Every bid, comment, photo and fact lands once as an append-only row with two times: *event time*
   (when it happened at the source) and *ingest time* (when we learned it). `auction_comments` (18.4M rows) is the
   auction log; `vehicle_observations` (10.1M rows, "immutable event store for all vehicle observations") is the
   fact log.
2. **The state.** One row per live thing (a live lot, a bidder) holding running measures, updated as each event lands
   at a fixed cost per event (incremental maintenance: counts, sums, distinct sets, sketches such as t-digest and
   HyperLogLog). No rescans of the log at page time.
3. **The baselines.** Cohort distributions (what comparable lots looked like at each hour to close), recomputed on a
   schedule, because history does not change when one comment lands.
4. **Features, and features of features.** Measures keyed to an entity and an as-of time, built in levels: a record
   (what a bidder has done), an effect (what happens when they enter), and the lot-level sum of effects present.
5. **Predictions.** A defined bet on an outcome, graded against a baseline, backtested by replaying the log.

The present is a **fold over the log** (state = f(every event so far)). The past matters because every new feature
has to be computed for every past lot by **replay** before anyone can test whether it predicts anything. Rebuilding
the log from the published record (the backfills) is how the machine gets its past.

**The invariant(s):**
- **Append, never overwrite.** Events are immutable; corrections supersede (SCHEMA_LAW, `lofficiel-concierge/supabase/SCHEMA_LAW.md`).
- **Bitemporal.** Every event table names its event-time column and its ingest-time column, in the column comments.
- **Idempotent ingest.** Every event has a source key (e.g. `bat_comment_id`), so a replayed or re-read event counts once.
- **Point-in-time correct.** A feature used at moment *t* may use only events with event time before *t*. A lifetime
  number computed today (e.g. `bat_user_profiles.win_rate`) must never feed a past prediction: that is *leakage*.
- **Every reference is a foreign key.** Text that names another entity (a handle, a listing, a place) becomes a key to
  that entity's table. The identity entity already exists: `external_identities` (platform + handle, 593K rows, 19
  tables keyed to it). Extend it; never mint a parallel identity table.
- **The database describes itself.** Every live column carries `COMMENT ON`: meaning, unit, source, grain, and which
  time it is. `v_schema_atlas` (`n_cols_described`, `fk_in`, `fk_out`) is the scoreboard.
- **Per-event work is incremental; cohort work is batch.**
- **One owner per computed field** (`pipeline_registry`).
- **No prediction without its six blanks** (below).

**The vocabulary** (say it this way):
- *Entity (dimension table)*: a thing that exists: a vehicle, a person, a place, a model.
- *Event (fact table)*: something that happened at a moment: a bid, a comment, a photo, a sale.
- *Grain*: what one row means (one comment; one lot; one lot at one hour to close; one bidder as of one date).
- *Foreign key*, *one-to-many*, *many-to-many (bridge table)*: how rows point at each other.
- *Event time / ingest time*, *as-of join*, *point-in-time*, *replay / backfill*, *leakage*.
- *Feature*: one measure of one entity at one moment. *Label*: the outcome a prediction is graded on.
- *Cohort*: a set of dimension values; *stacking*: their intersection; *residual*: observed minus what the stacked
  cohorts expect (the anomaly score).
- *Percentile rank within a cohort*: the calibrated spectrum ("hot" means the same thing at every table).
- *Lift*: P(outcome | X present) ÷ P(outcome | cohort without X). *Shrinkage*: pulling a small-sample estimate toward
  the cohort, so one lucky result does not make a legend.
- *Backtest*: replay the past hour by hour with only what was known then; grade the predictions.
- *Calibration*: 80% ranges contain the truth 80% of the time.

**Worked shapes (the owner's examples, 2026-09-30):**
- **The consequential bidder.** Level 1, record as of a date: auctions entered and won, win rate, median top bid, share
  of bids in the final 2 minutes, segments, comments per auction. Level 2, effect: *entry lift* on an outcome such as
  "closes above its cohort's 75th percentile", shrunk toward 1 on few auctions; and the *event study*, bidding pace in
  the hour after entry against the hour before. Level 3, the lot: the lift of everyone who has entered so far. Measured
  2026-09-30 in `bat_listings.buyer_username`: 68,957 distinct buyers; 685 won 10 or more lots, 39 won 50 or more, one
  won 703; the top 1% won 14.0% of all lots.
- **Cohort stacking.** Dimensions are hierarchies (make → model → generation → trim; state → region → coast; era;
  condition tier; provenance tags read from listing text: "California car", "rust-free", "Florida"). A lot belongs to
  many cohorts at once (bridge table lot × cohort). The 1600 Veloce in New England is a residual: normal against the
  model nationally, an outlier against the region, which says where the money is. Location today is about 13
  overlapping columns on `vehicles` (`state`, `city`, `zip_code`, `registration_state`, `bat_location`,
  `listing_location_raw`, `gps_latitude`, …) with no geography entity to key them to.
- **The live lot.** The SL500 of 2026-09-30 at 2 h to close (`live_lot_temperature`, PR #482): bid $10,000, higher
  than 68 of 273 comparable sold lots at that point; 38 bids and 15 bidders. Price cold, activity hot.

**Built current reader shape, 2026-10-04.** Permitted work testimony can reach a searchable vehicle
table (PR #564) and a Lifecycle count/supplier/activity reader (C22 local assay at 22:22 UTC).
A work filter makes older work reachable when newer conditions fill the recent-activity window.
The original observation ID gives idempotent reader merging; the public contract's recorded date
is not an ingest clock, supplier text is not an organization key, build stage is not installation
evidence, and a readable-amount subtotal is not complete investment. These boundaries expose the
next structural dependencies without treating a current reader as a historical financial feature.
See the C22 case for the assay and separate delivery stages.

**A prediction is six blanks.** At moment **t**, from only what is known at t, for lots in population **P**, a
distribution over outcome **Y** in a stated **form**, graded by rule **S** against baseline **B**. Example (proposed,
awaiting the owner): "At 2 h to close, for BaT lots with at least 8 same-model comparables, predict the final price as a
median and an 80% range; grade by absolute % error against the cohort median; backtest on every lot closed since 2025
using only data known at 2 h."

**Measured state, 2026-09-30** (`v_schema_atlas`): 925 tables (654 non-empty); 16,403 columns, 2,967 described (18%);
195 non-empty tables with no foreign key in or out. `auction_comments`: 56 columns, 2 described, nothing keys to a
comment. `bat_user_profiles`: 689K rows, 26 columns, 0 described, no keys in or out (an island). `bat_listings`: 157K
rows, 0 of 28 columns described. `vehicles`: 342 columns (157 described), 285 tables key to it.

**The team (one lane at a time, each with its scoreboard):**
1. *Cartographer:* describe every column of the event and entity tables (meaning, unit, source, grain, event or
   ingest time) and list every text field that names another entity, with its match rate. Scoreboard: described %.
2. *Keys:* turn those fields into foreign keys (comment author → `external_identities`; listing → vehicle; location
   → a geography entity). Plan-first: big tables take `NOT VALID` keys, validated in the background.
3. *Time:* event and ingest time declared on every event table; the per-event state rows for live lots.
4. *Features and cohorts:* bidder records and effects as of a date; the cohort dimensions and their bridge.
5. *Prediction:* the six blanks filled with the owner; the replay backtest.

The process these lanes run, as the stages one row passes through (land, key, describe, shape, fold, replay, assay,
prospect), its queue and its standing runner are in the case ledger, §12.

**Canonical entrypoints:** `v_schema_atlas` and `v_job_health` (read with `scripts/data/q.sh`); `auction_comments`
fed by the cron `bat-live-pull` (live lots) and the `import_queue` backfill; `vehicle_observations`;
`external_identities`; `pipeline_registry`; `live_lot_temperature(p_vehicle_id)`; `market_index_values`
(`BAT-LIVE-BIDS`, hourly); `scripts/discovery/repair-backlog.sql` (the ranked model backlog from the atlas,
read-only; case ledger §12).

**Owner buying question, 2026-10-08 (§13.10).** Separate the mileage number's reassurance to a later buyer
from confidence in a vehicle bought for personal use. Maintenance, usage, storage, exposure and condition
testimony must become reachable from retained descriptions, comments and images before assigning economic
weights. The bounded `scripts/discovery/buying-evidence.mjs` finder (PR #900) exposes exact attributed regions,
source clocks and retrieval gaps; its lexical candidates are not admitted work, diagnoses or reliability
predictions. No matches mean unknown. Reliability and resale have different outcomes and need separate calibration.

**Do NOT:** feed a lifetime aggregate into a past moment; build a feature that cannot be replayed from the log; mint a
second identity, geography or cohort table beside an existing one; store a derived number without its as-of time;
describe a column in a doc but not in the database.

## Drilling through cohorts, 2026-10-04

The owner's "repair" and "sale" are names for recursive cohorts of connected evidence (§10 of the case ledger).
A useful drill has two kinds of depth: **relationships** into smaller/shared evidence cohorts, and **folds** into
measures and measures of measures. A larger diagram alone does not establish either one.

For each node, declare its grain before connecting it. A catalog part design, one physical part, one purchased
line and one installation are different grains. A labor task, its entry author, its performer, a skill claim and
a dated record of supported outcomes are different grains too. Reuse the same evidenced entities across jobs,
ownership periods and market events; bridges carry role, period and attribution. Preserve unresolved matches.

An example drill is **repair → labor task → performer → skill record → prior job → observed outcome → supporting
observation → original source**. The prior job can point back into the repair graph: fan-out is a graph with shared
nodes, not duplicated ownership of every descendant. A missing outcome is unobserved, not successful work. A
rating has a reviewer, criterion and work context; it is not automatically a measurement of technical skill.

Artistic practice uses this same contribution foundation: a person's evidenced activity can develop their skill record across
vehicles and artworks. Keep the originating artist, executor, holder and documenting photographer as contextual roles; a
library association is not a creation claim. The shared automotive/art repair and its open acceptance cases are in
`data-machine-cases.md` §21.4. Extend existing contribution and capability owners before introducing a separate artist system.

Above that evidence, follow the card's five layers:

1. **Log:** source-keyed claims/events and corrections, with their event and recording clocks.
2. **State:** supported records keyed to an entity and as-of time; update affected records incrementally.
3. **Baselines:** distributions over explicitly eligible comparison populations and stacked dimensions.
4. **Features of features:** contextual records → measured associations with outcomes → a combined job/vehicle/lot
   assessment with declared dependence and uncertainty. Do not silently add overlapping effects or call an
   association causal. Sparse or unqualified evidence can withhold the measure.
5. **Prediction:** the six blanks, then replay and grading against the declared baseline.

Comparison membership is explicit: for example procedure × part family × vehicle specification × region × date ×
evidence coverage. Keep all retained source episodes available before qualification and relevance; retain unknowns,
conflicts and the reason for each exclusion. For every aggregate name its unit, denominator, eligibility, source
lineage, event cutoff, knowledge cutoff and revision. A retrospective assessment using later evidence is distinct
from what was supportable at the earlier moment. A row-created timestamp alone is not proof of commit availability.

A new event updates the affected incremental folds and marks affected baseline/feature work for their declared
cadence. A duplicate source event counts once. Later evidence may revise today's reading of an earlier ownership
period while an earlier assessment receipt remains reproducible. No full-log rescan belongs in a page request.
Every proposed fold still needs an owner, writer, assay, described keys and a reader before it can count as operating.

**Existing anchors, checked 2026-10-04:** the capability map designates `work_sessions` as the work ledger and
`catalog_parts` as the parts catalog. Live metadata confirms typed work-session links to vehicles, users, places
and technician phone links, and a catalog-part link to catalog sources. This does not establish a complete
performer/skill/payment/part-instance chain. The repository's `create-work-session-from-evidence` currently creates
an image-backed pending-analysis `timeline_events` row; its name alone cannot prove work-session ingestion. These
are a bounded design and metadata/code inspection, not a runtime assay or permission to mint parallel structures.

**Before you build here:** read this card, SCHEMA_LAW, `docs/ledger/CAPABILITY_MAP.md`, and the `v_schema_atlas` row
of every table you touch.

## The owner's words, 2026-09-30 (typed to the lead from the airport)

> theres so many factors and this data discussion needs to be promoted significantly in our heirarchy as i need deeply
> to internalize this core functionality. it for far to long has been getting brushed over as if the DB is perfected
> when it is far far from it. when i see the postgres example i already know that map reaches FAR deeper than that
> example shows so either i havent illustrated enough what i need or youre pulling an extract. its the first option as
> no matter what we need to continuously develop meaningful branches of data. the internet is giving us freely
> information. its the raw material that we refine and our only tool in that refining process is i guess at its core a
> postgres [...] the postgres is not good enough. i want to mine out every single possible grain. we havent enough
> defined what each entity, dimension table, event, fact table, foreign key, one-to-many, grain... can become. we
> havent made enough foreign keys out of the source data. i love the "how the data is laid out" we need to get a team on
> that. "measuring a lot at the moment" ok so this already i hit a wall because data is a constant. its always coming in
> and the measuring is always recalibrating. period the end. the entire entity of bat in theory shifts as every comment
> arrives. its pushes the data most certainly. so stop - how does that effect our db, our processing.. how do we make
> that whole situation free? hard algorithms, hard equations that run everytime a data point lands and lets say they
> are landing a lot and fast. its not like we are measuring at the end of the day. we are measuring at stock market
> speed [...] whys it so hard to get this method on paper so an agent can begin to build it with me. [...] if the data
> system is set up to constant monitering doesnt only the present matter? all the sudden things kind of collapse. the
> past really becomes the past.. far less interesting than whats happening BUT... the big but is if we didnt properly
> set our postgres up or our jargon up then we have to go back into the past and pick up those measurements. [...]
> point-in-time like i said, thats where we need to fix. we are picking up all the old pieces, atoning for not having
> had the perfect tool from day one. but as we pick up to pieces we are seeing more and more relations thats why all
> areas of the machine have to grow in unison. its only possible with coordinating always turning agents who know what
> they are doing and have an understanding of time. like its bad when a vanilla agent jumps in and assumes but i guess
> we are building or might need to build in a way that a new agent is forced to work as if they are a context rich
> agent... thats possible if the posgres is really good right? ok so yeah we have features. features need to grow, but
> what about features of features. when you add things like bidder, how it becomes a consequential bidder, what
> measurements do you have to be tieing in to eleveate a biddder into one that when they enter the auction the auction
> has then a higher probability of something happening. [...] once, a known in the crowd guy bid and commentors were
> like oh shit when he shows up hes never lost an auction... these types of guys wow weve got to know their behaviors so
> how do we create the postgres definition equation of what that bidder looks like. cohort... we have a lot of
> different types of cohorts, from year make model to west coast car or east coast car. so cohort stacking creates a
> profile on a vehicle often seen in marketing... clean california car for sale.. west coast truck... new england rust
> bucket... id never buy a car from florida.. type shit. so many measurements and then anomoly opportunites when u see
> 1600veloce operating out of the new england area. ultra high end.. but thats cuz theres money out there.. [...] the
> visuals we need to unlock first is to see the posgres in its best form and developing. path to prediction starts with
> defining prediction if its what we are both talking about

(The elisions `[...]` drop the owner's market-strategy remarks about a named company, kept out of this public repo; the
lead holds them.)

## The owner's words, 2026-11-10 (typed from his phone during the image-analysis session)

> Here's how I see it, when a user signs up, they grant access by clicking allow allow allow on the requests we ask
> for. Then the connection takes place and it's really not batches. It's one at a time til done. The ideal is that we
> start from the earliest available data because provenance works in order not in random. But in reality we also have
> priorities like users want to have their thing in mind getting handled, I'm not sure what that would be per say but
> like a specific job of vehicle they have some need for urgently. So part of the reason we are such a mess now is due
> to the multiple swings of the jagged ax over the last two years causing a mess of ideas. Anyways User signs up grants
> access Flow begins data enriches. User data stack and the profile takes it shape. This idea is in opposition to the
> traditional approach of software provinding a bunch of forms to fill. Instead, the data acquires labels, keys, folds
> etc as connections are made. The connections span from the images, text messages, emails, connected financial
> records, and whatever else, PDFs etc. The users photo album is one of the most easy repeatable systems to automate.
> Because it's the same for everyone. Just a bunch of images. Then we label and tag all the stuff in the images. We
> build up "everything" specifically visible and underlying concepts visible in the pattern of images. It tells so much
> about users. The data is signal the lack of data is signal. If they don't give signal we direct them on what they
> need in order to provide us with what we need. So yeah image analysis is the mega department of everything and I hate
> it. I think for now you're kind of focusing on the single idea of how to look at images and make sure whatever packet
> of data that you've arbitrarily decided is important lands in someway in a data base that's under powered for the
> capacity you're in need of. [...] It should be divided and given to shapes that will persist

> The other thing is that the data model is supposed to be the blue print the hypothesis the mirror of how the data
> needs to be interpreted. The agent walks up to the mirror with the data and sees it's normalized form its data model
> shaped form it's tesseract it's real structure that will enable it to be cross examined in a full on mind hive of
> data. So when you wanna search specifically mustangs whose felts were replaced during restoration with photographic
> proof you can. Or like find a Porsche that has this specific imperfection on it. You can. Or find that that specific
> imperfection was repaired and that it's now this restored Porsche. Stuff like that. Earliest photos first is a
> dangerous mode. That's why you need to handle it like really carefully with prejudice Because it's great if we have
> infinite compute. But if we don't we will not win. And in the state of the db and how images are handled I wouldn't
> know if it's good or not. I like the body of what I said earlier and wouldn't want to dismiss the heavy concepts [in]
> it because of a focus on one aspect like this

> So the next bar that's more important the images being "analysed" is the enrichment of the data model which is the
> real measure. I don't know where to start with that but like tables, keys, folds, all those fancy things. That's
> image analysis. That the observations connect

> The map is supposed to be the data model it's supposed to be the mcguffins of the scenario. It's supposed to be
> shaped even to help find what it's shaped to look for. We get to control the map and look for what we are trying to
> find. The yes/no is answers. And they become factual if handled right creating truth from a hallucination machine.
> The contextual data shapes the map too. The point of view shapes it

> There's so much going on. This is how I explain how a human approaches critiquing the data They do it based on their
> understanding and their patterns and their training along with their experience and the context of the situation but
> we have to build that as a system which is what I've thought we've been doing for a couple years now

> That's my point is that the data and the data model reinforce either and the agent has to wire it in real time. If
> there's no place to put the data it has to be written. That takes a certain degree of intelligence and most
> importantly consistency

> This is the only conversation that matters and that we never backtrack from here and that any agents never has to do
> what you did today The obvious problem of being able to write the data model side is if it writes too much and wrong
> and new every time. So I'm not sure how to remedy that but again if it's running we can fix it. If it never gets off
> the ground we can't

> But also the architecture is the only thing that will ensure agents even dumb ones don't fuck up

> I'd think you can hand the whole folds and keys stuff to a tested dedicated agent or I'm not sure hopefully you can
> configure a team that help you work

> You'll get to a point where you'll need to test the system by acting like me. Querying to a new agent to fix the
> image analysis pipeline. That's where this will get interesting

> For me, a real test would be that I can like talk with Grok Bot and like it actually would be on the same page as
> where we're at right now if that makes sense

> Like I said, the best type of batch is one at a time, unfortunately and then figuring out how to speed things up
> beyond one at a time. Does that make sense? You can generate it on that idea but if they can't do one, they
> definitely can't do, but the thing is kind of changes when you have to analyze batch contextual information but
> that's like a different approach a different harness.

> A better example to work on is the firebird. Also the talk on keys and folds is essential to not lose. I know we
> need the pipeline to work but it has to be for the data we actually care about

Earlier the same day, on where the first reading happens, on provider keys and on the app: "First read can take place
the moment the image is taken like a live stream basically. And it can be routed vision api on device and all in near
livestream speed"; "That gate is more like a key box. Use whatever key has tokens. Don't just block"; "there's no
successful integration on the iOS that helps me know it's moving forward or stalling."

(The elision `[...]` and the omitted messages are remarks about the session itself. `[in]` restores a word the phone
dropped.)

## Additions, 2026-10-01 (from the owner's phone session of 2026-09-30)

- **The case ledger.** `data-machine-cases.md` beside this card holds the open cases, the extended vocabulary
  (market event, method, blip, chain, closer, edge, fold, dimension, bridge, join, assay, vein, fold depth), the
  measurements of the soft close, the monitoring-by-species table, the hypotheses to test, and the compass. Read it
  with this card; close cases there with the commit and the number.
- **Lane 6, Prospector.** Input: the residual view (mass with no keys, no descriptions, no reader, still written).
  Output: the vein ledger, a table. Scoreboard: veins assayed per week, veins promoted to features.
- **Market event.** The entity is one act of bringing an asset to a room; "auction" is a value of its method
  dimension. The soft-close chain is the first fold over it (80% of BaT lots extend; 39% of bids and a median +25%
  of price happen inside the chain, measured on 400 lots).
- **Not abandoning a fold:** an owner in `pipeline_registry`, a scheduled writer, an assay in `v_job_health`, a
  described output keyed to the trunk, and a reader. A fold with no reader is dead on arrival.
- **Anon rule:** anon may write testimony only as proposals into quarantine, never truth (P0.5, #488).

## Construction evidence, 2026-10-05: unresolved relationships reach readers

A missing supplier key or name must not make otherwise permitted work disappear from a supplier
reader. C22's bounded consumer case retains six existing work observations under an explicitly
unrecorded supplier, using original observation IDs and recorded dates. Supplier-text groups are
presentation groups, not organization entities or verified bridges; current masked work supplies no
ingest clock or complete monetary outcome. The case ledger records executable acceptance and exact
delivery boundaries. This extends the useful answer without inventing the missing relationship.


**Construction evidence, 2026-10-05: a supplier group reaches its permitted work.** C22's
supplier-detail reader joins the existing masked build-log contract by original observation ID.
Exact supplier-text selection and an explicit unresolved selector make the group drill reproducible
without treating a slug as an organization identity. The same six retained anonymous sources reach
six local detail rows where production previously showed zero. Event dates remain recorded dates;
missing source/ingest/organization relationships remain missing. See C22 and its delivery receipt for
separate implementation, publication and runtime stages; this is one current consumer connection.
