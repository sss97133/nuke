// Content data pipelines for the Patient Zero content engine.
// Each function queries Supabase and returns typed data for content generators.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- Types ---

export interface SaveData {
  savedItem: {
    title: string;
    permalink: string;
    thumbnail_url: string;
    creator_name: string;
  };
  listing: {
    price: number;
    location: string;
    status: string;
    first_seen_at: string;
    removed_at: string | null;
    days_listed: number;
  } | null;
  disappeared: boolean;
  dayNumber: number;
}

export interface RetrospectiveData {
  auctionVehicle: {
    year: number;
    make: string;
    model: string;
    sale_price: number;
    listing_url: string;
    sold_at: string;
  };
  marketplaceListing: {
    price: number;
    location: string;
    url: string;
    status: string;
  };
  priceDelta: number;
  priceDeltaPct: number;
}

export interface MarketObservationData {
  observationType:
    | "disappearance_velocity"
    | "price_trend"
    | "supply_change"
    | "fastest_selling";
  data: Record<string, unknown>;
  headline: string;
}

export interface EnhancedVehicleData {
  year: number;
  make: string;
  model: string;
  sale_price: number | null;
  nuke_estimate: number | null;
  bid_count: number | null;
  comment_count: number | null;
  listing_url: string | null;
  image_url: string;
  vehicle_id: string;
  vehicle_image_id: string;
}

export interface ThreadData {
  topic: string;
  sections: Array<{
    text: string;
    chartConfig?: {
      slug: string;
      data: { labels: string[]; datasets: { label: string; data: number[] }[] };
    };
  }>;
  make: string;
  vehicleCount: number;
  timespan: string;
}

export interface ChartTemplateData {
  template: {
    id: string;
    slug: string;
    title: string;
    chart_type: string;
    caption_prompt: string;
    chart_config_template: Record<string, unknown>;
  };
  rawQuery: string;
}

// --- Helpers ---

function extractFacebookId(permalink: string): string | null {
  const match = permalink.match(/\/marketplace\/item\/(\d+)/);
  return match ? match[1] : null;
}

