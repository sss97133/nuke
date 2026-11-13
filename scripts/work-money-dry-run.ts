#!/usr/bin/env -S deno run --allow-read
/** Offline only: no env, network, database, cursor, Gmail labels or writes. */
import {
  classify,
  type Email,
  type Job,
  matchJobs,
  VERSION,
} from "../supabase/functions/gmail-books-poller/core.ts";
if (Deno.args.length !== 1 || Deno.args[0].startsWith("--")) {
  console.error(
    "Usage: deno run --allow-read scripts/work-money-dry-run.ts <samples.json>",
  );
  Deno.exit(2);
}
const input: { emails: Email[]; jobs: Job[]; accountantSenders: string[] } =
  JSON.parse(await Deno.readTextFile(Deno.args[0]));
console.log(
  JSON.stringify(
    {
      dryRun: true,
      version: VERSION,
      results: input.emails.map((email) => {
        const signal = classify(email, {
          accountantSenders: input.accountantSenders,
        });
        return {
          messageId: email.id,
          signal,
          proposals: signal ? matchJobs(email, signal, input.jobs) : [],
        };
      }),
    },
    null,
    2,
  ),
);
