import {
  buildQuery,
  classify,
  type Config,
  type Email,
  type Job,
  matchJobs,
  VERSION,
} from "./core.ts";
import { type Message, parseMessage } from "./gmail.ts";
export interface PollDeps {
  list(
    query: string,
    page?: string,
  ): Promise<{ messages?: { id: string }[]; nextPageToken?: string }>;
  message(id: string): Promise<Message>;
  jobs(): Promise<Job[]>;
  start(): Promise<string>;
  stage(
    run: string,
    email: Email,
    signal: NonNullable<ReturnType<typeof classify>>,
    proposals: ReturnType<typeof matchJobs>,
    sha: string,
  ): Promise<boolean>;
  finish(
    run: string,
    success: boolean,
    scanned: number,
    staged: number,
    lastMessage: string | null,
    error: string | null,
  ): Promise<void>;
}
export async function poll(
  options: { dryRun: boolean; after: string; before: string; config: Config },
  deps: PollDeps,
) {
  const { dryRun, after, before, config } = options;
  if (
    !Number.isFinite(Date.parse(after)) ||
    !Number.isFinite(Date.parse(before)) ||
    Date.parse(after) >= Date.parse(before) ||
    Date.parse(before) - Date.parse(after) > 31 * 86400000
  ) throw new Error("invalid_window");
  let scanned = 0, staged = 0, lastMessage: string | null = null;
  const run = dryRun ? null : await deps.start();
  try {
    const jobs = await deps.jobs();
    if (jobs.length > 500) throw new Error("job_scope_too_large");
    let page: string | undefined;
    const seen = new Set<string>(), pages = new Set<string>();
    const results: {
      messageId: string;
      signal: ReturnType<typeof classify>;
      proposals: ReturnType<typeof matchJobs>;
    }[] = [];
    do {
      const batch = await deps.list(buildQuery(after, before, config), page);
      for (const { id } of batch.messages ?? []) {
        if (seen.has(id)) continue;
        if (seen.size >= 250) throw new Error("window_overflow_narrow_window");
        seen.add(id);
        const email = parseMessage(await deps.message(id));
        if (email.id !== id) throw new Error("message_identity_mismatch");
        // Gmail epoch queries are second-grained; enforce exact interval locally.
        if (email.receivedAt < after || email.receivedAt >= before) continue;
        scanned++;
        lastMessage = new Date(
          Math.max(
            Date.parse(lastMessage ?? "1970-01-01"),
            Date.parse(email.receivedAt),
          ),
        ).toISOString();
        const signal = classify(email, config);
        const proposals = signal ? matchJobs(email, signal, jobs) : [];
        if (signal && run) {
          const hash = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(email)),
          );
          const sha = [...new Uint8Array(hash)].map((b) =>
            b.toString(16).padStart(2, "0")
          ).join("");
          if (await deps.stage(run, email, signal, proposals, sha)) staged++;
        }
        if (dryRun) results.push({ messageId: id, signal, proposals });
      }
      page = batch.nextPageToken;
      if (page && pages.has(page)) throw new Error("repeated_page_token");
      if (page) pages.add(page);
      if (pages.size > 10) throw new Error("window_overflow_narrow_window");
    } while (page);
    if (run) await deps.finish(run, true, scanned, staged, lastMessage, null);
    return {
      dryRun,
      classifierVersion: VERSION,
      scanned,
      staged,
      after,
      before,
      results,
    };
  } catch (e) {
    // Do not store provider response bodies (tokens/private email may be present).
    if (run) {
      await deps.finish(
        run,
        false,
        scanned,
        staged,
        lastMessage,
        "scan_failed_retry_same_window",
      );
    }
    throw e;
  }
}
