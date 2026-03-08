import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

const BUCKET = "listing-snapshots";

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!,
  );
}

function buildPath(platform: string, fetchedAt: string, id: string, ext: string): string {
  const d = new Date(fetchedAt);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${platform}/${yyyy}/${mm}/${dd}/${id}.${ext}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = getSupabase();
  const startTime = Date.now();

  const body = await req.json().catch(() => ({}));
  const maxBatches = body.max_batches ?? 10;
  const batchSize = body.batch_size ?? 10;
  const dryRun = body.dry_run ?? false;

  let totalMigrated = 0;
  let totalBytes = 0;
  const errors: string[] = [];

  for (let batch = 0; batch < maxBatches; batch++) {
    // Use RPC to bypass PostgREST schema cache
    const { data: rows, error: fetchErr } = await supabase.rpc("get_snapshots_to_migrate", {
      batch_limit: batchSize,
    });

    if (fetchErr) {
      errors.push(`Fetch: ${fetchErr.message}`);
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      try {
        const platform = row.platform || "unknown";
        const fetchedAt = row.fetched_at || new Date().toISOString();
        const htmlPath = buildPath(platform, fetchedAt, row.id, "html");
        const htmlBytes = new TextEncoder().encode(row.html);
        let bytes = htmlBytes.length;

        if (!dryRun) {
          const { error: uploadErr } = await supabase.storage
            .from(BUCKET)
            .upload(htmlPath, htmlBytes, { contentType: "text/html", upsert: true });
          if (uploadErr) {
            errors.push(`Upload ${row.id}: ${uploadErr.message}`);
            continue;
          }
        }

        let mdPath: string | null = null;
        if (row.markdown) {
          mdPath = buildPath(platform, fetchedAt, row.id, "md");
          const mdBytes = new TextEncoder().encode(row.markdown);
          bytes += mdBytes.length;
          if (!dryRun) {
            await supabase.storage
              .from(BUCKET)
              .upload(mdPath, mdBytes, { contentType: "text/markdown", upsert: true });
          }
        }

        if (!dryRun) {
          const { error: updateErr } = await supabase.rpc("mark_snapshot_migrated", {
            snapshot_id: row.id,
            p_html_path: htmlPath,
            p_md_path: mdPath,
          });
          if (updateErr) {
            errors.push(`Mark ${row.id}: ${updateErr.message}`);
            continue;
          }
        }

        totalMigrated++;
        totalBytes += bytes;
      } catch (e) {
        errors.push(`Row ${row.id}: ${e.message}`);
      }
    }

    if (batch < maxBatches - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const elapsed = Date.now() - startTime;

  let remaining: number | string = "unknown";
  const { data: countData } = await supabase.rpc("count_snapshots_remaining");
  if (countData !== null) remaining = countData;

  return new Response(JSON.stringify({
    migrated: totalMigrated,
    bytes_moved: totalBytes,
    bytes_moved_pretty: `${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
    remaining,
    elapsed_ms: elapsed,
    errors: errors.slice(0, 20),
    dry_run: dryRun,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