function daysBetween(from: string, to: string | null): number {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

// --- Query Functions ---

export async function querySaveData(
  supabase: SupabaseClient,
): Promise<SaveData | null> {
  try {
    // Get random marketplace-type saved items (ProductItem with marketplace permalink)
    const { data: items, error } = await supabase
      .from("fb_saved_items")
      .select(
        "fb_item_id, title, permalink, thumbnail_url, creator_name, created_at",
      )
      .eq("item_type", "ProductItem")
      .like("permalink", "%/marketplace/item/%")
      .limit(50);

    if (error || !items || items.length === 0) return null;

    // Pick one at random
    const item = items[Math.floor(Math.random() * items.length)];
    const fbId = extractFacebookId(item.permalink);

    let listing: SaveData["listing"] = null;
    let disappeared = false;

    if (fbId) {
      const { data: ml } = await supabase
        .from("marketplace_listings")
        .select(
          "price, location, status, first_seen_at, removed_at, last_seen_at",
        )
        .eq("facebook_id", fbId)
        .limit(1)
        .maybeSingle();

      if (ml) {
        listing = {
          price: ml.price ?? 0,
          location: ml.location ?? "Unknown",
          status: ml.status ?? "unknown",
          first_seen_at: ml.first_seen_at,
          removed_at: ml.removed_at,
          days_listed: daysBetween(ml.first_seen_at, ml.removed_at),
        };
        disappeared = ml.removed_at !== null;
      }
    }

    // dayNumber = days since item was saved
    const dayNumber = daysBetween(item.created_at, null);

    return {
      savedItem: {
        title: item.title ?? "Untitled",
        permalink: item.permalink,
        thumbnail_url: item.thumbnail_url ?? "",
        creator_name: item.creator_name ?? "Unknown",
      },
      listing,
      disappeared,
      dayNumber,
    };
  } catch (err) {
    console.error("[contentQueries] querySaveData error:", err);
    return null;
  }
}

export async function queryRetrospectiveData(
  supabase: SupabaseClient,
): Promise<RetrospectiveData | null> {
  try {
    // Get auction vehicles that sold with a meaningful price
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select("id, year, make, model, sale_price, listing_url, sold_at")
      .gt("sale_price", 0)
      .not("sold_at", "is", null)
      .not("make", "is", null)
      .not("year", "is", null)
      .limit(200);

    if (error || !vehicles || vehicles.length === 0) return null;

    // Shuffle and try to find a match in marketplace_listings
    const shuffled = vehicles.sort(() => Math.random() - 0.5);

    for (const v of shuffled.slice(0, 30)) {
      const { data: listings } = await supabase
        .from("marketplace_listings")
        .select("price, location, url, status")
        .eq("parsed_year", v.year)
        .ilike("parsed_make", v.make)
        .gt("price", 0)
        .limit(20);

      if (!listings || listings.length === 0) continue;

      // Find one with a large price delta
      for (const ml of listings) {
        const delta = Math.abs(ml.price - v.sale_price);
        if (delta > 2000) {
          const pct = Math.round((delta / v.sale_price) * 100);
          return {
            auctionVehicle: {
              year: v.year,
              make: v.make,
              model: v.model ?? "Unknown",
              sale_price: v.sale_price,
              listing_url: v.listing_url ?? "",
              sold_at: v.sold_at,
            },
            marketplaceListing: {
              price: ml.price,
              location: ml.location ?? "Unknown",
              url: ml.url ?? "",
              status: ml.status ?? "unknown",
            },
            priceDelta: delta,
            priceDeltaPct: pct,
          };
        }
      }
    }

    return null;
  } catch (err) {
    console.error("[contentQueries] queryRetrospectiveData error:", err);
    return null;
  }
}

export async function queryMarketObservationData(
  supabase: SupabaseClient,
): Promise<MarketObservationData | null> {
  const types = [
    "disappearance_velocity",
    "price_trend",
    "supply_change",
    "fastest_selling",
  ] as const;
  const pick = types[Math.floor(Math.random() * types.length)];

  try {
    switch (pick) {
      case "disappearance_velocity":
        return await queryDisappearanceVelocity(supabase);
      case "price_trend":
        return await queryPriceTrend(supabase);
      case "supply_change":
        return await querySupplyChange(supabase);
      case "fastest_selling":
        return await queryFastestSelling(supabase);
    }
  } catch (err) {
    console.error("[contentQueries] queryMarketObservationData error:", err);
    return null;
  }
}

async function queryDisappearanceVelocity(
  supabase: SupabaseClient,
): Promise<MarketObservationData | null> {
  // Count removed listings in last 7 days by location
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("location")
    .not("removed_at", "is", null)
    .gte(
      "removed_at",
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .lt("parsed_year", 2000);

  if (error || !data || data.length === 0) return null;

  // Aggregate by location in JS since supabase-js doesn't support GROUP BY
  const counts: Record<string, number> = {};
  for (const row of data) {
    const loc = row.location || "Unknown";
    counts[loc] = (counts[loc] || 0) + 1;
  }
  const top5 = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (top5.length === 0) return null;

  return {
    observationType: "disappearance_velocity",
    data: {
      locations: top5.map(([loc, count]) => ({ location: loc, count })),
      total: data.length,
      period: "7d",
    },
    headline: `${data.length} pre-2000 vehicles disappeared from Marketplace in the last 7 days. ${top5[0][0]} leads with ${top5[0][1]}.`,
  };
}

async function queryPriceTrend(
  supabase: SupabaseClient,
): Promise<MarketObservationData | null> {
  // Compare avg price this week vs last week by decade tier
  const now = Date.now();
  const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: thisWeek } = await supabase
    .from("marketplace_listings")
    .select("parsed_year, price")
    .gte("first_seen_at", oneWeekAgo)
    .gt("price", 0)
    .lt("parsed_year", 2000)
    .limit(500);

  const { data: lastWeek } = await supabase
    .from("marketplace_listings")
    .select("parsed_year, price")
    .gte("first_seen_at", twoWeeksAgo)
    .lt("first_seen_at", oneWeekAgo)
    .gt("price", 0)
    .lt("parsed_year", 2000)
    .limit(500);

  if (
    !thisWeek || thisWeek.length === 0 || !lastWeek || lastWeek.length === 0
  ) {
    return null;
  }

  function tierAvg(rows: { parsed_year: number; price: number }[]) {
    const tiers: Record<string, number[]> = {};
    for (const r of rows) {
      if (!r.parsed_year || !r.price) continue;
      const tier = r.parsed_year < 1970
        ? "Pre-70"
        : r.parsed_year < 1980
        ? "70s"
        : r.parsed_year < 1990
        ? "80s"
        : "90s";
      (tiers[tier] ??= []).push(r.price);
    }
    const result: Record<string, number> = {};
    for (const [tier, prices] of Object.entries(tiers)) {
      result[tier] = Math.round(
        prices.reduce((a, b) => a + b, 0) / prices.length,
      );
    }
    return result;
  }

  const thisAvg = tierAvg(thisWeek);
  const lastAvg = tierAvg(lastWeek);
  const tiers = [
    ...new Set([...Object.keys(thisAvg), ...Object.keys(lastAvg)]),
  ];
  const trends = tiers.map((tier) => ({
    tier,
    thisWeek: thisAvg[tier] ?? 0,
    lastWeek: lastAvg[tier] ?? 0,
    change: (thisAvg[tier] ?? 0) - (lastAvg[tier] ?? 0),
  }));

  const biggest = trends.reduce((a, b) =>
    Math.abs(b.change) > Math.abs(a.change) ? b : a
  );
  const dir = biggest.change > 0 ? "up" : "down";

  return {
    observationType: "price_trend",
    data: { trends, thisWeekCount: thisWeek.length, lastWeekCount: lastWeek.length },
    headline: `${biggest.tier} vehicles trending ${dir} $${Math.abs(biggest.change).toLocaleString()} avg week-over-week on Marketplace.`,
  };
}

async function querySupplyChange(
  supabase: SupabaseClient,
): Promise<MarketObservationData | null> {
  const oneWeekAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { count: activeCount } = await supabase
    .from("marketplace_listings")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .lt("parsed_year", 2000);

  const { count: removedThisWeek } = await supabase
    .from("marketplace_listings")
    .select("id", { count: "exact", head: true })
    .gte("removed_at", oneWeekAgo)
    .lt("parsed_year", 2000);

  const { count: newThisWeek } = await supabase
    .from("marketplace_listings")
    .select("id", { count: "exact", head: true })
    .gte("first_seen_at", oneWeekAgo)
    .lt("parsed_year", 2000);

  const active = activeCount ?? 0;
  const removed = removedThisWeek ?? 0;
  const added = newThisWeek ?? 0;
  const net = added - removed;
  const direction = net > 0 ? "grew" : net < 0 ? "shrank" : "held steady";

  return {
    observationType: "supply_change",
    data: { active, removedThisWeek: removed, newThisWeek: added, net },
    headline: `Pre-2000 supply ${direction} by ${Math.abs(net)} this week. ${active} active, +${added} new, -${removed} removed.`,
  };
}

async function queryFastestSelling(
  supabase: SupabaseClient,
): Promise<MarketObservationData | null> {
  // Listings that disappeared fastest (shortest time on market)
  const twoWeeksAgo = new Date(
    Date.now() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("marketplace_listings")
    .select(
      "title, parsed_year, parsed_make, parsed_model, price, location, first_seen_at, removed_at",
    )
    .not("removed_at", "is", null)
    .gte("removed_at", twoWeeksAgo)
    .gt("price", 0)
    .lt("parsed_year", 2000)
    .limit(200);

  if (error || !data || data.length === 0) return null;

  const withDuration = data
    .map((r) => ({
      ...r,
      hours: Math.max(
        1,
        (new Date(r.removed_at!).getTime() -
          new Date(r.first_seen_at).getTime()) / (1000 * 60 * 60),
      ),
    }))
    .sort((a, b) => a.hours - b.hours)
    .slice(0, 5);

  const fastest = withDuration[0];
  const hoursStr = fastest.hours < 24
    ? `${Math.round(fastest.hours)}h`
    : `${Math.round(fastest.hours / 24)}d`;

  return {
    observationType: "fastest_selling",
    data: {
      listings: withDuration.map((r) => ({
        title: r.title,
        price: r.price,
        location: r.location,
        hours: Math.round(r.hours),
      })),
    },
    headline: `Fastest flip: ${fastest.parsed_year} ${fastest.parsed_make} ${fastest.parsed_model ?? ""} — gone in ${hoursStr} at $${fastest.price?.toLocaleString()}.`.trim(),
  };
}

export async function queryVehicleData(
  supabase: SupabaseClient,
): Promise<EnhancedVehicleData | null> {
  try {
    // Get vehicles with interesting data + at least one image
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select(
        "id, year, make, model, sale_price, nuke_estimate, bid_count, comment_count, listing_url",
      )
      .not("make", "is", null)
      .not("year", "is", null)
      .or("sale_price.gt.0,nuke_estimate.gt.0")
      .limit(100);

    if (error || !vehicles || vehicles.length === 0) return null;

    // Shuffle and find one with an image
    const shuffled = vehicles.sort(() => Math.random() - 0.5);

    for (const v of shuffled.slice(0, 20)) {
      const { data: images } = await supabase
        .from("vehicle_images")
        .select("id, image_url")
        .eq("vehicle_id", v.id)
        .not("image_url", "is", null)
        .limit(5);

      if (!images || images.length === 0) continue;

      const img = images[Math.floor(Math.random() * images.length)];

      return {
        year: v.year,
        make: v.make,
        model: v.model ?? "Unknown",
        sale_price: v.sale_price,
        nuke_estimate: v.nuke_estimate,
        bid_count: v.bid_count ?? null,
        comment_count: v.comment_count ?? null,
        listing_url: v.listing_url,
        image_url: img.image_url,
        vehicle_id: v.id,
        vehicle_image_id: img.id,
      };
    }

    return null;
  } catch (err) {
    console.error("[contentQueries] queryVehicleData error:", err);
    return null;
  }
}

export async function queryThreadData(
  supabase: SupabaseClient,
): Promise<ThreadData | null> {
  try {
    // Find popular makes in marketplace (pre-2000 vehicles)
    const { data: listings, error } = await supabase
      .from("marketplace_listings")
      .select("parsed_make, parsed_year, price, location, status, removed_at")
      .lt("parsed_year", 2000)
      .not("parsed_make", "is", null)
      .gt("price", 0)
      .limit(2000);

    if (error || !listings || listings.length === 0) return null;

    // Aggregate by make
    const makeStats: Record<
      string,
      {
        count: number;
        prices: number[];
        locations: Record<string, number>;
        removed: number;
      }
    > = {};

    for (const l of listings) {
      const make = l.parsed_make;
      if (!make) continue;
      const s = (makeStats[make] ??= {
        count: 0,
        prices: [],
        locations: {},
        removed: 0,
      });
      s.count++;
      if (l.price) s.prices.push(l.price);
      if (l.location) s.locations[l.location] = (s.locations[l.location] || 0) + 1;
      if (l.removed_at) s.removed++;
    }

    // Pick a make with at least 10 listings
    const eligible = Object.entries(makeStats)
      .filter(([, s]) => s.count >= 10)
      .sort((a, b) => b[1].count - a[1].count);

    if (eligible.length === 0) return null;

    // Pick from top 5 randomly for variety
    const [make, stats] =
      eligible[Math.floor(Math.random() * Math.min(5, eligible.length))];

    const prices = stats.prices.sort((a, b) => a - b);
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const median = prices[Math.floor(prices.length / 2)];
    const min = prices[0];
    const max = prices[prices.length - 1];

    const topMetros = Object.entries(stats.locations)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const disappearanceRate =
      stats.count > 0 ? Math.round((stats.removed / stats.count) * 100) : 0;

    const sections: ThreadData["sections"] = [
      {
        text:
          `${stats.count} pre-2000 ${make} listings tracked on Facebook Marketplace. Avg ask: $${avg.toLocaleString()}. Median: $${median.toLocaleString()}. Range: $${min.toLocaleString()} - $${max.toLocaleString()}.`,
      },
      {
        text:
          `Where they cluster: ${topMetros.map(([loc, n]) => `${loc} (${n})`).join(", ")}.`,
      },
      {
        text:
          `${disappearanceRate}% have disappeared (removed/sold). ${stats.removed} of ${stats.count} listings no longer active.`,
      },
    ];

    // Add price distribution chart data if enough data
    if (prices.length >= 5) {
      const brackets = ["<$5k", "$5-10k", "$10-20k", "$20-50k", "$50k+"];
      const buckets = [0, 0, 0, 0, 0];
      for (const p of prices) {
        if (p < 5000) buckets[0]++;
        else if (p < 10000) buckets[1]++;
        else if (p < 20000) buckets[2]++;
        else if (p < 50000) buckets[3]++;
        else buckets[4]++;
      }
      sections.push({
        text: `Price distribution for ${make}:`,
        chartConfig: {
          slug: `thread-${make.toLowerCase()}-price-dist`,
          data: {
            labels: brackets,
            datasets: [{ label: make, data: buckets }],
          },
        },
      });
    }

    return {
      topic: `${make} on Facebook Marketplace`,
      sections,
      make,
      vehicleCount: stats.count,
      timespan: "all tracked data",
    };
  } catch (err) {
    console.error("[contentQueries] queryThreadData error:", err);
    return null;
  }
}

export async function queryChartData(
  supabase: SupabaseClient,
  templateSlug?: string,
): Promise<ChartTemplateData | null> {
  try {
    let query = supabase
      .from("patient_zero_chart_templates")
      .select(
        "id, slug, chart_type, query_template, chart_config_template, caption_prompt, cooldown_days, last_used_at",
      );

    if (templateSlug) {
      query = query.eq("slug", templateSlug);
    } else {
      // Prefer templates not used recently
      query = query.or(
        "last_used_at.is.null,last_used_at.lt." +
          new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      );
    }

    const { data: templates, error } = await query.limit(10);

    if (error || !templates || templates.length === 0) {
      // Fallback: get any template
      const { data: fallback } = await supabase
        .from("patient_zero_chart_templates")
        .select(
          "id, slug, chart_type, query_template, chart_config_template, caption_prompt, cooldown_days, last_used_at",
        )
        .limit(5);

      if (!fallback || fallback.length === 0) return null;
      const t = fallback[Math.floor(Math.random() * fallback.length)];
      return {
        template: {
          id: t.id,
          slug: t.slug,
          title: t.slug.replace(/-/g, " "),
          chart_type: t.chart_type,
          caption_prompt: t.caption_prompt ?? "",
          chart_config_template: t.chart_config_template ?? {},
        },
        rawQuery: t.query_template ?? "",
      };
    }

    // Pick one randomly from eligible
    const t = templates[Math.floor(Math.random() * templates.length)];

    // Mark as used
    await supabase
      .from("patient_zero_chart_templates")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", t.id);

    return {
      template: {
        id: t.id,
        slug: t.slug,
        title: t.slug.replace(/-/g, " "),
        chart_type: t.chart_type,
        caption_prompt: t.caption_prompt ?? "",
        chart_config_template: t.chart_config_template ?? {},
      },
      rawQuery: t.query_template ?? "",
    };
  } catch (err) {
    console.error("[contentQueries] queryChartData error:", err);
    return null;
  }
}
