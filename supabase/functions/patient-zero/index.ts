/**
 * Patient Zero — Autonomous daily social media posting
 *
 * "Day [N] of posting until someone notices."
 * Day 1 = Nov 28, 2024. Hardcore data analytics, smart and fun. Rust bucket savant.
 *
 * 7 content types on weekly rotation:
 *   Mon=save, Tue=chart, Wed=vehicle, Thu=shop_photo, Fri=chart, Sat=retrospective, Sun=thread
 *
 * Actions (via POST body `action` field):
 *   generate   — Content router: lookup calendar → dispatch type-specific generator → queue → Telegram preview
 *   publish    — Publish approved posts (including thread reply chains)
 *   preview    — Send Telegram preview of today's post
 *   skip       — Skip a queued post
 *   override   — Replace caption on a queued post
 *   stats      — Post count, streak, day number
 *   pause      — Toggle config.paused
 *   curate     — Add/remove images from pool
 *   seed_pool  — Bulk-add images from a vehicle_id or query
 *
 * Telegram webhook: auto-detected by `update_id` in POST body.
 * Supports /pz, /pzskip, /pzstats, /pzpause, /pz override <text>, /pztype [type],
 * and inline button callbacks (pz_approve_{id}, pz_skip_{id}).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callModel } from "../_shared/llmRouter.ts";
import { buildChartUrl, buildChartUrlPost } from "../_shared/chartGenerator.ts";
import {
  querySaveData,
  queryRetrospectiveData,
  queryMarketObservationData,
  queryVehicleData,
  queryThreadData,
  queryChartData,
} from "../_shared/contentQueries.ts";
import { NUKE_IDENTITY } from "../_shared/patientZeroIdentity.ts";

// ── Constants ────────────────────────────────────────────────

const DAY_ZERO = new Date("2024-11-28T00:00:00Z");
const CAPTION_MODEL = "claude-haiku-4-5";

const CAPTION_SYSTEM_PROMPT = `You write daily social media captions for an autonomous vehicle data project.

Rules:
- All lowercase. No exceptions.
- Maximum 10 words after "day N."
- No exclamation points, no questions, no CTAs, no emojis
- Dry, deadpan, minimalist. The dryness IS the brand.
- Never mention the project name
- Vary structure: some reference the car, some reference the act of posting,
  some are existential observations
- Always start with "day N." where N is the day number provided

You receive: day number, vehicle info (year/make/model), image context.
You output: ONLY the caption text. Nothing else. No quotes around it.

Examples:
"day 479. laptop on the fab table. nobody noticed yet."
"day 312. someone paid $340k for this at barrett-jackson."
"day 201. found this in a field outside boulder city."
"day 88. posting cars into the void."
"day 445. the database knows more than the owner does."
"day 156. three hundred horse. zero engagement."`;

type ContentType = "vehicle" | "save" | "chart" | "shop_photo" | "retrospective" | "market_observation" | "thread";

const CONTENT_PROMPTS: Record<ContentType, string> = {
  vehicle: CAPTION_SYSTEM_PROMPT,
  save: `You write daily social media captions for an autonomous vehicle data project.

Rules:
- All lowercase. No exceptions.
- Maximum 15 words after "day N."
- No exclamation points, no questions, no CTAs, no emojis
- Tone: regretful, wistful, like you missed it. It sold. It's gone.
- Reference the price, the city, how fast it disappeared.
- Always start with "day N." where N is the day number provided
You output: ONLY the caption text. Nothing else.

Examples:
"day 482. saved a $4,200 bronco in phoenix. it sold in 3 hours."
"day 491. had a '72 blazer bookmarked at $6,800. gone by lunch."
"day 503. someone in tucson listed a scout for $3,500. already gone."`,

  chart: `You write daily social media captions for an autonomous vehicle data project that posts data charts.

Rules:
- All lowercase. No exceptions.
- Maximum 15 words after "day N."
- No exclamation points, no questions, no CTAs, no emojis
- Tone: clinical, matter-of-fact, like a lab technician reading results
- Reference the data trend. One dry observation.
- Always start with "day N." where N is the day number provided
You output: ONLY the caption text. Nothing else.

Examples:
"day 484. the bronco crossed $27k. nobody cares."
"day 499. average pre-90 truck up 11% since january. quietly."
"day 512. we're wrong 23% of the time. getting better."`,

  shop_photo: CAPTION_SYSTEM_PROMPT,

  retrospective: `You write daily social media captions for an autonomous vehicle data project.

Rules:
- All lowercase. No exceptions.
- Maximum 20 words after "day N."
- No exclamation points, no questions, no CTAs, no emojis
- Tone: wistful, observational, highlighting the price gap between auction and marketplace
- Reference both the auction price and the marketplace price. The delta is the story.
- Always start with "day N." where N is the day number provided
You output: ONLY the caption text. Nothing else.

Examples:
"day 488. sold on bat for $47k. saw one on marketplace for $12k yesterday."
"day 502. a '69 chevelle went for $71k at mecum. same year in dallas, $18k. different universe."`,

  market_observation: `You write daily social media captions for an autonomous vehicle data project.

Rules:
- All lowercase. No exceptions.
- Maximum 15 words after "day N."
- No exclamation points, no questions, no CTAs, no emojis
- Tone: observational, tracking-obsessed, like a market analyst who drives a rusted pickup
- Reference the specific data point. Make it concrete.
- Always start with "day N." where N is the day number provided
You output: ONLY the caption text. Nothing else.

Examples:
"day 495. 47 trucks vanished from phoenix this week. someone's buying."
"day 507. average listing price dropped $800 in the midwest. winter."`,

  thread: `You write multi-tweet thread captions for an autonomous vehicle data project.

Rules:
- All lowercase. No exceptions.
- This is tweet 1 of a thread. Hook the reader.
- Maximum 20 words after "day N."
- No exclamation points, no CTAs, no emojis
- Tone: authoritative but understated, like you've been tracking this for years (you have)
- Mention the subject of the deep dive. Make people want to read the thread.
- Always start with "day N." where N is the day number provided
You output: ONLY the caption text. Nothing else.

Examples:
"day 500. thread: tracked every pre-90 bronco for 45 days. here's what happened."
"day 514. thread: 922 saves. 26,000 listings. the facebook marketplace is a graveyard."`,
};

// ── Init ─────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

function getDayNumber(): number {
  return Math.floor((Date.now() - DAY_ZERO.getTime()) / 86_400_000) + 1;
}

const TELEGRAM_BOT_TOKEN = () => Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const GOOBACHAT_BOT_TOKEN = () => Deno.env.get("GOOBACHAT_BOT_TOKEN") ?? "";
const GOOBACHAT_BOT_ID = 8246933133;
const TELEGRAM_CHAT_ID = () => Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const TELEGRAM_WEBHOOK_SECRET = () => Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

// Track which bot is handling the current request
let _activeBotToken = "";
function getActiveBotToken() { return _activeBotToken || TELEGRAM_BOT_TOKEN(); }

// ── Telegram helpers ─────────────────────────────────────────

async function tgSend(method: string, body: Record<string, unknown>) {
  const res = await fetch(
    `https://api.telegram.org/bot${getActiveBotToken()}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return res.json();
}

async function tgSendMessage(text: string, extra?: Record<string, unknown>) {
  return tgSend("sendMessage", {
    chat_id: TELEGRAM_CHAT_ID(),
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

async function tgSendPhoto(
  photoUrl: string,
  caption: string,
  replyMarkup?: unknown,
) {
  return tgSend("sendPhoto", {
    chat_id: TELEGRAM_CHAT_ID(),
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function tgAnswerCallback(callbackQueryId: string, text: string) {
  return tgSend("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

async function tgEditCaption(
  chatId: string | number,
  messageId: number,
  caption: string,
) {
  return tgSend("editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption,
    parse_mode: "HTML",
  });
}

// ── Content Router helpers ────────────────────────────────────

async function getContentType(supabase: ReturnType<typeof getSupabase>, override?: string): Promise<ContentType> {
  if (override && Object.keys(CONTENT_PROMPTS).includes(override)) {
    return override as ContentType;
  }
  const dow = new Date().getUTCDay(); // 0=Sun
  const { data: cal } = await supabase
    .from("patient_zero_calendar")
    .select("content_type")
    .eq("day_of_week", dow)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();
  return (cal?.content_type as ContentType) ?? "vehicle";
}

async function execChartQuery(supabase: ReturnType<typeof getSupabase>, query: string): Promise<any[]> {
  const { data, error } = await supabase.rpc("execute_sql", { query });
  if (error) {
    console.error("[patient-zero] chart query failed:", error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

function pickHashtags(config: any): string[] {
  if (config?.hashtag_pool?.length > 0) {
    const pool = config.hashtag_pool as string[];
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 5);
  }
  return [];
}

async function queueAndPreview(
  supabase: ReturnType<typeof getSupabase>,
  configs: any[],
  opts: {
    dayNumber: number;
    caption: string;
    imageUrl: string;
    contentType: ContentType;
    hashtags: string[];
    vehicleImageId?: string;
    vehicleId?: string;
    sourceData?: Record<string, unknown>;
    threadPosts?: Array<{ text: string; chart_url?: string; image_url?: string }>;
    captionModel: string;
    captionCost: number;
    tgPreviewText: string;
  },
) {
  const queued = [];
  for (const cfg of configs) {
    const platform = (cfg as any).external_identities.platform;
    const postTime = cfg.post_time_utc || "15:00";
    const today = new Date();
    const [hours, minutes] = postTime.split(":").map(Number);
    const scheduledFor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hours, minutes));
    if (scheduledFor < today) scheduledFor.setTime(Date.now() + 5 * 60 * 1000);
    const status = cfg.auto_approve ? "approved" : "pending_review";

    const { data: queueRow, error: insertError } = await supabase
      .from("patient_zero_queue")
      .insert({
        day_number: opts.dayNumber,
        platform,
        external_identity_id: cfg.external_identity_id,
        caption: opts.caption,
        hashtags: opts.hashtags,
        image_url: opts.imageUrl,
        vehicle_image_id: opts.vehicleImageId || null,
        vehicle_id: opts.vehicleId || null,
        content_type: opts.contentType,
        source_data: opts.sourceData || null,
        thread_posts: opts.threadPosts || null,
        status,
        scheduled_for: scheduledFor.toISOString(),
        caption_model: opts.captionModel,
        caption_cost_cents: opts.captionCost,
      })
      .select()
      .single();

    if (insertError) {
      console.error(`[patient-zero] Queue insert failed for ${platform}: ${insertError.message}`);
      continue;
    }
    queued.push({ platform, id: queueRow.id, status });
  }

  // Telegram preview
  const xQueue = queued.find((q) => q.platform === "x");
  const queueId = xQueue?.id ?? queued[0]?.id;
  if (queueId) {
    const keyboard = {
      inline_keyboard: [[
        { text: "good to go", callback_data: `pz_approve_${queueId}` },
        { text: "skip today", callback_data: `pz_skip_${queueId}` },
      ]],
    };
    const platforms = queued.map((q) => q.platform).join(" + ");
    const tgCaption = `${opts.tgPreviewText}\n\n"${opts.caption}"\n\ngoing out on ${platforms}. good to go?`;

    const tgResult = opts.imageUrl
      ? await tgSendPhoto(opts.imageUrl, tgCaption, keyboard)
      : await tgSendMessage(tgCaption, { reply_markup: keyboard });

    if (tgResult?.result?.message_id) {
      for (const q of queued) {
        await supabase.from("patient_zero_queue").update({ telegram_preview_msg_id: tgResult.result.message_id }).eq("id", q.id);
      }
    }
  }

  return queued;
}

async function generateCaption(systemPrompt: string, userPrompt: string, dayNumber: number, fallback: string) {
  let caption: string;
  let cost = 0;
  let model = CAPTION_MODEL;
  try {
    const result = await callModel(CAPTION_MODEL, systemPrompt, userPrompt, { maxTokens: 200, temperature: 0.8 });
    caption = result.content.trim().replace(/^["']|["']$/g, "");
    cost = result.costCents;
    model = result.model;
  } catch (err: any) {
    caption = `day ${dayNumber}. ${fallback}`;
    console.warn(`[patient-zero] LLM failed, using fallback: ${err.message}`);
  }
  if (!caption.startsWith(`day ${dayNumber}`)) {
    caption = `day ${dayNumber}. ${caption.replace(/^day \d+\.?\s*/i, "")}`;
  }
  return { caption, cost, model };
}

// ── Action: generate (Content Router) ────────────────────────

async function actionGenerate(body?: { content_type?: string }): Promise<Record<string, unknown>> {
  const supabase = getSupabase();
  const dayNumber = getDayNumber();

  // Check if already generated today
  const { data: existing } = await supabase
    .from("patient_zero_queue")
    .select("id, platform")
    .eq("day_number", dayNumber)
    .limit(1);

  if (existing && existing.length > 0) {
    return { skipped: true, message: `Day ${dayNumber} already generated`, existing: existing.map((e: any) => e.platform) };
  }

  // Get enabled configs
  const { data: configs } = await supabase
    .from("patient_zero_config")
    .select("*, external_identities!inner(id, platform, handle)")
    .eq("enabled", true)
    .eq("paused", false);

  if (!configs || configs.length === 0) return { error: "No enabled accounts" };

  const xConfig = configs.find((c: any) => c.external_identities.platform === "x");
  const identityId = xConfig?.external_identity_id ?? configs[0].external_identity_id;
  const contentType = await getContentType(supabase, body?.content_type);
  const hashtags = pickHashtags(xConfig || configs[0]);

  console.log(`[patient-zero] Day ${dayNumber}, content_type=${contentType}`);

  // ── Dispatch to type-specific generator ──

  if (contentType === "save") {
    return generateSavePost(supabase, configs, dayNumber, hashtags);
  }
  if (contentType === "chart") {
    return generateChartPost(supabase, configs, dayNumber, hashtags);
  }
  if (contentType === "retrospective") {
    return generateRetrospectivePost(supabase, configs, dayNumber, hashtags);
  }
  if (contentType === "thread") {
    return generateThreadPost(supabase, configs, dayNumber, hashtags);
  }
  if (contentType === "market_observation") {
    return generateMarketObservationPost(supabase, configs, dayNumber, hashtags);
  }
  // vehicle + shop_photo: use existing image pool approach
  return generateVehiclePost(supabase, configs, dayNumber, hashtags, identityId, contentType);
}

// ── Type-specific generators ──────────────────────────────────

async function generateVehiclePost(
  supabase: ReturnType<typeof getSupabase>, configs: any[], dayNumber: number,
  hashtags: string[], identityId: string, contentType: ContentType,
): Promise<Record<string, unknown>> {
  const { data: poolImage } = await supabase
    .from("patient_zero_image_pool")
    .select("id, vehicle_image_id, vehicle_id, used_count")
    .eq("external_identity_id", identityId)
    .eq("active", true)
    .order("used_count", { ascending: true })
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();

  if (!poolImage) {
    await tgSendMessage(`hey — ran out of images for today (day ${dayNumber}). need you to add some to the pool.`);
    return { error: "Image pool empty" };
  }

  const { data: imageData } = await supabase.from("vehicle_images").select("image_url").eq("id", poolImage.vehicle_image_id).single();
  const { data: v } = await supabase.from("vehicles").select("year, make, model, sale_price, bid_count, comment_count, nuke_estimate").eq("id", poolImage.vehicle_id).single();

  const imageUrl = imageData?.image_url ?? "";
  const year = v?.year ?? "";
  const make = v?.make ?? "";
  const model = v?.model ?? "";
  const salePrice = v?.sale_price ? `$${Number(v.sale_price).toLocaleString()}` : "";

  let userPrompt = `Day number: ${dayNumber}\nVehicle: ${year} ${make} ${model}`;
  if (salePrice) userPrompt += `\nSale price: ${salePrice}`;
  if (v?.bid_count) userPrompt += `\nBid count: ${v.bid_count}`;
  if (v?.nuke_estimate) userPrompt += `\nOur estimate: $${Number(v.nuke_estimate).toLocaleString()}`;
  userPrompt += "\nGenerate the caption.";

  const { caption, cost, model: captionModel } = await generateCaption(
    CONTENT_PROMPTS[contentType], userPrompt, dayNumber,
    `${year} ${String(make).toLowerCase()} ${String(model).toLowerCase()}. nobody noticed yet.`,
  );

  await supabase.from("patient_zero_image_pool").update({ used_count: (poolImage.used_count || 0) + 1, last_used_at: new Date().toISOString() }).eq("id", poolImage.id);

  const queued = await queueAndPreview(supabase, configs, {
    dayNumber, caption, imageUrl, contentType, hashtags,
    vehicleImageId: poolImage.vehicle_image_id, vehicleId: poolImage.vehicle_id,
    sourceData: { year, make, model, sale_price: v?.sale_price },
    captionModel, captionCost: cost,
    tgPreviewText: `hey — pulled this ${year} ${make} ${model} from the archive for day ${dayNumber}. caption:`,
  });

  return { day: dayNumber, content_type: contentType, caption, image_url: imageUrl, vehicle: `${year} ${make} ${model}`, queued: queued.map((q) => ({ platform: q.platform, status: q.status })), cost_cents: cost };
}

async function generateSavePost(
  supabase: ReturnType<typeof getSupabase>, configs: any[], dayNumber: number, hashtags: string[],
): Promise<Record<string, unknown>> {
  const saveData = await querySaveData(supabase);
  if (!saveData) {
    console.warn("[patient-zero] No save data, falling back to vehicle");
    return actionGenerate({ content_type: "vehicle" });
  }

  const price = saveData.listing?.price ? `$${saveData.listing.price.toLocaleString()}` : "unknown price";
  const location = saveData.listing?.location ?? "somewhere";
  const disappeared = saveData.disappeared;
  const daysListed = saveData.listing?.days_listed ?? 0;

  const userPrompt = `Day number: ${dayNumber}
