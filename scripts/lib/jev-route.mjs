/**
 * Jev recommends a runner only after the caller attests the complete work order is public.
 * That attestation is a caller responsibility, not algorithmic proof of sanitization.
 * Code checks qualification; uncertain or ineligible recommendations need review.
 * These fixed choices are not a live account catalog or suitability assay.
 * JEV_ROUTE_MAX_TIER limits Claude tiers; it does not rank Codex against Claude.
 * JEV_ROUTE_MIN_CONFIDENCE defaults to 0.6. Hold paths never launch a fallback.
 */
import { createHash } from 'node:crypto';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const TIERS = ['haiku', 'sonnet', 'opus', 'fable'];
const CHOICES = [...TIERS, 'codex'];
const MODEL_ARG = { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus', fable: 'claude-fable-5-1' };
// Bound the complete serialized work order, never remove trailing instructions.
export const MAX_TASK_BYTES = 64 * 1024;

const QUESTIONS = {
  tier: {
    type: 'choice',
    instructions:
      'First judge suitability and quality for the entire task: structural role, requirements, persona, ' +
      'completion instructions and acceptance criteria. Select an option qualified to complete this work ' +
      'correctly. Only among qualified options compare total cost, including expected retries and verification. ' +
      'Judge the actual work, not role seniority, task importance or description length. ' +
      'These are configured choices, not evidence of account availability or measured suitability.',
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
        'Research-grade problems or long-horizon autonomous builds requiring the strongest reasoning. ' +
        'Judge whether this task actually requires these capabilities.',
      codex:
        'A bounded, self-contained coding task that needs no private data, database access or secrets, ' +
        'including its persona and completion obligations.',
    },
  },
  private_data: {
    type: 'noul',
    instructions:
      'Does any part of the complete task, including persona and completion instructions, require reading or ' +
      'writing private data: contact details, invoices, amounts, customer or vehicle-owner records, ' +
      'credentials or secrets, or the production database?',
  },
  high_stakes: {
    type: 'noul',
    instructions:
      'Does any part of the complete task change shared production state, move money, send messages to others, ' +
      'or delete data, so that a wrong answer is expensive to undo?',
  },
};

const isScore = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const workOrder = ({
  title = '', description = '', role = null,
  requirements = {}, completionInstructions = '', persona = '',
  publicWorkOrder = false,
} = {}) => ({ title, description, role, requirements, completionInstructions, persona, publicWorkOrder });

// Launcher checks the same complete work order immediately before claiming it.
export function hashWorkOrder(input = {}) {
  return createHash('sha256').update(JSON.stringify(workOrder(input))).digest('hex');
}

export async function routeTask(input = {}) {
  const { fallback = 'sonnet' } = input;
  const task = workOrder(input);
  const { title, description, role, requirements, completionInstructions, persona } = task;
  let serializedTask;
  try {
    serializedTask = JSON.stringify(task);
  } catch {
    return {
      status: 'needs_review', model: null, runner: null, modelArg: null,
      suggestedModel: CHOICES.includes(fallback) ? fallback : null, recommendedModel: null,
      confidence: null, source: 'policy', reason: 'work order is not JSON serializable',
      taskHash: null, decidedAt: new Date().toISOString(),
    };
  }
  const receipt = {
    taskHash: createHash('sha256').update(serializedTask).digest('hex'),
    decidedAt: new Date().toISOString(),
    suggestedModel: CHOICES.includes(fallback) ? fallback : null,
  };
  const hold = (reason, source = 'policy', confidence = null, recommendedModel = null) => ({
    ...receipt, status: 'needs_review', model: null, runner: null, modelArg: null,
    confidence, source, reason, recommendedModel,
  });

  if (task.publicWorkOrder !== true) {
    return hold('public work order attestation required before external routing');
  }

  if (Buffer.byteLength(serializedTask, 'utf8') > MAX_TASK_BYTES) {
    return hold(`complete work order exceeds ${MAX_TASK_BYTES} bytes`);
  }
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements) ||
      typeof title !== 'string' || typeof description !== 'string' ||
      typeof completionInstructions !== 'string' || typeof persona !== 'string' ||
      (role !== null && typeof role !== 'string')) {
    return hold('invalid work order fields');
  }
  // Use the hashed snapshot for both transport and policy, including across awaits.
  const routedTask = JSON.parse(serializedTask);

  const max = process.env.JEV_ROUTE_MAX_TIER ?? 'fable';
  if (!TIERS.includes(max)) return hold('invalid JEV_ROUTE_MAX_TIER');
  const rawMin = process.env.JEV_ROUTE_MIN_CONFIDENCE;
  const minConf = rawMin === undefined ? 0.6 : Number(rawMin);
  if ((rawMin !== undefined && rawMin.trim() === '') || !isScore(minConf)) {
    return hold('invalid JEV_ROUTE_MIN_CONFIDENCE');
  }
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return hold('TYPESAFE_API_KEY not set', 'fallback');

  let body;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state: { task: routedTask }, questions: QUESTIONS }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return hold(`TypeSafe HTTP ${res.status}`, 'fallback');
    body = await res.json();
  } catch (err) {
    return hold(`TypeSafe error: ${err?.message ?? 'request failed'}`, 'fallback');
  }

  const answers = body?.answers;
  const pick = answers?.tier?.choice;
  if (!CHOICES.includes(pick)) return hold('missing or invalid tier answer', 'jev');
  const confidence = answers.tier.confidence;
  if (!isScore(confidence)) return hold('missing or invalid confidence', 'jev', null, pick);
  // Unknown safety answers remain conservative, as in the original restriction.
  const priv = answers.private_data?.noul ?? 1;
  const stakes = answers.high_stakes?.noul ?? 1;
  if (!isScore(priv) || !isScore(stakes)) return hold('invalid safety answer', 'jev', confidence, pick);
  if (confidence < minConf) {
    return hold(`low confidence ${confidence.toFixed(2)} below ${minConf}`, 'jev', confidence, pick);
  }
  if (pick === 'codex' && priv >= 0.3) {
    return hold('codex blocked: possible private data', 'jev', confidence, pick);
  }
  // A declared database obligation cannot be overruled by Jev's classification.
  const databaseAccess = routedTask.requirements.databaseAccess;
  if (pick === 'codex' && databaseAccess !== undefined && databaseAccess !== null &&
      databaseAccess !== false && databaseAccess !== 'none') {
    return hold('codex blocked: declared database access', 'jev', confidence, pick);
  }
  if (pick === 'haiku' && stakes >= 0.5) {
    return hold('high stakes: haiku needs review', 'jev', confidence, pick);
  }
  if (TIERS.includes(pick) && TIERS.indexOf(pick) > TIERS.indexOf(max)) {
    return hold(`selected model exceeds ceiling ${max}`, 'jev', confidence, pick);
  }
  return {
    ...receipt, status: 'ready', model: pick, modelArg: MODEL_ARG[pick] ?? null,
    runner: pick === 'codex' ? 'codex' : 'claude', confidence,
    source: 'jev', reason: 'validated Jev recommendation', recommendedModel: pick,
  };
}
