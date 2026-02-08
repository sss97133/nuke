import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * calculate-vehicle-scores
 *
 * Computes composite "video game stats" for a vehicle from its raw spec data.
 * All scores are 0-100 integers, derived from real formulas and normalised
 * against a reference set of collector vehicles.
 *
 * POST { vehicle_id }          → calculate for one vehicle
 * POST { batch: true, limit }  → batch-calculate vehicles missing scores
 */

// ---------------------------------------------------------------------------
// Reference ceilings – used to normalise raw values into 0-100 scores.
// These represent the practical maxima across the collector car universe.
// ---------------------------------------------------------------------------
const REF = {
  hp_max: 800,           // Dodge Demon / GT500 territory
  hp_min: 30,            // Model A / early VW
  torque_max: 700,
  ptw_best: 0.15,        // lb/hp – lower is better (supercar)
  ptw_worst: 50,         // lb/hp – higher is worse (truck)
  zero60_best: 2.5,      // seconds – lower is better
  zero60_worst: 25,      // Model T territory
  quarter_best: 9.5,
  quarter_worst: 25,
  top_speed_max: 250,    // mph
  braking_best: 90,      // feet from 60-0
  braking_worst: 250,
  lateral_g_best: 1.2,
  lateral_g_worst: 0.5,
};

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Scale value into 0-100 where higher raw value = higher score */
function scaleUp(value: number | null, min: number, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(((clamped - min) / (max - min)) * 100);
}

/** Scale value into 0-100 where LOWER raw value = higher score (e.g. 0-60 time) */
function scaleDown(value: number | null, best: number, worst: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const clamped = Math.max(best, Math.min(worst, value));
  return Math.round(((worst - clamped) / (worst - best)) * 100);
}

/** Weighted average of non-null scores */
function weightedAvg(pairs: Array<[number | null, number]>): number | null {
  let sum = 0;
  let wt = 0;
  for (const [score, weight] of pairs) {
    if (score != null) {
      sum += score * weight;
      wt += weight;
    }
  }
  return wt > 0 ? Math.round(sum / wt) : null;
}

// ---------------------------------------------------------------------------
// Social positioning engine
// Calculates demographic appeal based on vehicle characteristics.
// Every score is grounded in observable vehicle properties.
// ---------------------------------------------------------------------------

interface SocialBreakdown {
  enthusiast_appeal: number;       // Car guys / track day crowd
  luxury_collector: number;        // High-net-worth collectors
  investment_grade: number;        // Financial investors
  weekend_cruiser: number;         // Casual weekend driver
  show_circuit: number;            // Concours / car show crowd
  youth_appeal: number;            // Under-30 appeal
  heritage_prestige: number;       // Historical significance
  overall: number;
}

const PRESTIGE_MAKES = new Set([
  "ferrari", "lamborghini", "porsche", "aston martin", "bentley", "rolls-royce",
  "maserati", "bugatti", "mclaren", "pagani", "koenigsegg", "mercedes-benz",
  "mercedes", "jaguar", "alfa romeo",
]);

const MUSCLE_MAKES = new Set([
  "chevrolet", "ford", "dodge", "plymouth", "pontiac", "buick", "oldsmobile",
  "amc", "shelby",
]);

const JAPANESE_SPORT = new Set([
  "toyota", "nissan", "datsun", "honda", "mazda", "subaru", "mitsubishi",
]);