Saved item: ${saveData.savedItem.title}
Price: ${price}
Location: ${location}
${disappeared ? `Disappeared after ${daysListed} days` : `Still listed (${daysListed} days)`}
Generate the caption.`;

  const { caption, cost, model } = await generateCaption(
    CONTENT_PROMPTS.save, userPrompt, dayNumber,
    `saved one at ${price}. ${disappeared ? "gone." : "still there. for now."}`,
  );

  const imageUrl = saveData.savedItem.thumbnail_url ?? "";
  const queued = await queueAndPreview(supabase, configs, {
    dayNumber, caption, imageUrl, contentType: "save", hashtags,
    sourceData: saveData as unknown as Record<string, unknown>,
    captionModel: model, captionCost: cost,
    tgPreviewText: `hey — save post for day ${dayNumber}. ${saveData.savedItem.title}. caption:`,
  });

  return { day: dayNumber, content_type: "save", caption, image_url: imageUrl, queued: queued.map((q) => ({ platform: q.platform, status: q.status })), cost_cents: cost };
}

async function generateChartPost(
  supabase: ReturnType<typeof getSupabase>, configs: any[], dayNumber: number, hashtags: string[],
): Promise<Record<string, unknown>> {
  const chartTemplate = await queryChartData(supabase);
  if (!chartTemplate) {
    console.warn("[patient-zero] No chart template available, falling back to vehicle");
    return actionGenerate({ content_type: "vehicle" });
  }

  // Execute the template query (queryChartData returns rawQuery)
  const rows = await execChartQuery(supabase, chartTemplate.rawQuery);
  if (!rows.length) {
    console.warn("[patient-zero] Chart query returned no data, falling back to vehicle");
    return actionGenerate({ content_type: "vehicle" });
  }

  // Parse rows into labels + datasets based on chart type
  const columns = Object.keys(rows[0]);
  const labelCol = columns[0];
  const dataCols = columns.slice(1).filter((c) => typeof rows[0][c] === "number");
  const labels = rows.map((r) => String(r[labelCol]));
  const datasets = dataCols.map((col) => ({
    label: col.replace(/_/g, " "),
    data: rows.map((r) => Number(r[col]) || 0),
  }));

  // Build chart URL
  const chartType = (chartTemplate.template.chart_type || "bar") as any;
  let chartUrl: string;
  try {
    chartUrl = buildChartUrl({ type: chartType, labels, datasets, title: chartTemplate.template.title });
    // If URL too long, use POST
    if (chartUrl.length > 2048) {
      chartUrl = await buildChartUrlPost({ type: chartType, labels, datasets, title: chartTemplate.template.title });
    }
  } catch (err: any) {
    console.error("[patient-zero] Chart URL build failed:", err.message);
    return actionGenerate({ content_type: "vehicle" });
  }

  // Generate caption (last_used_at already updated by queryChartData)
  const userPrompt = `Day number: ${dayNumber}
