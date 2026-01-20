/**
 * Minimal Recursive Language Model (RLM) helper for Supabase Edge Functions.
 *
 * This is a lightweight, provider-agnostic recursive summarization utility:
 * - Split long context into overlapping chunks
 * - Summarize each chunk
 * - Merge summaries (optionally recursively)
 *
 * The caller supplies the LLM function; we only manage chunking + call budget.
 */
export type RlmLlmFn = (params: {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  stage: string;
  callIndex: number;
  chunkIndex?: number;
  chunkCount?: number;
}) => Promise<string>;

export type RlmOptions = {
  chunkSizeChars?: number;
  chunkOverlapChars?: number;
  maxDepth?: number;
  maxCalls?: number;
  temperature?: number;
  maxTokens?: number;
};

export type RlmResult = {
  summary: string;
  calls_used: number;
  truncated: boolean;
};

const DEFAULT_CHUNK_SIZE_CHARS = 12_000;
const DEFAULT_CHUNK_OVERLAP_CHARS = 800;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_CALLS = 10;

function splitContext(context: string, size: number, overlap: number): string[] {
  const chunkSize = Math.max(500, size);
  const ov = Math.max(0, Math.min(overlap, chunkSize - 1));
  const chunks: string[] = [];
  let start = 0;
  while (start < context.length) {
    const end = Math.min(context.length, start + chunkSize);
    chunks.push(context.slice(start, end));
    if (end >= context.length) break;
    start = Math.max(0, end - ov);
  }
  return chunks;
}

function buildChunkPrompt(goal: string, chunk: string, index: number, total: number): string {
  return [
    'You are summarizing part of a long-context corpus for an RLM workflow.',
    `Goal: ${goal}`,
    `Chunk ${index} of ${total}.`,
    'Extract concrete decisions, tasks, blockers, and next steps. Keep key identifiers and numbers.',
    'Return concise bullet points only.',
    'Context chunk:',
    chunk,
  ].join('\n\n');
}

function buildMergePrompt(goal: string, merged: string): string {
  return [
    'You are merging partial RLM summaries into a final context.',
    `Goal: ${goal}`,
    'Deduplicate, prioritize the most actionable items, and keep key identifiers and numbers.',
    'Return concise bullet points only.',
    'Summaries:',
    merged,
  ].join('\n\n');
}

export async function rlmSummarize(params: {
  llm: RlmLlmFn;
  goal: string;
  context: string;
  options?: RlmOptions;
}): Promise<RlmResult> {
  const chunkSizeChars = params.options?.chunkSizeChars ?? DEFAULT_CHUNK_SIZE_CHARS;
  const chunkOverlapChars = params.options?.chunkOverlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS;
  const maxDepth = params.options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxCalls = params.options?.maxCalls ?? DEFAULT_MAX_CALLS;
  const temperature = params.options?.temperature;
  const maxTokens = params.options?.maxTokens;

  let callsUsed = 0;
  let truncated = false;

  const llmCall: RlmLlmFn = async (callParams) => {
    callsUsed += 1;
    if (callsUsed > maxCalls) {
      truncated = true;
      // Stop recursion gracefully; caller can decide if this is acceptable.
      return '';
    }
    return await params.llm({
      ...callParams,
      temperature: callParams.temperature ?? temperature,
      maxTokens: callParams.maxTokens ?? maxTokens,
    });
  };

  async function summarizeRecursive(goal: string, context: string, depth: number): Promise<string> {
    const chunks = splitContext(context, chunkSizeChars, chunkOverlapChars);

    // Base case: one chunk or no depth left.
    if (chunks.length <= 1 || depth <= 1) {
      const prompt = buildChunkPrompt(goal, context, 1, 1);
      return await llmCall({
        prompt,
        stage: 'final',
        callIndex: callsUsed + 1,
        chunkIndex: 1,
        chunkCount: 1,
      });
    }

    // Summarize chunks
    const summaries: string[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const prompt = buildChunkPrompt(goal, chunks[i], i + 1, chunks.length);
      const summary = await llmCall({
        prompt,
        stage: `chunk_${i + 1}`,
        callIndex: callsUsed + 1,
        chunkIndex: i + 1,
        chunkCount: chunks.length,
      });
      if (!summary) break; // call budget exceeded
      summaries.push(summary.trim());
    }

    const merged = summaries.join('\n\n').trim();
    if (!merged) return '';

    if (merged.length <= chunkSizeChars || depth <= 1) {
      const mergePrompt = buildMergePrompt(goal, merged);
      return await llmCall({
        prompt: mergePrompt,
        stage: 'merge',
        callIndex: callsUsed + 1,
      });
    }

    return await summarizeRecursive(goal, merged, depth - 1);
  }

  const summary = (await summarizeRecursive(params.goal, params.context, maxDepth)).trim();
  return { summary, calls_used: callsUsed, truncated };
}

