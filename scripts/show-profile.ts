import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function main() {
  // Get a vehicle that has images (was backfilled)
  const { data: vehicleWithImages } = await supabase
    .from("vehicle_images")
    .select("vehicle_id")
    .ilike("image_url", "%media.carsandbids%")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!vehicleWithImages) { console.log("No vehicles with images"); return; }

  const { data: v } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", vehicleWithImages.vehicle_id)
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

  console.log("");
  console.log("  Sample URLs:");
  images?.slice(0,3).forEach((img: any, i: number) => {
    console.log("    " + (i+1) + ". [" + (img.category || "other") + "] " + img.image_url?.substring(0,55) + "...");
  });

  // Get comments
  const { data: comments } = await supabase
    .from("vehicle_comments")
    .select("username, content, is_seller, posted_at")
    .eq("vehicle_id", v.id)
    .order("posted_at", { ascending: true });

  console.log("");
  console.log("COMMENTS (" + (comments?.length || 0) + " total)");
  comments?.slice(0, 4).forEach((c: any, i: number) => {
    const tag = c.is_seller ? " [SELLER]" : "";
    const time = new Date(c.posted_at).toLocaleString();
    console.log("  " + (i+1) + ". " + c.username + tag + " - " + time);
    console.log("     \"" + (c.content?.substring(0, 75) || "") + (c.content?.length > 75 ? "..." : "") + "\"");
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
