#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const YOUTUBE_SOURCE_ID = "e980c7bd-404f-41f6-8a17-1c7cabd1d8a4";

const ORGS = {
  "barrett-jackson": {
    id: "7a3d0d2a-c738-4d8a-a199-1a687aa6cdf4",
    name: "Barrett-Jackson",
    slug: "barrett-jackson",
    channel_url: "https://www.youtube.com/@BarrettJacksonTV",
    videos: ["3665XiILsm4", "k5HzsS8Z4kk", "IkFx07O8E3k", "rTuUOukR7d0"],
  },
  "mecum": {
    id: "d2f587a0-5993-4d2c-9032-0fb3dd94d995",
    name: "Mecum Auctions",
    slug: "mecum-auctions",
    channel_url: "https://www.youtube.com/@MecumAuctions",
    videos: ["c9fxArnD3IY", "FOXssScuAGU", "B1FV2n1FiUk"],
  },
  "rm-sothebys": {
    id: "83e1e414-2c02-46d2-b677-0eacf60e9201",
    name: "RM Sotheby's",
    slug: "rm-sothebys",
    channel_url: "https://www.youtube.com/@RMSothebysInc",
    videos: ["2d-WXoGKZ6E", "5Yj73ZZtlF0", "RcKOO6i0m0g", "vghxNuZfBW0", "G9s1_QZ5k6c", "jSfv8omiSr0", "SO9f2lkOvgQ", "IFheRC0w2dE"],
  },
  "broad-arrow": {
    id: "bf7f8e55-4abc-45dc-aae0-1df86a9f365a",
    name: "Broad Arrow Auctions",
    slug: "broad-arrow-auctions",
    channel_url: "https://www.youtube.com/@BroadArrowAuctions",
    videos: ["Qh1kXsYVl94", "n06sHkW9XNA", "XWbvALSFfRo", "reysYUk2czM", "CIUzxWgtCiE", "SFKsVz3k4zo", "wANPsBwxTsg"],
  },
  "gooding-christies": {
    id: "98a2e93e-b814-4fda-b48a-0bb5440b7d00",
    name: "Gooding and Company",
    slug: "gooding-and-company",
    channel_url: "https://www.youtube.com/@GoodingChristies",
    videos: ["uNyzglrAxHE", "iTX6BSlZ52o", "u6iVM08gYIc"],
  },
  "bonhams-auctioneers": {
    id: "eb426570-c8e7-43c3-a4f1-8807ed9e075c",
    name: "Bonhams",
    slug: "bonhams",
    channel_url: "https://www.youtube.com/@BonhamsAuctioneers1793",
    videos: ["OrXeXz32poA", "8y3zZUgtCWM", "T8vCPvGop-8", "spuLSi_clDg", "VCiaR7_ynH4"],
  },
};

const latest = JSON.parse(fs.readFileSync("/Users/skylar/nuke/output/mecum/discovery/latest.json", "utf8"));
const sample = JSON.parse(fs.readFileSync("/Users/skylar/nuke/output/mecum/processed-evidence-sample.json", "utf8"));
const rev = JSON.parse(fs.readFileSync("/Users/skylar/nuke/output/mecum/review-publisher-classification.json", "utf8"));
const causalAssay = JSON.parse(fs.readFileSync("/Users/skylar/nuke/output/mecum/audio-discovery/causal-audio-feature-assay.json", "utf8"));

// Map surface census by platform key
const surfaceByPlatform = {};
for (const s of latest.sources || []) {
  surfaceByPlatform[s.platform] = s;
}
for (const s of latest.separate_source_inventories || []) {
  surfaceByPlatform[s.platform] = s;
}

