import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ReviewResult {
  approved: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
  auto_approve: boolean;
}

/**
 * AI Agent Guardrails for Auction Listings
 * Reviews listings before they go live to ensure quality and prevent issues
 */
async function reviewAuctionListing(
  listingId: string,
  supabase: any
): Promise<ReviewResult> {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let confidence = 100;
  let autoApprove = true;

  // Get listing with vehicle details
  const { data: listing, error: listingError } = await supabase
    .from("vehicle_listings")
    .select(
      `
      *,
      vehicle:vehicles(*)
    `
    )
    .eq("id", listingId)
    .single();

  if (listingError || !listing) {
    return {
      approved: false,
      confidence: 0,
      issues: ["Listing not found"],
      suggestions: [],
      auto_approve: false,
    };
  }

  const vehicle = listing.vehicle;

  // =====================================================
  // GUARDRAIL 1: Required Vehicle Data
  // =====================================================
  if (!vehicle?.make || !vehicle?.model) {
    issues.push("Missing required vehicle information (make/model)");
    confidence -= 30;
    autoApprove = false;
  }

  if (!vehicle?.year || vehicle.year < 1900 || vehicle.year > new Date().getFullYear() + 1) {
    issues.push("Invalid or missing vehicle year");
    confidence -= 20;
    autoApprove = false;
  }

  // =====================================================
  // GUARDRAIL 2: Pricing Validation
  // =====================================================
  if (listing.sale_type === "auction" || listing.sale_type === "live_auction") {
    if (listing.reserve_price_cents) {
      // Check if reserve is reasonable (not too high or too low)
      const reserveDollars = listing.reserve_price_cents / 100;

      // If vehicle has current_value, check if reserve is within 50-200% of value
      if (vehicle?.current_value) {
        const valueDollars = vehicle.current_value;
        const reservePercent = (reserveDollars / valueDollars) * 100;

        if (reservePercent < 50) {
          suggestions.push(
            `Reserve price ($${reserveDollars.toFixed(2)}) is very low compared to estimated value ($${valueDollars.toFixed(2)})`
          );
        } else if (reservePercent > 200) {
          issues.push(
            `Reserve price ($${reserveDollars.toFixed(2)}) is very high compared to estimated value ($${valueDollars.toFixed(2)})`
          );
          confidence -= 15;
        }
      }

      // Check for suspiciously low reserves (potential fraud indicator)
      if (reserveDollars < 100 && vehicle?.year && vehicle.year > 2000) {
        issues.push("Reserve price seems suspiciously low");
        confidence -= 25;
        autoApprove = false;
      }
    }

    // Validate auction duration
    if (listing.auction_duration_minutes) {
      if (listing.auction_duration_minutes < 5) {
        issues.push("Auction duration is too short (minimum 5 minutes)");
        confidence -= 20;
        autoApprove = false;
      } else if (listing.auction_duration_minutes > 30 * 24 * 60) {
        // 30 days max
        issues.push("Auction duration is too long (maximum 30 days)");
        confidence -= 10;
      }

      // For live auctions, suggest shorter durations
      if (
        listing.sale_type === "live_auction" &&
        listing.auction_duration_minutes > 60
      ) {
        suggestions.push(
          "Live auctions typically work best with 5-30 minute durations"
        );
      }
    }
  }

  // =====================================================
  // GUARDRAIL 3: Description Quality
  // =====================================================
  if (!listing.description || listing.description.trim().length < 20) {
    issues.push("Description is too short (minimum 20 characters)");
    confidence -= 15;
    autoApprove = false;
  } else if (listing.description.length < 50) {
    suggestions.push("Consider adding more detail to your description");
  }

  // Check for suspicious patterns in description
  const suspiciousPatterns = [
    /urgent|asap|quick sale|must sell/i,
    /wire transfer only|western union|money gram/i,
    /contact.*@.*\.(ru|cn|tk)/i, // Suspicious email domains
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(listing.description)) {
      issues.push("Description contains suspicious content");
      confidence -= 30;
      autoApprove = false;
      break;
    }
  }

  // =====================================================
  // GUARDRAIL 4: Image Requirements
  // =====================================================
  const { data: images, error: imagesError } = await supabase
    .from("vehicle_images")
    .select("id")
    .eq("vehicle_id", listing.vehicle_id)
    .limit(1);

  if (!images || images.length === 0) {
    issues.push("No images found for this vehicle");
    confidence -= 25;
    autoApprove = false;
  } else if (images.length < 3) {
    suggestions.push("Consider adding more images (at least 3 recommended)");
  }

  // =====================================================
  // GUARDRAIL 5: Seller History
  // =====================================================
  const { data: sellerListings, error: sellerError } = await supabase
    .from("vehicle_listings")
    .select("id, status")
    .eq("seller_id", listing.seller_id);

  if (sellerListings) {
    const activeListings = sellerListings.filter(
      (l: any) => l.status === "active" && l.id !== listingId
    ).length;

    // Check for potential dealer/spam (too many active listings)
    if (activeListings > 50) {
      issues.push("Too many active listings (potential dealer/spam)");
      confidence -= 20;
      autoApprove = false;
    }

    // Check seller's completed auctions
    const completedAuctions = sellerListings.filter(
      (l: any) => l.status === "sold"
    ).length;

    if (completedAuctions === 0 && activeListings > 5) {
      suggestions.push(
        "New seller with multiple listings - consider verifying account"
      );
    }
  }

  // =====================================================
  // GUARDRAIL 6: VIN Validation (if available)
  // =====================================================
  if (vehicle?.vin) {
    // Basic VIN format check (17 characters, alphanumeric)
    if (vehicle.vin.length !== 17) {
      issues.push("Invalid VIN format (must be 17 characters)");
      confidence -= 10;
    }

    // Check for duplicate VINs in active listings
    const { data: duplicateListings } = await supabase
      .from("vehicle_listings")
      .select("id")
      .eq("status", "active")
      .neq("id", listingId)
      .eq("vehicle_id", listing.vehicle_id);

    if (duplicateListings && duplicateListings.length > 0) {
      issues.push("Vehicle already has an active listing");
      confidence -= 50;
      autoApprove = false;
    }
  }

  // =====================================================
  // FINAL DECISION
  // =====================================================
  const approved = confidence >= 70 && issues.length === 0;

  return {
    approved,
    confidence: Math.max(0, Math.min(100, confidence)),
    issues,
    suggestions,
    auto_approve: autoApprove && approved,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { listing_id } = await req.json();

    if (!listing_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing listing_id",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Use service role for full access
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Perform review
    const reviewResult = await reviewAuctionListing(
      listing_id,
      supabaseAdmin
    );

    // Update listing with review results
    await supabaseAdmin
      .from("vehicle_listings")
      .update({
        ai_review_status: reviewResult.auto_approve
          ? "approved"
          : reviewResult.approved
          ? "approved"
          : "needs_review",
        ai_review_notes: JSON.stringify({
          issues: reviewResult.issues,
          suggestions: reviewResult.suggestions,
          confidence: reviewResult.confidence,
        }),
        ai_reviewed_at: new Date().toISOString(),
      })
      .eq("id", listing_id);

    return new Response(
      JSON.stringify({
        success: true,
        review: reviewResult,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Review error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

