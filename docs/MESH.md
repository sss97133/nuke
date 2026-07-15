# The Mesh

> Founder curates. This is the doctrine for the query layer and the agent
> economy. Read before touching search, the API surface, or anything that
> writes vehicle data. Companion to VISION.md (why) and LAUNCH_DAY_ONE.md
> (when). Last updated 2026-06-10.

## One primitive

Every fact in nuke has the same shape:

```
(vehicle, field, value, who said it, how confident, what it cost, when)
```

The feed, the map, the vehicle profile, the agent API — these are not
features. They are renderings of queries over that one shape. "What's going
on with Corvettes" is a slice across five dimensions of the same data:

| Dimension | The Corvette slice |
|---|---|
| Inventory | every Corvette the mesh knows (digital twins) |
| Live state | at auction now; surfaced on FBM in Albany 20 min ago |
| Activity | who's wrenching on them; work sessions; photos flowing in |
| Market | drawing bids/watchers; just sold; at what price |
| Probability | given listing velocity by region/segment, where the next ones pop up |

The user (or agent) rotates one answer: list → map → timeline → odds.
Rotation must feel free — queries cheap enough that an agent calls them in a
loop without anyone wincing at the bill. That's the god-map feel.

## Honest emptiness

**The mesh never bluffs.** If the true answer is "one active mechanic in your
area," that IS the answer — rendered plainly, not padded. Sparse-but-true
beats dense-but-fake; it is the entire moat against generic LLM hallucination.

Implementation rule: every answer carries its own coverage —
`based on N observations · freshest X hours ago · confidence Y`. The render
says "thin data here" instead of pretending. This is cheap because every fact
already carries provenance. Empty cells on the god map are not failures; they
are the acquisition roadmap.

## Field economics

The unit of account is the **schema field**:

- **Cost to fill** — tokens for a vision pass, a scrape, a human's minute.
  Stamped at write time (the photo pipeline already records duration; add
  model + token cost).
- **Value when read** — how often queries touch the field (app_events +
  API logs make this measurable).

The database's worth = answered fields × query demand for them. Every
decision — which backfill, which agent gets more work, what API access
costs — becomes arithmetic on that ledger.

## The selection loop ("genetic" inputs)

Agents, humans, and agents-acting-for-humans are one model: **sources**
writing observations with trust scores. The substrate exists —
`observation_sources.base_trust_score`, `vehicle_field_evidence` with
confidence + source attribution, `pipeline_registry` field ownership.

The missing piece is selection pressure: when a later, higher-confidence
observation contradicts an earlier one, the earlier source's score takes the
hit automatically (nightly contradiction job). The mesh breeds good
contributors and starves bad ones. No committee — the data grades its own
inputs.

Nobody is exempt: humans are just another source with a score. Nobody is
trusted; everything is scored. That is why the system can be trusted.

## The agent hierarchy

| Tier | Who | Can do | Trust basis |
|---|---|---|---|
| 0 — Builders | founder + key-level agent sessions | curate how the system exists: schema, pipelines, doctrine | the keys |
| 1 — Toolsmiths | proven agents | propose/build small tools, adopted on demonstrated results | track record in the ledger |
| 2 — Contributors | any agent or human source | write observations through gated ingest paths only | trust score, earned |
| 3 — Queriers | everyone (incl. paying API/MCP users) | read answers | n/a — reads are safe |

Promotion is earned bottom-up, measured in the DB (the selection loop above).
Writes NEVER touch tables raw below tier 0 — they go through gated functions
(`ingest-observation` etc.) that stamp source + confidence. The security
model is the tier model.

The translation layer — human asks in plain language, the agent picks
functions from the toolbox — already has its manifest: **TOOLS.md is the
toolbox.** The MCP connector (`nuke.ag/mcp`) is the door any agent walks
through. "My agent handles my data, paid through my Claude subscription" is
deployed reality, not roadmap.

## What to build, in order (no new construction — close the loops)

1. **The answer endpoint.** One query → structured answer (counts, live
   listings, price distribution, activity) + visual payloads (map points,
   trend series) + coverage metadata. Compose from what stands: browse_stats,
   feed MV, atlas data. Every client renders the same truth.
2. **Cost stamping.** Token cost + model on every pipeline-written field.
3. **The contradiction job.** Nightly source re-weighting. Small SQL,
   enormous consequence — the difference between a pile of claims and a
   self-correcting mesh.