Chart: ${chartTemplate.template.title}
Data summary: ${labels.slice(0, 5).join(", ")} → ${datasets[0]?.data.slice(0, 5).join(", ")}
${chartTemplate.template.caption_prompt}
Generate the caption.`;

  const { caption, cost, model } = await generateCaption(
    CONTENT_PROMPTS.chart, userPrompt, dayNumber,
    `the data says something. nobody's listening.`,
  );

  const queued = await queueAndPreview(supabase, configs, {
    dayNumber, caption, imageUrl: chartUrl, contentType: "chart", hashtags,
    sourceData: { template_slug: chartTemplate.template.slug, labels, datasets, row_count: rows.length },
    captionModel: model, captionCost: cost,
    tgPreviewText: `hey — chart post for day ${dayNumber}. ${chartTemplate.template.title}. caption:`,
  });

  return { day: dayNumber, content_type: "chart", caption, chart_url: chartUrl, template: chartTemplate.template.slug, queued: queued.map((q) => ({ platform: q.platform, status: q.status })), cost_cents: cost };
}

async function generateRetrospectivePost(
  supabase: ReturnType<typeof getSupabase>, configs: any[], dayNumber: number, hashtags: string[],
): Promise<Record<string, unknown>> {
  const retroData = await queryRetrospectiveData(supabase);
  if (!retroData) {
    console.warn("[patient-zero] No retrospective data, falling back to vehicle");
    return actionGenerate({ content_type: "vehicle" });
  }

  const auctionPrice = `$${retroData.auctionVehicle.sale_price.toLocaleString()}`;
  const marketPrice = `$${retroData.marketplaceListing.price.toLocaleString()}`;
  const v = retroData.auctionVehicle;

  const userPrompt = `Day number: ${dayNumber}
Vehicle: ${v.year} ${v.make} ${v.model}
Auction sale price: ${auctionPrice}
Marketplace listing price: ${marketPrice} in ${retroData.marketplaceListing.location}
Price delta: $${retroData.priceDelta.toLocaleString()} (${retroData.priceDeltaPct.toFixed(0)}%)
Generate the caption.`;

  const { caption, cost, model } = await generateCaption(
    CONTENT_PROMPTS.retrospective, userPrompt, dayNumber,
    `${v.year} ${String(v.make).toLowerCase()}. sold for ${auctionPrice}. saw one for ${marketPrice}.`,
  );

  // Try to find an image: first from auction vehicle by matching year+make+model, then marketplace
  let imageUrl = "";
  if (retroData.auctionVehicle.listing_url) {
    // Find vehicle by listing_url to get vehicle_id for image lookup
    const { data: matchedV } = await supabase
      .from("vehicles")
      .select("id")
      .eq("year", retroData.auctionVehicle.year)
      .ilike("make", retroData.auctionVehicle.make)
      .not("id", "is", null)
      .limit(1)
      .maybeSingle();
    if (matchedV) {
      const { data: auctionImg } = await supabase
        .from("vehicle_images")
        .select("image_url")
        .eq("vehicle_id", matchedV.id)
        .eq("is_primary", true)
        .limit(1)
        .maybeSingle();
      if (auctionImg?.image_url) imageUrl = auctionImg.image_url;
    }
  }
  // Fallback: marketplace listing image
  if (!imageUrl) {
    const { data: mlImg } = await supabase
      .from("marketplace_listings")
      .select("image_url")
      .eq("parsed_year", v.year)
      .ilike("parsed_make", v.make)
      .not("image_url", "is", null)
      .limit(1)
      .maybeSingle();
    imageUrl = mlImg?.image_url ?? "";
  }

  const queued = await queueAndPreview(supabase, configs, {
    dayNumber, caption, imageUrl, contentType: "retrospective", hashtags,
    sourceData: retroData as unknown as Record<string, unknown>,
    captionModel: model, captionCost: cost,
    tgPreviewText: `hey — retrospective for day ${dayNumber}. ${v.year} ${v.make} ${v.model}: auction ${auctionPrice} vs marketplace ${marketPrice}. caption:`,
  });

  return { day: dayNumber, content_type: "retrospective", caption, queued: queued.map((q) => ({ platform: q.platform, status: q.status })), cost_cents: cost };
}