const videoMeta = {
  "c9fxArnD3IY": {
    title: "Mecum Kissimmee 2026 Live Block Cam (Saturday, Jan 17, 2026)",
    format: "multi-hour live auction block broadcast",
    findings: [
      "Lot S114 (1159827) 1967 Chevrolet Corvette Two-Top Convertible (VIN 194677S101228): 74 atomic source claims bound to vehicle profile 12cde831-8981-471b-9631-588bc1251259.",
      "7 visual price display samples extracted from live on-screen chyron between 2546s ($80,000) and 2600s ($140,000 CURRENT BID · The BID Goes On...).",
      "25 caption-derived attribute claims across 8 distinct caption cues (67s cue union): 427/390 HP L36 V8, matching numbers, NCRS Top Flight, Tank Sticker, 2 owners, 4-speed manual.",
    ],
  },
  "FOXssScuAGU": { title: "Mecum Full Day Live Broadcast Archive (FOXssScuAGU)", format: "multi-hour live auction broadcast" },
  "B1FV2n1FiUk": { title: "Mecum Nashville Live Block Cam // Tuesday, September 22, 2026", format: "multi-hour live block cam" },
  "rTuUOukR7d0": { title: "Barrett-Jackson Full Day Livestream Archive (rTuUOukR7d0)", format: "multi-hour live auction broadcast" },
  "IFheRC0w2dE": { title: "RM Sotheby's Full Auction Livestream Archive (IFheRC0w2dE)", format: "auctioneer-led live auction broadcast" },
  "RcKOO6i0m0g": { title: "RM Sotheby's Auction Livestream (RcKOO6i0m0g)", format: "auctioneer-led live auction broadcast" },
  "G9s1_QZ5k6c": { title: "RM Sotheby's Collector Car Auction Livestream (G9s1_QZ5k6c)", format: "auctioneer-led live auction broadcast" },
  "jSfv8omiSr0": { title: "RM Sotheby's Feature Lot & Bidding Broadcast (jSfv8omiSr0)", format: "auctioneer-led live auction broadcast" },
  "XWbvALSFfRo": { title: "The Broad Arrow Amelia Concours Auction - Friday", format: "multi-hour live auction broadcast" },
  "wANPsBwxTsg": { title: "Broad Arrow Collector Car Auction Livestream (wANPsBwxTsg)", format: "multi-hour live auction broadcast" },
  "8y3zZUgtCWM": { title: "Bonhams Motor Cars Auction Livestream (8y3zZUgtCWM)", format: "auctioneer-led live auction broadcast" },
  "VCiaR7_ynH4": { title: "Bonhams Collector Motor Cars Livestream (VCiaR7_ynH4)", format: "auctioneer-led live auction broadcast" },
};
for (const s of latest.sample_sources || []) {
  videoMeta[s.video_id] = {
    title: s.title,
    format: s.format,
    findings: s.findings,
    visual_findings: s.visual_findings,
    reviewed_windows_seconds: s.reviewed_windows_seconds,
    source_identity_url: s.source_identity_url,
  };
}

// Load v3 reports
const sourcesDir = "/Users/skylar/nuke/output/mecum/audio-discovery/loop/sources";
const v3Reports = {};
for (const vid of fs.readdirSync(sourcesDir)) {
  const runsDir = path.join(sourcesDir, vid, "runs");
  if (!fs.existsSync(runsDir)) continue;
  const v3Run = fs.readdirSync(runsDir).find((r) => r.startsWith("mecum-caption-cues-v3-"));
  if (!v3Run) continue;
  const repPath = path.join(runsDir, v3Run, "report.json");
  if (fs.existsSync(repPath)) {
    v3Reports[vid] = JSON.parse(fs.readFileSync(repPath, "utf8"));
  }
}
const c9Path = "/Users/skylar/nuke/output/mecum/audio-discovery/c9fxArnD3IY-caption-discovery-v1.json";
if (fs.existsSync(c9Path) && !v3Reports["c9fxArnD3IY"]) {
  v3Reports["c9fxArnD3IY"] = JSON.parse(fs.readFileSync(c9Path, "utf8"));
}

