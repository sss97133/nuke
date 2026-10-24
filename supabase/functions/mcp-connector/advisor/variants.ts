/**
 * Variant / trim / URL helpers shared by evaluate_listing, value_asset, and get_comps.
 * Never invent identity — these only classify text already present.
 */

export type VariantKey =
  | "turbo_s"
  | "turbo"
  | "gt2"
  | "gt3"
  | "rs"
  | "speedster"
  | "gunther_werks"
  | "restomod"
  | "base";

const VARIANT_RULES: Array<{ key: Exclude<VariantKey, "base">; re: RegExp }> = [
  { key: "gunther_werks", re: /gunther\s*werks|g[uü]nther\s*werks/i },
  { key: "turbo_s", re: /turbo\s*[\-_]?s\b/i },
  { key: "gt2", re: /\bgt[\s\-]?2\b/i },
  { key: "gt3", re: /\bgt[\s\-]?3\b/i },
  { key: "rs", re: /\b(?:carrera\s*)?rs\b|\b911\s*rs\b/i },
  { key: "speedster", re: /speedster/i },
  { key: "turbo", re: /\bturbo\b/i },
  { key: "restomod", re: /restomod|singer\b/i },
];

/** Highest-priority specialty variant present in text, or base. */
export function detectVariant(text: string | null | undefined): VariantKey {
  const t = text || "";
  if (!t.trim()) return "base";
  for (const rule of VARIANT_RULES) {
    if (rule.re.test(t)) return rule.key;
  }
  return "base";
}

/** Specialty markers that must not contaminate a base-car cohort (and vice versa). */
export function specialtyVariants(v: VariantKey): boolean {
  return v !== "base";
}

/**
 * True when a candidate should be excluded from the subject's sold-comp pool.
 * - Base subject: drop Turbo / RS / Speedster / Gunther / GT2/3 / restomod.
 * - Specialty subject: drop comps that lack the same specialty (or a stricter sibling).
 */
export function isVariantMismatch(subject: VariantKey, candidate: VariantKey): boolean {
  if (subject === "base") return specialtyVariants(candidate);
  if (candidate === "base") return true;
  if (subject === candidate) return false;
  // Turbo S may use Turbo comps; Gunther is its own cohort.
  if (subject === "turbo_s" && candidate === "turbo") return false;
  if (subject === "turbo" && candidate === "turbo_s") return false;
  if (subject === "restomod" && candidate === "gunther_werks") return false;
  if (subject === "gunther_werks" && candidate === "restomod") return false;
  return true;
}

/**
 * Porsche 911 generation (930 / 964 / 993 / 996 / 997 / 991 / 992) from explicit text first, then
 * model year. A 993 Turbo and a 964 Turbo 3.6 are both "turbo" but are different cars at very
 * different prices, so comps must match generation too. Returns null when not a 911 or the year
 * straddles a changeover without a text cue (unknown never excludes).
 */
export type Porsche911Generation = "901" | "930" | "964" | "993" | "996" | "997" | "991" | "992";

export function detectGeneration(input: {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  text?: string | null;
}): Porsche911Generation | null {
  const blob = `${input.make || ""} ${input.model || ""} ${input.text || ""}`.toLowerCase();
  const isPorsche = /porsche/.test(blob);
  const is911 = /\b911\b|\b9(?:30|64|93|96|97|91|92)\b|carrera|\bturbo\b|\bgt[\s-]?[23]\b|targa|speedster/.test(blob);
  const otherModel = /\b(?:356|912|914|924|928|944|968|959|918)\b|boxster|cayman|cayenne|macan|panamera|taycan|carrera\s*gt\b/.test(blob) &&
    !/\b911\b/.test(blob);
  if (!isPorsche || !is911 || otherModel) return null;
  // Explicit generation codes win (e.g. "964 Turbo 3.6", "993 Carrera 4S"). Skip "911" itself.
  const code = blob.match(/(?:^|[^0-9.])(930|964|993|996|997|991|992)(?![0-9])(?!\s*(?:k\b|mi\b|miles|km))/);
  if (code) return code[1] as Porsche911Generation;
  const y = input.year ?? null;
  if (y == null || !Number.isFinite(y)) return null;
  const turbo = /\bturbo\b/.test(blob);
  if (turbo) {
    // 930 Turbo ran 1975-1989; 964 Turbo 1991-1994; 993 Turbo 1995-1998 (1996+ US).
    if (y >= 1975 && y <= 1989) return "930";
    if (y >= 1990 && y <= 1994) return "964";
    if (y >= 1995 && y <= 1998) return "993";
  }
  if (y >= 1964 && y <= 1988) return "901";
  if (y === 1989) return null; // 3.2 Carrera and 964 C4 overlap
  if (y >= 1990 && y <= 1994) return "964";
  if (y >= 1995 && y <= 1998) return "993";
  if (y >= 1999 && y <= 2004) return "996";
  if (y === 2005) return null; // 996 and 997 overlap
  if (y >= 2006 && y <= 2011) return "997";
  if (y === 2012) return null; // 997 and 991 overlap
  if (y >= 2013 && y <= 2018) return "991";
  if (y === 2019) return null; // 991 and 992 overlap
  if (y >= 2020) return "992";
  return null;
}

