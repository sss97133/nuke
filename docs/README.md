# Documentation

Start with [`AGENTS.md`](../AGENTS.md) at the repository root. It routes each question to the document that owns it:

| Question | Where |
|---|---|
| How should I work on this task? | [`AGENTS.md`](../AGENTS.md) and the rules in `.claude/rules/` |
| What is the data machine meant to do? | [`ledger/theory/data-machine.md`](ledger/theory/data-machine.md) |
| Which problem is open, and what would close it? | [`ledger/theory/data-machine-cases.md`](ledger/theory/data-machine-cases.md) |
| What exists and operates now? | The live `v_schema_atlas` and `v_job_health` views, not any file here |
| What was found in earlier audits? | [`ledger/`](ledger/README.md): dated inventories from the 2026-07-12 audit |
| How is the market read? | [`features/ask-nuke/THEORY.md`](features/ask-nuke/THEORY.md) and [`market/`](market/) |
| Which function does X? | [`TOOLS.md`](../TOOLS.md) |
| The K5 wiring build | [`wiring/`](wiring/) |
| The library: dictionary, encyclopedia, engineering manual | [`library/`](library/README.md) |

Everything else in this tree is dated writing: [`plans/`](plans/), [`strategy/`](strategy/), [`research/`](research/), [`design/`](design/), [`publishing/`](publishing/). Keep the date and the limits of anything you cite from it; a plan is not a record of what was built.
