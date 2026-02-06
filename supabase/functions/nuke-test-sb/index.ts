// Test with jsr import
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(() => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  return new Response("SB OK");
});