function computeSocialPositioning(v: any): SocialBreakdown {
  const make = String(v.make || "").toLowerCase();
  const model = String(v.model || "").toLowerCase();
  const year = Number(v.year) || 0;
  const hp = Number(v.horsepower) || 0;
  const price = Number(v.nuke_estimate || v.sale_price || v.asking_price || v.current_value || 0);
  const isConvertible = /roadster|convertible|cabriolet|spider|spyder|targa|drop.?top/i.test(
    `${v.model} ${v.body_style} ${v.canonical_body_style}`
  );
  const isCoupe = /coupe|coup/i.test(`${v.model} ${v.body_style}`);
  const conditionRating = Number(v.condition_rating) || 5;
  const isMuscle = MUSCLE_MAKES.has(make);
  const isPrestige = PRESTIGE_MAKES.has(make);
  const isJdm = JAPANESE_SPORT.has(make);
  const age = 2026 - year;
  const isPreWar = year > 0 && year < 1946;
  const isClassic = year >= 1946 && year <= 1975;
  const isModern = year > 2000;

  // Enthusiast appeal: HP, performance orientation, modification potential
  let enthusiast = 40;
  if (hp > 400) enthusiast += 25;
  else if (hp > 250) enthusiast += 15;
  else if (hp > 150) enthusiast += 8;
  if (isMuscle) enthusiast += 15;
  if (isJdm) enthusiast += 12;
  if (v.is_track_car) enthusiast += 10;
  if (v.is_modified) enthusiast += 5;
  if (isPrestige && hp > 300) enthusiast += 10;

  // Luxury collector: price, prestige make, rarity (age), condition
  let luxury = 20;
  if (price > 500000) luxury += 35;
  else if (price > 200000) luxury += 25;
  else if (price > 100000) luxury += 18;
  else if (price > 50000) luxury += 10;
  if (isPrestige) luxury += 20;
  if (conditionRating >= 8) luxury += 10;
  if (isPreWar) luxury += 10;
  if (isConvertible && isPrestige) luxury += 5;

  // Investment grade: appreciation potential, rarity, provenance
  let investment = 25;
  if (price > 100000) investment += 10;
  if (isClassic || isPreWar) investment += 15;
  if (isPrestige) investment += 15;
  if (conditionRating >= 8) investment += 10;
  if (v.previous_owners != null && v.previous_owners <= 3) investment += 8;
  if (v.vin) investment += 5;
  if (Number(v.provenance_score) > 60) investment += 12;

  // Weekend cruiser: convertible, comfort, not too extreme
  let cruiser = 35;
  if (isConvertible) cruiser += 20;
  if (hp >= 100 && hp <= 400) cruiser += 10;
  if (isClassic) cruiser += 10;
  if (v.is_daily_driver || v.is_weekend_car) cruiser += 10;
  if (conditionRating >= 6) cruiser += 5;
  if (!v.is_track_car) cruiser += 5;

  // Show circuit: condition, originality, rarity
  let show = 20;
  if (conditionRating >= 9) show += 30;
  else if (conditionRating >= 7) show += 15;
  if (!v.is_modified) show += 15;
  if (isPreWar) show += 15;
  if (isPrestige) show += 10;
  if (isClassic) show += 10;

  // Youth appeal: JDM, muscle, modern, affordable, looks cool
  let youth = 25;
  if (isJdm) youth += 25;
  if (isMuscle && hp > 300) youth += 15;
  if (isModern) youth += 10;
  if (price < 50000) youth += 10;
  if (v.is_modified) youth += 10;
  if (isCoupe || isConvertible) youth += 5;

  // Heritage prestige: age, historical significance, racing provenance
  let heritage = 15;
  if (isPreWar) heritage += 35;
  else if (isClassic) heritage += 20;
  else if (age > 30) heritage += 10;
  if (isPrestige) heritage += 15;
  if (v.previous_owners != null && v.previous_owners <= 2) heritage += 10;
  if (/race|racing|competition|rally|le mans|nurburgring/i.test(
    `${v.description} ${v.highlights} ${v.modifications}`
  )) heritage += 15;

  // Clamp all to 0-100
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  const breakdown: SocialBreakdown = {
    enthusiast_appeal: clamp(enthusiast),
    luxury_collector: clamp(luxury),
    investment_grade: clamp(investment),
    weekend_cruiser: clamp(cruiser),
    show_circuit: clamp(show),
    youth_appeal: clamp(youth),
    heritage_prestige: clamp(heritage),
    overall: 0,
  };

  // Overall = weighted blend
  breakdown.overall = clamp(
    breakdown.enthusiast_appeal * 0.15 +
    breakdown.luxury_collector * 0.20 +
    breakdown.investment_grade * 0.15 +
    breakdown.weekend_cruiser * 0.10 +
    breakdown.show_circuit * 0.15 +
    breakdown.youth_appeal * 0.05 +
    breakdown.heritage_prestige * 0.20
  );

  return breakdown;
}

// ---------------------------------------------------------------------------
// Score explanation engine
// Returns the full breakdown of every factor for algorithm transparency.
// ---------------------------------------------------------------------------

interface ScoreFactor {
  name: string;
  raw: number | string | null;
  normalized: number | null;
  weight: number;
  scale: string;
}

interface ScoreBonus {
  name: string;
  value: number;
  reason: string;
  present: boolean;
}

interface ScoreExplanation {
  score: number | null;
  label: string;
  description: string;
  factors: ScoreFactor[];
  bonuses: ScoreBonus[];
  formula_hint: string; // the blurred algorithm hint
}