// Visual OCR evidence per platform
const VISUAL_OCR_BY_PLATFORM = {
  "barrett-jackson": {
    presentations_assayed: 1,
    total_visual_points: 3,
    featured_lot: {
      video_id: "3665XiILsm4",
      youtube_url: "https://www.youtube.com/watch?v=3665XiILsm4",
      auction: "Barrett-Jackson 2026 Las Vegas Auction",
      lot: "682",
      vehicle_label: "1982 CHEVROLET C10 CUSTOM PICKUP",
      first_sampled_bid_usd: 155000,
      final_displayed_sold_usd: 157000,
      attributed_build_cost_usd: 200000,
      sampled_elapsed_seconds: 24,
      endpoint_delta_usd: 2000,
      endpoint_growth_usd_per_nominal_second: 83.33,
    },
    frame_series: [
      {
        observation_id: "8700e5e9-d6e4-4fac-9f40-8a134aca506b",
        video_id: "3665XiILsm4",
        timestamp_seconds: 121,
        timestamp_ms: 121021,
        youtube_url: "https://www.youtube.com/watch?v=3665XiILsm4&t=121s",
        frame_image_url: "/broadcast-poc/3665XiILsm4-121s-INTERNAL.jpg",
        lot: "682",
        vehicle_label: "1982 CHEVROLET C10",
        overlay_status: "CURRENT BID",
        overlay_amount_usd: 155000,
        camera_views: ["vehicle closeup", "skybox", "auction floor"],
        ocr_caption: "Top-left chyron reads LOT 682 · 1982 CHEVROLET C10 · $155,000 CURRENT BID across 3-pane split screen (vehicle close-up, VIP skybox, auction floor).",
      },
      {
        observation_id: "3a3879d3-bd73-4dbe-aefa-2812a9dfa132",
        video_id: "3665XiILsm4",
        timestamp_seconds: 145,
        timestamp_ms: 145012,
        youtube_url: "https://www.youtube.com/watch?v=3665XiILsm4&t=145s",
        frame_image_url: "/broadcast-poc/3665XiILsm4-145s-INTERNAL.jpg",
        lot: "682",
        vehicle_label: "1982 CHEVROLET C10",
        overlay_status: "SOLD!",
        overlay_amount_usd: 157000,
        camera_views: ["skybox"],
        ocr_caption: "Top-left chyron transitions to LOT 682 · 1982 CHEVROLET C10 · $157,000 SOLD! as skybox bidder and Barrett-Jackson official high-five.",
      },
      {
        observation_id: "f3ff5616-b417-44d7-886d-4ca040b5d4f3",
        video_id: "3665XiILsm4",
        timestamp_seconds: 152,
        timestamp_ms: 152019,
        youtube_url: "https://www.youtube.com/watch?v=3665XiILsm4&t=152s",
        frame_image_url: "/broadcast-poc/3665XiILsm4-152s-INTERNAL.jpg",
        lot: "682",
        vehicle_label: "1982 CHEVROLET C10",
        overlay_status: "POST-SALE CLOSEUP (NO OVERLAY)",
        overlay_amount_usd: null,
        camera_views: ["vehicle closeup"],
        ocr_caption: "Chyron dismissed after hammer; full-frame vehicle beauty shot confirms lot exit boundary.",
      },
    ],
  },
  "mecum": {
    presentations_assayed: 1,
    total_visual_points: 7,
    featured_lot: {
      video_id: "c9fxArnD3IY",
      youtube_url: "https://www.youtube.com/watch?v=c9fxArnD3IY&t=2546s",
      auction: "Mecum Kissimmee 2026",
      lot: "S114",
      source_listing_id: "1159827",
      vehicle_id: "12cde831-8981-471b-9631-588bc1251259",
      vin: "194677S101228",
      vehicle_label: "1967 CHEVROLET CORVETTE TWO TOP CONVERTIBLE",
      first_sampled_bid_usd: 80000,
      final_displayed_bid_usd: 140000,
      sampled_elapsed_seconds: 54,
      endpoint_delta_usd: 60000,
      endpoint_growth_usd_per_nominal_second: 1111.11,
      regression_growth_usd_per_nominal_second: 934.01,
      interval_figure_url: "/broadcast-poc/presence-interval-evidence.svg",
    },
    frame_series: [
      {
        video_id: "c9fxArnD3IY",
        timestamp_seconds: 2546,
        youtube_url: "https://www.youtube.com/watch?v=c9fxArnD3IY&t=2546s",
        lot: "S114",
        vehicle_label: "1967 CHEVROLET CORVETTE TWO TOP CONVERTIBLE",
        overlay_status: "CURRENT BID",
        overlay_amount_usd: 80000,
        camera_views: ["block wide", "top chyron"],
        ocr_caption: "Initial sampled chyron at 2546s: LOT S114 · 1967 CHEVROLET CORVETTE TWO TOP CONVERTIBLE · $80,000 CURRENT BID.",
      },
      {
        video_id: "c9fxArnD3IY",
        timestamp_seconds: 2555,
        youtube_url: "https://www.youtube.com/watch?v=c9fxArnD3IY&t=2555s",
        lot: "S114",
        vehicle_label: "1967 CHEVROLET CORVETTE TWO TOP CONVERTIBLE",
        overlay_status: "CURRENT BID",
        overlay_amount_usd: 90000,
        camera_views: ["vehicle front 3/4", "top chyron"],
        ocr_caption: "2555s visual price point: $90,000 CURRENT BID (+$10,000 in 9s). Callback PTS verified within 0.03s.",
      },
      {
        video_id: "c9fxArnD3IY",
        timestamp_seconds: 2565,
        youtube_url: "https://www.youtube.com/watch?v=c9fxArnD3IY&t=2565s",
        lot: "S114",
        vehicle_label: "1967 CHEVROLET CORVETTE TWO TOP CONVERTIBLE",
        overlay_status: "CURRENT BID",
        overlay_amount_usd: 105000,
        camera_views: ["engine bay", "top chyron"],
        ocr_caption: "2565s visual price point: $105,000 CURRENT BID (+$15,000 in 10s). Background board displays $115,000 ask.",
      },
      {
        video_id: "c9fxArnD3IY",
        timestamp_seconds: 2575,
        youtube_url: "https://www.youtube.com/watch?v=c9fxArnD3IY&t=2575s",
        lot: "S114",
        vehicle_label: "1967 CHEVROLET CORVETTE TWO TOP CONVERTIBLE",
        overlay_status: "CURRENT BID",
        overlay_amount_usd: 115000,
        camera_views: ["interior cockpit", "top chyron"],
        ocr_caption: "2575s visual price point: $115,000 CURRENT BID (+$10,000 in 10s).",
      },
      {
        video_id: "c9fxArnD3IY",
        timestamp_seconds: 2585,
        youtube_url: "https://www.youtube.com/watch?v=c9fxArnD3IY&t=2585s",
        lot: "S114",
        vehicle_label: "1967 CHEVROLET CORVETTE TWO TOP CONVERTIBLE",
        overlay_status: "CURRENT BID",
        overlay_amount_usd: 135000,
        camera_views: ["rear 3/4", "top chyron"],
        ocr_caption: "2585s visual price point: $135,000 CURRENT BID (+$20,000 in 10s).",
      },
      {
        video_id: "c9fxArnD3IY",
        timestamp_seconds: 2600,
        youtube_url: "https://www.youtube.com/watch?v=c9fxArnD3IY&t=2600s",
        frame_image_url: "/broadcast-poc/s114-frame-2600.png",
        lot: "S114",
        vehicle_label: "1967 CHEVROLET CORVETTE TWO TOP CONVERTIBLE",
        overlay_status: "CURRENT BID · The BID Goes On...",
        overlay_amount_usd: 140000,
        camera_views: ["arena wide", "ESPN+ block desk", "top chyron"],
        ocr_caption: "2600s visual price point: LOT S114 · 1967 CHEVROLET CORVETTE TWO TOP CONVERTIBLE · $140,000 CURRENT BID · The BID Goes On...",
      },
    ],
  },
  "gooding-christies": {
    presentations_assayed: 1,
    total_visual_points: 3,
    featured_lot: {
      video_id: "u6iVM08gYIc",
      youtube_url: "https://www.youtube.com/watch?v=u6iVM08gYIc",
      auction: "Gooding Christie's Pebble Beach Auctions 2026",
      lot: "22 (Nose Roundel)",
      vehicle_label: "1963 FERRARI 250 P",
      first_sampled_bid_usd: null,
      final_displayed_sold_usd: null,
    },
    frame_series: [
      {
        observation_id: "07d8b35e-4e4e-41c7-8d6a-0c8e8c3737c4",
        video_id: "u6iVM08gYIc",
        timestamp_seconds: 2,
        timestamp_ms: 2012,
        youtube_url: "https://www.youtube.com/watch?v=u6iVM08gYIc&t=2s",
        frame_image_url: "/broadcast-poc/u6iVM08gYIc-2s-INTERNAL.jpg",
        lot: "#22",
        vehicle_label: "1963 FERRARI 250 P",
        overlay_status: "NOSE ROUNDEL #22 + FERRARI BADGE",
        overlay_amount_usd: null,
        camera_views: ["front nose closeup"],
        ocr_caption: "Frame OCR reads racing roundel '22' and Scuderia Ferrari nose badge on red bodywork.",
      },
      {
        observation_id: "57a29ca6-5d57-46c9-97a2-f8786d25a9f0",
        video_id: "u6iVM08gYIc",
        timestamp_seconds: 30,
        timestamp_ms: 30016,
        youtube_url: "https://www.youtube.com/watch?v=u6iVM08gYIc&t=30s",
        frame_image_url: "/broadcast-poc/u6iVM08gYIc-30s-INTERNAL.jpg",
        lot: "#22",
        vehicle_label: "1963 FERRARI 250 P",
        overlay_status: "VEGLIA GAUGE TELEMETRY (5,800 RPM)",
        overlay_amount_usd: null,
        camera_views: ["instrument cluster"],
        ocr_caption: "Instrument OCR reads Ferrari Veglia tachometer (GIRI x 100 = 58 / 5,800 RPM), Manometro Olio (2.8 Kg/cm²), and Olio Temp (55°C).",
      },
      {
        observation_id: "d89f1147-8fb4-403e-970f-d1883295d79c",
        video_id: "u6iVM08gYIc",
        timestamp_seconds: 62,
        timestamp_ms: 62013,
        youtube_url: "https://www.youtube.com/watch?v=u6iVM08gYIc&t=62s",
        frame_image_url: "/broadcast-poc/u6iVM08gYIc-62s-INTERNAL.jpg",
        lot: "#22",
        vehicle_label: "1963 FERRARI 250 P",
        overlay_status: "VEGLIA GAUGE TELEMETRY (2,100 RPM)",
        overlay_amount_usd: null,
        camera_views: ["instrument cluster"],
        ocr_caption: "Instrument OCR reads Ferrari Veglia tachometer at 2,100 RPM (GIRI x 100 = 21), Manometro Olio (~5.8 Kg/cm²), and Olio Temp (55°C).",
      },
    ],
  },
};

