# Bot Testing Framework

Automated QA bots that simulate real user behavior to find bugs and UX issues - similar to Facebook's internal testing infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Bot Test System                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Casual    │  │  Impatient  │  │  Confused   │   ... more   │
│  │   Casey     │  │    Ian      │  │    Carl     │   personas   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         └────────────────┼────────────────┘                      │
│                          │                                       │
│                    ┌─────▼─────┐                                 │
│                    │ BotRunner │ ◄── Base class                  │
│                    └─────┬─────┘                                 │
│                          │                                       │
│         ┌────────────────┼────────────────┐                      │
│         │                │                │                      │
│    ┌────▼────┐    ┌──────▼──────┐   ┌─────▼─────┐               │
│    │Findings │    │ Test Runs   │   │   Admin   │               │
│    │  Table  │    │   Table     │   │Notifications│              │
│    └────┬────┘    └─────────────┘   └─────┬─────┘               │
│         │                                  │                     │
│         │    Auto-escalate critical ──────┘                     │
│         │                                                        │
│    ┌────▼────────────────────────────┐                          │
│    │      Admin Dashboard            │                          │
│    │   /admin/bot-testing            │                          │
│    └─────────────────────────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Bot Personas

| Persona | Slug | Behavior | What it Tests |
|---------|------|----------|---------------|
| **Casual Casey** | `casual_browser` | Browses, uses filters, doesn't log in | Public pages, search, navigation |
| **Impatient Ian** | `impatient_ian` | Rapid clicks, doesn't wait, rage-clicks | Debouncing, loading states, race conditions |
| **Confused Carl** | `confused_carl` | Clicks wrong things, gets lost | Error messages, dead ends, help text |
| **Bidding Bob** | `active_bidder` | Places bids, watches auctions | Auction flows, auth, real-time updates |
| **Power User Pat** | `power_user_pat` | Keyboard shortcuts, bulk ops | Advanced features, keyboard nav |
| **Mobile Mary** | `mobile_mary` | Touch gestures, slow connection | Responsive design, touch targets |

## Quick Start

### Prerequisites

```bash
# Install dependencies
npm install playwright @playwright/test

# Set environment variables
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export BOT_BASE_URL="https://n-zero.dev"  # or localhost for local testing
```

### Run All Bots

```bash
npx tsx tests/bots/run-bots.ts
```

### Run Specific Persona

```bash
npx tsx tests/bots/run-bots.ts --persona casual_browser
npx tsx tests/bots/run-bots.ts --persona impatient_ian
npx tsx tests/bots/run-bots.ts --persona confused_carl
```

### Run with Browser Visible (for debugging)

```bash
npx tsx tests/bots/run-bots.ts --headless false
```

### Run Against Local Dev Server

```bash
npx tsx tests/bots/run-bots.ts --url http://localhost:3000
```

## Viewing Results

### Admin Dashboard

Navigate to `/admin/bot-testing` to see:
- All findings with severity and status
- Test run history
- Stats overview
- Ability to triage and update finding status

### Real-time Notifications

Critical and high-severity findings automatically appear in the Admin Notification Center.

## Database Schema

### `bot_personas`
Stores persona definitions (patience level, behavior profile, goals)

### `bot_test_runs`
Records each bot execution with stats and logs

### `bot_findings`
Individual issues found by bots with reproduction steps and evidence

### `bot_test_scenarios`
Predefined user journeys for specific testing

## Creating a New Bot Persona

1. Add to database:
```sql
INSERT INTO bot_personas (slug, name, description, behavior_profile, goals, patience_level, tech_savviness)
VALUES (
  'my_new_persona',
  'My New Bot',
  'Description of what this bot does',
  '{"custom_behavior": true}',
  ARRAY['goal1', 'goal2'],
  5, 5
);
```

2. Create bot class:
```typescript
// tests/bots/personas/MyNewBot.ts
import { BotRunner } from '../BotRunner';
import type { BotPersona } from '../types';

export class MyNewBot extends BotRunner {
  constructor(persona: BotPersona) {
    super(persona);
  }

  async execute(): Promise<void> {
    await this.start();
    
    // Your bot logic here
    await this.navigate('/some-page');
    await this.click('button.submit');
    
    // Report issues
    await this.reportFinding('bug', 'high', 'Title', 'Description');
    
    await this.complete();
  }
}
```