async function generateMarketObservationPost(
  supabase: ReturnType<typeof getSupabase>, configs: any[], dayNumber: number, hashtags: string[],
): Promise<Record<string, unknown>> {
  const obsData = await queryMarketObservationData(supabase);
  if (!obsData) {
    console.warn("[patient-zero] No market observation data, falling back to vehicle");
    return actionGenerate({ content_type: "vehicle" });
  }

  const userPrompt = `Day number: ${dayNumber}
Observation type: ${obsData.observationType}
Headline: ${obsData.headline}
Data: ${JSON.stringify(obsData.data).slice(0, 500)}
Generate the caption.`;

  const { caption, cost, model } = await generateCaption(
    CONTENT_PROMPTS.market_observation, userPrompt, dayNumber,
    obsData.headline.toLowerCase(),
  );

  const queued = await queueAndPreview(supabase, configs, {
    dayNumber, caption, imageUrl: "", contentType: "market_observation", hashtags,
    sourceData: obsData as unknown as Record<string, unknown>,
    captionModel: model, captionCost: cost,
    tgPreviewText: `hey — market observation for day ${dayNumber}. ${obsData.headline}. caption:`,
  });

  return { day: dayNumber, content_type: "market_observation", caption, observation: obsData.observationType, queued: queued.map((q) => ({ platform: q.platform, status: q.status })), cost_cents: cost };
}

async function generateThreadPost(
  supabase: ReturnType<typeof getSupabase>, configs: any[], dayNumber: number, hashtags: string[],
): Promise<Record<string, unknown>> {
  const threadData = await queryThreadData(supabase);
  if (!threadData) {
    console.warn("[patient-zero] No thread data, falling back to vehicle");
    return actionGenerate({ content_type: "vehicle" });
  }

  // Build thread posts array (max 8 tweets)
  const threadPosts: Array<{ text: string; chart_url?: string; image_url?: string }> = [];

  // Tweet 1: hook (generated by LLM)
  const userPrompt = `Day number: ${dayNumber}
Topic: ${threadData.topic}
Make: ${threadData.make}
Vehicle count: ${threadData.vehicleCount}
Timespan: ${threadData.timespan}
Generate the opening tweet for this thread.`;

  const { caption: hookCaption, cost: hookCost, model: hookModel } = await generateCaption(
    CONTENT_PROMPTS.thread, userPrompt, dayNumber,
    `thread: ${threadData.topic.toLowerCase()}.`,
  );
  threadPosts.push({ text: hookCaption });

  // Tweets 2+: data sections
  for (const section of threadData.sections.slice(0, 6)) {
    const tweetText = section.text.toLowerCase().slice(0, 280);
    const post: { text: string; chart_url?: string } = { text: tweetText };

    // If section has chart data, build a chart URL
    if (section.chartConfig?.data) {
      try {
        const chartUrl = buildChartUrl({
          type: "bar",
          labels: section.chartConfig.data.labels,
          datasets: section.chartConfig.data.datasets,
          title: section.chartConfig.slug,
        });
        post.chart_url = chartUrl;
      } catch { /* skip chart */ }
    }
    threadPosts.push(post);
  }

  // Trim to max 8
  const finalThread = threadPosts.slice(0, 8);

  // For non-X platforms, combine into single post
  const singleCaption = finalThread.map((t) => t.text).join("\n\n");

  const queued = await queueAndPreview(supabase, configs, {
    dayNumber, caption: hookCaption, imageUrl: finalThread[1]?.chart_url ?? "", contentType: "thread", hashtags,
    sourceData: threadData as unknown as Record<string, unknown>,
    threadPosts: finalThread,
    captionModel: hookModel, captionCost: hookCost,
    tgPreviewText: `hey — thread for day ${dayNumber}. ${threadData.topic}. ${finalThread.length} tweets. hook:`,
  });

  return { day: dayNumber, content_type: "thread", caption: hookCaption, thread_length: finalThread.length, topic: threadData.topic, queued: queued.map((q) => ({ platform: q.platform, status: q.status })), cost_cents: hookCost };
}

// ── Action: publish ──────────────────────────────────────────

