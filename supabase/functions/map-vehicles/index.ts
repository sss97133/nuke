import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// State name to code mapping
const stateToCode: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
  'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC'
};

function normalizeState(input: string | null): string | null {
  if (!input) return null;
  const clean = input.toLowerCase().trim();

  // Already a 2-letter code
  if (clean.length === 2 && /^[a-z]{2}$/.test(clean)) {
    return clean.toUpperCase();
  }

  // Full state name
  if (stateToCode[clean]) {
    return stateToCode[clean];
  }

  return null;
}

function extractStateFromLocation(loc: string | null): string | null {
  if (!loc) return null;

  // Pattern: "City, State ZIP" or "City, State"
  const match = loc.match(/,\s*([A-Za-z\s]+?)\s*(\d{5})?$/);
  if (match && match[1]) {
    return normalizeState(match[1].trim());
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch vehicles with state data
    const { data: withState, error: e1 } = await supabase
      .from("vehicles")
      .select("state, sale_price, sold_price")
      .is("deleted_at", null)
      .not("state", "is", null)
      .limit(50000);

    // Fetch vehicles with listing_location but no state
    const { data: withLocation, error: e2 } = await supabase
      .from("vehicles")
      .select("listing_location, sale_price, sold_price")
      .is("deleted_at", null)
      .is("state", null)
      .not("listing_location", "is", null)
      .limit(100000);

    if (e1) throw e1;
    if (e2) throw e2;

    const vehicles = [
      ...(withState || []).map(v => ({ ...v, listing_location: null })),
      ...(withLocation || []).map(v => ({ ...v, state: null }))
    ];

    // Aggregate by state
    const byState: Record<string, { count: number; value: number }> = {};

    for (const v of vehicles || []) {
      let state = normalizeState(v.state);
      if (!state) {
        state = extractStateFromLocation(v.listing_location);
      }
      if (!state) continue;

      const price = v.sale_price || v.sold_price || 0;
      if (!byState[state]) {
        byState[state] = { count: 0, value: 0 };
      }
      byState[state].count++;
      byState[state].value += price;
    }

    // Convert to array sorted by value
    const states = Object.entries(byState)
      .map(([code, data]) => ({
        code,
        count: data.count,
        value: data.value,
        avg: data.count > 0 ? Math.round(data.value / data.count) : 0
      }))
      .sort((a, b) => b.value - a.value);

    const totalCount = states.reduce((s, st) => s + st.count, 0);
    const totalValue = states.reduce((s, st) => s + st.value, 0);

    return new Response(
      JSON.stringify({
        states,
        stats: { totalCount, totalValue },
        generated_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