function explainScores(v: any): Record<string, ScoreExplanation> {
  const hp = Number(v.horsepower) || null;
  const tq = Number(v.torque) || null;
  const wt = Number(v.weight_lbs) || null;
  const z60 = Number(v.zero_to_sixty) || null;
  const qm = Number(v.quarter_mile) || null;
  const ts = Number(v.top_speed_mph) || null;
  const brk = Number(v.braking_60_0_ft) || null;
  const latg = Number(v.lateral_g) || null;
  const ptw = hp && wt ? Math.round((wt / hp) * 100) / 100 : null;

  const hpScore = scaleUp(hp, REF.hp_min, REF.hp_max);
  const tqScore = scaleUp(tq, 30, REF.torque_max);
  const ptwScore = scaleDown(ptw, REF.ptw_best, REF.ptw_worst);
  const z60Score = scaleDown(z60, REF.zero60_best, REF.zero60_worst);
  const qmScore = scaleDown(qm, REF.quarter_best, REF.quarter_worst);
  const brkScore = scaleDown(brk, REF.braking_best, REF.braking_worst);
  const latgScore = scaleUp(latg, REF.lateral_g_worst, REF.lateral_g_best);

  const scores = calculateScores(v);

  // Engine health bonuses
  const engineBonuses: ScoreBonus[] = [];
  const engineHealthDirect = Number(v.engine_health_score) || null;
  if (engineHealthDirect != null) {
    engineBonuses.push({
      name: "Engine Health Score",
      value: Math.round(engineHealthDirect * 0.1),
      reason: `Direct engine health rating of ${engineHealthDirect}/100`,
      present: true,
    });
  }
  if (v.compression_test_psi && typeof v.compression_test_psi === "object") {
    const vals = Object.values(v.compression_test_psi as Record<string, number>).filter(
      (x) => typeof x === "number" && Number.isFinite(x)
    );
    if (vals.length >= 4) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const maxDev = Math.max(...vals.map((x) => Math.abs(x - avg)));
      engineBonuses.push({
        name: "Compression Test Variance",
        value: maxDev < 10 ? 5 : maxDev > 30 ? -5 : 0,
        reason: `Max deviation ${Math.round(maxDev)} PSI across ${vals.length} cylinders (avg ${Math.round(avg)} PSI)`,
        present: true,
      });
    }
  } else {
    engineBonuses.push({
      name: "Compression Test",
      value: 0,
      reason: "No compression test data available",
      present: false,
    });
  }

  // Brake bonuses
  const brakeBonuses: ScoreBonus[] = [
    {
      name: "Disc Brakes",
      value: 5,
      reason: "Disc brakes detected on front/rear",
      present: /disc/i.test(`${v.brake_type_front} ${v.brake_type_rear}`),
    },
    {
      name: "ABS",
      value: 3,
      reason: "Anti-lock braking system equipped",
      present: !!v.abs_equipped,
    },
    {
      name: "Hydroboost",
      value: 3,
      reason: "Hydroboost brake assist system",
      present: /hydroboost/i.test(v.brake_booster_type || ""),
    },
  ];

  // Handling bonuses
  const handlingBonuses: ScoreBonus[] = [
    {
      name: "Rack & Pinion",
      value: 5,
      reason: "Rack and pinion steering for direct feedback",
      present: /rack.?and.?pinion/i.test(v.steering_type || ""),
    },
    {
      name: "Independent Suspension",
      value: 5,
      reason: "Independent suspension for improved handling",
      present: /independent/i.test(`${v.suspension_front} ${v.suspension_rear}`),
    },
    {
      name: "Limited Slip Differential",
      value: 3,
      reason: "LSD for better traction and cornering",
      present: /limited.?slip|posi/i.test(v.rear_axle_type || ""),
    },
  ];

  // Comfort factors
  const comfortBonuses: ScoreBonus[] = [
    { name: "4+ Seats", value: 10, reason: "Spacious seating", present: v.seats && Number(v.seats) >= 4 },
    { name: "Daily Driver", value: 15, reason: "Designed for daily use", present: !!v.is_daily_driver },
    { name: "Track Car", value: -20, reason: "Track-focused = less comfort", present: !!v.is_track_car },
    { name: "Leather Interior", value: 10, reason: "Leather seat material", present: /leather/i.test(v.seat_material_primary || "") },
    { name: "Air Conditioning", value: 10, reason: "Climate control equipped", present: /air.?conditioning|climate|a\/c/i.test(v.equipment || v.highlights || "") },
    { name: "Power Steering", value: 5, reason: "Power-assisted steering", present: /power/i.test(v.steering_type || "") || /power/i.test(v.steering_pump || "") },
    { name: "ABS", value: 3, reason: "Safety/comfort from ABS", present: !!v.abs_equipped },
  ];

  // Provenance factors
  const provBonuses: ScoreBonus[] = [
    { name: "VIN Present", value: 15, reason: "Vehicle identification number on file", present: !!v.vin },
    { name: "Owners Known", value: 10, reason: "Ownership history documented", present: v.previous_owners != null },
    { name: "Low Owners (≤3)", value: 10, reason: `${v.previous_owners || "?"} previous owners`, present: v.previous_owners != null && v.previous_owners <= 3 },
    { name: "Clean Title", value: 10, reason: "Clean title status verified", present: v.title_status === "clean" },
    { name: "Photo Documentation", value: Number(v.image_count) > 20 ? 10 : Number(v.image_count) > 5 ? 5 : 0, reason: `${v.image_count || 0} photos on file`, present: Number(v.image_count) > 5 },
    { name: "Detailed Description", value: 5, reason: "Comprehensive listing description", present: v.description && String(v.description).length > 200 },
    { name: "Highlights", value: 5, reason: "Key features documented", present: !!v.highlights },
    { name: "Service History", value: 10, reason: "Recent service records on file", present: !!v.recent_service_history },
  ];

  // Social positioning sub-explanation
  const social = computeSocialPositioning(v);
  const make = String(v.make || "").toLowerCase();

  return {
    power: {
      score: scores.perf_power_score,
      label: "Power",
      description: "Measures raw engine output relative to vehicle mass. Higher horsepower, torque, and better power-to-weight ratios yield higher scores.",
      factors: [
        { name: "Horsepower", raw: hp, normalized: hpScore, weight: 3, scale: `${REF.hp_min}–${REF.hp_max} hp` },
        { name: "Torque", raw: tq, normalized: tqScore, weight: 2, scale: `30–${REF.torque_max} lb-ft` },
        { name: "Power-to-Weight", raw: ptw, normalized: ptwScore, weight: 5, scale: `${REF.ptw_best}–${REF.ptw_worst} lb/hp (lower better)` },
      ],
      bonuses: engineBonuses,
      formula_hint: "weightedAvg([hp×3, torque×2, ptw×5]) + engineHealthBonus",
    },
    acceleration: {
      score: scores.perf_acceleration_score,
      label: "Acceleration",
      description: "How fast the vehicle gets off the line. Based on 0-60 times, quarter mile performance, and power-to-weight ratio as a proxy.",
      factors: [
        { name: "0-60 mph", raw: z60, normalized: z60Score, weight: 3, scale: `${REF.zero60_best}–${REF.zero60_worst}s (lower better)` },
        { name: "Quarter Mile", raw: qm, normalized: qmScore, weight: 2, scale: `${REF.quarter_best}–${REF.quarter_worst}s (lower better)` },
        { name: "Power-to-Weight", raw: ptw, normalized: ptwScore, weight: 1, scale: "Proxy for acceleration potential" },
      ],
      bonuses: [],
      formula_hint: "weightedAvg([0-60×3, qm×2, ptw×1])",
    },
    braking: {
      score: scores.perf_braking_score,
      label: "Braking",
      description: "Stopping power from 60 mph. Enhanced by brake component quality — disc brakes, ABS, and hydraulic boost systems contribute bonus points.",
      factors: [
        { name: "60-0 Distance", raw: brk, normalized: brkScore, weight: 3, scale: `${REF.braking_best}–${REF.braking_worst} ft (lower better)` },
        { name: "Brake Condition", raw: v.brake_condition_score, normalized: Number(v.brake_condition_score) || null, weight: 1, scale: "0–100 condition rating" },
      ],
      bonuses: brakeBonuses,
      formula_hint: "weightedAvg([60-0×3, condition×1]) + specBonuses",
    },
    handling: {
      score: scores.perf_handling_score,
      label: "Handling",
      description: "Cornering ability and chassis dynamics. Lateral G-force is primary, with condition scores for suspension, tires, and steering. Chassis specification bonuses for advanced components.",
      factors: [
        { name: "Lateral G", raw: latg, normalized: latgScore, weight: 3, scale: `${REF.lateral_g_worst}–${REF.lateral_g_best}g` },
        { name: "Suspension Condition", raw: v.suspension_condition_score, normalized: Number(v.suspension_condition_score) || null, weight: 1, scale: "0–100" },
        { name: "Tire Condition", raw: v.tire_condition_score, normalized: Number(v.tire_condition_score) || null, weight: 1, scale: "0–100" },
        { name: "Steering Condition", raw: v.steering_condition_score, normalized: Number(v.steering_condition_score) || null, weight: 1, scale: "0–100" },
      ],
      bonuses: handlingBonuses,
      formula_hint: "weightedAvg([latG×3, susp×1, tire×1, steer×1]) + specBonuses",
    },
    comfort: {
      score: scores.perf_comfort_score,
      label: "Comfort",
      description: "Livability and daily-driver suitability. Starts at baseline 50 and adjusts based on amenities, seating, climate control, and how road-friendly the car is.",
      factors: [
        { name: "Base Score", raw: 50, normalized: 50, weight: 1, scale: "Starting baseline" },
      ],
      bonuses: comfortBonuses,
      formula_hint: "base(50) + sum(amenityBonuses) − trackPenalty",
    },
    social: {
      score: scores.social_positioning_score,
      label: "Social Position",
      description: "How this vehicle resonates across different buyer demographics. Each sub-score measures appeal to a specific audience based on make, era, price, performance, and body style.",
      factors: [
        { name: "Enthusiast Appeal", raw: social.enthusiast_appeal, normalized: social.enthusiast_appeal, weight: 15, scale: "Car guys / track day crowd" },
        { name: "Luxury Collector", raw: social.luxury_collector, normalized: social.luxury_collector, weight: 20, scale: "High-net-worth collectors" },
        { name: "Investment Grade", raw: social.investment_grade, normalized: social.investment_grade, weight: 15, scale: "Financial investors" },
        { name: "Weekend Cruiser", raw: social.weekend_cruiser, normalized: social.weekend_cruiser, weight: 10, scale: "Casual weekend driver" },
        { name: "Show Circuit", raw: social.show_circuit, normalized: social.show_circuit, weight: 15, scale: "Concours / car show crowd" },
        { name: "Youth Appeal", raw: social.youth_appeal, normalized: social.youth_appeal, weight: 5, scale: "Under-30 appeal" },
        { name: "Heritage Prestige", raw: social.heritage_prestige, normalized: social.heritage_prestige, weight: 20, scale: "Historical significance" },
      ],
      bonuses: [
        { name: "Prestige Make", value: 0, reason: `${v.make} — ${PRESTIGE_MAKES.has(make) ? "prestige manufacturer" : "standard manufacturer"}`, present: PRESTIGE_MAKES.has(make) },
        { name: "Muscle Car", value: 0, reason: `${v.make} — ${MUSCLE_MAKES.has(make) ? "American muscle heritage" : "non-muscle"}`, present: MUSCLE_MAKES.has(make) },
        { name: "JDM", value: 0, reason: `${v.make} — ${JAPANESE_SPORT.has(make) ? "Japanese sports car culture" : "non-JDM"}`, present: JAPANESE_SPORT.has(make) },
      ],
      formula_hint: "enthusiast×0.15 + luxury×0.20 + invest×0.15 + cruiser×0.10 + show×0.15 + youth×0.05 + heritage×0.20",
    },
    investment: {
      score: scores.investment_quality_score,
      label: "Investment Quality",
      description: "How strong this vehicle is as a financial investment. Blends social investment grade with market data (deal score, heat score), valuation confidence, and physical condition.",
      factors: [
        { name: "Social Investment Grade", raw: social.investment_grade, normalized: social.investment_grade, weight: 3, scale: "From social positioning engine" },
        { name: "Deal Score", raw: v.deal_score, normalized: v.deal_score ? Math.round(Number(v.deal_score)) : null, weight: 2, scale: "Market deal rating" },
        { name: "Heat Score", raw: v.heat_score, normalized: v.heat_score ? Math.round(Number(v.heat_score)) : null, weight: 1, scale: "Market demand indicator" },
        { name: "Valuation Confidence", raw: v.nuke_estimate_confidence, normalized: Number(v.nuke_estimate_confidence) || null, weight: 1, scale: "Nuke estimate confidence %" },
        { name: "Condition Rating", raw: v.condition_rating, normalized: v.condition_rating ? Math.round((Number(v.condition_rating) / 10) * 100) : null, weight: 1, scale: "Physical condition /10" },
      ],
      bonuses: [],
      formula_hint: "weightedAvg([socialInvest×3, deal×2, heat×1, confidence×1, condition×1])",
    },
    provenance: {
      score: scores.provenance_score,
      label: "Provenance",
      description: "Documentation quality and ownership history. Every verifiable fact adds points — VIN, title, ownership chain, service records, and photographic evidence.",
      factors: [
        { name: "Base Score", raw: 20, normalized: 20, weight: 1, scale: "Starting baseline" },
      ],
      bonuses: provBonuses,
      formula_hint: "base(20) + sum(documentationBonuses)",
    },
    overall: {
      score: scores.overall_desirability_score,
      label: "Overall Desirability",
      description: "The master score. Weighted blend of all dimensions — performance, social appeal, investment quality, and provenance.",
      factors: [
        { name: "Power", raw: scores.perf_power_score, normalized: scores.perf_power_score, weight: 2, scale: "Performance dimension" },
        { name: "Acceleration", raw: scores.perf_acceleration_score, normalized: scores.perf_acceleration_score, weight: 2, scale: "Performance dimension" },
        { name: "Braking", raw: scores.perf_braking_score, normalized: scores.perf_braking_score, weight: 1, scale: "Performance dimension" },
        { name: "Handling", raw: scores.perf_handling_score, normalized: scores.perf_handling_score, weight: 1, scale: "Performance dimension" },
        { name: "Comfort", raw: scores.perf_comfort_score, normalized: scores.perf_comfort_score, weight: 1, scale: "Livability dimension" },
        { name: "Social", raw: scores.social_positioning_score, normalized: scores.social_positioning_score, weight: 2, scale: "Market appeal" },
        { name: "Investment", raw: scores.investment_quality_score, normalized: scores.investment_quality_score, weight: 1, scale: "Financial quality" },
        { name: "Provenance", raw: scores.provenance_score, normalized: scores.provenance_score, weight: 1, scale: "Documentation quality" },
      ],
      bonuses: [],
      formula_hint: "weightedAvg([power×2, accel×2, brake×1, handle×1, comfort×1, social×2, invest×1, prov×1])",
    },
  };
}