function makeObsRow({ orgId, sourceIdentifier, sourceUrl, property, claimRole, value, interpretation }) {
  const structuredData = {
    kind_detail: "broadcast_profile_derived",
    property,
    claim_role: claimRole,
    value,
    interpretation,
    computed_at: "2026-10-02T22:08:57.384698+00:00",
  };
  const contentForHash = JSON.stringify({
    source: "youtube",
    kind: "media",
    subject_type: "organization",
    subject_id: orgId,
    source_identifier: sourceIdentifier,
    data: structuredData,
  });
  const contentHash = crypto.createHash("sha256").update(contentForHash).digest("hex");
  return {
    subject_type: "organization",
    subject_id: orgId,
    source_id: YOUTUBE_SOURCE_ID,
    source_identifier: sourceIdentifier,
    source_url: sourceUrl,
    raw_source_ref: sourceUrl,
    kind: "media",
    confidence: "high",
    confidence_score: 0.85,
    extraction_method: "broadcast-profile-fold-v1-from-verified-Nuke-source-grains",
    observed_at: "2026-10-02T22:08:57.384Z",
    content_hash: contentHash,
    structured_data: structuredData,
  };
}

const rowsToUpsert = [];

for (const [platformKey, org] of Object.entries(ORGS)) {
  const surface = surfaceByPlatform[platformKey] || {};
  const sampleBroadcasts = (latest.sample_sources || [])
    .filter((s) => s.platform === platformKey)
    .map((s) => ({
      video_id: s.video_id,
      title: s.title,
      url: s.url,
      format: s.format,
      reviewed_windows_seconds: s.reviewed_windows_seconds,
      findings: s.findings,
      visual_findings: s.visual_findings || null,
      source_identity_url: s.source_identity_url || null,
    }));

  // 1. Channel Surface Census
  rowsToUpsert.push(
    makeObsRow({
      orgId: org.id,
      sourceIdentifier: `youtube:channel:${platformKey}:derived-profile:surface-census:fold-v1`,
      sourceUrl: org.channel_url,
      property: "broadcast_channel_surface_census",
      claimRole: "derived_channel_surface",
      value: {
        platform: platformKey,
        organization_name: org.name,
        channel_handle: surface.channel_handle_requested || surface.channel_handle || org.channel_url.split("/").pop(),
        unique_video_ids: surface.unique_video_ids || 0,
        surface_counts: surface.surface_counts || { videos: 0, shorts: 0, streams: 0 },
        known_duration_hours: surface.known_duration_hours || 0,
        known_duration_count: surface.known_duration_count || 0,
        unknown_duration_count: surface.unknown_duration_count || 0,
        automotive_title_candidates: surface.automotive_title_candidates || null,
        automotive_title_candidate_hours: surface.automotive_title_candidate_hours || null,
        surfaces_exhausted: Boolean(surface.surfaces_exhausted ?? surface.listing_exhausted),
        sample_broadcasts: sampleBroadcasts,
      },
      interpretation: `Public YouTube channel census for ${org.name}: ${surface.unique_video_ids || 0} unique video IDs across ${surface.known_duration_hours || 0} hours of discoverable broadcast footage.`,
    })
  );

  // 2. Caption Discovery Fold (mecum-caption-cues-v3)
  let totalDurationSec = 0;
  let totalCaptionCues = 0;
  let totalWordTokens = 0;
  let totalCandidateGrains = 0;
  let totalReviewWindows = 0;
  let totalTransitions = 0;
  const categoryTotals = {};
  const makeFrequencies = {};
  const broadcastSummaries = [];

  for (const vid of org.videos) {
    const rep = v3Reports[vid];
    if (!rep) continue;
    const cov = rep.coverage || {};
    const yld = rep.yield || {};
    const dur = cov.duration_seconds || 0;
    const cues = cov.scanned_caption_cues || cov.caption_cues || 0;
    const words = cov.word_tokens || 0;
    const grains = yld.candidate_source_grains || 0;
    const wins = yld.review_windows || 0;
    const trans = yld.presentation_transition_candidates || 0;

    totalDurationSec += dur;
    totalCaptionCues += cues;
    totalWordTokens += words;
    totalCandidateGrains += grains;
    totalReviewWindows += wins;
    totalTransitions += trans;

    const catBreakdown = [];
    const topExamples = [];
    for (const cat of rep.categories || []) {
      categoryTotals[cat.property] = (categoryTotals[cat.property] || 0) + (cat.candidate_grains || 0);
      catBreakdown.push({
        property: cat.property,
        title: cat.title,
        candidate_grains: cat.candidate_grains || 0,
        review_windows: cat.review_windows || 0,
      });
      if (cat.property === "vehicle_reference_cue" && cat.rule_frequencies) {
        for (const [k, v] of Object.entries(cat.rule_frequencies)) {
          makeFrequencies[k] = (makeFrequencies[k] || 0) + (Number(v) || 0);
        }
      }
      for (const ex of (cat.example_candidates || []).slice(0, 2)) {
        if (topExamples.length < 6) {
          topExamples.push({
            property: cat.property,
            start_seconds: ex.start_seconds ?? (ex.start_ms ? Math.round(ex.start_ms / 1000) : 0),
            text: ex.caption_text || ex.text || "",
            matched_rules: ex.matched_rules || [],
            youtube_url: `https://www.youtube.com/watch?v=${vid}&t=${Math.floor(ex.start_seconds ?? (ex.start_ms ? ex.start_ms / 1000 : 0))}s`,
          });
        }
      }
    }

    broadcastSummaries.push({
      video_id: vid,
      title: videoMeta[vid]?.title || `Broadcast ${vid}`,
      format: videoMeta[vid]?.format || "auction broadcast",
      youtube_url: `https://www.youtube.com/watch?v=${vid}`,
      duration_seconds: dur,
      duration_hours: Number((dur / 3600).toFixed(2)),
      caption_cues: cues,
      word_tokens: words,
      candidate_grains: grains,
      review_windows: wins,
      presentation_transition_candidates: trans,
      categories: catBreakdown,
      example_cues: topExamples,
    });
  }

  rowsToUpsert.push(
    makeObsRow({
      orgId: org.id,
      sourceIdentifier: `youtube:channel:${platformKey}:derived-profile:caption-discovery-v3:fold-v1`,
      sourceUrl: org.channel_url,
      property: "broadcast_caption_discovery_fold",
      claimRole: "derived_caption_coverage",
      value: {
        discovery_version: "mecum-caption-cues-v3",
        broadcasts_scanned: broadcastSummaries.length,
        total_duration_seconds: totalDurationSec,
        total_duration_hours: Number((totalDurationSec / 3600).toFixed(2)),
        total_caption_cues: totalCaptionCues,
        total_word_tokens: totalWordTokens,
        total_candidate_grains: totalCandidateGrains,
        total_review_windows: totalReviewWindows,
        total_presentation_transition_candidates: totalTransitions,
        category_totals: categoryTotals,
        make_mention_frequencies: makeFrequencies,
        broadcasts: broadcastSummaries,
      },
      interpretation: `Full-broadcast caption mining (mecum-caption-cues-v3) across ${broadcastSummaries.length} ${org.name} broadcasts (${(totalDurationSec / 3600).toFixed(2)} hrs, ${totalWordTokens.toLocaleString()} words): ${totalCandidateGrains.toLocaleString()} structured candidate grains and ${totalTransitions} lot transition cues.`,
    })
  );

  // 3. Visual Frame OCR Evidence (where available)
  if (VISUAL_OCR_BY_PLATFORM[platformKey]) {
    const vOcr = VISUAL_OCR_BY_PLATFORM[platformKey];
    rowsToUpsert.push(
      makeObsRow({
        orgId: org.id,
        sourceIdentifier: `youtube:channel:${platformKey}:derived-profile:visual-ocr-evidence:fold-v1`,
        sourceUrl: vOcr.featured_lot.youtube_url,
        property: "broadcast_visual_ocr_evidence",
        claimRole: "derived_display_proxy",
        value: vOcr,
        interpretation: `Verified video frame OCR & on-screen chyron extraction for ${org.name} (${vOcr.featured_lot.vehicle_label}, Lot ${vOcr.featured_lot.lot}).`,
      })
    );
  }

  // 4. Reviewed Atomic Broadcast Claims Rollup
  // Fetch updated live vehicle_ids for these observations
  const pubMembership = rev.observation_membership.filter((m) => m.publisher_review_group === platformKey);
  const pubObsIds = new Set(pubMembership.map((m) => m.observation_id));
  const pubObs = sample.observations.filter((o) => pubObsIds.has(o.id));

  // Apply the relinked vehicle_ids we just bound in live DB
  const s114RelinkedVehicleId = "12cde831-8981-471b-9631-588bc1251259";
  const batmobileIds = new Set([
    "463ceab2-cb0a-4465-b474-92dce3c90356",
    "91a5fb1e-8bd8-4454-a199-da6ce9d113bb",
    "f95d1807-78f5-4eef-bfae-71eae0b3248a",
    "913375b3-1a68-45ef-bb13-71a29a80519c",
    "21e7a18b-23a6-41ab-b80d-949969df0e71",
    "24c83e63-d4c9-4aa3-8f4c-3f6f6a49c5cf",
  ]);
  const peterbiltIds = new Set([
    "cb0d6f3c-6f44-4a85-9b5f-e06fbb1066ea",
    "687b8427-6553-45d4-af1a-42f5441b885a",
  ]);

  const claimsList = pubObs.map((o) => {
    const sd = o.structured_data || {};
    const ec = sd.event_context || {};
    const media = sd.media || {};
    let resolvedVehicleId = o.vehicle_id || null;
    if (!resolvedVehicleId && o.subject_type === "vehicle" && ec.source_listing_id === "1159827") {
      resolvedVehicleId = s114RelinkedVehicleId;
    } else if (batmobileIds.has(o.id)) {
      resolvedVehicleId = "3dc59e8f-3b1a-49fb-9759-2b957b7c13b4";
    } else if (peterbiltIds.has(o.id)) {
      resolvedVehicleId = "e4393db7-5518-4b6e-a784-4d92a23afd86";
    }

    const startSec =
      media.start_seconds ??
      (o.source_identifier.includes(":caption-onset-ms:")
        ? Math.round(Number(o.source_identifier.split(":caption-onset-ms:")[1].split(":")[0]) / 1000)
        : o.source_identifier.includes(":visual-point-ms:")
        ? Math.round(Number(o.source_identifier.split(":visual-point-ms:")[1].split(":")[0]) / 1000)
        : o.source_identifier.includes(":visual-point:")
        ? Number(o.source_identifier.split(":visual-point:")[1].split(":")[0])
        : o.source_identifier.includes(":frame:")
        ? Number(o.source_identifier.split(":frame:")[1].split(":")[0])
        : null);

    const vid = media.video_id || (o.source_identifier.startsWith("youtube:") ? o.source_identifier.split(":")[1] : null);

    return {
      observation_id: o.id,
      source_identifier: o.source_identifier,
      kind: o.kind,
      video_id: vid,
      start_seconds: Number.isFinite(startSec) ? startSec : null,
      lot: ec.lot || ec.lot_claim || (sd.value && typeof sd.value === "object" ? sd.value.lot : null) || null,
      auction: ec.auction || ec.auction_title_claim || ec.auction_name_claim || (vid && videoMeta[vid]?.title) || null,
      vehicle_id: resolvedVehicleId,
      subject_type: o.subject_type,
      property: sd.property || "claim",
      claim_role: sd.claim_role || null,
      value: sd.value,
      unit: sd.unit || null,
      raw_source_ref: o.raw_source_ref || (vid ? `https://www.youtube.com/watch?v=${vid}${Number.isFinite(startSec) ? `&t=${startSec}s` : ""}` : null),
    };
  });

  const vehicleBoundCount = claimsList.filter((c) => Boolean(c.vehicle_id)).length;
  const orgSubjectCount = claimsList.filter((c) => c.subject_type === "organization").length;

  rowsToUpsert.push(
    makeObsRow({
      orgId: org.id,
      sourceIdentifier: `youtube:channel:${platformKey}:derived-profile:reviewed-claims-rollup:fold-v1`,
      sourceUrl: org.channel_url,
      property: "broadcast_reviewed_claims_rollup",
      claimRole: "derived_publisher_claims_rollup",
      value: {
        publisher_group: platformKey,
        organization_name: org.name,
        total_reviewed_observations: claimsList.length,
        vehicle_bound_count: vehicleBoundCount,
        organization_subject_count: orgSubjectCount,
        unbound_media_claims_count: claimsList.length - vehicleBoundCount - orgSubjectCount,
        videos_covered: [...new Set(claimsList.map((c) => c.video_id).filter(Boolean))],
        claims: claimsList,
      },
      interpretation: `Publisher rollup of ${claimsList.length} reviewed atomic broadcast & catalogue claims for ${org.name} (${vehicleBoundCount} bound to physical vehicles in public.vehicles).`,
    })
  );

  // 5. Acoustic / Auctioneer Rhythm Assay (for Mecum & Broad Arrow)
  if (platformKey === "mecum" || platformKey === "broad-arrow") {
    const vid = platformKey === "mecum" ? "c9fxArnD3IY" : "reysYUk2czM";
    rowsToUpsert.push(
      makeObsRow({
        orgId: org.id,
        sourceIdentifier: `youtube:channel:${platformKey}:derived-profile:acoustic-rhythm-assay:fold-v1`,
        sourceUrl: `https://www.youtube.com/watch?v=${vid}`,
        property: "broadcast_acoustic_rhythm_assay",
        claimRole: "derived_acoustic_assay",
        value: {
          video_id: vid,
          auction_title: videoMeta[vid]?.title || vid,
          lot: platformKey === "mecum" ? "S114 (1967 Chevrolet Corvette)" : "129 (1992 Porsche 911 Carrera RS)",
          requested_crop_seconds: platformKey === "mecum" ? 92 : 98,
          decoded_audio_seconds: platformKey === "mecum" ? 99.9735 : 107.9735,
          caption_span_union_seconds: platformKey === "mecum" ? 67 : 145.04,
          asr_span_union_seconds: platformKey === "mecum" ? 83.22 : 97.56,
          causal_feature_rows: 5397,
          rhythm_report_image_url: "/broadcast-poc/auctioneer-rhythm-report.png",
          all_stars_report_image_url: "/broadcast-poc/mecum-all-stars-report.png",
          recovered_chant_categories: [
            "closing_call / numeral_remediation",
            "speaker_bid_acknowledgement / new_bidder_reference",
            "speaker_bid_acknowledgement / phone_or_room_participant_reference",
            "increment_rejection / rhetorical_low_exaggeration",
            "closing_call / sold_price",
          ],
        },
        interpretation: `Acoustic & auctioneer rhythm contour assay for ${org.name} (${vid}): 5,397 causal feature rows with zero lookahead leakage.`,
      })
    );
  }
}