3. Register in orchestrator:
```typescript
// run-bots.ts
import { MyNewBot } from './personas/MyNewBot';

const BOT_CLASSES = {
  // ... existing
  'my_new_persona': MyNewBot,
};
```

## Finding Types

- `bug` - Something is broken
- `ux_friction` - Hard to use but works
- `performance` - Slow loading or response
- `broken_link` - 404 or navigation failure
- `missing_element` - Expected UI element not found
- `console_error` - JavaScript errors in console
- `network_error` - API failures
- `accessibility` - A11y issues
- `visual_regression` - UI looks wrong
- `unexpected_behavior` - Works but not as expected

## Severity Levels

- **Critical** - App is broken, data loss risk
- **High** - Major feature broken
- **Medium** - Feature partially broken
- **Low** - Minor issue, workaround exists
- **Info** - Observation, may not be a bug

## CI/CD Integration

Add to your GitHub Actions:

```yaml
name: Bot Tests
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  bot-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install chromium
      - run: npx tsx tests/bots/run-bots.ts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          BOT_BASE_URL: https://n-zero.dev
```

## The Debug Team Concept

For the parallel "debug team" AI agents:

1. **Monitor Agent** - Watches `bot_findings` table for new entries
2. **Triage Agent** - Categorizes and prioritizes findings
3. **Investigator Agent** - Reads code, identifies root cause
4. **Fixer Agent** - Creates PR with fix for simple issues

This creates a closed loop:
```
Bot finds bug → Debug agent investigates → Fix deployed → Bot verifies fix
```

## AI Debug Team

The debug team is a set of AI agents that work together to investigate and fix issues found by the bots.

### The Team

| Agent | Role | Responsibilities |
|-------|------|------------------|
| **Sentinel** 👁️ | Monitor | Watches for new findings, triggers pipeline, checks SLA |
| **Sherlock** 🔍 | Triage | Analyzes severity, detects duplicates, categorizes |
| **Watson** 🔬 | Investigator | Deep-dives code, finds root cause, suggests fixes |
| **Patch** 🔧 | Fixer | Generates code fixes, creates PRs |

### Pipeline Flow

```
New Finding → Sentinel (monitor) → Sherlock (triage) → Watson (investigate) → Patch (fix)
                  ↓                      ↓                    ↓                   ↓
            Admin Alert            Duplicate?           Root Cause          Create PR
              (critical)           Close/Merge          Analysis            or Escalate
```

### Running the Debug Team

```bash
# Run all agents once (process all pending findings)
npx tsx tests/bots/agents/run-debug-team.ts

# Watch mode - run continuously every minute
npx tsx tests/bots/agents/run-debug-team.ts --watch

# Run specific agent
npx tsx tests/bots/agents/run-debug-team.ts --agent watson
```

### Environment Variables

```bash
# Required
SUPABASE_URL="your-url"
SUPABASE_SERVICE_ROLE_KEY="your-key"
ANTHROPIC_API_KEY="your-anthropic-key"

# Optional
PATCH_AUTO_PR=true          # Enable automatic PR creation
PATCH_AUTO_MERGE=false      # Require human approval (recommended)
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `debug_agents` | Agent definitions (Sentinel, Sherlock, Watson, Patch) |
| `debug_agent_sessions` | Each time an agent runs |
| `debug_investigations` | Deep analysis of findings |
| `debug_fix_attempts` | Generated fixes and PR info |
| `debug_agent_messages` | Communication between agents |

### Agent Communication

Agents communicate via the `debug_agent_messages` table:

- **handoff**: Pass work to next agent
- **question**: Ask for clarification
- **answer**: Respond to question
- **escalation**: SLA breach or priority change
- **status_update**: Progress notification

### Auto-Escalation

- Critical/high findings auto-create admin notifications
- SLA breaches trigger escalation alerts
- Complex fixes (moderate+) require human review

### Viewing Results

Visit `/admin/bot-testing` and click the "Debug Team" tab to see:
- Agent status cards
- Recent sessions with stats
- Investigations with root cause analysis
- Fix attempts with PR links

### Full Automation Loop

For fully automated QA:

```bash
# Terminal 1: Run bots continuously
npx tsx tests/bots/run-bots.ts --headless true &

# Terminal 2: Run debug team continuously  
npx tsx tests/bots/agents/run-debug-team.ts --watch &
```

This creates the closed loop:
```
Bot finds bug → Debug team investigates → Fix created → Bot verifies fix
```
