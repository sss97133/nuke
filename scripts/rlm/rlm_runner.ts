import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { spawn } from 'child_process';

export interface RlmConfig {
  projectRoot?: string;
  includePaths: string[];
  excludeGlobs?: string[];
  allowedExtensions?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalChars?: number;
  chunkSizeChars?: number;
  chunkOverlapChars?: number;
  maxDepth?: number;
  maxCalls?: number;
  timeoutMs?: number;
  claudeCommand?: string;
  outputFormat?: 'json' | 'text';
  goal?: string;
}

export interface ContextBuildResult {
  context: string;
  files: string[];
  truncated: boolean;
  totalChars: number;
}

export interface CallLogEntry {
  callIndex: number;
  stage: string;
  promptChars: number;
  contextChars: number;
  responseChars: number;
  timestamp: string;
}

const DEFAULT_MAX_FILE_BYTES = 200_000;
const DEFAULT_MAX_TOTAL_CHARS = 2_000_000;
const DEFAULT_CHUNK_SIZE = 12_000;
const DEFAULT_CHUNK_OVERLAP = 800;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_CALLS = 12;
const DEFAULT_TIMEOUT_MS = 900_000;

export async function buildContext(
  config: RlmConfig,
  projectRoot: string
): Promise<ContextBuildResult> {
  const exclude = config.excludeGlobs ?? [];
  const allowedExt = config.allowedExtensions ?? ['.md', '.txt'];
  const maxFiles = config.maxFiles ?? 200;
  const maxFileBytes = config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalChars = config.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;

  const files = new Set<string>();
  for (const pattern of config.includePaths) {
    const matched = await glob(pattern, {
      cwd: projectRoot,
      ignore: exclude,
      nodir: true,
      absolute: true
    });
    for (const filePath of matched) {
      files.add(filePath);
    }
  }

  const sortedFiles = Array.from(files)
    .filter((filePath) => allowedExt.includes(path.extname(filePath)))
    .slice(0, maxFiles);

  let context = '';
  let truncated = false;

  for (const filePath of sortedFiles) {
    const stats = await fs.stat(filePath);
    if (stats.size > maxFileBytes) {
      continue;
    }

    const relPath = path.relative(projectRoot, filePath);
    const content = await fs.readFile(filePath, 'utf8');
    if (content.includes('\u0000')) {
      continue;
    }

    const header = `\n\n--- FILE: ${relPath} ---\n`;
    const nextChunk = `${header}${content}`;

    if (context.length + nextChunk.length > maxTotalChars) {
      truncated = true;
      break;
    }

    context += nextChunk;
  }

  return {
    context,
    files: sortedFiles.map((p) => path.relative(projectRoot, p)),
    truncated,
    totalChars: context.length
  };
}

export class RlmRunner {
  private config: RlmConfig;
  private context: string;
  private callCount = 0;
  private onCall?: (entry: CallLogEntry) => Promise<void> | void;

  constructor(config: RlmConfig, context: string, onCall?: (entry: CallLogEntry) => Promise<void> | void) {
    this.config = config;
    this.context = context;
    this.onCall = onCall;
  }

  peek(offset: number, length: number): string {
    return this.context.slice(offset, offset + length);
  }

