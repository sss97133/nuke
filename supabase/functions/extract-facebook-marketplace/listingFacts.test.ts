import assert from "node:assert/strict";
import { galleryPhotos, listedDaysAgo, sellerFacts, titleIdentity, vehicleFacts, withListingFacts } from "./listingFacts.ts";

// The shape of a retained listing page (fb_sweep_jobs playwright_rendered_listing_page), names and places replaced.
const page = [
  "1971 Plymouth road runner restomod", "$59,000", "Listed a day ago in Example City, XX", "Message",
  "About this vehicle", "Driven 89,703 miles", "Automatic transmission",
  "Exterior color: Yellow · Interior color: Black", "Fuel type: Gasoline", "Very good condition", "Clean title", "",
  "This vehicle has no significant damage or problems.", "", "Seller's description", "Hemi road runner RestoMod",
  "Example City, XX · Location is approximate", "Seller information", "Seller details", "Example Seller", "(5)",
  "Highly rated on Marketplace", "Joined Facebook in 2010", "Ad", "A Store", "Today's picks", "$17,000", "1972 Chevy k20",
].join("\n");

Deno.test("title identity reads Facebook's form suffixes off before the shared parser", () => {
  assert.deepEqual(titleIdentity("1976 Chevrolet corvette Coupe 2D"),
    { year: 1976, make: "Chevrolet", model: "corvette", body_style: "Coupe", doors: 2 });
  const truck = titleIdentity("1986 Toyota tacoma regular cab Pickup 2D 6 ft");
  assert.equal(truck.model, "tacoma regular cab");
  assert.equal(truck.body_style, "Pickup");
  assert.equal(titleIdentity("1976 Chevrolet 1500 regular cab Long Bed").bed, "long");
  assert.equal(titleIdentity("1971 Plymouth road runner restomod").make, "Plymouth");
  // A title with no model stays unresolved; it is not filled from anything else.
  assert.equal(titleIdentity("1984 Porsche").model, null);
  assert.equal(titleIdentity("Shop truck, runs").year, null);
});

Deno.test("about-this-vehicle lines become facts; absent lines stay absent", () => {
  const f = vehicleFacts(page);
  assert.equal(f.mileage, 89703);
  assert.equal(f.transmission, "Automatic");
  assert.equal(f.exterior_color, "Yellow");
  assert.equal(f.interior_color, "Black");
  assert.equal(f.fuel_type, "Gasoline");
  assert.equal(f.title_status, "clean");
  assert.equal(f.condition, "very good");
  assert.equal(f.damage_statement, "This vehicle has no significant damage or problems.");
  assert.equal(f.owners, undefined);
  assert.ok(!f.lines.some((l) => /Hemi/.test(l)), "the block stops at the seller's description");
  assert.deepEqual(vehicleFacts("Exterior color: Red · Interior color:").lines, [], "no heading, no facts");
  const blank = vehicleFacts("About this vehicle\nExterior color: Red · Interior color:\n2+ owners\nSeller's description");
  assert.equal(blank.interior_color, undefined);
  assert.deepEqual(blank.owners, { count: 2, at_least: true });
});

Deno.test("seller block counts and badges; the name is not a fact here", () => {
  assert.deepEqual(sellerFacts(page), { rating_count: 5, badges: ["Highly rated on Marketplace"], joined_year: 2010 });
  assert.deepEqual(sellerFacts("no seller block"), { badges: [] });
});

Deno.test("listed label is a whole-day lower bound", () => {
  assert.equal(listedDaysAgo("Listed a day ago in Example City, XX"), 1);
  assert.equal(listedDaysAgo("Listed 3 weeks ago in Example City, XX"), 21);
  assert.equal(listedDaysAgo("Listed 5 hours ago in Example City, XX"), 0);
  assert.equal(listedDaysAgo("Listed over a week ago in Example City, XX"), 7);
  assert.equal(listedDaysAgo("Just listed"), null);
});

Deno.test("gallery keeps the listing's photos and drops picks tiles, avatars and ads", () => {
  const own = "https://scontent.example.fbcdn.net/v/t45.5328-4/1_n.jpg?stp=dst-jpg_p720x720_tt6&oh=a";
  const own2 = "https://scontent.example.fbcdn.net/v/t39.30808-6/2_n.jpg?stp=dst-jpg_s960x960_tt6&oh=b";
  const pick = "https://scontent.example.fbcdn.net/v/t39.84726-6/3_n.jpg?stp=c0.79.720.720a_dst-jpg_s526x526_tt6&oh=c";
  const avatar = "https://scontent.example.fbcdn.net/v/t39.30808-1/4_n.jpg?stp=dst-jpg_s40x40&oh=d";
  const ad = "https://scontent.example.fbcdn.net/v/t45.1600-4/5_n.jpg?oh=e";
  assert.deepEqual(galleryPhotos([own, pick, own2, avatar, ad], [[960, 720], [526, 526], [960, 640], [40, 40], [1080, 1080]]), [own, own2]);
  assert.deepEqual(galleryPhotos([own], undefined), [own], "unknown size is not a reason to drop");
});

Deno.test("withListingFacts fills only absent fields and records what it read", () => {
  const own = "https://scontent.example.fbcdn.net/v/t45.5328-4/1_n.jpg?stp=dst-jpg_p720x720_tt6";
  const pick = "https://scontent.example.fbcdn.net/v/t39.84726-6/3_n.jpg?stp=c0.79.720.720a_dst-jpg_s526x526";
  const detail = withListingFacts({
    facebook_id: "1", title: "1971 Plymouth road runner restomod", mileage: 90000,
    content_text: JSON.stringify({ displayed_text: page, listed_label: "Listed a day ago in Example City, XX" }),
    all_images: [own, pick], image_url: own, agent_context: { session_type: "browser_listing_page", image_sizes: [[960, 720], [526, 526]] },
  });
  assert.equal(detail.parsed_make, "Plymouth");
  assert.equal(detail.parsed_model, "road runner restomod");
  assert.equal(detail.mileage, 90000, "a value the caller sent wins");
  assert.equal(detail.transmission, "Automatic");
  assert.deepEqual(detail.all_images, [own]);
  assert.equal(detail.listing_facts.photos_seen, 2);
  assert.equal(detail.listing_facts.listed_days_ago, 1);
  assert.equal(detail.listing_facts.seller?.rating_count, 5);

  const card = withListingFacts({
    facebook_id: "2", title: "1973 Volkswagen super beetle", parsed_year: 1973,
    content_text: JSON.stringify({ displayed_text: "Just listed\n$2,200\n1973 Volkswagen super beetle\nExample City, XX",
      rendered_images: [{ url: pick, alt: "1973 Volkswagen super beetle in Example City, XX" }] }),
    agent_context: { session_type: "browser_search_card" },
  });
  assert.equal(card.parsed_make, "Volkswagen");
  assert.equal(card.image_url, pick, "a search card's own thumbnail is its image");
  assert.equal(card.listing_facts.vehicle, undefined);
  assert.equal(card.mileage, undefined);
});
