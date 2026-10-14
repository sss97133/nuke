// The AI policy of batch-extract-snapshots: when the model may be called, and what a row is called when it is not.
//
// The function parses a snapshot with a regex parser per platform. When that returns no field on content over 500
// characters it falls back to claude-haiku (parseWithAI), and for a platform with no regex parser, or mode "ai", the
// model is the parser. That spend is what kept the Barrett-Jackson and Bonhams jobs paused.
//
// `no_ai: true` in the request body closes every one of those doors. The model is never called, a row the regex could not
// read is counted as regex-empty, and in queue mode it ends with queue status 'regex_empty' instead of 'completed', so the
// demand for the fallback is countable in the database (select status, count(*) from snapshot_extraction_queue ...) and the
// rows stay out of the claim loop and can be found again if the owner approves the spend.
//
// Without `no_ai` the behavior is what it was: the same calls, in the same cases, with the same log line.
//
// All three call sites go through this gate; aiGate.test.ts also checks that index.ts has no other call to parseWithAI.

export type AiParse = (content: string, url: string, platform: string) => Promise<Record<string, unknown>>;

/** Whether the request turns the AI off. Fails closed: only an explicit false-like value leaves the AI on. */
export function readNoAi(body: unknown): boolean {
  const v = (body as { no_ai?: unknown } | null | undefined)?.no_ai;
  if (v === undefined || v === null || v === false || v === 0 || v === '' || v === 'false' || v === '0') return false;
  return true;
}

/** Count of fields with a value, the test the fallback has always used. */
export function filledFieldCount(parsed: Record<string, unknown>): number {
  return Object.keys(parsed).filter((k) => parsed[k] != null).length;
}

export interface AiGateCounters {
  /** Rows whose non-AI parse found no field. Counted whether or not the AI was then tried. */
  regex_empty: number;
  /** Times the model was actually called. Always 0 with no_ai. */
  ai_calls: number;
  /** Times the model would have been called and was not. Always 0 without no_ai. */
  ai_blocked: number;
}

export interface AiGate {
  readonly noAi: boolean;
  /** The model as the parser (mode "ai", or a platform with no regex parser). Returns {} when the AI is off. */
  primary(content: string, url: string, platform: string): Promise<Record<string, unknown>>;
  /** After a regex parse: if it found no field, try the model, unless the AI is off. Says whether the row was regex-empty. */
  fallback(
    parsed: Record<string, unknown>,
    content: string | null,
    url: string,
    platform: string,
    rowId: string,
  ): Promise<{ parsed: Record<string, unknown>; regexEmpty: boolean }>;
  counters(): AiGateCounters;
}

export function makeAiGate(noAi: boolean, ai: AiParse, log: (line: string) => void = console.log): AiGate {
  let regexEmpty = 0;
  let aiCalls = 0;
  let aiBlocked = 0;
  return {
    noAi,
    async primary(content, url, platform) {
      if (noAi) {
        aiBlocked++;
        return {};
      }
      aiCalls++;
      return await ai(content, url, platform);
    },
    async fallback(parsed, content, url, platform, rowId) {
      if (filledFieldCount(parsed) > 0) return { parsed, regexEmpty: false };
      regexEmpty++;
      if (!content || content.length <= 500) return { parsed, regexEmpty: true };
      if (noAi) {
        aiBlocked++;
        // Not the "[AI-fallback]" line: that string means the model was called, and a stop rule watches for it.
        log(`[no-ai] regex returned 0 fields for ${rowId}; the AI fallback is off`);
        return { parsed, regexEmpty: true };
      }
      log(`[AI-fallback] Regex returned 0 fields for ${rowId}, trying AI...`);
      aiCalls++;
      return { parsed: await ai(content, url, platform), regexEmpty: true };
    },
    counters: () => ({ regex_empty: regexEmpty, ai_calls: aiCalls, ai_blocked: aiBlocked }),
  };
}

/** The queue status of a row that was parsed without error. A regex-empty row under no_ai is not 'completed'. */
export function terminalQueueStatus(noAi: boolean, regexEmpty: boolean): 'completed' | 'regex_empty' {
  return noAi && regexEmpty ? 'regex_empty' : 'completed';
}

/** The platforms that have a regex parser in index.ts. Any other platform is parsed by the model, or not at all. */
export const REGEX_PLATFORMS: ReadonlySet<string> = new Set(['bat', 'bonhams', 'mecum', 'barrett-jackson', 'carsandbids']);

/** Why a request cannot run with no_ai, or null. Checked before any row is claimed. */
export function noAiConflict(noAi: boolean, mode: string, platform: string): string | null {
  if (!noAi) return null;
  if (mode === 'ai') return 'mode "ai" is the model as the parser; it cannot run with no_ai';
  if (!REGEX_PLATFORMS.has(platform)) {
    return `platform "${platform}" has no regex parser, so with no_ai every row would be marked regex_empty and none read`;
  }
  return null;
}