// ---------------------------------------------------------------------------
// Main score calculator
// ---------------------------------------------------------------------------

function calculateScores(v: any) {
  const hp = Number(v.horsepower) || null;
  const tq = Number(v.torque) || null;
  const wt = Number(v.weight_lbs) || null;
  const z60 = Number(v.zero_to_sixty) || null;
  const qm = Number(v.quarter_mile) || null;
  const ts = Number(v.top_speed_mph) || null;
  const brk = Number(v.braking_60_0_ft) || null;
  const latg = Number(v.lateral_g) || null;

  // Power-to-weight ratio (lbs per hp – lower is better)
  const ptw = hp && wt ? wt / hp : null;

  // POWER SCORE: based on raw HP and torque
  const hpScore = scaleUp(hp, REF.hp_min, REF.hp_max);
  const tqScore = scaleUp(tq, 30, REF.torque_max);
  const ptwScore = scaleDown(ptw, REF.ptw_best, REF.ptw_worst);
  const powerScore = weightedAvg([
    [hpScore, 3],
    [tqScore, 2],
    [ptwScore, 5],
  ]);

  // ACCELERATION SCORE
  const z60Score = scaleDown(z60, REF.zero60_best, REF.zero60_worst);
  const qmScore = scaleDown(qm, REF.quarter_best, REF.quarter_worst);
  const accelScore = weightedAvg([
    [z60Score, 3],
    [qmScore, 2],
    [ptwScore, 1], // power-to-weight as proxy if no timing data
  ]);

  // ENGINE HEALTH SCORE (from deep internals when available)
  let engineHealthBonus = 0;
  const engineHealthDirect = Number(v.engine_health_score) || null;
  if (engineHealthDirect != null) {
    engineHealthBonus = Math.round(engineHealthDirect * 0.1); // up to +10 on power
  }
  // Compression test analysis: low variance = healthy engine
  if (v.compression_test_psi && typeof v.compression_test_psi === "object") {
    const vals = Object.values(v.compression_test_psi as Record<string, number>).filter(
      (x) => typeof x === "number" && Number.isFinite(x)
    );
    if (vals.length >= 4) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const maxDev = Math.max(...vals.map((x) => Math.abs(x - avg)));
      // Under 10 PSI deviation = excellent; over 30 = bad
      if (maxDev < 10) engineHealthBonus += 5;
      else if (maxDev > 30) engineHealthBonus -= 5;
    }
  }

  // Adjust power score with engine health
  const adjustedPowerScore = powerScore != null ? Math.max(0, Math.min(100, powerScore + engineHealthBonus)) : null;

  // BRAKING SCORE (enhanced with deep brake specs)
  const brkScore = scaleDown(brk, REF.braking_best, REF.braking_worst);
  const brakeCondScore = Number(v.brake_condition_score) || null;
  let brakeSpecBonus = 0;
  if (/disc/i.test(`${v.brake_type_front} ${v.brake_type_rear}`)) brakeSpecBonus += 5;
  if (v.abs_equipped) brakeSpecBonus += 3;
  if (/hydroboost/i.test(v.brake_booster_type || "")) brakeSpecBonus += 3;
  const brakingScore = weightedAvg([
    [brkScore, 3],
    [brakeCondScore, 1],
  ]);
  const adjustedBrakingScore = brakingScore != null
    ? Math.max(0, Math.min(100, brakingScore + brakeSpecBonus))
    : brakeSpecBonus > 0 ? Math.min(100, 40 + brakeSpecBonus) : null;

  // HANDLING SCORE (enhanced with steering and chassis data)
  const latgScore = scaleUp(latg, REF.lateral_g_worst, REF.lateral_g_best);
  const suspCondScore = Number(v.suspension_condition_score) || null;
  const tireCondScore = Number(v.tire_condition_score) || null;
  const steeringCondScore = Number(v.steering_condition_score) || null;
  let handlingSpecBonus = 0;
  if (/rack.?and.?pinion/i.test(v.steering_type || "")) handlingSpecBonus += 5;
  if (/independent/i.test(`${v.suspension_front} ${v.suspension_rear}`)) handlingSpecBonus += 5;
  if (/limited.?slip|posi/i.test(v.rear_axle_type || "")) handlingSpecBonus += 3;
  const handlingScoreRaw = weightedAvg([
    [latgScore, 3],
    [suspCondScore, 1],
    [tireCondScore, 1],
    [steeringCondScore, 1],
  ]);
  const handlingScore = handlingScoreRaw != null
    ? Math.max(0, Math.min(100, handlingScoreRaw + handlingSpecBonus))
    : handlingSpecBonus > 0 ? Math.min(100, 40 + handlingSpecBonus) : null;

  // AERO SCORE (for fun – from drag coefficient and body mods)
  let aeroScore: number | null = null;
  const cd = Number(v.drag_coefficient) || null;
  if (cd != null) {
    // Cd ranges: 0.25 (sleek) to 0.60 (brick). Lower = better.
    aeroScore = scaleDown(cd, 0.25, 0.60);
  }
  // Lift = worse aero, lower = better
  const liftInches = Number(v.lift_inches) || 0;
  if (aeroScore != null && liftInches > 0) {
    aeroScore = Math.max(0, aeroScore - liftInches * 3); // -3 pts per inch of lift
  }
  if (v.has_spoiler) aeroScore = (aeroScore || 40) + 3;
  if (v.has_air_dam) aeroScore = (aeroScore || 40) + 3;

  // COMFORT SCORE (inverse of track focus, enhanced with steering/brake detail)
  let comfortBase = 50; // default midpoint
  if (v.seats && Number(v.seats) >= 4) comfortBase += 10;
  if (v.is_daily_driver) comfortBase += 15;
  if (v.is_track_car) comfortBase -= 20;
  if (/leather/i.test(v.seat_material_primary || "")) comfortBase += 10;
  if (/air.?conditioning|climate|a\/c/i.test(v.equipment || v.highlights || "")) comfortBase += 10;
  if (/power/i.test(v.steering_type || "") || /power/i.test(v.steering_pump || "")) comfortBase += 5;
  if (v.abs_equipped) comfortBase += 3;
  const comfortScore = Math.max(0, Math.min(100, Math.round(comfortBase)));

  // SOCIAL POSITIONING
  const social = computeSocialPositioning(v);

  // INVESTMENT QUALITY
  const dealScore = Number(v.deal_score) || null;
  const heatScore = Number(v.heat_score) || null;
  const nukeConfidence = Number(v.nuke_estimate_confidence) || null;
  const condRating = v.condition_rating ? (Number(v.condition_rating) / 10) * 100 : null;
  const investScore = weightedAvg([
    [social.investment_grade, 3],
    [dealScore ? Math.round(dealScore) : null, 2],
    [heatScore ? Math.round(heatScore) : null, 1],
    [nukeConfidence, 1],
    [condRating, 1],
  ]);

  // PROVENANCE SCORE
  let provBase = 20;
  if (v.vin) provBase += 15;
  if (v.previous_owners != null) provBase += 10;
  if (v.previous_owners != null && v.previous_owners <= 3) provBase += 10;
  if (v.title_status === "clean") provBase += 10;
  const imageCount = Number(v.image_count) || 0;
  if (imageCount > 20) provBase += 10;
  else if (imageCount > 5) provBase += 5;
  if (v.description && String(v.description).length > 200) provBase += 5;
  if (v.highlights) provBase += 5;
  if (v.recent_service_history) provBase += 10;
  const provenanceScore = Math.max(0, Math.min(100, Math.round(provBase)));

  // OVERALL DESIRABILITY
  const overallScore = weightedAvg([
    [powerScore, 2],
    [accelScore, 2],
    [brakingScore, 1],
    [handlingScore, 1],
    [comfortScore, 1],
    [social.overall, 2],
    [investScore, 1],
    [provenanceScore, 1],
  ]);

  return {
    power_to_weight: ptw ? Math.round(ptw * 100) / 100 : null,
    perf_power_score: adjustedPowerScore,
    perf_acceleration_score: accelScore,
    perf_braking_score: adjustedBrakingScore,
    perf_handling_score: handlingScore,
    perf_comfort_score: comfortScore,
    social_positioning_score: social.overall,
    social_positioning_breakdown: social,
    investment_quality_score: investScore,
    provenance_score: provenanceScore,
    overall_desirability_score: overallScore,
  };
}