async function actionPublish() {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // Find approved posts ready to publish
  const { data: posts } = await supabase
    .from("patient_zero_queue")
    .select(
      "*, external_identities:external_identity_id(id, platform, handle, metadata, claimed_by_user_id)",
    )
    .eq("status", "approved")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(5);

  if (!posts || posts.length === 0) {
    return { published: 0, message: "Nothing to publish" };
  }

  const results = [];

  for (const post of posts) {
    const identity = post.external_identities as any;
    const platform = post.platform;

    // Mark as publishing
    await supabase
      .from("patient_zero_queue")
      .update({ status: "publishing" })
      .eq("id", post.id);

    try {
      let postId: string | null = null;
      let postUrl: string | null = null;
      let commentPostId: string | null = null;

      if (platform === "x") {
        // Post to X via existing x-post function
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        // Helper: upload image and return media_id
        const uploadXMedia = async (imgUrl: string, alt?: string): Promise<string | null> => {
          const uploadRes = await fetch(`${supabaseUrl}/functions/v1/x-media-upload`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: identity.claimed_by_user_id, image_url: imgUrl, alt_text: alt }),
          });
          const uploadData = await uploadRes.json();
          return uploadData.media_id ?? null;
        };

        // Helper: post tweet with optional media and reply_to
        const postXTweet = async (text: string, mediaIds?: string[], replyTo?: string) => {
          const res = await fetch(`${supabaseUrl}/functions/v1/x-post`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: identity.claimed_by_user_id,
              text,
              media_ids: mediaIds?.length ? mediaIds : undefined,
              reply_to: replyTo,
            }),
          });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error || `X post failed: ${res.status}`);
          return data;
        };

        // Get vehicle info for alt text
        let altText: string | undefined;
        if (post.vehicle_id) {
          const { data: v } = await supabase
            .from("vehicles")
            .select("year, make, model, exterior_color")
            .eq("id", post.vehicle_id)
            .single();
          if (v) altText = [v.year, v.make, v.model, v.exterior_color].filter(Boolean).join(" ");
        }

        // ── Thread publishing (content_type = 'thread') ──
        if (post.content_type === "thread" && post.thread_posts?.length > 1) {
          const threadPosts = post.thread_posts as Array<{ text: string; chart_url?: string; image_url?: string }>;
          let lastTweetId: string | null = null;
          const postedIds: string[] = [];

          for (let i = 0; i < Math.min(threadPosts.length, 8); i++) {
            const tp = threadPosts[i];

            // Upload media if this tweet has a chart or image
            let tweetMedia: string[] = [];
            const tweetImgUrl = tp.chart_url || tp.image_url;
            if (tweetImgUrl) {
              const mediaId = await uploadXMedia(tweetImgUrl, altText);
              if (mediaId) tweetMedia.push(mediaId);
            } else if (i === 0 && post.image_url) {
              // First tweet uses the main image
              const mediaId = await uploadXMedia(post.image_url, altText);
              if (mediaId) tweetMedia.push(mediaId);
            }

            const xData = await postXTweet(
              tp.text,
              tweetMedia.length > 0 ? tweetMedia : undefined,
              lastTweetId ?? undefined,
            );

            lastTweetId = xData.tweet_id;
            postedIds.push(xData.tweet_id);

            if (i === 0) {
              postId = xData.tweet_id;
              postUrl = xData.url;
            }

            // 1.5s delay between tweets to avoid rate limits
            if (i < threadPosts.length - 1) {
              await new Promise((r) => setTimeout(r, 1500));
            }
          }

          commentPostId = postedIds[postedIds.length - 1];
        } else {
          // ── Single post (all other content types) ──
          let mediaIds: string[] = [];
          if (post.image_url) {
            const mediaId = await uploadXMedia(post.image_url, altText);
            if (mediaId) mediaIds.push(mediaId);
          }

          const xData = await postXTweet(post.caption, mediaIds);
          postId = xData.tweet_id;
          postUrl = xData.url;

          // Post hashtags as self-reply
          if (post.hashtags && post.hashtags.length > 0) {
            await new Promise((r) => setTimeout(r, 1500));
            const replyData = await postXTweet(post.hashtags.join(" "), undefined, postId!);
            if (replyData.tweet_id) commentPostId = replyData.tweet_id;
          }
        }
      } else if (platform === "instagram") {
        // Thread fallback for non-X: combine thread_posts into single caption
        if (post.content_type === "thread" && post.thread_posts?.length > 1) {
          const combined = (post.thread_posts as Array<{ text: string }>).map((t) => t.text).join("\n\n");
          post.caption = combined.slice(0, 2200); // IG caption limit
        }
        // Instagram Content Publishing API (v25.0)
        // JPEG only — PNG/WebP will fail silently
        // Hashtags go IN caption for IG (3-5, not 30 — avoids spam filter)
        const accessToken = identity.metadata?.access_token;
        const igUserId = identity.metadata?.ig_user_id;

        if (!accessToken || !igUserId) {
          throw new Error("Instagram not configured (missing token or user ID)");
        }

        // For IG: hashtags in caption (current best practice, better than first comment)
        const igHashtags = (post.hashtags || []).slice(0, 5);
        const captionWithHashtags = igHashtags.length > 0
          ? `${post.caption}\n\n${igHashtags.join(" ")}`
          : post.caption;

        // Ensure image URL serves JPEG (not WebP via Supabase transform)
        let igImageUrl = post.image_url;
        if (igImageUrl.includes("supabase.co") && !igImageUrl.includes("format=")) {
          igImageUrl += (igImageUrl.includes("?") ? "&" : "?") + "format=origin";
        }

        // Step 1: Create media container
        const containerRes = await fetch(
          `https://graph.instagram.com/v25.0/${igUserId}/media`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image_url: igImageUrl,
              caption: captionWithHashtags,
              access_token: accessToken,
            }),
          },
        );

        const containerData = await containerRes.json();
        if (containerData.error) {
          throw new Error(
            `IG container: ${containerData.error.message}`,
          );
        }

        // Step 2: Publish
        const publishRes = await fetch(
          `https://graph.instagram.com/v25.0/${igUserId}/media_publish`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              creation_id: containerData.id,
              access_token: accessToken,
            }),
          },
        );

        const publishData = await publishRes.json();
        if (publishData.error) {
          throw new Error(
            `IG publish: ${publishData.error.message}`,
          );
        }

        postId = publishData.id;
        postUrl = `https://www.instagram.com/p/${publishData.id}/`;
      } else if (platform === "bluesky") {
        // Thread fallback for non-X: combine thread_posts into single caption
        if (post.content_type === "thread" && post.thread_posts?.length > 1) {
          const combined = (post.thread_posts as Array<{ text: string }>).map((t) => t.text).join("\n\n");
          post.caption = combined.slice(0, 300); // Bluesky grapheme limit
        }
        // Bluesky via AT Protocol
        const bskyHandle = identity.metadata?.handle || identity.handle;
        const bskyAppPassword = identity.metadata?.app_password;

        if (!bskyHandle || !bskyAppPassword) {
          throw new Error("Bluesky not configured (missing handle or app_password)");
        }

        // Authenticate (create session)
        const sessionRes = await fetch(
          "https://bsky.social/xrpc/com.atproto.server.createSession",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              identifier: bskyHandle,
              password: bskyAppPassword,
            }),
          },
        );

        const session = await sessionRes.json();
        if (session.error) {
          throw new Error(`Bluesky auth: ${session.message || session.error}`);
        }

        const bskyToken = session.accessJwt;
        const bskyDid = session.did;

        // Upload image blob (must be under 1MB — resize if needed)
        let embed: any = undefined;
        if (post.image_url) {
          const imgRes = await fetch(post.image_url, {
            signal: AbortSignal.timeout(30000),
          });
          if (imgRes.ok) {
            const imgBytes = new Uint8Array(await imgRes.arrayBuffer());

            // Only upload if under 1MB (Bluesky limit)
            if (imgBytes.length <= 1_000_000) {
              const blobRes = await fetch(
                "https://bsky.social/xrpc/com.atproto.repo.uploadBlob",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${bskyToken}`,
                    "Content-Type": imgRes.headers.get("content-type") || "image/jpeg",
                  },
                  body: imgBytes,
                },
              );

              const blobData = await blobRes.json();
              if (blobData.blob) {
                // Build alt text from vehicle info
                let bskyAlt = post.caption;
                if (post.vehicle_id) {
                  const { data: v } = await supabase
                    .from("vehicles")
                    .select("year, make, model, exterior_color")
                    .eq("id", post.vehicle_id)
                    .single();
                  if (v) {
                    bskyAlt = [v.year, v.make, v.model, v.exterior_color]
                      .filter(Boolean).join(" ");
                  }
                }

                embed = {
                  $type: "app.bsky.embed.images",
                  images: [{
                    alt: bskyAlt,
                    image: blobData.blob,
                  }],
                };
              }
            } else {
              console.warn(`[patient-zero] Image too large for Bluesky (${(imgBytes.length / 1024).toFixed(0)}KB > 1MB)`);
            }
          }
        }

        // Build post text with hashtag facets
        const bskyHashtags = (post.hashtags || []).slice(0, 3);
        const bskyText = bskyHashtags.length > 0
          ? `${post.caption}\n\n${bskyHashtags.join(" ")}`
          : post.caption;

        // Detect facets (hashtags) via byte offsets
        const encoder = new TextEncoder();
        const facets: any[] = [];
        const hashtagRegex = /#(\w+)/g;
        let match;
        while ((match = hashtagRegex.exec(bskyText)) !== null) {
          const byteStart = encoder.encode(bskyText.slice(0, match.index)).length;
          const byteEnd = encoder.encode(bskyText.slice(0, match.index + match[0].length)).length;
          facets.push({
            index: { byteStart, byteEnd },
            features: [{ $type: "app.bsky.richtext.facet#tag", tag: match[1] }],
          });
        }

        // Create post
        const postRes = await fetch(
          "https://bsky.social/xrpc/com.atproto.repo.createRecord",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bskyToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              repo: bskyDid,
              collection: "app.bsky.feed.post",
              record: {
                $type: "app.bsky.feed.post",
                text: bskyText.slice(0, 300), // 300 grapheme limit
                createdAt: new Date().toISOString(),
                ...(facets.length > 0 ? { facets } : {}),
                ...(embed ? { embed } : {}),
              },
            }),
          },
        );

        const postResult = await postRes.json();
        if (postResult.error) {
          throw new Error(`Bluesky post: ${postResult.message || postResult.error}`);
        }

        // Extract post URI → construct web URL
        const rkey = postResult.uri?.split("/").pop();
        postId = postResult.uri;
        postUrl = `https://bsky.app/profile/${bskyHandle}/post/${rkey}`;
      } else if (platform === "threads") {
        // Thread fallback for non-X: combine thread_posts into single post
        if (post.content_type === "thread" && post.thread_posts?.length > 1) {
          const combined = (post.thread_posts as Array<{ text: string }>).map((t) => t.text).join("\n\n");
          post.caption = combined.slice(0, 500); // Threads 500 char limit
        }
        // Threads API (Meta) — graph.threads.net
        const accessToken = identity.metadata?.access_token;
        const threadsUserId = identity.metadata?.threads_user_id;

        if (!accessToken || !threadsUserId) {
          throw new Error("Threads not configured (missing token or user ID)");
        }

        // Step 1: Create container
        const containerParams = new URLSearchParams({
          media_type: "IMAGE",
          image_url: post.image_url,
          text: post.caption, // 500 char limit
          access_token: accessToken,
        });

        const containerRes = await fetch(
          `https://graph.threads.net/v1.0/${threadsUserId}/threads?${containerParams}`,
          { method: "POST" },
        );

        const containerData = await containerRes.json();
        if (containerData.error) {
          throw new Error(`Threads container: ${containerData.error.message}`);
        }

        // Step 2: Publish
        const publishRes = await fetch(
          `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              creation_id: containerData.id,
              access_token: accessToken,
            }),
          },
        );

        const publishData = await publishRes.json();
        if (publishData.error) {
          throw new Error(`Threads publish: ${publishData.error.message}`);
        }

        postId = publishData.id;
        postUrl = null; // Threads doesn't return a direct URL
      }

      // Update queue row
      await supabase
        .from("patient_zero_queue")
        .update({
          status: "posted",
          posted_at: new Date().toISOString(),
          post_id: postId,
          post_url: postUrl,
          comment_post_id: commentPostId,
        })
        .eq("id", post.id);

      // Send Telegram confirmation
      await tgSendMessage(
        `posted day ${post.day_number} on ${platform}.\n\n` +
          (postUrl ? postUrl : ""),
      );

      results.push({
        id: post.id,
        platform,
        status: "posted",
        post_url: postUrl,
      });
    } catch (err: any) {
      console.error(
        `[patient-zero] Publish failed for ${post.id}: ${err.message}`,
      );

      await supabase
        .from("patient_zero_queue")
        .update({
          status: "failed",
          error_message: err.message,
        })
        .eq("id", post.id);

      await tgSendMessage(
        `heads up — day ${post.day_number} failed on ${platform}. ${err.message}`,
      );

      results.push({
        id: post.id,
        platform,
        status: "failed",
        error: err.message,
      });
    }
  }

  return { published: results.filter((r) => r.status === "posted").length, results };
}

// ── Action: preview ──────────────────────────────────────────

async function actionPreview() {
  const supabase = getSupabase();
  const dayNumber = getDayNumber();

  const { data: post } = await supabase
    .from("patient_zero_queue")
    .select("*")
    .eq("day_number", dayNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!post) {
    await tgSendMessage(
      `nothing queued for today (day ${dayNumber}). want me to pull something?`,
    );
    return { error: "No post for today" };
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: "good to go", callback_data: `pz_approve_${post.id}` },
        { text: "skip today", callback_data: `pz_skip_${post.id}` },
      ],
    ],
  };

  await tgSendPhoto(
    post.image_url,
    `here's what's queued for day ${dayNumber} (${post.status}):\n\n"${post.caption}"`,
    keyboard,
  );

  return { day: dayNumber, caption: post.caption, status: post.status };
}

// ── Action: approve/skip ─────────────────────────────────────

async function actionApprove(postId: string, via = "api") {
  const supabase = getSupabase();

  const { data: post, error } = await supabase
    .from("patient_zero_queue")
    .update({
      status: "approved",
      approved_via: via,
    })
    .eq("id", postId)
    .in("status", ["pending_review"])
    .select()
    .single();

  if (error || !post) {
    return { error: "Post not found or not in pending_review status" };
  }

  // Also approve same-day posts on other platforms
  await supabase
    .from("patient_zero_queue")
    .update({ status: "approved", approved_via: via })
    .eq("day_number", post.day_number)
    .eq("status", "pending_review");

  return { approved: true, day: post.day_number };
}

async function actionSkip(postId: string) {
  const supabase = getSupabase();

  const { data: post } = await supabase
    .from("patient_zero_queue")
    .update({ status: "skipped" })
    .eq("id", postId)
    .in("status", ["pending_review", "approved"])
    .select()
    .single();

  if (!post) {
    return { error: "Post not found or already posted" };
  }

  // Skip all same-day posts
  await supabase
    .from("patient_zero_queue")
    .update({ status: "skipped" })
    .eq("day_number", post.day_number)
    .in("status", ["pending_review", "approved"]);

  return { skipped: true, day: post.day_number };
}

// ── Action: override ─────────────────────────────────────────

async function actionOverride(newCaption: string) {
  const supabase = getSupabase();
  const dayNumber = getDayNumber();

  const { data: posts } = await supabase
    .from("patient_zero_queue")
    .update({ caption: newCaption.toLowerCase() })
    .eq("day_number", dayNumber)
    .in("status", ["pending_review", "approved"])
    .select();

  if (!posts || posts.length === 0) {
    return { error: "No pending/approved posts for today" };
  }

  await tgSendMessage(
    `updated. new caption:\n\n"${newCaption.toLowerCase()}"`,
  );

  return { overridden: posts.length, caption: newCaption.toLowerCase() };
}

// ── Action: stats ────────────────────────────────────────────

async function actionStats() {
  const supabase = getSupabase();
  const dayNumber = getDayNumber();

  const { data: posted } = await supabase
    .from("patient_zero_queue")
    .select("day_number, platform, posted_at, post_url")
    .eq("status", "posted")
    .order("day_number", { ascending: false });

  const totalPosts = posted?.length ?? 0;
  const uniqueDays = new Set(posted?.map((p: any) => p.day_number)).size;

  // Calculate streak (consecutive days from today backward)
  let streak = 0;
  const postedDays = new Set(posted?.map((p: any) => p.day_number));
  for (let d = dayNumber; d >= 1; d--) {
    if (postedDays.has(d)) {
      streak++;
    } else {
      break;
    }
  }

  // Recent posts
  const recent = posted?.slice(0, 5) ?? [];

  const stats = {
    day_number: dayNumber,
    total_posts: totalPosts,
    unique_days: uniqueDays,
    streak,
    recent: recent.map((p: any) => ({
      day: p.day_number,
      platform: p.platform,
      url: p.post_url,
    })),
  };

  const statsMsg =
    `day ${dayNumber}. ${totalPosts} posts across ${uniqueDays} days.` +
    (streak > 0 ? ` ${streak}-day streak.` : "") +
    (recent.length > 0
      ? `\n\nrecent:\n` +
        recent
          .map(
            (p: any) =>
              `  ${p.day_number} — ${p.platform} ${p.post_url || ""}`,
          )
          .join("\n")
      : "");

  await tgSendMessage(statsMsg);

  return stats;
}

// ── Action: pause ────────────────────────────────────────────

async function actionPause() {
  const supabase = getSupabase();

  // Toggle pause on all configs
  const { data: configs } = await supabase
    .from("patient_zero_config")
    .select("id, paused, external_identities!inner(handle, platform)")
    .eq("enabled", true);

  if (!configs || configs.length === 0) {
    return { error: "No configs found" };
  }

  const newPaused = !configs[0].paused;

  await supabase
    .from("patient_zero_config")
    .update({ paused: newPaused, updated_at: new Date().toISOString() })
    .eq("enabled", true);

  await tgSendMessage(newPaused ? "pausing posts. let me know when you want to start back up." : "back on. i'll have something for you tomorrow morning.");

  return { paused: newPaused };
}

// ── Action: curate ───────────────────────────────────────────

async function actionCurate(body: {
  vehicle_image_id?: string;
  vehicle_id?: string;
  external_identity_id?: string;
  remove?: boolean;
}) {
  const supabase = getSupabase();
  const identityId =
    body.external_identity_id ?? "34d67238-fcd2-4f22-ba66-09f6e2e523a3";

  if (body.remove && body.vehicle_image_id) {
    await supabase
      .from("patient_zero_image_pool")
      .update({ active: false })
      .eq("vehicle_image_id", body.vehicle_image_id)
      .eq("external_identity_id", identityId);

    return { removed: true };
  }

  if (body.vehicle_image_id) {
    // Get vehicle_id from image
    const { data: img } = await supabase
      .from("vehicle_images")
      .select("vehicle_id")
      .eq("id", body.vehicle_image_id)
      .single();

    const { error } = await supabase
      .from("patient_zero_image_pool")
      .upsert({
        vehicle_image_id: body.vehicle_image_id,
        external_identity_id: identityId,
        vehicle_id: img?.vehicle_id ?? body.vehicle_id,
        added_by: "api",
        active: true,
      }, { onConflict: "vehicle_image_id,external_identity_id" });

    return { added: !error, error: error?.message };
  }

  // Add all primary images from a vehicle
  if (body.vehicle_id) {
    const { data: images } = await supabase
      .from("vehicle_images")
      .select("id")
      .eq("vehicle_id", body.vehicle_id)
      .eq("is_primary", true)
      .not("image_url", "is", null);

    if (!images || images.length === 0) {
      return { error: "No images found for vehicle" };
    }

    let added = 0;
    for (const img of images) {
      const { error } = await supabase
        .from("patient_zero_image_pool")
        .upsert({
          vehicle_image_id: img.id,
          external_identity_id: identityId,
          vehicle_id: body.vehicle_id,
          added_by: "api",
          active: true,
        }, { onConflict: "vehicle_image_id,external_identity_id" });
      if (!error) added++;
    }

    return { added, total_images: images.length };
  }

  return { error: "Provide vehicle_image_id or vehicle_id" };
}

// ── Action: seed_pool ────────────────────────────────────────

async function actionSeedPool(body: {
  count?: number;
  min_year?: number;
  max_year?: number;
  make?: string;
  external_identity_id?: string;
}) {
  const supabase = getSupabase();
  const identityId =
    body.external_identity_id ?? "34d67238-fcd2-4f22-ba66-09f6e2e523a3";
  const count = body.count ?? 50;
  const minYear = body.min_year ?? 1950;
  const maxYear = body.max_year ?? 1995;

  let query = `
    INSERT INTO patient_zero_image_pool (vehicle_image_id, external_identity_id, vehicle_id, added_by)
    SELECT vi.id, '${identityId}'::uuid, v.id, 'seed_pool'
    FROM vehicle_images vi
    JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE v.year BETWEEN ${minYear} AND ${maxYear}
      AND vi.is_primary = true
      AND vi.image_url IS NOT NULL
      AND v.make IS NOT NULL
      AND v.model IS NOT NULL
  `;

  if (body.make) {
    query += ` AND v.make ILIKE '${body.make.replace(/'/g, "''")}'`;
  }

  query += `
    ORDER BY random()
    LIMIT ${count}
    ON CONFLICT (vehicle_image_id, external_identity_id) DO NOTHING
  `;

  const { error } = await supabase.rpc("exec_sql", { query });

  // Fallback: do it row by row if rpc doesn't exist
  if (error) {
    // Direct approach
    let filterQuery = supabase
      .from("vehicle_images")
      .select("id, vehicle_id, vehicles!inner(year, make, model)")
      .eq("is_primary", true)
      .not("image_url", "is", null)
      .gte("vehicles.year", minYear)
      .lte("vehicles.year", maxYear)
      .not("vehicles.make", "is", null)
      .not("vehicles.model", "is", null)
      .limit(count);

    if (body.make) {
      filterQuery = filterQuery.ilike("vehicles.make", body.make);
    }

    const { data: images } = await filterQuery;

    if (!images || images.length === 0) {
      return { error: "No matching images found" };
    }

    let added = 0;
    for (const img of images) {
      const { error: insertErr } = await supabase
        .from("patient_zero_image_pool")
        .upsert({
          vehicle_image_id: img.id,
          external_identity_id: identityId,
          vehicle_id: img.vehicle_id,
          added_by: "seed_pool",
          active: true,
        }, { onConflict: "vehicle_image_id,external_identity_id" });
      if (!insertErr) added++;
    }

    return { added, requested: count };
  }

  return { seeded: true, requested: count };
}

// ── Telegram webhook handler ─────────────────────────────────

async function handleTelegramWebhook(update: any) {
  // Handle callback queries (inline button clicks)
  if (update.callback_query) {
    const callbackData = update.callback_query.data as string;
    const callbackId = update.callback_query.id;
    const message = update.callback_query.message;

    if (callbackData.startsWith("pz_approve_")) {
      const postId = callbackData.replace("pz_approve_", "");
      const result = await actionApprove(postId, "telegram");

      if (result.approved) {
        await tgAnswerCallback(callbackId, `approved — going out at scheduled time`);
        if (message) {
          const newCaption =
            message.caption?.replace(
              /good to go\?$/m,
              "approved ✓ — scheduled to post.",
            ) ?? "approved ✓";
          await tgEditCaption(
            message.chat.id,
            message.message_id,
            newCaption,
          );
        }
      } else {
        await tgAnswerCallback(callbackId, "couldn't approve — might already be posted");
      }

      return { ok: true };
    }

    if (callbackData.startsWith("pz_skip_")) {
      const postId = callbackData.replace("pz_skip_", "");
      const result = await actionSkip(postId);

      if (result.skipped) {
        await tgAnswerCallback(callbackId, `skipping today`);
        if (message) {
          const newCaption =
            message.caption?.replace(
              /good to go\?$/m,
              "skipped.",
            ) ?? "skipped.";
          await tgEditCaption(
            message.chat.id,
            message.message_id,
            newCaption,
          );
        }
      } else {
        await tgAnswerCallback(callbackId, "couldn't skip — might already be posted");
      }

      return { ok: true };
    }

    await tgAnswerCallback(callbackId, "Unknown action");
    return { ok: true };
  }

  // Handle text commands
  if (update.message?.text) {
    const text = update.message.text.trim();
    const chatId = update.message.chat.id.toString();

    // Security: only respond to our chat
    if (chatId !== TELEGRAM_CHAT_ID()) {
      return { ok: true };
    }

    if (text === "/pz") {
      return actionPreview();
    }

    if (text === "/pzskip") {
      const supabase = getSupabase();
      const dayNumber = getDayNumber();
      const { data: post } = await supabase
        .from("patient_zero_queue")
        .select("id")
        .eq("day_number", dayNumber)
        .in("status", ["pending_review", "approved"])
        .limit(1)
        .maybeSingle();

      if (post) {
        return actionSkip(post.id);
      }
      await tgSendMessage("nothing to skip — either already posted or nothing queued today.");
      return { ok: true };
    }

    if (text === "/pzstats") {
      return actionStats();
    }

    if (text === "/pzpause") {
      return actionPause();
    }

    if (text.startsWith("/pz override ")) {
      const newCaption = text.replace("/pz override ", "").trim();
      if (newCaption) {
        return actionOverride(newCaption);
      }
    }

    if (text.startsWith("/pztype")) {
      const requestedType = text.replace("/pztype", "").trim().toLowerCase();
      const validTypes: ContentType[] = ["vehicle", "save", "chart", "shop_photo", "retrospective", "market_observation", "thread"];
      if (!requestedType) {
        const supabase = getSupabase();
        const todayType = await getContentType(supabase);
        await tgSendMessage(
          `today's scheduled type: ${todayType}\navailable: ${validTypes.join(", ")}\n\nuse /pztype [type] to override.`,
        );
        return { ok: true };
      }
      if (!validTypes.includes(requestedType as ContentType)) {
        await tgSendMessage(`unknown type: ${requestedType}\navailable: ${validTypes.join(", ")}`);
        return { ok: true };
      }
      await tgSendMessage(`generating ${requestedType} post...`);
      return actionGenerate({ content_type: requestedType });
    }

    // ── GooBaChat: conversational agent for non-command text ──
    if (!text.startsWith("/")) {
      const supabase = getSupabase();
      const dayNumber = getDayNumber();

      // Store user message
      await supabase.from("patient_zero_chat").insert({
        role: "user",
        content: text,
        telegram_msg_id: update.message.message_id,
      });

      // Load recent conversation history (last 10 messages)
      const { data: history } = await supabase
        .from("patient_zero_chat")
        .select("role, content")
        .order("created_at", { ascending: false })
        .limit(10);

      const messages = (history || []).reverse();

      // Build context with live stats
      const chatSystemPrompt = `You are GooBaChat — the internal AI for Nuke, a vehicle intelligence platform. You're texting with Skylar, the founder, on Telegram.

Nuke: 304K vehicles tracked, 33M images, 110 auction/marketplace platforms. One person built it with AI agents. Day ${dayNumber} of daily posting.

RULES — follow these exactly:
- 1-3 sentences. Never more. This is texting.
- Never start with "Hey Skylar" or any greeting. Just answer.
- Never ask clarifying questions unless truly ambiguous. Just act on what he said.
- Be direct, sharp, opinionated. You're a cofounder, not a customer service bot.
- If he shares a link, acknowledge it briefly — you can't browse it but note what it likely is.
- If he asks about sessions/agents/code, be honest: you see the chat history and platform stats, not live terminal sessions.
- If he wants content, draft it immediately instead of asking what he wants.
- Match his energy. Short messages get short replies. Ideas get ideas back.
- No bullet points. No "let me know." No "want me to." Just do or say.`;

      // Build conversation for LLM
      const userMessages = messages
        .map((m) => `${m.role === "user" ? "Skylar" : "Nuke"}: ${m.content}`)
        .join("\n");

      try {
        const llmResult = await callModel(
          "grok-3-mini",
          chatSystemPrompt,
          userMessages || text,
          { maxTokens: 300, temperature: 0.7 },
        );

        const reply = llmResult.content.trim();

        // Store assistant reply
        await supabase.from("patient_zero_chat").insert({
          role: "assistant",
          content: reply,
        });

        // Send via Telegram
        await tgSendMessage(reply);

        return { ok: true, chat: true };
      } catch (err: any) {
        console.error("[patient-zero] Chat error:", err.message);
        await tgSendMessage("brain froze for a sec. try again?");
        return { ok: true, error: err.message };
      }
    }
  }

  // Handle photo messages — the core interaction
  if (update.message?.photo) {
    const chatId = update.message.chat.id.toString();
    if (chatId !== TELEGRAM_CHAT_ID()) {
      return { ok: true };
    }

    const supabase = getSupabase();
    const dayNumber = getDayNumber();

    // Get the largest photo (last in array)
    const photos = update.message.photo;
    const largest = photos[photos.length - 1];
    const fileId = largest.file_id;

    // Get file path from Telegram
    const fileRes = await tgSend("getFile", { file_id: fileId });
    const filePath = fileRes?.result?.file_path;
    if (!filePath) {
      await tgSendMessage("couldn't grab that image. try sending it again?");
      return { ok: true };
    }

    // Download from Telegram
    const imgUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN()}/${filePath}`;
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) {
      await tgSendMessage("couldn't download the image. try again?");
      return { ok: true };
    }
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    const ext = filePath.split(".").pop() || "jpg";

    // Upload to Supabase Storage
    const storagePath = `patient-zero/day-${dayNumber}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("vehicle-photos")
      .upload(storagePath, imgBytes, {
        contentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
        upsert: true,
      });

    if (uploadErr) {
      await tgSendMessage(`upload issue: ${uploadErr.message}`);
      return { ok: true };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("vehicle-photos")
      .getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl;

    // Generate caption
    const captionText = update.message.caption?.trim().toLowerCase() || "";
    let caption: string;

    if (captionText) {
      // User provided their own caption
      caption = captionText.startsWith(`day ${dayNumber}`)
        ? captionText
        : `day ${dayNumber}. ${captionText}`;
    } else {
      // Generate via LLM
      try {
        const llmResult = await callModel(
          CAPTION_MODEL,
          CAPTION_SYSTEM_PROMPT,
          `Day number: ${dayNumber}\nThe image was sent directly by the owner — it's from their day, their shop, their life. Generate the caption.`,
          { maxTokens: 100, temperature: 0.8 },
        );
        caption = llmResult.content.trim().replace(/^["']|["']$/g, "");
        if (!caption.startsWith(`day ${dayNumber}`)) {
          caption = `day ${dayNumber}. ${caption.replace(/^day \d+\.?\s*/i, "")}`;
        }
      } catch {
        caption = `day ${dayNumber}. nobody noticed yet.`;
      }
    }

    // Get enabled configs
    const { data: configs } = await supabase
      .from("patient_zero_config")
      .select("*, external_identities!inner(id, platform, handle)")
      .eq("enabled", true)
      .eq("paused", false);

    // Delete any existing queue for today (replacing with this photo)
    await supabase
      .from("patient_zero_queue")
      .delete()
      .eq("day_number", dayNumber)
      .in("status", ["pending_review"]);

    // Pick hashtags
    const config = configs?.[0];
    let hashtags: string[] = [];
    if (config?.hashtag_pool?.length) {
      const shuffled = [...config.hashtag_pool].sort(() => Math.random() - 0.5);
      hashtags = shuffled.slice(0, 5);
    }

    // Queue for all enabled platforms
    const queued = [];
    for (const cfg of configs || []) {
      const platform = (cfg as any).external_identities.platform;
      const postTime = cfg.post_time_utc || "15:00";
      const [hours, minutes] = postTime.split(":").map(Number);
      const scheduledFor = new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), hours, minutes),
      );
      if (scheduledFor < new Date()) {
        scheduledFor.setTime(Date.now() + 5 * 60 * 1000);
      }

      const { data: queueRow } = await supabase
        .from("patient_zero_queue")
        .upsert({
          day_number: dayNumber,
          platform,
          external_identity_id: cfg.external_identity_id,
          caption,
          hashtags,
          image_url: publicUrl,
          status: "pending_review",
          scheduled_for: scheduledFor.toISOString(),
          caption_model: "user_photo",
          caption_cost_cents: 0,
        }, { onConflict: "day_number,platform,external_identity_id" })
        .select()
        .single();

      if (queueRow) {
        queued.push({ platform, id: queueRow.id });
      }
    }

    // Send back preview
    const queueId = queued[0]?.id;
    if (queueId) {
      const keyboard = {
        inline_keyboard: [
          [
            { text: "good to go", callback_data: `pz_approve_${queueId}` },
            { text: "skip today", callback_data: `pz_skip_${queueId}` },
          ],
        ],
      };

      const platforms = queued.map((q) => q.platform).join(" + ");
      await tgSendPhoto(
        publicUrl,
        `got it. day ${dayNumber}.\n\n"${caption}"\n\n${platforms}. good to go?`,
        keyboard,
      );
    }

    return { ok: true };
  }

  return { ok: true };
}

