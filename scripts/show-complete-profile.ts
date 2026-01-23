import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function main() {
  // Find vehicles with both images and comments from C&B
  const { data: vWithComments } = await supabase
    .from("vehicle_comments")
    .select("vehicle_id")
    .limit(100);

  if (!vWithComments || vWithComments.length === 0) {
    console.log("No comments found");
    return;
  }

  const vehicleIds = vWithComments.map(v => v.vehicle_id);

  // Find one that also has C&B images
  const { data: imgMatch } = await supabase
    .from("vehicle_images")
    .select("vehicle_id")
    .ilike("image_url", "%media.carsandbids%")
    .in("vehicle_id", vehicleIds)
    .limit(1)
    .single();

  if (!imgMatch) {
    console.log("No match found");
    return;
  }

  const vehicleId = imgMatch.vehicle_id;

  // Get vehicle
  const { data: v } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .single();

  if (!v) { console.log("Vehicle not found"); return; }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  PERFECTED C&B VEHICLE PROFILE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("BASIC INFO");
  console.log("  Vehicle:", v.year, v.make, v.model);
  console.log("  VIN:", v.vin);
  console.log("  URL:", v.listing_url);
  console.log("");
  console.log("AUCTION RESULTS");
  console.log("  Status:", v.auction_outcome || v.sale_status || "N/A");
  console.log("  Sold Price:", v.sold_price ? "$" + v.sold_price.toLocaleString() : "N/A");
  console.log("  High Bid:", v.high_bid ? "$" + v.high_bid.toLocaleString() : "N/A");
  console.log("  Bid Count:", v.bid_count || "N/A");
  console.log("  View Count:", v.view_count || "N/A");
  console.log("");
  console.log("DETAILS");
  console.log("  Location:", v.location || v.listing_location || "N/A");
  console.log("  Seller:", v.bat_seller || "N/A");
  console.log("  Mileage:", v.mileage ? v.mileage.toLocaleString() + " mi" : "N/A");
  console.log("  Transmission:", v.transmission || "N/A");
  console.log("  Color:", v.color || v.color_primary || "N/A");

  // Get images
  const { data: images } = await supabase
    .from("vehicle_images")
    .select("image_url, category")
    .eq("vehicle_id", v.id);

  console.log("");
  console.log("IMAGES (" + (images?.length || 0) + " total)");
  const byCategory: Record<string, number> = {};
  images?.forEach((img: any) => {
    byCategory[img.category || "uncategorized"] = (byCategory[img.category || "uncategorized"] || 0) + 1;
  });
  Object.entries(byCategory).sort((a,b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log("  " + cat + ":", count);
  });

  // Get comments
  const { data: comments } = await supabase
    .from("vehicle_comments")
    .select("username, content, is_seller, posted_at")
    .eq("vehicle_id", v.id)
    .order("posted_at", { ascending: true });

  console.log("");
  console.log("COMMENTS (" + (comments?.length || 0) + " total)");
  comments?.slice(0, 5).forEach((c: any, i: number) => {
    const tag = c.is_seller ? " [SELLER]" : "";
    const time = new Date(c.posted_at).toLocaleString();
    console.log("  " + (i+1) + ". " + c.username + tag + " - " + time);
    console.log("     \"" + (c.content?.substring(0, 70) || "") + (c.content?.length > 70 ? "..." : "") + "\"");
  });

  // Get content sections
  const { data: sections } = await supabase
    .from("vehicle_content_sections")
    .select("section_type, content")
    .eq("vehicle_id", v.id);

  console.log("");
  console.log("CONTENT SECTIONS (" + (sections?.length || 0) + ")");
  sections?.forEach((s: any) => {
    const preview = typeof s.content === "string"
      ? s.content.substring(0, 50)
      : (Array.isArray(s.content) ? s.content.length + " items" : JSON.stringify(s.content).substring(0, 50));
    console.log("  - " + s.section_type + ": " + preview + "...");
  });

  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
}

main();
