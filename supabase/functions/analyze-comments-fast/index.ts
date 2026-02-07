/**
 * ANALYZE COMMENTS FAST
 *
 * Programmatic comment analysis engine — zero API cost replacement for
 * batch-comment-discovery. Uses keyword dictionaries, regex patterns,
 * and scoring algorithms calibrated against 2,787 existing AI analyses.
 *
 * Produces identical output schema to batch-comment-discovery so
 * aggregate-sentiment works unchanged.
 *
 * Modes:
 *   calibrate  — mine existing AI data to report keyword frequencies
 *   analyze    — process a batch of vehicles programmatically
 *   validate   — compare programmatic vs AI scores on overlap set
 *   batch      — continuous processing with self-chaining
 *
 * POST /functions/v1/analyze-comments-fast
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── KEYWORD DICTIONARIES (calibrated from 2,787 AI analyses) ───

const POSITIVE_WORDS: Record<string, number> = {
  // Strong positive (weight 2)
  "beautiful": 2, "stunning": 2, "gorgeous": 2, "incredible": 2,
  "spectacular": 2, "pristine": 2, "flawless": 2, "perfect": 2,
  "exceptional": 2, "magnificent": 2, "breathtaking": 2, "immaculate": 2,
  // Moderate positive (weight 1)
  "great": 1, "nice": 1, "good": 1, "excellent": 1, "awesome": 1,
  "amazing": 1, "impressive": 1, "fantastic": 1, "wonderful": 1,
  "cool": 1, "lovely": 1, "elegant": 1, "sharp": 1, "clean": 1,
  "sweet": 1, "epic": 1, "iconic": 1, "legendary": 1, "classic": 1,
  // Enthusiast positive
  "love": 1.5, "dream": 1.5, "want": 0.5, "wish": 0.5, "jealous": 0.5,
  "drool": 1.5, "bucket list": 2, "dream car": 2, "grail": 2,
  // Auction positive
  "well-bought": 1.5, "fair price": 1, "bargain": 1.5, "steal": 2,
  "good buy": 1.5, "well bought": 1.5, "congratulations": 1, "congrats": 1,
  "well done": 1, "good luck": 0.5,
};

const NEGATIVE_WORDS: Record<string, number> = {
  // Strong negative (weight -2)
  "terrible": -2, "horrible": -2, "awful": -2, "disgusting": -2,
  "disaster": -2, "wreck": -1.5, "junk": -2, "trash": -2,
  // Moderate negative (weight -1)
  "ugly": -1, "bad": -1, "poor": -1, "cheap": -1, "rough": -1,
  "tired": -1, "worn": -1, "beaten": -1, "neglected": -1, "abused": -1,
  "disappointing": -1, "overpriced": -1.5, "too much": -1, "too high": -1,
  // Condition negative
  "rust": -1.5, "rusty": -1.5, "rot": -1.5, "dent": -1, "crack": -1,
  "leak": -1, "smoke": -1, "knock": -1.5, "misfire": -1.5,
  "overspray": -1, "bondo": -1.5, "filler": -1, "repaint": -0.5,
};

const INTENSIFIERS = new Set([
  "very", "really", "extremely", "incredibly", "absolutely", "truly",
  "seriously", "insanely", "ridiculously", "remarkably", "exceptionally",
]);

const NEGATORS = new Set([
  "not", "no", "never", "neither", "nor", "hardly", "barely",
  "scarcely", "doesn't", "don't", "didn't", "isn't", "wasn't",
  "aren't", "weren't", "won't", "wouldn't", "shouldn't", "couldn't",
  "can't", "cannot",
]);

// ─── CONDITION PATTERNS ───

const CONDITION_POSITIVE_PATTERNS: [RegExp, string][] = [
  [/matching\s*numbers?/i, "matching numbers"],
  [/numbers?\s*match(ing)?/i, "matching numbers"],
  [/date[\s-]?code\s*(correct|match)/i, "date-code correct"],
  [/rust[\s-]?free/i, "rust-free"],
  [/no\s*rust/i, "no rust"],
  [/original\s*paint/i, "original paint"],
  [/factory\s*paint/i, "factory paint"],
  [/all[\s-]?original/i, "all-original"],
  [/bone[\s-]?stock/i, "bone stock"],
  [/low[\s-]?mile(age|s)?/i, "low mileage"],
  [/one[\s-]?owner/i, "one-owner"],
  [/single[\s-]?owner/i, "single-owner"],
  [/garage[\s-]?kept/i, "garage kept"],
  [/well[\s-]?maintained/i, "well-maintained"],
  [/well[\s-]?preserved/i, "well-preserved"],
  [/time[\s-]?capsule/i, "time capsule"],
  [/survivor/i, "survivor"],
  [/documented\s*(history|service|maintenance)/i, "documented history"],
  [/service\s*(records?|history)/i, "service records"],
  [/clean\s*(carfax|title|history)/i, "clean history"],
  [/no\s*accidents?/i, "no accidents"],
  [/straight\s*(body|panels?)/i, "straight body"],
  [/solid\s*(frame|body|floors?|undercarriage)/i, "solid undercarriage"],
  [/tight\s*(car|body|gaps?)/i, "tight gaps"],
  [/runs?\s*(and\s*)?drives?\s*(great|well|perfect)/i, "runs and drives well"],
  [/strong\s*(motor|engine|runner)/i, "strong engine"],
  [/new\s*(paint|interior|top|clutch|brakes?|tires?|exhaust|suspension)/i, "recent work done"],
];

const CONDITION_NEGATIVE_PATTERNS: [RegExp, string][] = [
  [/rust\s*(on|in|under|through|bubbl)/i, "rust noted"],
  [/surface\s*rust/i, "surface rust"],
  [/body\s*filler|bondo/i, "body filler detected"],
  [/repaint(ed)?/i, "repaint noted"],
  [/overspray/i, "overspray noted"],
  [/clear[\s-]?coat\s*(peel|fail|flak)/i, "clear coat failure"],
  [/aftermarket\s*(parts?|wheels?|exhaust|stereo|radio)/i, "aftermarket parts"],
  [/wrong\s*(engine|motor|transmission|color|interior)/i, "wrong components"],
  [/not\s*original\s*(engine|motor|transmission|color)/i, "non-original components"],
  [/accident\s*(history|damage|repair)/i, "accident history"],
  [/frame\s*damage/i, "frame damage"],
  [/flood\s*(damage|car|title)/i, "flood damage"],
  [/salvage\s*title/i, "salvage title"],
  [/rebuilt\s*title/i, "rebuilt title"],
  [/oil\s*leak/i, "oil leak"],
  [/smoke/i, "smoke noted"],
  [/misfire/i, "engine misfire"],
  [/check\s*engine/i, "check engine light"],
  [/needs?\s*(work|repair|restoration|attention|tlc|paint)/i, "needs work"],
  [/torn\s*(seat|top|interior)/i, "interior damage"],
  [/crack(ed)?\s*(dash|windshield|glass|leather)/i, "cracked components"],
  [/electrical\s*(issue|problem|gremlin)/i, "electrical issues"],
];

const MODIFICATION_PATTERNS: [RegExp, string][] = [
  [/engine\s*swap(ped)?/i, "engine swap"],
  [/(ls|lt)\d?\s*swap/i, "LS swap"],
  [/turbo(charged)?/i, "turbo"],
  [/supercharg(ed|er)/i, "supercharger"],
  [/nitrous/i, "nitrous"],
  [/coilover/i, "coilover suspension"],
  [/lowered/i, "lowered"],
  [/lifted/i, "lifted"],
  [/air\s*(ride|suspension|bags?)/i, "air ride"],
  [/roll\s*(cage|bar)/i, "roll cage/bar"],
  [/big\s*brake\s*kit/i, "big brake kit"],
  [/headers?/i, "headers"],
  [/exhaust\s*(system|upgrade)/i, "exhaust upgrade"],
  [/cam(shaft)?\s*(upgrade|swap)/i, "cam upgrade"],
  [/wheels?\s*(swap|upgrade|change)/i, "wheel swap"],
  [/body\s*kit/i, "body kit"],
  [/wide[\s-]?body/i, "widebody"],
  [/custom\s*(paint|interior|exhaust|wheels?|build)/i, "custom work"],
  [/restomod/i, "restomod"],
  [/pro[\s-]?tour(ing)?/i, "pro-touring build"],
];

const RESTORATION_QUALITY_PATTERNS: { pattern: RegExp; quality: string }[] = [
  { pattern: /concours/i, quality: "concours" },
  { pattern: /frame[\s-]?off/i, quality: "professional" },
  { pattern: /rotisserie/i, quality: "professional" },
  { pattern: /bare[\s-]?metal/i, quality: "professional" },
  { pattern: /nut[\s-]?and[\s-]?bolt/i, quality: "professional" },
  { pattern: /ground[\s-]?up/i, quality: "professional" },
  { pattern: /professional(ly)?\s*(restored|restoration|done|built|paint)/i, quality: "professional" },
  { pattern: /amateur(ish)?\s*(restoration|paint|work)/i, quality: "amateur" },
  { pattern: /rattle[\s-]?can/i, quality: "amateur" },
  { pattern: /maaco/i, quality: "amateur" },
  { pattern: /shade[\s-]?tree/i, quality: "amateur" },
  { pattern: /diy/i, quality: "amateur" },
];

const ORIGINALITY_PATTERNS: { pattern: RegExp; score: number }[] = [
  { pattern: /matching\s*numbers?/i, score: 1.0 },
  { pattern: /numbers?\s*match/i, score: 1.0 },
  { pattern: /all[\s-]?original/i, score: 1.0 },
  { pattern: /bone[\s-]?stock/i, score: 0.9 },
  { pattern: /factory\s*(original|correct|spec)/i, score: 0.9 },
  { pattern: /date[\s-]?code\s*(correct|match)/i, score: 0.9 },
  { pattern: /original\s*(engine|motor|drivetrain|paint|interior)/i, score: 0.7 },
  { pattern: /mostly\s*original/i, score: 0.6 },
  { pattern: /period[\s-]?correct/i, score: 0.5 },
  { pattern: /restomod/i, score: 0.2 },
  { pattern: /engine\s*swap/i, score: 0.1 },
  { pattern: /(ls|lt)\d?\s*swap/i, score: 0.1 },
  { pattern: /custom\s*(build|built)/i, score: 0.1 },
];

// ─── MARKET SIGNAL PATTERNS ───

const HIGH_DEMAND_PATTERNS = [
  /wish i could (afford|bid|buy)/i,
  /bucket\s*list/i,
  /dream\s*car/i,
  /grail/i,
  /need(s)?\s*this/i,
  /want(s)?\s*this\s*(so\s*bad|badly)?/i,
  /take\s*my\s*money/i,
  /shut\s*up\s*and\s*take/i,
  /under[\s-]?priced/i,
  /too\s*cheap/i,
  /steal/i,
  /will\s*(go|sell)\s*(higher|more)/i,
  /going\s*to\s*fly/i,
  /gonna\s*be\s*(expensive|pricey)/i,
];

const LOW_DEMAND_PATTERNS = [
  /overpriced/i,
  /too\s*(much|expensive|high|rich)/i,
  /not\s*worth/i,
  /pass/i,
  /no\s*reserve\s*and\s*still/i,
  /hard\s*sell/i,
  /market\s*(is\s*)?(soft|weak|declining)/i,
  /good\s*luck\s*(selling|getting)/i,
];

const RARITY_PATTERNS: { pattern: RegExp; level: string }[] = [
  { pattern: /\b1\s*of\s*\d+\b/i, level: "rare" },
  { pattern: /only\s*\d+\s*(made|built|produced|exist)/i, level: "rare" },
  { pattern: /\brare\b/i, level: "rare" },
  { pattern: /\bunicorn\b/i, level: "rare" },
  { pattern: /never\s*(see|seen|find|found)\s*(one|another|these)/i, level: "rare" },
  { pattern: /\buncommon\b/i, level: "uncommon" },
  { pattern: /don'?t\s*see\s*(many|these|them)\s*(often|anymore)/i, level: "uncommon" },
  { pattern: /\bcommon\b/i, level: "common" },
  { pattern: /dime\s*a\s*dozen/i, level: "common" },
  { pattern: /see\s*(these|them)\s*everywhere/i, level: "common" },
];

const PRICE_TREND_PATTERNS: { pattern: RegExp; trend: string }[] = [
  { pattern: /prices?\s*(are|have|been)\s*(rising|climbing|going\s*up|increasing|skyrocket)/i, trend: "rising" },
  { pattern: /values?\s*(are|have|been)\s*(rising|climbing|going\s*up|increasing)/i, trend: "rising" },
  { pattern: /appreciat(ing|ed|ion)/i, trend: "rising" },
  { pattern: /prices?\s*(are|have|been)\s*(stable|steady|flat|holding)/i, trend: "stable" },
  { pattern: /prices?\s*(are|have|been)\s*(declining|dropping|falling|going\s*down|soft)/i, trend: "declining" },
  { pattern: /depreciat(ing|ed|ion)/i, trend: "declining" },
  { pattern: /market\s*(is\s*)?(soft|weak|cooling)/i, trend: "declining" },
];

// ─── TECHNICAL VOCABULARY (for expert detection) ───

const TECHNICAL_TERMS = new Set([
  // Engine
  "compression ratio", "torque converter", "camshaft", "crankshaft",
  "cylinder head", "intake manifold", "carburetor", "fuel injection",
  "displacement", "bore", "stroke", "horsepower", "torque",
  "redline", "valve train", "pushrod", "overhead cam", "ohc", "ohv",
  "dohc", "sohc", "turbo", "supercharger", "intercooler", "wastegate",
  "efi", "tbi", "mpi", "hemi", "flathead", "big block", "small block",
  // Transmission
  "synchro", "gear ratio", "final drive", "limited slip", "posi",
  "positraction", "overdrive", "close ratio", "wide ratio", "dogleg",
  // Suspension/Brakes
  "double wishbone", "mcpherson", "coilover", "leaf spring",
  "torsion bar", "anti-roll bar", "sway bar", "disc brake", "drum brake",
  "caliper", "rotor", "master cylinder", "power assist",
  // Body/Chassis
  "unibody", "body-on-frame", "monocoque", "space frame",
  "panel fit", "shut lines", "door gaps", "fender flare",
  // Collector-specific
  "matching numbers", "date code", "broadcast sheet", "build sheet",
  "protect-o-plate", "cowl tag", "vin decode", "trim tag",
  "window sticker", "fender tag", "data plate", "buck tag",
  "concours", "marque", "provenance", "pedigree", "chain of ownership",
  "numbers matching", "date coded", "correct date",
]);

// ─── AUTHENTICITY PATTERNS ───

const AUTHENTICITY_CONCERN_PATTERNS = [
  /\bfake\b/i, /\bclone\b/i, /\btribute\b/i, /\breplica\b/i,
  /\breproduction\b/i, /not\s*(a\s*)?(real|genuine|authentic)/i,
  /\bfaux\b/i, /\bknock[\s-]?off\b/i, /counterfeit/i,
  /vin\s*(swap|plate|stamp|issue|concern|question)/i,
  /title\s*(wash|issue|problem)/i, /is\s*(it|this)\s*(really|actually)/i,
  /\bsuspicious\b/i, /too\s*good\s*to\s*be\s*true/i,
];

// ─── PRICE MENTION PATTERNS ───

const PRICE_MENTION_RE = /\$[\d,]+(?:\.\d{2})?/g;
const COMPARABLE_CONTEXT = /(sold\s*for|went\s*for|brought|fetched|hammered\s*at|bid\s*to|selling?\s*for)\s*\$[\d,]+/gi;

const PRICE_POSITIVE = [
  /\bbargain\b/i, /\bsteal\b/i, /\bwell[\s-]?bought\b/i, /\bfair\s*price\b/i,
  /\bgood\s*(buy|deal|price|value)\b/i, /\bunder[\s-]?valued\b/i,
  /\bcheap\b/i, /\bworth\s*(more|every\s*penny)\b/i,
];

const PRICE_NEGATIVE = [
  /\boverpriced\b/i, /\btoo\s*(much|expensive|high|rich)\b/i,
  /\bnot\s*worth\b/i, /\bpaid\s*too\s*much\b/i,
  /\bover[\s-]?valued\b/i, /\bexpensive\b/i,
];

// ─── THEME CATEGORIES ───

const THEME_PATTERNS: [RegExp, string][] = [
  [/color|paint|hue|shade/i, "Color and appearance"],
  [/history|story|provenance|previous\s*owner/i, "Vehicle history"],
  [/price|value|worth|cost|investment|money|bid/i, "Price and value discussion"],
  [/mod(ification|ified|s)|custom|swap|upgrade|build/i, "Modifications and builds"],
  [/condition|shape|quality|preserved|maintained/i, "Condition assessment"],
  [/original|authentic|numbers|matching|stock|factory/i, "Originality and authenticity"],
  [/restore|restoration|rebuild/i, "Restoration discussion"],
  [/drive|driving|road|track|handling|performance/i, "Driving experience"],
  [/rare|uncommon|unique|special|limited/i, "Rarity and collectibility"],
  [/nostalgi|remember|childhood|grew up|back in the day/i, "Nostalgia and memories"],
  [/market|trend|appreciate|depreciate|collect/i, "Market trends"],
  [/mechanic|engine|transmission|suspension|brake/i, "Technical discussion"],
];

// ─── EMOTIONAL THEME MAP ───

const EMOTIONAL_THEMES_MAP: Record<string, RegExp[]> = {
  "nostalgia": [/nostalgi/i, /remember/i, /childhood/i, /grew up/i, /back in the day/i, /those were the days/i],
  "excitement": [/excit/i, /can't wait/i, /pumped/i, /stoked/i, /fired up/i, /thrilled/i],
  "appreciation": [/appreciat/i, /respect/i, /beautiful/i, /gorgeous/i, /stunning/i, /magnificent/i],
  "humor": [/lol/i, /haha/i, /funny/i, /hilarious/i, /joke/i, /😂|🤣/],
  "concern": [/worried/i, /concern/i, /nervous/i, /careful/i, /watch out/i, /be aware/i],
  "passion": [/love/i, /passion/i, /obsess/i, /dream/i, /bucket list/i, /grail/i],
  "debate": [/disagree/i, /debate/i, /actually/i, /wrong/i, /incorrect/i, /versus|vs\./i],
  "admiration": [/admire/i, /impressed/i, /hats off/i, /well done/i, /incredible/i, /amazing/i],
};

// ═══════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "analyze";

    let result: any;

    switch (mode) {
      case "calibrate":
        result = await calibrate(supabase);
        break;
      case "analyze":
        result = await analyze(supabase, body);
        break;
      case "validate":
        result = await validate(supabase, body);
        break;
      case "batch":
        result = await batchProcess(supabase, supabaseUrl, serviceKey, body);
        break;
      default:
        return jsonResponse({ error: `Unknown mode: ${mode}` }, 400);
    }

    return jsonResponse({
      success: true,
      mode,
      elapsed_ms: Date.now() - startTime,
      ...result,
    });
  } catch (e: any) {
    console.error("[analyze-comments-fast] Error:", e);
    return jsonResponse({ error: e.message, elapsed_ms: Date.now() - startTime }, 500);
  }
});

// ═══════════════════════════════════════════════════
// MODE: CALIBRATE
// ═══════════════════════════════════════════════════

async function calibrate(supabase: any) {
  const { data: stats, error } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE overall_sentiment = 'positive') AS positive,
        count(*) FILTER (WHERE overall_sentiment = 'mixed') AS mixed,
        count(*) FILTER (WHERE overall_sentiment = 'negative') AS negative,
        round(avg(sentiment_score)::numeric, 3) AS avg_score,
        round(percentile_cont(0.25) WITHIN GROUP (ORDER BY sentiment_score)::numeric, 3) AS p25_score,
        round(percentile_cont(0.75) WITHIN GROUP (ORDER BY sentiment_score)::numeric, 3) AS p75_score
      FROM comment_discoveries
      WHERE sentiment_score IS NOT NULL
    `,
  });

  if (error) throw error;

  return {
    calibration_source: "2787 AI-analyzed vehicles",
    score_distribution: stats?.[0] ?? {},
    dictionaries: {
      positive_words: Object.keys(POSITIVE_WORDS).length,
      negative_words: Object.keys(NEGATIVE_WORDS).length,
      condition_positive_patterns: CONDITION_POSITIVE_PATTERNS.length,
      condition_negative_patterns: CONDITION_NEGATIVE_PATTERNS.length,
      modification_patterns: MODIFICATION_PATTERNS.length,
      technical_terms: TECHNICAL_TERMS.size,
      theme_categories: THEME_PATTERNS.length,
    },
  };
}

// ═══════════════════════════════════════════════════
// MODE: ANALYZE
// ═══════════════════════════════════════════════════

async function analyze(supabase: any, body: any) {
  const batchSize = Math.min(body.batch_size || 100, 500);
  const minComments = body.min_comments ?? 5;
  const offset = body.offset ?? 0;

  // Get candidate vehicles (same logic as batch-comment-discovery)
  const { data: candidates, error: cErr } = await supabase.rpc("execute_sql", {
    query: `
      SELECT bl.vehicle_id, bl.comment_count,
             v.year, v.make, v.model,
             COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price) AS sale_price
      FROM bat_listings bl
      JOIN vehicles v ON v.id = bl.vehicle_id AND v.deleted_at IS NULL
      WHERE bl.vehicle_id IS NOT NULL
        AND bl.comment_count >= ${minComments}
        AND NOT EXISTS (SELECT 1 FROM comment_discoveries cd WHERE cd.vehicle_id = bl.vehicle_id)
      ORDER BY random()
      LIMIT ${batchSize}
    `,
  });

  if (cErr) throw new Error(`Candidate query: ${JSON.stringify(cErr)}`);

  const vehicles = Array.isArray(candidates) ? candidates : [];
  if (vehicles.length === 0) {
    return { message: "No more vehicles to analyze", discovered: 0, remaining: 0 };
  }

  // Process each vehicle
  const results = { discovered: 0, errors: 0, error_details: [] as string[], samples: [] as any[] };

  for (const v of vehicles) {
    try {
      const discovery = await analyzeVehicle(supabase, v);
      if (discovery) {
        results.discovered++;
        if (results.samples.length < 3) {
          results.samples.push({
            vehicle: `${v.year} ${v.make} ${v.model}`,
            price: v.sale_price,
            comments: v.comment_count,
            sentiment: discovery.sentiment?.overall,
            score: discovery.sentiment?.score,
            condition: discovery.condition_signals?.overall_impression,
            demand: discovery.market_signals?.demand,
          });
        }
      }
    } catch (e: any) {
      results.errors++;
      results.error_details.push(`${v.vehicle_id}: ${e.message}`);
    }
  }

  // Remaining count
  const { data: remData } = await supabase.rpc("execute_sql", {
    query: `
      SELECT count(*) AS remaining
      FROM bat_listings bl
      WHERE bl.vehicle_id IS NOT NULL
        AND bl.comment_count >= ${minComments}
        AND NOT EXISTS (SELECT 1 FROM comment_discoveries cd WHERE cd.vehicle_id = bl.vehicle_id)
    `,
  });
  const remaining = Number(remData?.[0]?.remaining ?? 0);

  return { ...results, remaining, batch_size: batchSize };
}

// ─── Core analysis for a single vehicle ───

async function analyzeVehicle(supabase: any, vehicle: any): Promise<any> {
  // Fetch comments
  const { data: comments, error: cErr } = await supabase
    .from("auction_comments")
    .select("comment_text, author_username, is_seller, posted_at, comment_likes, bid_amount")
    .eq("vehicle_id", vehicle.vehicle_id)
    .order("posted_at", { ascending: true })
    .limit(200);

  if (cErr || !comments || comments.length < 3) return null;

  // Run all analysis modules — sanitize text to remove JSONB-breaking control chars
  const sanitize = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  const allText = comments.map((c: any) => sanitize(c.comment_text || "")).join("\n");
  const sellerComments = comments.filter((c: any) => c.is_seller);
  const commentTexts = comments.map((c: any) => ({
    text: sanitize(c.comment_text || ""),
    isSeller: !!c.is_seller,
    likes: Number(c.comment_likes || 0),
    username: c.author_username || "anon",
    bidAmount: c.bid_amount ? Number(c.bid_amount) : null,
  }));

  const sentiment = analyzeSentiment(commentTexts);
  const conditionSignals = analyzeCondition(allText);
  const marketSignals = analyzeMarketSignals(allText, commentTexts);
  const expertInsights = detectExperts(commentTexts);
  const sellerDisclosures = extractSellerDisclosures(sellerComments);
  const communityConcerns = extractConcerns(commentTexts);
  const comparableSales = extractComparableSales(allText);
  const authenticityDiscussion = analyzeAuthenticity(allText);
  const priceSentiment = analyzePriceSentiment(allText, vehicle.sale_price);
  const discussionThemes = extractThemes(allText);
  const keyQuotes = extractKeyQuotes(commentTexts);
  const metaAnalysis = computeMetaAnalysis(comments, sentiment, conditionSignals, expertInsights, sellerComments);

  const raw_extraction = {
    sentiment,
    condition_signals: conditionSignals,
    expert_insights: expertInsights,
    seller_disclosures: sellerDisclosures,
    community_concerns: communityConcerns,
    comparable_sales: comparableSales,
    market_signals: marketSignals,
    authenticity_discussion: authenticityDiscussion,
    price_sentiment: priceSentiment,
    discussion_themes: discussionThemes,
    key_quotes: keyQuotes,
    meta_analysis: metaAnalysis,
  };

  // Deep-clean all strings in raw_extraction to remove JSONB-breaking chars
  const deepClean = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "string") return obj.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    if (Array.isArray(obj)) return obj.map(deepClean);
    if (typeof obj === "object") {
      const cleaned: any = {};
      for (const [k, v] of Object.entries(obj)) cleaned[k] = deepClean(v);
      return cleaned;
    }
    return obj;
  };
  const cleanExtraction = deepClean(raw_extraction);

  // Upsert via Supabase client
  const { error: insertError } = await supabase
    .from("comment_discoveries")
    .upsert({
      vehicle_id: vehicle.vehicle_id,
      discovered_at: new Date().toISOString(),
      raw_extraction: cleanExtraction,
      comment_count: comments.length,
      total_fields: countFields(raw_extraction),
      sale_price: vehicle.sale_price != null ? Math.round(Number(vehicle.sale_price)) : null,
      overall_sentiment: sentiment.overall,
      sentiment_score: sentiment.score,
      data_quality_score: metaAnalysis.data_quality_score,
      missing_data_flags: metaAnalysis.missing_data,
      recommended_sources: [],
      model_used: "programmatic-v1",
    }, { onConflict: "vehicle_id" });

  if (insertError) throw new Error(`Insert: ${insertError.message}`);

  return raw_extraction;
}

// ═══════════════════════════════════════════════════
// ANALYSIS MODULES
// ═══════════════════════════════════════════════════

function analyzeSentiment(comments: { text: string; isSeller: boolean; likes: number }[]): {
  overall: string; score: number; mood_keywords: string[]; emotional_themes: string[];
} {
  let totalScore = 0;
  let totalWeight = 0;
  const moodCounts: Record<string, number> = {};
  const emotionalThemeCounts: Record<string, number> = {};

  for (const c of comments) {
    const text = c.text.toLowerCase();
    const words = text.split(/\s+/);
    let commentScore = 0;
    let wordCount = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];

      // Check for negator in previous 3 words
      let negated = false;
      for (let j = Math.max(0, i - 3); j < i; j++) {
        if (NEGATORS.has(words[j])) { negated = true; break; }
      }

      // Check for intensifier in previous 2 words
      let intensified = false;
      for (let j = Math.max(0, i - 2); j < i; j++) {
        if (INTENSIFIERS.has(words[j])) { intensified = true; break; }
      }

      const posScore = POSITIVE_WORDS[word];
      const negScore = NEGATIVE_WORDS[word];

      if (posScore !== undefined) {
        let s = negated ? -posScore * 0.5 : posScore;
        if (intensified) s *= 1.5;
        commentScore += s;
        wordCount++;
      } else if (negScore !== undefined) {
        let s = negated ? -negScore * 0.3 : negScore;
        if (intensified) s *= 1.5;
        commentScore += s;
        wordCount++;
      }
    }

    // Also check multi-word positive/negative phrases
    for (const [phrase, weight] of Object.entries(POSITIVE_WORDS)) {
      if (phrase.includes(" ") && text.includes(phrase)) {
        commentScore += weight;
        wordCount++;
      }
    }
    for (const [phrase, weight] of Object.entries(NEGATIVE_WORDS)) {
      if (phrase.includes(" ") && text.includes(phrase)) {
        commentScore += weight;
        wordCount++;
      }
    }

    if (wordCount > 0) {
      const normalized = Math.max(-1, Math.min(1, commentScore / Math.max(wordCount, 1)));
      const weight = 1 + Math.log2(1 + c.likes);
      totalScore += normalized * weight;
      totalWeight += weight;
    }

    // Collect mood keywords from the text
    for (const [keyword] of Object.entries(POSITIVE_WORDS)) {
      if (!keyword.includes(" ") && text.includes(keyword)) {
        moodCounts[keyword] = (moodCounts[keyword] || 0) + 1;
      }
    }

    // Emotional themes
    for (const [theme, patterns] of Object.entries(EMOTIONAL_THEMES_MAP)) {
      for (const p of patterns) {
        if (p.test(c.text)) {
          emotionalThemeCounts[theme] = (emotionalThemeCounts[theme] || 0) + 1;
          break;
        }
      }
    }
  }

  const avgScore = totalWeight > 0 ? totalScore / totalWeight : 0;
  // Calibration: AI avg=0.699, P25=0.7, P75=0.85. BaT comments are overwhelmingly positive.
  // Raw keyword scores already trend positive due to enthusiast language.
  // Minimal bias of +0.05 to account for undetected subtle positivity.
  const biased = avgScore + 0.05;
  const clampedScore = Math.round(Math.max(-1, Math.min(1, biased)) * 100) / 100;

  let overall: string;
  if (clampedScore >= 0.5) overall = "positive";
  else if (clampedScore >= 0.1) overall = "mixed";
  else if (clampedScore >= -0.15) overall = "neutral";
  else overall = "negative";

  // Top mood keywords (by frequency, limited to 5)
  const topMoods = Object.entries(moodCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  // Fallback: map from AI's common keywords based on score
  if (topMoods.length === 0) {
    if (clampedScore >= 0.5) topMoods.push("enthusiastic", "appreciative");
    else if (clampedScore >= 0.2) topMoods.push("interested", "curious");
    else if (clampedScore >= -0.1) topMoods.push("neutral");
    else topMoods.push("critical", "skeptical");
  }

  // Top emotional themes
  const topEmotional = Object.entries(emotionalThemeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k);

  if (topEmotional.length === 0) {
    topEmotional.push(clampedScore >= 0 ? "appreciation" : "concern");
  }

  return {
    overall,
    score: clampedScore,
    mood_keywords: topMoods,
    emotional_themes: topEmotional,
  };
}

function analyzeCondition(allText: string): {
  overall_impression: string;
  positives: string[];
  negatives: string[];
  modifications: string[];
  restoration_quality: string;
  originality: string;
} {
  const positives: string[] = [];
  const negatives: string[] = [];
  const modifications: string[] = [];

  for (const [pattern, label] of CONDITION_POSITIVE_PATTERNS) {
    if (pattern.test(allText)) positives.push(label);
  }
  for (const [pattern, label] of CONDITION_NEGATIVE_PATTERNS) {
    if (pattern.test(allText)) negatives.push(label);
  }
  for (const [pattern, label] of MODIFICATION_PATTERNS) {
    if (pattern.test(allText)) modifications.push(label);
  }

  // Deduplicate
  const uniquePos = [...new Set(positives)];
  const uniqueNeg = [...new Set(negatives)];
  const uniqueMods = [...new Set(modifications)];

  // Restoration quality
  let restorationQuality = "unknown";
  for (const { pattern, quality } of RESTORATION_QUALITY_PATTERNS) {
    if (pattern.test(allText)) {
      restorationQuality = quality;
      if (quality === "concours" || quality === "professional") break; // prefer higher
    }
  }

  // Originality
  let origScore = 0;
  let origCount = 0;
  for (const { pattern, score } of ORIGINALITY_PATTERNS) {
    if (pattern.test(allText)) {
      origScore += score;
      origCount++;
    }
  }
  let originality = "unknown";
  if (origCount > 0) {
    const avg = origScore / origCount;
    if (avg >= 0.8) originality = "all-original";
    else if (avg >= 0.5) originality = "mostly-original";
    else if (avg >= 0.2) originality = "modified";
    else originality = "restomod";
  }

  // Overall impression: calibrated against AI data where 75% = excellent, 17% = good.
  // BaT cars are generally high quality, so bias toward excellent when signals are weak.
  const posWeight = uniquePos.length;
  const negWeight = uniqueNeg.length;
  let overallImpression: string;
  if (negWeight === 0) {
    // No negatives at all — excellent (matches AI behavior)
    overallImpression = "excellent";
  } else if (posWeight > negWeight) {
    // More positives than negatives — still excellent (AI is generous)
    overallImpression = "excellent";
  } else if (posWeight === negWeight) {
    overallImpression = "good";
  } else if (negWeight - posWeight <= 2) {
    // Slightly more negatives
    overallImpression = "good";
  } else if (negWeight - posWeight <= 4) {
    overallImpression = "fair";
  } else {
    overallImpression = "poor";
  }

  return {
    overall_impression: overallImpression,
    positives: uniquePos,
    negatives: uniqueNeg,
    modifications: uniqueMods,
    restoration_quality: restorationQuality,
    originality,
  };
}

function analyzeMarketSignals(allText: string, comments: { text: string; likes: number }[]): {
  demand: string; rarity: string; price_trend: string; value_factors: string[];
} {
  // Demand
  let highSignals = 0;
  let lowSignals = 0;
  for (const p of HIGH_DEMAND_PATTERNS) {
    const matches = allText.match(new RegExp(p, "gi"));
    if (matches) highSignals += matches.length;
  }
  for (const p of LOW_DEMAND_PATTERNS) {
    const matches = allText.match(new RegExp(p, "gi"));
    if (matches) lowSignals += matches.length;
  }

  let demand: string;
  if (highSignals >= 3 && highSignals > lowSignals * 2) demand = "high";
  else if (lowSignals >= 3 && lowSignals > highSignals * 2) demand = "low";
  else demand = "moderate";

  // Rarity
  let rarity = "common";
  for (const { pattern, level } of RARITY_PATTERNS) {
    if (pattern.test(allText)) {
      if (level === "rare" || (level === "uncommon" && rarity === "common")) {
        rarity = level;
      }
    }
  }

  // Price trend
  let priceTrend = "unknown";
  for (const { pattern, trend } of PRICE_TREND_PATTERNS) {
    if (pattern.test(allText)) {
      priceTrend = trend;
      break;
    }
  }

  // Value factors
  const valueFactors: string[] = [];
  if (highSignals > 0) valueFactors.push("Strong community enthusiasm");
  if (rarity === "rare") valueFactors.push("Rarity premium");
  if (/matching\s*numbers?|numbers?\s*match/i.test(allText)) valueFactors.push("Numbers-matching provenance");
  if (/low[\s-]?mile/i.test(allText)) valueFactors.push("Low mileage");
  if (/one[\s-]?owner|single[\s-]?owner/i.test(allText)) valueFactors.push("Single-owner history");
  if (/documented|service\s*records?/i.test(allText)) valueFactors.push("Documented history");
  if (/concours|frame[\s-]?off|rotisserie/i.test(allText)) valueFactors.push("Quality restoration");

  return { demand, rarity, price_trend: priceTrend, value_factors: valueFactors };
}

function detectExperts(comments: { text: string; username: string; likes: number }[]): { insight: string; expertise_level: string }[] {
  const insights: { insight: string; expertise_level: string; score: number }[] = [];

  for (const c of comments) {
    const text = c.text.toLowerCase();
    let techTermCount = 0;

    for (const term of TECHNICAL_TERMS) {
      if (text.includes(term)) techTermCount++;
    }

    // Also check for specific model knowledge (dates, production numbers)
    if (/\b(19|20)\d{2}\b/.test(c.text) && /\bproduction|produced|built|made\b/i.test(c.text)) {
      techTermCount++;
    }

    if (techTermCount >= 2 && c.text.length > 80) {
      const level = techTermCount >= 4 ? "high" : techTermCount >= 2 ? "medium" : "low";
      // Truncate to first 200 chars for the insight
      const truncated = c.text.length > 200 ? c.text.substring(0, 200) + "..." : c.text;
      insights.push({ insight: truncated, expertise_level: level, score: techTermCount + c.likes });
    }
  }

  // Sort by score, take top 5
  return insights
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ insight, expertise_level }) => ({ insight, expertise_level }));
}

function extractSellerDisclosures(sellerComments: any[]): string[] {
  const disclosures: string[] = [];
  for (const c of sellerComments) {
    const text = c.comment_text || "";
    if (text.length > 30) {
      // Take first 300 chars
      disclosures.push(text.length > 300 ? text.substring(0, 300) + "..." : text);
    }
  }
  return disclosures.slice(0, 10);
}

function extractConcerns(comments: { text: string; likes: number }[]): string[] {
  const concerns: string[] = [];
  for (const c of comments) {
    const text = c.text.toLowerCase();
    const hasNegative = Object.keys(NEGATIVE_WORDS).some(w => text.includes(w));
    const hasQuestionMark = c.text.includes("?");
    const hasWarning = /\bconcern|worried|careful|watch out|be aware|issue|problem|red flag\b/i.test(text);

    if ((hasNegative || hasWarning) && (c.likes >= 2 || hasWarning)) {
      const truncated = c.text.length > 200 ? c.text.substring(0, 200) + "..." : c.text;
      concerns.push(truncated);
    }
  }
  return concerns.slice(0, 5);
}

function extractComparableSales(allText: string): { description: string; price: number | null }[] {
  const sales: { description: string; price: number | null }[] = [];
  const matches = allText.matchAll(COMPARABLE_CONTEXT);

  for (const m of matches) {
    const priceMatch = m[0].match(PRICE_MENTION_RE);
    const price = priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, "")) : null;
    // Get surrounding context (50 chars before, full match, 50 chars after)
    const idx = m.index || 0;
    const start = Math.max(0, idx - 50);
    const end = Math.min(allText.length, idx + m[0].length + 50);
    const context = allText.substring(start, end).replace(/\n/g, " ").trim();
    sales.push({ description: context, price });
  }

  return sales.slice(0, 5);
}

function analyzeAuthenticity(allText: string): { concerns_raised: boolean | string; details: string } {
  const concerns: string[] = [];
  for (const p of AUTHENTICITY_CONCERN_PATTERNS) {
    if (p.test(allText)) {
      const match = allText.match(p);
      if (match) concerns.push(match[0]);
    }
  }

  if (concerns.length === 0) {
    return { concerns_raised: false, details: "No authenticity concerns raised in comments" };
  }

  return {
    concerns_raised: true,
    details: `Authenticity keywords found: ${[...new Set(concerns)].join(", ")}`,
  };
}

function analyzePriceSentiment(allText: string, salePrice: number | null): { community_view: string; reasoning: string } {
  let posCount = 0;
  let negCount = 0;

  for (const p of PRICE_POSITIVE) {
    if (p.test(allText)) posCount++;
  }
  for (const p of PRICE_NEGATIVE) {
    if (p.test(allText)) negCount++;
  }

  let view: string;
  let reasoning: string;

  if (posCount > 0 && negCount === 0) {
    view = "bargain";
    reasoning = "Community sentiment suggests the vehicle was well-bought";
  } else if (posCount > negCount) {
    view = "fair";
    reasoning = "Generally positive price sentiment with some discussion";
  } else if (negCount > posCount) {
    view = "high";
    reasoning = "Some community members expressed the price was high";
  } else if (negCount > 0 && posCount > 0) {
    view = "fair";
    reasoning = "Mixed community views on pricing";
  } else {
    view = "unknown";
    reasoning = "Limited price discussion in comments";
  }

  return { community_view: view, reasoning };
}

function extractThemes(allText: string): string[] {
  const themes: { theme: string; count: number }[] = [];

  for (const [pattern, theme] of THEME_PATTERNS) {
    const matches = allText.match(new RegExp(pattern, "gi"));
    if (matches && matches.length >= 2) {
      themes.push({ theme, count: matches.length });
    }
  }

  return themes
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(t => t.theme);
}

function extractKeyQuotes(comments: { text: string; likes: number; username: string }[]): { quote: string; significance: string }[] {
  // Sort by engagement (likes), take top comments
  const sorted = [...comments]
    .filter(c => c.text.length >= 30 && c.text.length <= 500)
    .sort((a, b) => b.likes - a.likes);

  const quotes: { quote: string; significance: string }[] = [];

  for (const c of sorted.slice(0, 5)) {
    if (c.likes >= 1) {
      quotes.push({
        quote: c.text.length > 250 ? c.text.substring(0, 250) + "..." : c.text,
        significance: `${c.likes} likes — popular community comment`,
      });
    }
  }

  // If not enough liked comments, grab high-signal ones
  if (quotes.length < 3) {
    for (const c of comments) {
      if (quotes.length >= 3) break;
      const text = c.text.toLowerCase();
      const hasTechnical = [...TECHNICAL_TERMS].some(t => text.includes(t));
      if (hasTechnical && c.text.length >= 50) {
        quotes.push({
          quote: c.text.length > 250 ? c.text.substring(0, 250) + "..." : c.text,
          significance: "Technical insight from community member",
        });
      }
    }
  }

  return quotes.slice(0, 5);
}

function computeMetaAnalysis(
  comments: any[],
  sentiment: { score: number },
  condition: { positives: string[]; negatives: string[] },
  experts: any[],
  sellerComments: any[],
): {
  data_quality_score: number;
  missing_data: string[];
  confidence_ratings: Record<string, string>;
} {
  const totalComments = comments.length;
  const avgLength = comments.reduce((s: number, c: any) => s + (c.comment_text?.length || 0), 0) / Math.max(totalComments, 1);
  const sellerPresent = sellerComments.length > 0;
  const expertPresent = experts.length > 0;

  // Data quality: 0-1 based on comment count, avg length, seller presence, expert presence
  let quality = 0;
  if (totalComments >= 50) quality += 0.3;
  else if (totalComments >= 20) quality += 0.2;
  else if (totalComments >= 5) quality += 0.1;

  if (avgLength >= 100) quality += 0.2;
  else if (avgLength >= 50) quality += 0.1;

  if (sellerPresent) quality += 0.2;
  if (expertPresent) quality += 0.15;

  // Signal density
  const totalSignals = condition.positives.length + condition.negatives.length;
  if (totalSignals >= 5) quality += 0.15;
  else if (totalSignals >= 2) quality += 0.1;

  quality = Math.round(Math.min(1, quality) * 100) / 100;

  // Missing data
  const missing: string[] = [];
  if (!sellerPresent) missing.push("No seller participation in comments");
  if (totalComments < 10) missing.push("Low comment count");
  if (condition.positives.length === 0 && condition.negatives.length === 0) {
    missing.push("No condition signals detected");
  }

  // Confidence ratings
  const sentimentSignals = totalComments;
  const conditionSignals = condition.positives.length + condition.negatives.length;

  const confidence = (count: number): string => {
    if (count >= 5) return "high";
    if (count >= 2) return "medium";
    return "low";
  };

  return {
    data_quality_score: quality,
    missing_data: missing,
    confidence_ratings: {
      sentiment: confidence(sentimentSignals),
      condition: confidence(conditionSignals),
      authenticity: confidence(totalComments >= 20 ? 3 : 1),
      price_assessment: confidence(totalComments >= 10 ? 3 : 1),
    },
  };
}

// ═══════════════════════════════════════════════════
// MODE: VALIDATE
// ═══════════════════════════════════════════════════

async function validate(supabase: any, body: any) {
  const limit = body.limit || 100;

  // Get vehicles that have AI analyses
  const { data: aiVehicles, error } = await supabase.rpc("execute_sql", {
    query: `
      SELECT cd.vehicle_id, cd.overall_sentiment AS ai_sentiment,
             cd.sentiment_score AS ai_score,
             cd.raw_extraction->'condition_signals'->>'overall_impression' AS ai_condition,
             cd.raw_extraction->'market_signals'->>'demand' AS ai_demand,
             bl.comment_count
      FROM comment_discoveries cd
      JOIN bat_listings bl ON bl.vehicle_id = cd.vehicle_id
      WHERE cd.model_used IS NULL OR cd.model_used != 'programmatic-v1'
      ORDER BY cd.sentiment_score DESC NULLS LAST
      LIMIT ${limit}
    `,
  });

  if (error) throw error;

  let sentimentMatches = 0;
  let conditionMatches = 0;
  let totalCompared = 0;
  const scoreDeltas: number[] = [];
  const mismatches: any[] = [];

  for (const av of aiVehicles || []) {
    const { data: comments } = await supabase
      .from("auction_comments")
      .select("comment_text, author_username, is_seller, posted_at, comment_likes, bid_amount")
      .eq("vehicle_id", av.vehicle_id)
      .order("posted_at", { ascending: true })
      .limit(200);

    if (!comments || comments.length < 3) continue;

    const allText = comments.map((c: any) => c.comment_text || "").join("\n");
    const commentTexts = comments.map((c: any) => ({
      text: c.comment_text || "",
      isSeller: !!c.is_seller,
      likes: Number(c.comment_likes || 0),
      username: c.author_username || "anon",
      bidAmount: c.bid_amount ? Number(c.bid_amount) : null,
    }));

    const progSentiment = analyzeSentiment(commentTexts);
    const progCondition = analyzeCondition(allText);

    totalCompared++;

    // Sentiment match (same label)
    if (progSentiment.overall === av.ai_sentiment) sentimentMatches++;

    // Condition match
    if (progCondition.overall_impression === av.ai_condition) conditionMatches++;

    // Score delta
    if (av.ai_score != null) {
      scoreDeltas.push(Math.abs(progSentiment.score - Number(av.ai_score)));
    }

    // Track mismatches for debugging
    if (progSentiment.overall !== av.ai_sentiment && mismatches.length < 5) {
      mismatches.push({
        vehicle_id: av.vehicle_id,
        ai_sentiment: av.ai_sentiment,
        prog_sentiment: progSentiment.overall,
        ai_score: av.ai_score,
        prog_score: progSentiment.score,
      });
    }
  }

  const avgDelta = scoreDeltas.length > 0
    ? Math.round((scoreDeltas.reduce((a, b) => a + b, 0) / scoreDeltas.length) * 1000) / 1000
    : null;

  return {
    compared: totalCompared,
    sentiment_match_rate: totalCompared > 0 ? Math.round(sentimentMatches / totalCompared * 100) : 0,
    condition_match_rate: totalCompared > 0 ? Math.round(conditionMatches / totalCompared * 100) : 0,
    avg_score_delta: avgDelta,
    sample_mismatches: mismatches,
  };
}

// ═══════════════════════════════════════════════════
// MODE: BATCH (self-chaining continuous processing)
// ═══════════════════════════════════════════════════

async function batchProcess(supabase: any, supabaseUrl: string, serviceKey: string, body: any) {
  const batchSize = Math.min(body.batch_size || 50, 50); // Max 50 per invocation (edge fn memory limit)
  const minComments = body.min_comments ?? 5;
  const batchNum = body._batch_num ?? 1;

  // Single batch per invocation to avoid memory limits
  const result = await analyze(supabase, { batch_size: batchSize, min_comments: minComments });
  const remaining = result.remaining || 0;

  console.log(`[batch #${batchNum}] ${result.discovered} discovered, ${remaining} remaining`);

  // Self-chain: fire-and-forget next invocation
  if (remaining > 0 && (result.discovered || 0) > 0 && body.continue !== false) {
    const nextUrl = `${supabaseUrl}/functions/v1/analyze-comments-fast`;
    fetch(nextUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "batch",
        batch_size: batchSize,
        min_comments: minComments,
        continue: true,
        _batch_num: batchNum + 1,
      }),
    }).catch(e => console.error("[batch] Chain failed:", e));
  }

  return {
    batch_num: batchNum,
    discovered: result.discovered || 0,
    errors: result.errors || 0,
    remaining,
    continued: remaining > 0 && (result.discovered || 0) > 0,
  };
}

// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════

function countFields(obj: any, depth = 0): number {
  if (depth > 5 || obj === null || obj === undefined) return 0;
  if (typeof obj !== "object") return 1;
  if (Array.isArray(obj)) return obj.reduce((s, i) => s + countFields(i, depth + 1), 0);
  return Object.values(obj).reduce((s: number, v) => s + countFields(v, depth + 1), 0);
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
