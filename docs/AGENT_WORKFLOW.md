# Agent workspace

Use the [Nuke work skill](../skills/nuke-work/SKILL.md) to scope, continue, review,
ship or hand off substantial work. It preserves the owner's original intent and
later corrections while keeping each implementation step bounded. Ordinary edits
do not need a new plan, task registry, agent team or full inventory.

For unfamiliar code, start with the [codebase inventory](architecture/CODEBASE_INVENTORY.md)
and follow its owning paths. Runtime state still comes from the affected reader and
current atlas/job-health rows, not the inventory.

## Install once on a shared workstation

From a reviewed checkout, preview the paths, then install:

```sh
node skills/nuke-work/scripts/install.mjs --repo /path/to/nuke
node skills/nuke-work/scripts/install.mjs --repo /path/to/nuke --install
```

The installer copies one portable skill into the user's Codex and Claude skill
directories, adds explicit Codex model profiles and refreshes the local Claude
commands in the selected checkout. Existing files are backed up under the user's
private `nuke-logs/agent-workspace/` directory. It does not change the base config,
credentials, permission controls, subscription, defaults or services. Re-running
with the same inputs is a no-op. `--home` permits installation into a disposable
directory for validation; the selected repository must be under that directory.

## Invocation

| Intent | Codex CLI / IDE | Claude Code |
|---|---|---|
| Turn rough intent into the next useful repair | `$nuke-work scope …` | `/scope …` or `/nuke-work scope …` |
| Pick up without repeating investigation | `$nuke-work continue …` | `/continue …` |
| Inspect a prepared change | `$nuke-work review …` | `/review …` |
| Finish an authorized release | `$nuke-work ship …` | `/ship …` |
| Preserve decisions for another session | `$nuke-work handoff …` | `/handoff …` |
| See progress and the next action | `$nuke-work status …` | `/status …` |

In ChatGPT desktop, select the installed skill with `@`; in Codex CLI use `/skills`
or `$`. A custom Claude slash command does not automatically become a Codex slash
command. Skill changes are normally discovered automatically; restart the relevant
client if it has not refreshed. Command discovery and execution in another person's
account require installation there; local setup does not establish that account's
model access or shared-book access.

Existing `/deploy`, audit, sync, QA, health and debugging names remain available
through focused adapters. Their instructions use current `AGENTS.md` and the current
design rules. Specialized extraction, library and deck commands retain their jobs
without obsolete raw writes, forced agents or implicit paid fallbacks. The vision
review command keeps its specialized procedure and existing authorization boundary.

## Explicit model choices

```sh
codex --profile nuke-luna -C /path/to/worktree
codex --profile nuke-sol -C /path/to/worktree
codex --profile nuke-astra -C /path/to/worktree
```

The profiles select Luna/low, GPT-6.1 Sol/medium and Astra/medium respectively, and
inherit the base configuration's connections and permission controls. They do not
route jobs automatically. Choose an available model in the active client's picker
when working in the app. Preserve Astra for understanding the gist and hard decisions;
use Sol for scoped engineering, Luna for suitable small jobs, and deterministic tools
for routine checks. No second agent is needed merely to run a command.

These are starting preferences, not a benchmark or a promise about plan usage. Track
actual task outcomes and usage before changing defaults or raising reasoning effort.
A session running under a subscription still consumes its allowance; do not silently
fall back to a separately billed API.

The installed CLI's `--profile` flag uses separate `<name>.config.toml` files.
Official references checked 2026-10-24: [profiles](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles),
[skill discovery](https://learn.chatgpt.com/docs/build-skills),
[model selection](https://developers.openai.com/api/docs/guides/model-selection),
and [Claude skills and commands](https://code.claude.com/docs/en/skills).