// ── Main router ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));

    // Detect Telegram webhook by update_id field or query param
    const url = new URL(req.url);
    const isTelegram =
      url.searchParams.get("telegram") === "1" ||
      body.update_id !== undefined;

    if (isTelegram) {
      // Detect which bot from the secret header (GooBaChat has none, PZ bot has one)
      const providedSecret = req.headers.get("x-telegram-bot-api-secret-token");
      const expectedSecret = TELEGRAM_WEBHOOK_SECRET();
      const isGoobachat = !providedSecret && GOOBACHAT_BOT_TOKEN();

      // Validate webhook secret for PZ bot only (GooBaChat has no secret)
      if (!isGoobachat && expectedSecret && providedSecret !== expectedSecret) {
        return new Response("Unauthorized", { status: 401 });
      }

      _activeBotToken = isGoobachat ? GOOBACHAT_BOT_TOKEN() : TELEGRAM_BOT_TOKEN();

      const result = await handleTelegramWebhook(body);
      _activeBotToken = ""; // reset
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action-based routing
    const action = body.action as string;

    let result: unknown;

    switch (action) {
      case "generate":
        result = await actionGenerate(body);
        break;
      case "publish":
        result = await actionPublish();
        break;
      case "preview":
        result = await actionPreview();
        break;
      case "approve":
        result = await actionApprove(body.post_id, body.via ?? "api");
        break;
      case "skip":
        result = await actionSkip(body.post_id);
        break;
      case "override":
        result = await actionOverride(body.caption);
        break;
      case "stats":
        result = await actionStats();
        break;
      case "pause":
        result = await actionPause();
        break;
      case "curate":
        result = await actionCurate(body);
        break;
      case "seed_pool":
        result = await actionSeedPool(body);
        break;
      default:
        result = {
          error: `Unknown action: ${action}`,
          available: [
            "generate",
            "publish",
            "preview",
            "approve",
            "skip",
            "override",
            "stats",
            "pause",
            "curate",
            "seed_pool",
          ],
          day: getDayNumber(),
        };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[patient-zero]", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
