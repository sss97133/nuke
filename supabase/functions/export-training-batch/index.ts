import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/cors.ts";

const BATCH_SIZE = 1000; // Supabase max is 1000 per request
const MAX_SUPABASE_ROWS = 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const {
      type = "image_vehicle", // image_vehicle | image_text | comment_context
      cursor = null,          // UUID for pagination
      limit = BATCH_SIZE,
      format = "jsonl"        // jsonl | json
    } = body;

    let query;
    let records: any[] = [];

    switch (type) {
      case "image_vehicle":
        // Image + vehicle metadata pairs
        // Using left join to get all images, with vehicle data when available
        query = supabase
          .from("vehicle_images")
          .select(`
            id,
            image_url,
            category,
            labels,
            angle,
            area,
            part,
            components,
            vehicle_id,
            vehicle:vehicles!vehicle_images_vehicle_id_fkey(
              year,
              make,
              model,
              vin
            )
          `)
          .not("image_url", "is", null)
          .order("id", { ascending: true })
          .limit(limit);

        if (cursor) {
          query = query.gt("id", cursor);
        }

        const { data: imageData, error: imageError } = await query;
        if (imageError) throw imageError;

        records = (imageData || []).map((r: any) => ({
          id: r.id,
          image_url: r.image_url,
          category: r.category,
          labels: r.labels,
          angle: r.angle,
          area: r.area,
          part: r.part,
          components: r.components,
          year: r.vehicle?.year,
          make: r.vehicle?.make,
          model: r.vehicle?.model,
          vin: r.vehicle?.vin,
          vehicle: r.vehicle
            ? `${r.vehicle.year || ''} ${r.vehicle.make || ''} ${r.vehicle.model || ''}`.trim()
            : null
        }));
        break;

      case "image_text":
        // Images with captions or text context
        query = supabase
          .from("vehicle_images")
          .select(`
            id,
            image_url,
            caption,
            category,
            labels,
            vehicle:vehicles!vehicle_images_vehicle_id_fkey(
              year,
              make,
              model
            )
          `)
          .not("caption", "is", null)
          .order("id", { ascending: true })
          .limit(limit);

        if (cursor) {
          query = query.gt("id", cursor);
        }

        const { data: textData, error: textError } = await query;
        if (textError) throw textError;

        records = (textData || []).map((r: any) => ({
          id: r.id,
          image_url: r.image_url,
          caption: r.caption,
          category: r.category,
          labels: r.labels,
          vehicle: r.vehicle ? `${r.vehicle.year || ''} ${r.vehicle.make || ''} ${r.vehicle.model || ''}`.trim() : null
        }));
        break;

      case "comment_context":
        // Auction comments with vehicle context
        query = supabase
          .from("auction_comments")
          .select(`
            id,
            comment_text,
            author_username,
            author_type,
            posted_at,
            comment_likes,
            has_question,
            vehicle:vehicles!auction_comments_vehicle_id_fkey(
              year,
              make,
              model,
              vin
            )
          `)
          .order("id", { ascending: true })
          .limit(limit);

        if (cursor) {
          query = query.gt("id", cursor);
        }

        const { data: commentData, error: commentError } = await query;
        if (commentError) throw commentError;

        records = (commentData || []).map((r: any) => ({
          id: r.id,
          text: r.comment_text,
          author: r.author_username,
          author_type: r.author_type,
          posted_at: r.posted_at,
          likes: r.comment_likes,
          is_question: r.has_question,
          year: r.vehicle?.year,
          make: r.vehicle?.make,
          model: r.vehicle?.model,
          vin: r.vehicle?.vin,
          vehicle: r.vehicle ? `${r.vehicle.year || ''} ${r.vehicle.make || ''} ${r.vehicle.model || ''}`.trim() : null
        }));
        break;

      case "stats":
        // Return approximate counts without full scan
        const { data: statsData } = await supabase.rpc("pg_stat_user_tables_approx");

        // Fallback: use pg_class estimates
        const { data: pgStats, error: pgError } = await supabase
          .from("pg_stat_user_tables")
          .select("relname, n_live_tup")
          .in("relname", ["vehicle_images", "auction_comments", "vehicles", "vehicle_observations"]);

        return new Response(
          JSON.stringify({
            type: "stats",
            note: "Approximate row counts from pg_stat",
            tables: pgStats || [],
            message: pgError ? "Using estimate" : "Live stats"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

      default:
        return new Response(
          JSON.stringify({ error: `Unknown type: ${type}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const nextCursor = records.length > 0 ? records[records.length - 1].id : null;
    // Cap limit to Supabase max, and hasMore is true if we hit the cap
    const effectiveLimit = Math.min(limit, MAX_SUPABASE_ROWS);
    const hasMore = records.length >= effectiveLimit;

    if (format === "jsonl") {
      // JSONL format - one JSON object per line
      const jsonl = records.map(r => JSON.stringify(r)).join("\n");
      return new Response(jsonl, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/x-ndjson",
          "X-Next-Cursor": nextCursor || "",
          "X-Has-More": String(hasMore),
          "X-Record-Count": String(records.length)
        }
      });
    } else {
      // JSON format with metadata
      return new Response(
        JSON.stringify({
          type,
          records,
          pagination: {
            cursor: nextCursor,
            hasMore,
            count: records.length,
            limit
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    console.error("Export error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