/** 964 Turbo came as 3.3 (1991-92) and 3.6 (1993-94); explicit displacement only, never guessed. */
export function detectTurboDisplacement(text: string | null | undefined): "3.3" | "3.6" | null {
  const t = (text || "").toLowerCase();
  if (!/\bturbo\b/.test(t)) return null;
  if (/\b3[.,]6\b/.test(t)) return "3.6";
  if (/\b3[.,]3\b/.test(t)) return "3.3";
  return null;
}

/** True when subject and candidate are different 911 generations (or 3.3 vs 3.6 Turbo). Unknown keeps. */
export function isGenerationMismatch(
  subject: { make?: string | null; model?: string | null; year?: number | null; text?: string | null },
  candidate: { make?: string | null; model?: string | null; year?: number | null; text?: string | null },
): boolean {
  const sg = detectGeneration(subject);
  const cg = detectGeneration({ ...candidate, make: candidate.make || subject.make });
  if (sg && cg && sg !== cg) return true;
  const sd = detectTurboDisplacement(`${subject.model || ""} ${subject.text || ""}`);
  const cd = detectTurboDisplacement(`${candidate.model || ""} ${candidate.text || ""}`);
  return !!(sd && cd && sd !== cd);
}

/** Normalize listing URLs for dedupe (trailing slash, quotes, marketplace- prefix). */
export function canonicalListingUrl(url: string | null | undefined): string {
  if (!url) return "";
  let u = String(url).trim();
  // Quoted title stuck to URL: `"Title"https://...` or trailing `"`.
  u = u.replace(/^["']+/, "").replace(/["']+$/, "");
  const httpIdx = u.search(/https?:\/\//i);
  if (httpIdx > 0) u = u.slice(httpIdx);
  u = u.replace(/\/$/, "").toLowerCase();
  u = u.replace(/marketplace-/i, "");
  u = u.replace(/\/(auction|marketplace)\//, "/");
  return u;
}

/** Strip a quoted title glued onto a URL field. */
export function cleanListingUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  const httpIdx = raw.search(/https?:\/\//i);
  const cleaned = (httpIdx >= 0 ? raw.slice(httpIdx) : raw).replace(/["']+$/, "").trim();
  return cleaned || null;
}

/**
 * Flag likely parts / junk sales (not whole-car comps).
 * Uses title/URL language and extreme low prices for the year/make cohort.
 */
export function isLikelyPartsSale(input: {
  title?: string | null;
  url?: string | null;
  model?: string | null;
  sale_price?: number | null;
  year?: number | null;
}): { parts: boolean; reason: string | null } {
  const blob = `${input.title || ""} ${input.url || ""} ${input.model || ""}`.toLowerCase();
  if (/\bparts?\b|parting\s*out|project\s*car\s*for\s*parts|rolling\s*chassis|shell\s*only/.test(blob)) {
    return { parts: true, reason: "title_or_url_parts_language" };
  }
  const price = input.sale_price;
  if (price != null && price > 0 && price < 8000) {
    // Air-cooled / exotic whole cars almost never hammer under $8k as complete cars.
    if (/911|porsche|ferrari|lamborghini|gt2|gt3|turbo/i.test(blob) || (input.year != null && input.year <= 1998)) {
      return { parts: true, reason: "implausibly_low_price_for_complete_car" };
    }
  }
  return { parts: false, reason: null };
}

/** Soft similarity 0..1 from shared attributes (never a constant). */
export function scoreSimilarity(input: {
  subject: {
    year?: number | null;
    variant: VariantKey;
    body?: string | null;
    transmission?: string | null;
    mileage?: number | null;
    model?: string | null;
  };
  candidate: {
    year?: number | null;
    variant: VariantKey;
    body?: string | null;
    transmission?: string | null;
    mileage?: number | null;
    model?: string | null;
    sale_price?: number | null;
  };
}): number {
  let score = 0.35;
  const { subject: s, candidate: c } = input;
  if (s.year != null && c.year != null) {
    const dy = Math.abs(s.year - c.year);
    if (dy === 0) score += 0.18;
    else if (dy === 1) score += 0.12;
    else if (dy === 2) score += 0.06;
    else if (dy >= 5) score -= 0.08;
  }
  if (s.variant === c.variant) score += 0.22;
  else if (!isVariantMismatch(s.variant, c.variant)) score += 0.1;
  else score -= 0.25;
  if (s.body && c.body && s.body === c.body) score += 0.08;
  if (s.transmission && c.transmission) {
    const st = s.transmission.toLowerCase();
    const ct = c.transmission.toLowerCase();
    if (st === ct || (st.includes("manual") && ct.includes("manual"))) score += 0.06;
  }
  if (s.mileage != null && c.mileage != null && s.mileage > 0) {
    const ratio = Math.abs(c.mileage - s.mileage) / Math.max(s.mileage, 1);
    if (ratio <= 0.25) score += 0.08;
    else if (ratio <= 0.5) score += 0.03;
  }
  if (s.model && c.model) {
    const sm = s.model.toLowerCase();
    const cm = c.model.toLowerCase();
    if (sm === cm || sm.includes(cm) || cm.includes(sm)) score += 0.05;
  }
  return Math.max(0.05, Math.min(0.98, Number(score.toFixed(3))));
}

/**
 * If a model estimate is more than 3× off a same-asset sale within 90 days,
 * return a guard payload (caller lowers confidence and may rebases the estimate).
 */
export function recentSaleSanityGuard(input: {
  estimate: number | null;
  saleAmount: number | null;
  saleOn: string | null;
  nowMs?: number;
}): {
  triggered: boolean;
  ratio: number | null;
  days_since_sale: number | null;
  message: string | null;
} {
  if (input.estimate == null || input.saleAmount == null || !(input.saleAmount > 0) || !input.saleOn) {
    return { triggered: false, ratio: null, days_since_sale: null, message: null };
  }
  const t = Date.parse(input.saleOn);
  if (!Number.isFinite(t)) {
    return { triggered: false, ratio: null, days_since_sale: null, message: null };
  }
  const days = Math.round(((input.nowMs ?? Date.now()) - t) / 86_400_000);
  if (days < 0 || days > 90) {
    return { triggered: false, ratio: null, days_since_sale: days, message: null };
  }
  const ratio = input.estimate / input.saleAmount;
  if (ratio <= 3 && ratio >= 1 / 3) {
    return { triggered: false, ratio, days_since_sale: days, message: null };
  }
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return {
    triggered: true,
    ratio,
    days_since_sale: days,
    message:
      `Valuation ${money(input.estimate)} is more than 3× off this asset's sale of ` +
      `${money(input.saleAmount)} on ${input.saleOn.slice(0, 10)} (${days}d ago); confidence lowered.`,
  };
}

/** Pull year/make/model/turbo cues from a listing URL slug when HTML is empty (JS shells). */
export function identityFromListingUrl(url: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  title: string | null;
  auction_id: string | null;
} {
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  let title: string | null = null;
  let auction_id: string | null = null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const parts = u.pathname.split("/").filter(Boolean);
    const auctionsIdx = parts.findIndex((p) => p === "auctions" || p === "auction");
    if (auctionsIdx >= 0 && parts[auctionsIdx + 1]) {
      auction_id = parts[auctionsIdx + 1]!;
    }
    const slug = parts[parts.length - 1] || "";
    const tokens = slug.toLowerCase().split(/[-_]+/).filter(Boolean);
    const yearTok = tokens.find((t) => /^(19|20)\d{2}$/.test(t));
    if (yearTok) year = Number(yearTok);
    const makes: Record<string, string> = {
      porsche: "Porsche",
      volkswagen: "Volkswagen",
      vw: "Volkswagen",
      bmw: "BMW",
      mercedes: "Mercedes-Benz",
      ford: "Ford",
      chevrolet: "Chevrolet",
      chevy: "Chevrolet",
      ferrari: "Ferrari",
      toyota: "Toyota",
      honda: "Honda",
      nissan: "Nissan",
      audi: "Audi",
      mazda: "Mazda",
    };
    for (const t of tokens) {
      if (makes[t]) {
        make = makes[t]!;
        break;
      }
    }
    const modelBits: string[] = [];
    if (tokens.includes("911")) modelBits.push("911");
    if (tokens.includes("turbo") && !tokens.includes("non")) {
      modelBits.push(tokens.includes("s") && tokens.indexOf("s") > tokens.indexOf("turbo") ? "Turbo S" : "Turbo");
    }
    if (tokens.includes("carrera")) modelBits.push("Carrera");
    if (tokens.includes("speedster")) modelBits.push("Speedster");
    if (tokens.includes("cabriolet") || tokens.includes("cabrio") || tokens.includes("convertible")) {
      modelBits.push("Cabriolet");
    } else if (tokens.includes("coupe") || tokens.includes("coupé")) {
      modelBits.push("Coupe");
    }
    if (tokens.includes("targa")) modelBits.push("Targa");
    if (modelBits.length) model = modelBits.join(" ");
    if (year || make || model) {
      title = [year, make, model].filter(Boolean).join(" ");
    }
  } catch {
    /* ignore */
  }
  return { year, make, model, title, auction_id };
}