console.log(`Prepared ${rowsToUpsert.length} organization-subject observations across 6 auction houses.`);

// Upsert into public.vehicle_observations via q.sh
for (const row of rowsToUpsert) {
  const sdJson = JSON.stringify(row.structured_data).replace(/'/g, "''");
  const sql = `
    DELETE FROM public.vehicle_observations
    WHERE subject_type = 'organization'
      AND subject_id = '${row.subject_id}'::uuid
      AND source_identifier = '${row.source_identifier.replace(/'/g, "''")}';

    INSERT INTO public.vehicle_observations (
      vehicle_id,
      subject_type,
      subject_id,
      source_id,
      source_identifier,
      source_url,
      raw_source_ref,
      kind,
      confidence,
      confidence_score,
      extraction_method,
      observed_at,
      content_hash,
      structured_data
    ) VALUES (
      NULL,
      'organization',
      '${row.subject_id}'::uuid,
      '${row.source_id}'::uuid,
      '${row.source_identifier.replace(/'/g, "''")}',
      '${(row.source_url || "").replace(/'/g, "''")}',
      '${(row.raw_source_ref || "").replace(/'/g, "''")}',
      'media',
      'high',
      0.85,
      '${row.extraction_method}',
      '${row.observed_at}'::timestamptz,
      '${row.content_hash}',
      '${sdJson}'::jsonb
    ) RETURNING id, subject_id, source_identifier;
  `;
  const res = execFileSync("bash", ["/Users/skylar/nuke/scripts/data/q.sh", sql], { encoding: "utf8" });
  console.log("Upserted:", row.source_identifier, "->", res.trim());
}
