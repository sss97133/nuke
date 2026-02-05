import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Get a connection and run raw SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      query: `
        ALTER TABLE marketplace_listings
        ADD COLUMN IF NOT EXISTS contact_info JSONB,
        ADD COLUMN IF NOT EXISTS seller_profile_url TEXT,
        ADD COLUMN IF NOT EXISTS comments JSONB;

        CREATE INDEX IF NOT EXISTS idx_marketplace_contact_info
        ON marketplace_listings USING GIN (contact_info)
        WHERE contact_info IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_marketplace_comments
        ON marketplace_listings USING GIN (comments)
        WHERE comments IS NOT NULL;
      `
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Columns added: contact_info, seller_profile_url, comments"
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
