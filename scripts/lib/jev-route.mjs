/**
 * jev-route — pick the cheapest model that can do a job, using TypeSafe's Jev.
 *
 * Jev judges the task (a Choice for the tier, Noul flags for safety). Code owns
 * the policy: escalation on low confidence, a tier ceiling, and the rule that
 * private data never goes to a non-Anthropic runner.
 *
 *   routeTask({ title, description, fallback }) -> { model, runner, confidence, source, reason }
 *
 * Needs TYPESAFE_API_KEY (run under `dotenvx run --`). Any failure falls back to
 * `fallback` (the caller's static map), so spawning never blocks on the router.
 * Env: JEV_ROUTE_MAX_TIER=haiku|sonnet|opus|fable caps the result (default: fable, the top tier).
 *      JEV_ROUTE_MIN_CONFIDENCE (default 0.6): below it the tier goes up one.
 */

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const TIERS = ['haiku', 'sonnet', 'opus', 'fable'];
// What `claude --model` gets for each tier (aliases where they exist, full id for fable).
const MODEL_ARG = { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus', fable: 'claude-fable-5-1' };

const QUESTIONS = {
  tier: {
    type: 'choice',
    instructions:
      'Which is the cheapest runner that can complete the task in `task` correctly on the first attempt? ' +
      'Judge the work itself, not how important the task sounds.',
    criteria: {
      haiku:
        'Mechanical, well-specified work: run a script, scrape or classify rows, rename, format, summarize a file, ' +
        'fill a template. The steps are obvious and a mistake is cheap to spot.',
      sonnet:
        'Ordinary engineering: implement a feature or fix in known code, write a migration or edge function, ' +
        'investigate a bug, multi-file edits, data reconciliation with clear rules.',
      opus:
        'Hard judgment: architecture or schema design, ambiguous requirements, subtle debugging across systems, ' +
        'money or legal reasoning, planning a multi-step change to shared production state.',
      fable:
        'Frontier-hard work: research-grade problems, long-horizon autonomous builds, tasks where a strong ' +
        'model is likely to fail without the very best reasoning. Use sparingly; most hard work is opus.',
      codex:
        'A bounded, self-contained coding task (one script, one function, one test suite) that needs no private ' +
        'data, no database access and no secrets.',
    },
  },
  private_data: {
    type: 'noul',
    instructions:
      'Does the task in `task` require reading or writing private data: people contact details, invoices, ' +
      'amounts, customer or vehicle-owner records, credentials or secrets, or the production database?',
  },
  high_stakes: {
    type: 'noul',
    instructions:
      'Does the task in `task` change shared production state, move money, send messages to other people, ' +
      'or delete data, so that a wrong answer is expensive to undo?',
  },
};

const clampTier = (tier, max) =>
  TIERS.indexOf(tier) > TIERS.indexOf(max) ? max : tier;
const up = (tier) => TIERS[Math.min(TIERS.indexOf(tier) + 1, TIERS.length - 1)];

export async function routeTask({ title, description = '', fallback = 'sonnet' } = {}) {
  const max = TIERS.includes(process.env.JEV_ROUTE_MAX_TIER) ? process.env.JEV_ROUTE_MAX_TIER : 'fable';
  const minConf = Number(process.env.JEV_ROUTE_MIN_CONFIDENCE || 0.6);
  const fall = (reason) => ({
    model: clampTier(fallback, max), runner: 'claude', confidence: null, source: 'fallback', modelArg: MODEL_ARG[clampTier(fallback, max)], reason,
  });

  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return fall('TYPESAFE_API_KEY not set');

  let body;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { task: { title, description: String(description).slice(0, 4000) } },
        questions: QUESTIONS,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return fall(`TypeSafe HTTP ${res.status}`);
    body = await res.json();
  } catch (err) {
    return fall(`TypeSafe error: ${err.message}`);
  }

  const a = body.answers || {};
  if (!a.tier?.choice) return fall('no tier answer');

  let pick = a.tier.choice;
  const confidence = a.tier.confidence ?? 0;
  const notes = [];
  const priv = a.private_data?.noul ?? 1; // unknown counts as private
  const stakes = a.high_stakes?.noul ?? 1;

  if (pick === 'codex' && priv >= 0.3) { pick = 'sonnet'; notes.push('codex blocked: possible private data'); }
  if (pick === 'codex') return { model: 'codex', runner: 'codex', confidence, source: 'jev', reason: 'bounded coding task' };

  if (confidence < minConf) { pick = up(pick); notes.push(`low confidence ${confidence.toFixed(2)}: up one tier`); }
  if (stakes >= 0.5 && pick === 'haiku') { pick = 'sonnet'; notes.push('high stakes: not haiku'); }
  const capped = clampTier(pick, max);
  if (capped !== pick) notes.push(`capped at ${max}`);

  return { model: capped, modelArg: MODEL_ARG[capped], runner: 'claude', confidence, source: 'jev', reason: notes.join('; ') || 'jev tier' };
}