  search(pattern: string | RegExp, maxMatches = 20): Array<{ index: number; match: string; snippet: string }> {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'gi') : pattern;
    const results: Array<{ index: number; match: string; snippet: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(this.context)) !== null && results.length < maxMatches) {
      const index = match.index;
      const snippetStart = Math.max(0, index - 120);
      const snippetEnd = Math.min(this.context.length, index + 120);
      results.push({
        index,
        match: match[0],
        snippet: this.context.slice(snippetStart, snippetEnd)
      });
    }

    return results;
  }

  chunk(): string[] {
    const chunkSize = this.config.chunkSizeChars ?? DEFAULT_CHUNK_SIZE;
    const overlap = this.config.chunkOverlapChars ?? DEFAULT_CHUNK_OVERLAP;
    const chunks: string[] = [];
    let start = 0;

    while (start < this.context.length) {
      const end = Math.min(this.context.length, start + chunkSize);
      chunks.push(this.context.slice(start, end));
      if (end >= this.context.length) break;
      start = Math.max(0, end - overlap);
    }

    return chunks;
  }

  async summarize(goal: string): Promise<string> {
    const maxDepth = this.config.maxDepth ?? DEFAULT_MAX_DEPTH;
    return this.summarizeRecursive(goal, this.context, maxDepth);
  }

  private async summarizeRecursive(goal: string, context: string, depth: number): Promise<string> {
    const chunkSize = this.config.chunkSizeChars ?? DEFAULT_CHUNK_SIZE;
    const chunks = this.splitContext(context, chunkSize, this.config.chunkOverlapChars ?? DEFAULT_CHUNK_OVERLAP);

    if (chunks.length === 1 || depth <= 1) {
      return this.llmQuery(this.buildChunkPrompt(goal, chunks[0], 1, 1), chunks[0], 'final');
    }

    const summaries: string[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const prompt = this.buildChunkPrompt(goal, chunks[i], i + 1, chunks.length);
      const summary = await this.llmQuery(prompt, chunks[i], `chunk_${i + 1}`);
      summaries.push(summary.trim());
    }

    const merged = summaries.join('\n\n');
    if (merged.length <= chunkSize || depth <= 1) {
      return this.llmQuery(this.buildMergePrompt(goal, merged), merged, 'merge');
    }

    return this.summarizeRecursive(goal, merged, depth - 1);
  }

  private splitContext(context: string, size: number, overlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < context.length) {
      const end = Math.min(context.length, start + size);
      chunks.push(context.slice(start, end));
      if (end >= context.length) break;
      start = Math.max(0, end - overlap);
    }
    return chunks;
  }

  private buildChunkPrompt(goal: string, chunk: string, index: number, total: number): string {
    return [
      'You are summarizing part of a long-context corpus for an RLM wrapper.',
      `Goal: ${goal}`,
      `Chunk ${index} of ${total}.`,
      'Extract concrete tasks, blockers, decisions, and testing steps. Keep file references when present.',
      'Return concise bullet points only.',
      'Context chunk:',
      chunk
    ].join('\n\n');
  }

  private buildMergePrompt(goal: string, merged: string): string {
    return [
      'You are merging partial RLM summaries into a final context.',
      `Goal: ${goal}`,
      'Deduplicate, prioritize the most actionable items, and keep file references.',
      'Return concise bullet points only.',
      'Summaries:',
      merged
    ].join('\n\n');
  }

  private async llmQuery(prompt: string, context: string, stage: string): Promise<string> {
    const maxCalls = this.config.maxCalls ?? DEFAULT_MAX_CALLS;
    if (this.callCount >= maxCalls) {
      throw new Error(`RLM call budget exceeded (${maxCalls}).`);
    }

    const claudeCmd = this.config.claudeCommand ?? 'claude';
    const args = ['--output-format', this.config.outputFormat ?? 'json', '-p', prompt];
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const output = await this.runCommand(claudeCmd, args, timeoutMs);
    const parsed = this.parseClaudeOutput(output);

    this.callCount += 1;
    const entry: CallLogEntry = {
      callIndex: this.callCount,
      stage,
      promptChars: prompt.length,
      contextChars: context.length,
      responseChars: parsed.length,
      timestamp: new Date().toISOString()
    };

    if (this.onCall) {
      await this.onCall(entry);
    }

    return parsed;
  }

  private runCommand(cmd: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeoutMs);

      proc.stdout.on('data', (data) => chunks.push(data));
      proc.stderr.on('data', (data) => errChunks.push(data));

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(chunks).toString('utf8').trim();
        const stderr = Buffer.concat(errChunks).toString('utf8').trim();

        if (timedOut) {
          reject(new Error(`Claude CLI timed out after ${timeoutMs}ms.`));
          return;
        }

        if (code && code !== 0) {
          reject(new Error(`Claude CLI failed (exit ${code}): ${stderr || stdout}`));
          return;
        }

        resolve(stdout || stderr);
      });
    });
  }

  private parseClaudeOutput(output: string): string {
    try {
      const json = JSON.parse(output);
      const contentArray = json?.content;
      if (Array.isArray(contentArray)) {
        const text = contentArray.map((item: any) => item?.text ?? '').join('');
        if (text.trim()) return text.trim();
      }
      const messageContent = json?.message?.content;
      if (Array.isArray(messageContent)) {
        const text = messageContent.map((item: any) => item?.text ?? '').join('');
        if (text.trim()) return text.trim();
      }
      if (typeof json?.output_text === 'string') return json.output_text.trim();
      if (typeof json?.completion === 'string') return json.completion.trim();
    } catch {
      // fall through to raw output
    }
    return output.trim();
  }
}
