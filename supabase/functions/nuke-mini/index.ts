// Minimal bot test
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("OK");
  let data;
  try {
    data = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  console.log(data);
  return new Response("OK");
});