// ---------------------------------------------------------------------------
// Edge function handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({}));
    const vehicleId = (body as any)?.vehicle_id;
    const batch = (body as any)?.batch === true;
    const explain = (body as any)?.action === "explain";
    const batchLimit = Math.max(1, Math.min(500, Number((body as any)?.limit ?? 50)));

    if (!vehicleId && !batch) {
      return new Response(
        JSON.stringify({ error: "Provide vehicle_id or batch:true" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // EXPLAIN action: return full algorithm breakdown for a single vehicle
    if (explain && vehicleId) {
      const { data: veh, error: vehErr } = await supabase
        .from("vehicles")
        .select(`
          id, year, make, model, body_style, canonical_body_style,
          horsepower, torque, weight_lbs, drivetrain,
          zero_to_sixty, quarter_mile, quarter_mile_speed, top_speed_mph,
          braking_60_0_ft, lateral_g, redline_rpm,
          engine_type, engine_liters, engine_displacement,
          transmission_type,
          suspension_front, suspension_rear,
          brake_type_front, brake_type_rear,
          brake_condition_score, suspension_condition_score, tire_condition_score,
          wheel_diameter_front, wheel_diameter_rear,
          tire_spec_front, tire_spec_rear,
          seats, seat_material_primary,
          compression_test_psi, leakdown_test_pct, engine_health_score,
          rear_axle_type, steering_type, steering_pump, steering_condition_score,
          brake_booster_type, abs_equipped,
          drag_coefficient, lift_inches, has_spoiler, has_air_dam,
          condition_rating, previous_owners, vin,
          is_daily_driver, is_weekend_car, is_track_car, is_show_car, is_modified,
          sale_price, asking_price, current_value, nuke_estimate, nuke_estimate_confidence,
          deal_score, heat_score, signal_score,
          investment_grade, investment_confidence,
          description, highlights, equipment, modifications,
          recent_service_history, title_status,
          provenance_score, is_public
        `)
        .eq("id", vehicleId)
        .single();

      if (vehErr || !veh) {
        return new Response(
          JSON.stringify({ error: "Vehicle not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Get image count
      const { data: imgs } = await supabase
        .from("vehicle_images")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicleId);

      const enriched = { ...veh, image_count: imgs?.length || 0 };
      const breakdown = explainScores(enriched);

      // Also fetch recent comments for source data
      const { data: comments } = await supabase
        .from("auction_comments")
        .select("id, comment_text, username, posted_at, sentiment_label")
        .eq("vehicle_id", vehicleId)
        .order("posted_at", { ascending: false })
        .limit(20);

      // Fetch comment discoveries for AI analysis
      const { data: discoveries } = await supabase
        .from("comment_discoveries")
        .select("id, overall_sentiment, sentiment_score, key_themes, notable_observations")
        .eq("vehicle_id", vehicleId)
        .limit(1);

      return new Response(
        JSON.stringify({
          vehicle_id: vehicleId,
          vehicle_title: `${veh.year || ""} ${veh.make || ""} ${veh.model || ""}`.trim(),
          breakdown,
          source_data: {
            recent_comments: (comments || []).map((c: any) => ({
              text: c.comment_text?.slice(0, 300),
              user: c.username,
              date: c.posted_at,
              sentiment: c.sentiment_label,
            })),
            ai_analysis: discoveries?.[0] || null,
            comment_count: comments?.length || 0,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch vehicles
    let query = supabase
      .from("vehicles")
      .select(`
        id, year, make, model, body_style, canonical_body_style,
        horsepower, torque, weight_lbs, drivetrain,
        zero_to_sixty, quarter_mile, quarter_mile_speed, top_speed_mph,
        braking_60_0_ft, lateral_g, redline_rpm,
        engine_type, engine_liters, engine_displacement,
        transmission_type,
        suspension_front, suspension_rear,
        brake_type_front, brake_type_rear,
        brake_condition_score, suspension_condition_score, tire_condition_score,
        wheel_diameter_front, wheel_diameter_rear,
        tire_spec_front, tire_spec_rear,
        seats, seat_material_primary,
        compression_test_psi, leakdown_test_pct, engine_health_score,
        rear_axle_type, steering_type, steering_pump, steering_condition_score,
        brake_booster_type, abs_equipped, brake_type_front, brake_type_rear,
        drag_coefficient, lift_inches, has_spoiler, has_air_dam,
        condition_rating, previous_owners, vin,
        is_daily_driver, is_weekend_car, is_track_car, is_show_car, is_modified,
        sale_price, asking_price, current_value, nuke_estimate, nuke_estimate_confidence,
        deal_score, heat_score, signal_score,
        investment_grade, investment_confidence,
        description, highlights, equipment, modifications,
        recent_service_history, title_status,
        provenance_score,
        is_public
      `);

    if (vehicleId) {
      query = query.eq("id", vehicleId);
    } else {
      // Batch: vehicles that have at least some data but missing scores
      query = query
        .is("perf_scores_updated_at", null)
        .not("horsepower", "is", null)
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(batchLimit);
    }

    const { data: vehicles, error: fetchError } = await query;
    if (fetchError) throw fetchError;
    if (!vehicles || vehicles.length === 0) {
      return new Response(
        JSON.stringify({ message: "No vehicles to process", processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Also fetch image counts for provenance scoring
    const vehicleIds = vehicles.map((v: any) => v.id);
    const { data: imgCounts } = await supabase
      .from("vehicle_images")
      .select("vehicle_id")
      .in("vehicle_id", vehicleIds);

    const imageCountMap: Record<string, number> = {};
    (imgCounts || []).forEach((row: any) => {
      const vid = String(row.vehicle_id);
      imageCountMap[vid] = (imageCountMap[vid] || 0) + 1;
    });

    // Calculate and update each vehicle
    let processed = 0;
    const results: Array<{ id: string; scores: any }> = [];

    for (const v of vehicles) {
      const enriched = { ...v, image_count: imageCountMap[v.id] || 0 };
      const scores = calculateScores(enriched);

      const { error: updateError } = await supabase
        .from("vehicles")
        .update({
          power_to_weight: scores.power_to_weight,
          perf_power_score: scores.perf_power_score,
          perf_acceleration_score: scores.perf_acceleration_score,
          perf_braking_score: scores.perf_braking_score,
          perf_handling_score: scores.perf_handling_score,
          perf_comfort_score: scores.perf_comfort_score,
          social_positioning_score: scores.social_positioning_score,
          social_positioning_breakdown: scores.social_positioning_breakdown,
          investment_quality_score: scores.investment_quality_score,
          provenance_score: scores.provenance_score,
          overall_desirability_score: scores.overall_desirability_score,
          perf_scores_updated_at: new Date().toISOString(),
        })
        .eq("id", v.id);

      if (!updateError) {
        processed++;
        results.push({ id: v.id, scores });
      }
    }

    return new Response(
      JSON.stringify({
        processed,
        total: vehicles.length,
        results: vehicleId ? results[0]?.scores : undefined,
        sample: batch ? results.slice(0, 3).map((r) => ({
          id: r.id,
          power: r.scores.perf_power_score,
          social: r.scores.social_positioning_score,
          overall: r.scores.overall_desirability_score,
        })) : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("calculate-vehicle-scores error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
