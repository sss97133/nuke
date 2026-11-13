# Documentation

Start with [`AGENTS.md`](../AGENTS.md) at the repository root. It sets the working rules and routes each question to the
document that owns it. This page maps the rest of `docs/`.

No file here is the record of what runs. The live `v_schema_atlas` view describes every table and `v_job_health` every
scheduled job. A document is dated testimony about the system: cite it, then check it against the live views.

## Where each question is answered

| Question | Where |
|---|---|
| How should I work on this task? | [`AGENTS.md`](../AGENTS.md), the rules in [`.claude/rules/`](../.claude/rules/) and [`AGENT_WORKFLOW.md`](AGENT_WORKFLOW.md) |
| What is the data machine meant to do? | [`ledger/theory/data-machine.md`](ledger/theory/data-machine.md) |
| Which problem is open, and what would close it? | [`ledger/theory/data-machine-cases.md`](ledger/theory/data-machine-cases.md) |
| How does an asset class other than vehicles fit? | [`ledger/theory/asset-entity-model.md`](ledger/theory/asset-entity-model.md) |
| What has been measured? | [`POSITIONING.md`](POSITIONING.md). A script writes its evidence block |
| What is in the codebase? | [`architecture/CODEBASE_INVENTORY.md`](architecture/CODEBASE_INVENTORY.md), a coverage map inspected 2026-10-25 |
| What did earlier audits find? | [`ledger/`](ledger/README.md), the inventories from the 2026-07-12 audit, and [`function-drift-20261107.md`](function-drift-20261107.md) |
| Which function does X? | [`TOOLS.md`](../TOOLS.md) |
| How is the market read? | [`features/ask-nuke/THEORY.md`](features/ask-nuke/THEORY.md), the contracts in [`market/`](market/) and [`valuation-backtest-2026-10-22.md`](valuation-backtest-2026-10-22.md) |
| How do I call the API? | [The API reference](api/README.md), with quickstarts for [reading](QUICKSTART.md) (February 2026) and [writing](api/QUICKSTART.md) (May 2026). The write API's brief is [`external-agent-write-api.md`](external-agent-write-api.md). The read quickstart's bulk-export section calls `api-v1-export`, whose source left the repository on 2026-03-31 while the deployed copy still answers |
| How does an agent connect over MCP? | [`ADVISOR.md`](../supabase/functions/mcp-connector/ADVISOR.md) |
| What are the rules for extraction? | [`EXTRACTION_POLICY.md`](EXTRACTION_POLICY.md), [`EXTRACTION_TARGETS.md`](EXTRACTION_TARGETS.md) and [`ACCURATE_EXTRACTION.md`](ACCURATE_EXTRACTION.md) |
| How do photos land and get filed? | [`photo-sorting-pipeline.md`](photo-sorting-pipeline.md) and [`photo-landing-v3.md`](photo-landing-v3.md) |
| How do receipts reach the work record and the books? | [`receipt-work-contract.md`](receipt-work-contract.md), [`receipts-product-enrichment.md`](receipts-product-enrichment.md), [`books-docket.md`](books-docket.md) and [`accounting-shared-access.md`](accounting-shared-access.md) |
| How does an audit finding become a change? | [`agent-finding-to-main.md`](agent-finding-to-main.md) |
| How does the iOS capture app work? | [`apps/nuke-capture-ios/README.md`](../apps/nuke-capture-ios/README.md) |
| How does the image classifier work? | [`yono/README.md`](../yono/README.md) and [`ledger/theory/ai-vision-yono.md`](ledger/theory/ai-vision-yono.md) |
| What are the interface rules? | [`library/technical/design-book/`](library/technical/design-book/README.md) |
| The K5 wiring build | [`wiring/`](wiring/README.md) |
| The library: dictionary, encyclopedia, engineering manual | [`library/`](library/README.md) |

## Single documents at this level

Each is dated by its last change. A file stays at this level when what it describes still exists, when it is
founder-curated direction, or when code or another document cites it by path. Where a limit is known, the last column
gives it.

| Document | Last changed | What it is |
|---|---|---|
| [`VISION.md`](VISION.md) | 2026-10 | The founder's long-range direction. It says where the system is going, not what exists |
| [`MESH.md`](MESH.md), [`LAUNCH_DAY_ONE.md`](LAUNCH_DAY_ONE.md) | 2026-06 | Founder-curated doctrine for the query layer and for launch |
| [`NUKE_ENCYCLOPEDIA.md`](NUKE_ENCYCLOPEDIA.md) | 2026-03 | The long statement of the provenance engine. The theory in `ledger/theory/` is the current form |
| [`DESIGN_BIBLE.md`](DESIGN_BIBLE.md) | 2026-03 | The design philosophy. For implementation the design book in the library supersedes it |
| [`FINDER_ARCHITECTURE.md`](FINDER_ARCHITECTURE.md), [`FINDER_UI_RHIZOME_SPEC.md`](FINDER_UI_RHIZOME_SPEC.md) | 2026-03, 2026-10 | The finder interface: a working spec and a build prompt. The `nuke_frontend/src/finder/` files the spec names are not in the repository |
| [`IMAGE_ANALYSIS_100X_PROMPT.md`](IMAGE_ANALYSIS_100X_PROMPT.md) | 2026-10 | The brief for proving and repairing image analysis |
| [`client-evidence-producers.md`](client-evidence-producers.md) | 2026-11 | Producers of client evidence from mail, timeline and labor. Tested, not run against production |
| [`MONTHLY_REVIEW.md`](MONTHLY_REVIEW.md) | 2026-06 | SQL for reading one month of activity from the database. The three views it uses exist |
| [`ios-connection-audit-2026-06-23.md`](ios-connection-audit-2026-06-23.md) | 2026-07 | An audit of the iOS app's reads against production |
| [`imessage-bridge-architecture.md`](imessage-bridge-architecture.md) | 2026-03 | The design of the iMessage bridge. Its code is `scripts/imessage-bridge.mjs` and `supabase/functions/imessage-router/` |
| [`YONO_TRAINING_DATA.md`](YONO_TRAINING_DATA.md) | 2026-03 | The classifier's training-data plan. Its row counts are from March 2026 |
| [`forensics-metrics.md`](forensics-metrics.md) | 2026-02 | The fields of `auction_events.forensics_data`, a column that exists |
| [`VEHICLE_STATE_MODEL.md`](VEHICLE_STATE_MODEL.md), [`VEHICLE_STATES_AND_BADGES.md`](VEHICLE_STATES_AND_BADGES.md) | 2026-01 | Vehicle states and badge rules. The state names are still used in code |
| [`dead_tables_candidates.txt`](dead_tables_candidates.txt) | 2026-02 | Tables that looked unused in February 2026. A migration and the engineering manual cite it. Verify a table against the live database before acting on this list |

## Folders of dated writing

Keep the date and the limits of anything you cite from these. A plan is not a record of what was built.

| Folder | Holds |
|---|---|
| [`proposals/`](proposals/) | proposals for intake, keys, entities and folds, dated 2026-10-07 to 2026-10-19 |
| [`garage-model/`](garage-model/), [`migrations/`](migrations/) | the garage source inventory, and notes and revert scripts kept beside specific migrations (November 2026) |
| [`architecture/`](architecture/), [`features/`](features/) | architecture and per-feature notes from October 2025 to October 2026 |
| [`design/`](design/), [`schematics/`](schematics/), [`wireframes/`](wireframes/), [`components/`](components/), [`design-review/`](design-review/) | design constraints, page schematics, wireframes, and the April 2026 interface reviews with their two summaries |
| [`plans/`](plans/), [`strategy/`](strategy/), [`products/`](products/), [`product/`](product/), [`marketing/`](marketing/) | plans, strategy reports and product briefs |
| [`research/`](research/) | research on outside platforms and data sources |
| [`content/`](content/), [`publishing/`](publishing/) | essays, post drafts and the publishing module's status reports |
| [`agents/`](agents/), [`playbooks/`](playbooks/), [`guides/`](guides/), [`development/`](development/), [`handoffs/`](handoffs/) | runbooks, how-to guides and session reports |
| [`audits/`](audits/), [`search/`](search/), [`data/`](data/), [`testing/`](testing/), [`post-mortems/`](post-mortems/), [`schema-discovery/`](schema-discovery/), [`timeline/`](timeline/), [`reference-system/`](reference-system/), [`mesh/`](mesh/) | dated audits, QA reports, one outage post-mortem and working notes |
| [`archive/`](archive/README.md) | writing about retired features and finished sessions. Nothing in it describes the live system |

Twenty files left this level on 2026-11-13 for `archive/`, `plans/`, `strategy/`, `research/` and `design-review/`.
[`archive/README.md`](archive/README.md) lists them with the reason for each, and `git log --follow` finds any of them.
