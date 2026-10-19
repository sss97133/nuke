/**
 * Pure multi-axis taxonomy & facet extractor (`series`, `trim`, `body_style`)
 * and canonical model normalizer for Cars & Bids listings.
 *
 * Aligns Cars & Bids lots with the Nuke multi-axis taxonomy across:
 *   - Porsche 911 / 356 / Boxster / Cayman / Cayenne / Macan / Panamera / Taycan
 *   - BMW M3 / M5 / M2 / M4 / M6 / 2002 / 3-Series / 5-Series / Z3 / Z4 / 8-Series
 *   - Toyota Land Cruiser (J40/J43/J45/J55/J60/J70/J80/J100/J200/J250/J300) / Supra / 4Runner / Tacoma / FJ Cruiser
 *   - Chevrolet / GMC Corvette (C1-C8, Z06, ZR1, Grand Sport, Stingray), Pickup & SUV (C10/K10/C20/K20/C30/K30/1500/2500/3500/3100/K5 Blazer/Silverado/Sierra), Camaro, Chevelle
 *   - Ford Bronco (U13/U14/U15/Raptor/Wildtrak/Badlands/First Edition/Eddie Bauer/XLT), Mustang (Shelby GT350/GT500/Boss 302/Mach 1/Bullitt/Cobra), F-Series (F-100/F-150/F-250/F-350/Raptor/Lightning)
 *   - Mercedes-Benz SL (W198/W121/W113/R107/R129/R230/R231), AMG (C63/E55/E63/S55/S63/SL55/SL63/G55/G63/AMG GT/Black Series), G-Class (W460/W461/W463)
 *   - Dodge / Plymouth / RAM, Pontiac (GTO / The Judge / Firebird Trans Am), Jaguar (E-Type / XK / F-Type), Audi (RS/S), Volkswagen, Subaru, Nissan/Datsun, Mazda Miata, Jeep Wrangler, Land Rover Defender/Range Rover, Rivian, Tesla, Lexus
 */

export interface CabFacetInput {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  title?: string | null;
  subTitle?: string | null;
  highlights?: string | null;
  existingSeries?: string | null;
  existingTrim?: string | null;
  existingBodyStyle?: string | null;
}

export interface CabFacetResult {
  normalizedModel: string | null;
  series: string | null;
  trim: string | null;
  body_style: string | null;
}

/**
 * Cleans Cars & Bids raw model or title strings (e.g. strips trailing "Watch" UI artifact,
 * normalizes C&B's chassis-prefixed models like "991 911" -> "911" or "E46 M3" -> "M3" or "F8X M4" -> "M4"
 * when appropriate, while preserving full sub-model detail in title/series/trim).
 */
export function cleanCabText(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .replace(/Watch$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractCabFacets(input: CabFacetInput): CabFacetResult {
  const year = typeof input.year === "number" && Number.isFinite(input.year) ? input.year : null;
  const brand = cleanCabText(input.make).toLowerCase();
  const rawModel = cleanCabText(input.model);
  const rawTitle = cleanCabText(input.title);
  const rawSubTitle = cleanCabText(input.subTitle);

  // Strip " — <subtitle>" from title and strip leading mileage/year prefix (e.g. "14k-Mile 2002 ")
  // so model/year numbers like "2002" or "1968" or "1900" don't collide with model codes like BMW 2002 or Porsche 911/964/993!
  const headlineCore = rawTitle.split(/\s+[—–-]\s+/)[0].trim();
  const headlineWithoutYearPrefix = headlineCore.replace(/^(?:[\d,]+\s*k?-?\s*mile\s+|modified\s+)*(?:19\d{2}|20[0-3]\d)\s+/i, "").trim();
  const coreHaystack = [headlineWithoutYearPrefix, rawModel].filter(Boolean).join(" ").toUpperCase();
  const fullHaystack = [headlineWithoutYearPrefix, rawModel, rawSubTitle, cleanCabText(input.highlights)]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  let normalizedModel: string | null = rawModel || null;
  let series: string | null = null;
  let trim: string | null = null;
  let bodyStyle: string | null = cleanCabText(input.existingBodyStyle) || null;

  // Normalize C&B's generic "SUV/Crossover" or "Van/Minivan" to cleaner canonical values when appropriate
  if (/^SUV\/Crossover$/i.test(bodyStyle ?? "")) bodyStyle = "SUV";
  if (/^Van\/Minivan$/i.test(bodyStyle ?? "")) bodyStyle = "Van";

  // ── 0. NORMALIZE C&B API MODEL NAMES THAT FAIL CANONICAL MODEL LOOKUP ──────
  if (normalizedModel) {
    // Strip leading generation prefixes when C&B API sets model = "F8X M4" / "E9X M3" / "E46 M3" / "991 911" / "C8 Corvette" / "NB Miata" / "B9 S4"
    if (brand === "ford" && /^Super\s+Duty$/i.test(normalizedModel)) {
      if (/\bF-?250\b/i.test(headlineCore)) normalizedModel = "F-250 Super Duty";
      else if (/\bF-?350\b/i.test(headlineCore)) normalizedModel = "F-350 Super Duty";
      else if (/\bF-?450\b/i.test(headlineCore)) normalizedModel = "F-450 Super Duty";
    } else if (brand === "bmw" && /^[2345678]\s+Series$/i.test(normalizedModel)) {
      const mMatch = headlineCore.match(/\b([1-8]\d{2}[A-Za-z]*(?:\s+xDrive)?|[M][234568]\d{0,2}[A-Za-z]*)\b/);
      if (mMatch) normalizedModel = mMatch[1];
    } else if (brand === "bmw" && /^02\s+Series$/i.test(normalizedModel)) {
      if (/\b2002\s*tii\b/i.test(headlineCore)) normalizedModel = "2002tii";
      else if (/\b2002\b/i.test(headlineCore)) normalizedModel = "2002";
      else if (/\b1600\b/i.test(headlineCore)) normalizedModel = "1600";
    } else if (brand === "mercedes-benz" && /^GLK-\s*Class$/i.test(normalizedModel)) {
      normalizedModel = "GLK-Class";
    }
  }

  // ── 1. SERIES EXTRACTION (MULTI-AXIS TAXONOMY) ─────────────────────────────

  // A. Chevrolet & GMC Pickups, Blazers, Corvettes, Camaros, Chevelles
  if (brand === "chevrolet" || brand === "gmc") {
    if (/\bCORVETTE\b/.test(coreHaystack)) {
      if (/\bZR[-\s]?1\b/.test(coreHaystack)) series = "ZR1 / ZR-1";
      else if (/\bZ06\b/.test(coreHaystack)) series = "Z06";
      else if (/\bGRAND\s+SPORT\b/.test(coreHaystack)) series = "Grand Sport";
      else if (/\bE[-\s]?RAY\b/.test(coreHaystack)) series = "E-Ray";
      else if (/\bL88\b/.test(fullHaystack)) series = "L88 427";
      else if (/\b427\b/.test(coreHaystack)) series = "427 Big-Block";
      else if (/\bFUEL\s+INJECTED\b|\bFUELIE\b/.test(fullHaystack)) series = "Fuel Injected";
      else if (/\bSTING\s+RAY\b/.test(coreHaystack) || (year && year >= 1963 && year <= 1967)) series = "Sting Ray (C2)";
      else if (/\bSTINGRAY\b/.test(coreHaystack)) series = "Stingray";
      else if (/\bC8\b/.test(coreHaystack) || (year && year >= 2020)) series = "C8 Corvette";
      else if (/\bC7\b/.test(coreHaystack) || (year && year >= 2014 && year <= 2019)) series = "C7 Corvette";
      else if (/\bC6\b/.test(coreHaystack) || (year && year >= 2005 && year <= 2013)) series = "C6 Corvette";
      else if (/\bC5\b/.test(coreHaystack) || (year && year >= 1997 && year <= 2004)) series = "C5 Corvette";
      else if (/\bC4\b/.test(coreHaystack) || (year && year >= 1984 && year <= 1996)) series = "C4 Corvette";
      else if (/\bC3\b/.test(coreHaystack) || (year && year >= 1968 && year <= 1982)) series = "Stingray";
      else if (/\bC1\b/.test(coreHaystack) || (year && year >= 1953 && year <= 1962)) series = "C1 Corvette";
      else series = "Corvette Base";
    } else if (/\bBLAZER\b|\bJIMMY\b/.test(coreHaystack)) {
      if (/\bK\/?5\b|\bK5\b/.test(fullHaystack) || (year && year >= 1969 && year <= 1991 && !/\bS[-\s]?10\b|\bS[-\s]?15\b/.test(coreHaystack))) {
        series = brand === "gmc" ? "K5 Jimmy (Full-Size)" : "K5 Blazer (Full-Size)";
      } else if (/\bS[-\s]?10\b|\bS[-\s]?15\b/.test(coreHaystack)) {
        series = "S-10 / S-15 Compact";
      } else if (/\bTAHOE\b/.test(coreHaystack)) {
        series = "Tahoe / K1500 Blazer";
      }
    } else if (/\bCAMARO\b/.test(coreHaystack)) {
      if (/\bCOPO\b|\bYENKO\b|\bBALDWIN\b|\bZL[-\s]?1\b/.test(coreHaystack)) series = "COPO / ZL1";
      else if (/\bZ\/?28\b/.test(coreHaystack)) series = "Camaro Z/28";
      else if (/\bIROC[-\s]?Z\b/.test(coreHaystack)) series = "Camaro IROC-Z";
      else if (/\bRS\/SS\b|\bSS\/RS\b/.test(coreHaystack)) series = "Camaro RS/SS";
      else if (/\bSS\b|\bSUPER\s+SPORT\b/.test(coreHaystack)) series = "Camaro SS";
      else if (/\bRS\b|\bRALLY\s+SPORT\b/.test(coreHaystack)) series = "Camaro RS";
      else if (/\bBERLINETTA\b/.test(coreHaystack)) series = "Berlinetta";
    } else if (/\bCHEVELLE\b|\bMALIBU\b/.test(coreHaystack)) {
      if (/\bSS\s*454\b|\bLS6\b|\bLS5\b/.test(fullHaystack)) series = "SS 454";
      else if (/\bSS\s*396\b|\bL78\b|\bL89\b/.test(fullHaystack)) series = "SS 396";
      else if (/\bMALIBU\s+SS\b|\bCHEVELLE\s+SS\b|\bSUPER\s+SPORT\b|\bCHEVELLE\b.*\bSS\b/.test(coreHaystack)) series = "Chevelle SS";
      else if (/\bLAGUNA\b/.test(coreHaystack)) series = "Laguna S-3";
      else if (/\bMALIBU\b/.test(coreHaystack)) series = "Malibu";
      else if (/\b300\s+DELUXE\b|\b300\b/.test(coreHaystack)) series = "Chevelle 300";
    } else if (/\bBEL\s+AIR\b|\bNOMAD\b|\b210\b|\bTWO[-\s]?TEN\b|\b150\b|\bONE[-\s]?FIFTY\b/.test(coreHaystack)) {
      if (/\bNOMAD\b/.test(coreHaystack)) series = "Nomad Sport Wagon";
      else if (/\bBEL\s+AIR\b/.test(coreHaystack)) series = "Bel Air (2400 Series)";
      else if (/\b210\b|\bTWO[-\s]?TEN\b/.test(coreHaystack)) series = "210 (2100 Series)";
      else if (/\b150\b|\bONE[-\s]?FIFTY\b/.test(coreHaystack)) series = "150 (1500 Series)";
    } else {
      // Pickups & Trucks / Suburbans
      if (/\bC[-\s]?10\b/.test(coreHaystack)) series = "C10 (1/2-Ton 2WD)";
      else if (/\bK[-\s]?10\b/.test(coreHaystack)) series = "K10 (1/2-Ton 4x4)";
      else if (/\bC[-\s]?20\b/.test(coreHaystack)) series = "C20 (3/4-Ton 2WD)";
      else if (/\bK[-\s]?20\b/.test(coreHaystack)) series = "K20 (3/4-Ton 4x4)";
      else if (/\bC[-\s]?30\b/.test(coreHaystack)) series = "C30 (1-Ton 2WD)";
      else if (/\bK[-\s]?30\b/.test(coreHaystack)) series = "K30 (1-Ton 4x4)";
      else if (/\bR[-\s]?10\b|\bR[-\s]?1500\b/.test(coreHaystack)) series = "R10 (1/2-Ton 2WD)";
      else if (/\bV[-\s]?10\b|\bV[-\s]?1500\b|\bV[-\s]?2500\b/.test(coreHaystack)) series = "V10 (1/2-Ton 4x4)";
      else if (/\b3100\b/.test(coreHaystack)) series = "3100 (1/2-Ton)";
      else if (/\b3600\b/.test(coreHaystack)) series = "3600 (3/4-Ton)";
      else if (/\b3800\b/.test(coreHaystack)) series = "3800 (1-Ton)";
      else if (/\bAPACHE\b/.test(coreHaystack)) series = "Apache";
      else if (/\bCAMEO\b/.test(coreHaystack)) series = "Cameo Carrier";
      else if (/\bK[-\s]?1500\b/.test(coreHaystack)) series = "K1500 (1/2-Ton 4x4)";
      else if (/\bC[-\s]?1500\b|\b1500\b/.test(coreHaystack)) series = "1500 (1/2-Ton)";
      else if (/\bK[-\s]?2500\b|\bC[-\s]?2500\b|\b2500\s*(?:HD)?\b/.test(coreHaystack)) series = "2500 (3/4-Ton)";
      else if (/\bK[-\s]?3500\b|\bC[-\s]?3500\b|\b3500\s*(?:HD)?\b/.test(coreHaystack)) series = "3500 (1-Ton)";
      else if (/\bSYCLONE\b/.test(coreHaystack)) series = "Syclone";
      else if (/\bTYPHOON\b/.test(coreHaystack)) series = "Typhoon";
    }
  }

  // B. Ford Bronco, Mustang, F-Series, GT, Focus/Fiesta
  if (!series && brand === "ford") {
    if (/\bBRONCO\b/.test(coreHaystack)) {
      if (/\bRAPTOR\b/.test(coreHaystack)) series = "Bronco Raptor";
      else if (/\bSTROPPE\b|\bBAJA\b/.test(fullHaystack)) series = "Bill Stroppe Baja";
      else if (/\bU13\b|\bROADSTER\b/.test(fullHaystack) && year && year <= 1968) series = "U13 Roadster";
      else if (/\bU14\b|\bHALF[-\s]?CAB\b|\bSPORTS\s+UTILITY\b/.test(fullHaystack) && year && year <= 1977) series = "U14 Half-Cab Pickup";
      else if ((/\bU15\b|\bWAGON\b/.test(fullHaystack) || (year && year >= 1966 && year <= 1977)) && year && year <= 1977) series = "U15 Wagon";
      else if (/\bFIRST\s+EDITION\b/.test(coreHaystack)) series = "First Edition";
      else if (/\bWILDTRAK\b/.test(coreHaystack)) series = "Wildtrak";
      else if (/\bBADLANDS\b/.test(coreHaystack)) series = "Badlands";
      else if (/\bHERITAGE\b/.test(coreHaystack)) series = "Heritage Edition";
      else if (/\bEVERGLADES\b/.test(coreHaystack)) series = "Everglades";
      else if (/\bOUTER\s+BANKS\b/.test(coreHaystack)) series = "Outer Banks";
      else if (/\bBLACK\s+DIAMOND\b/.test(coreHaystack)) series = "Black Diamond";
      else if (/\bBIG\s+BEND\b/.test(coreHaystack)) series = "Big Bend";
      else if (/\bEDDIE\s+BAUER\b/.test(coreHaystack)) series = "Eddie Bauer";
      else if (/\bXLT\b/.test(coreHaystack)) series = "Bronco XLT";
      else if (year && year >= 1978 && year <= 1996) series = "Full-Size Bronco";
      else if (year && year >= 2021) series = "6th-Gen Bronco (U725)";
    } else if (/\bMUSTANG\b|\bSHELBY\s+GT(?:350|500)\b/.test(coreHaystack)) {
      if (/\bSHELBY\s+GT500KR\b/.test(coreHaystack)) series = "Shelby GT500KR";
      else if (/\bSHELBY\s+GT500\b|\bGT500\b/.test(coreHaystack)) series = "Shelby GT500";
      else if (/\bSHELBY\s+GT350R\b|\bGT350R\b/.test(coreHaystack)) series = "Shelby GT350R";
      else if (/\bSHELBY\s+GT350\b|\bGT350\b/.test(coreHaystack)) series = "Shelby GT350";
      else if (/\bBOSS\s+429\b/.test(coreHaystack)) series = "Boss 429";
      else if (/\bBOSS\s+302\b/.test(coreHaystack)) series = "Boss 302";
      else if (/\bBOSS\s+351\b/.test(coreHaystack)) series = "Boss 351";
      else if (/\bMACH\s+1\b|\bMACH\s+E\b/.test(coreHaystack)) {
        series = /\bMACH[-\s]?E\b/.test(coreHaystack) ? "Mustang Mach-E" : "Mach 1";
      } else if (/\bSVT\s+COBRA\s+R\b|\bCOBRA\s+R\b/.test(coreHaystack)) series = "SVT Cobra R";
      else if (/\bSVT\s+COBRA\b|\bCOBRA\b|\bTERMINATOR\b/.test(coreHaystack)) series = "SVT Cobra";
      else if (/\bBULLITT\b/.test(coreHaystack)) series = "Bullitt";
      else if (/\bDARK\s+HORSE\b/.test(coreHaystack)) series = "Dark Horse";
      else if (/\bSALEEN\b/.test(coreHaystack)) series = "Saleen Mustang";
      else if (/\bROUSH\b/.test(coreHaystack)) series = "Roush Mustang";
      else if (/\bMUSTANG\s+GT\b|\bGT\s+(?:COUPE|FASTBACK|CONVERTIBLE|PREMIUM|CALIFORNIA)\b|\bGT\b/.test(coreHaystack)) series = "Mustang GT";
      else series = "Mustang Standard";
    } else if (/\bF[-\s]?100\b/.test(coreHaystack)) {
      series = "F-100 (1/2-Ton)";
    } else if (/\bF[-\s]?150\b/.test(coreHaystack)) {
      series = "F-150 (1/2-Ton)";
    } else if (/\bF[-\s]?250\b/.test(coreHaystack)) {
      series = "F-250 (3/4-Ton)";
    } else if (/\bF[-\s]?350\b/.test(coreHaystack)) {
      series = "F-350 (1-Ton)";
    } else if (/\bF[-\s]?450\b/.test(coreHaystack)) {
      series = "F-450 Super Duty";
    } else if (/\bF[-\s]?1\b/.test(coreHaystack)) {
      series = "F-1 (1/2-Ton)";
    }
  }

  // C. Porsche 911 / 356 / Boxster / Cayman / Cayenne / Macan / Panamera / Taycan
  if (!series && brand === "porsche") {
    if (/\b911\b|\b930\b|\b964\b|\b993\b|\b996\b|\b997\b|\b991\b|\b992\b|\bCARRERA\b|\bTARGA\b|\bGT3\b|\bGT2\b/.test(coreHaystack) && !/\bCAYENNE\b|\bMACAN\b|\bPANAMERA\b|\bTAYCAN\b|\bBOXSTER\b|\bCAYMAN\b|\b944\b|\b928\b|\b968\b|\b914\b|\b912\b|\b356\b|\bCARRERA\s+GT\b/.test(coreHaystack)) {
      if (/\bGT3\s+RS\b/.test(coreHaystack)) series = "GT3 RS";
      else if (/\bGT3\s+TOURING\b|\bGT3\b/.test(coreHaystack)) series = "GT3";
      else if (/\bGT2\s+RS\b|\bGT2\b/.test(coreHaystack)) series = "GT2 / GT2 RS";
      else if (/\bSPORT\s+CLASSIC\b|\bDAKAR\b|\bS\/T\b|\bSPEEDSTER\b|\bR\b/.test(coreHaystack) && /\b911\s+(?:R|S\/T|DAKAR|SPORT\s+CLASSIC|SPEEDSTER)\b/.test(coreHaystack)) series = "911 Special Wishes / Heritage";
      else if (/\bTURBO\s+S\b|\bTURBO\b|\b930\b/.test(coreHaystack)) series = "911 Turbo";
      else if (/\bCARRERA\s+RS\b|\bRS\s+AMERICA\b/.test(coreHaystack)) series = "Carrera RS";
      else if (/\bCARRERA\s+4\s+GTS\b|\bCARRERA\s+GTS\b|\bTARGA\s+4\s+GTS\b|\bGTS\b/.test(coreHaystack)) series = "Carrera GTS";
      else if (/\bCARRERA\s+4S\b|\bTARGA\s+4S\b|\bC4S\b/.test(coreHaystack)) series = "Carrera 4S";
      else if (/\bCARRERA\s+S\b|\bC2S\b/.test(coreHaystack)) series = "Carrera S";
      else if (/\bCARRERA\s+4\b|\bTARGA\s+4\b|\bC4\b/.test(coreHaystack)) series = "Carrera 4";
      else if (/\bCARRERA\s+T\b/.test(coreHaystack)) series = "Carrera T";
      else if (/\bCARRERA\b/.test(coreHaystack)) series = "911 Carrera";
      else if (/\b911\s*SC\b|\bSC\b/.test(coreHaystack) && (!year || (year >= 1978 && year <= 1983))) series = "911 SC";
      else if (/\b911\s*S\b/.test(coreHaystack)) series = "911S";
      else if (/\b911\s*E\b/.test(coreHaystack)) series = "911E";
      else if (/\b911\s*T\b/.test(coreHaystack)) series = "911T";
      else if (/\bTARGA\b/.test(coreHaystack)) series = "911 Targa";
      else if (/\b992\b/.test(coreHaystack) || (year && year >= 2020)) series = "911 Carrera";
      else if (/\b991\b/.test(coreHaystack) || (year && year >= 2012 && year <= 2019)) series = "911 Carrera";
      else if (/\b997\b/.test(coreHaystack) || (year && year >= 2005 && year <= 2012)) series = "911 Carrera";
      else if (/\b996\b/.test(coreHaystack) || (year && year >= 1999 && year <= 2004)) series = "911 Carrera";
      else if (/\b993\b/.test(coreHaystack) || (year && year >= 1995 && year <= 1998)) series = "911 Carrera";
      else if (/\b964\b/.test(coreHaystack) || (year && year >= 1989 && year <= 1994)) series = "911 Carrera";
    } else if (/\b356\b/.test(coreHaystack)) {
      if (/\b356\s*C\b|\b356\s*SC\b/.test(coreHaystack) || (year && year >= 1964 && year <= 1965)) series = "356C / 356SC";
      else if (/\b356\s*B\b/.test(coreHaystack) || (year && year >= 1960 && year <= 1963)) series = "356B (T5 / T6)";
      else if (/\b356\s*A\b/.test(coreHaystack) || (year && year >= 1956 && year <= 1959)) series = "356A (T1 / T2)";
      else if (/\bPRE[-\s]?A\b/.test(coreHaystack) || (year && year <= 1955)) series = "356 Pre-A";
    } else if (/\bBOXSTER\b|\bCAYMAN\b|\b718\b/.test(coreHaystack)) {
      if (/\bGT4\s+RS\b/.test(coreHaystack)) series = "718 Cayman GT4 RS";
      else if (/\bGT4\b/.test(coreHaystack)) series = "Cayman GT4";
      else if (/\bSPYDER\s+RS\b|\bSPYDER\b/.test(coreHaystack)) series = "Boxster Spyder";
      else if (/\b718\b|\b982\b/.test(coreHaystack) || (year && year >= 2017)) series = "718 (982)";
      else if (/\b981\b/.test(coreHaystack) || (year && year >= 2013 && year <= 2016)) series = "981 Series";
      else if (/\b987\b/.test(coreHaystack) || (year && year >= 2005 && year <= 2012)) series = "987 Series";
      else if (/\b986\b/.test(coreHaystack) || (year && year >= 1997 && year <= 2004)) series = "986 Series";
    } else if (/\bCAYENNE\b/.test(coreHaystack)) {
      if (/\b955\b|\b957\b/.test(coreHaystack) || (year && year >= 2003 && year <= 2010)) series = "955 / 957 (1st Gen)";
      else if (/\b958\b/.test(coreHaystack) || (year && year >= 2011 && year <= 2018)) series = "958 (2nd Gen)";
      else if (/\b9Y0\b/.test(coreHaystack) || (year && year >= 2019)) series = "9Y0 (3rd Gen)";
    } else if (/\bMACAN\b/.test(coreHaystack)) {
      series = "95B Macan";
    } else if (/\bPANAMERA\b/.test(coreHaystack)) {
      series = year && year <= 2016 ? "970 Panamera" : "971 Panamera";
    } else if (/\bTAYCAN\b/.test(coreHaystack)) {
      series = "J1 Taycan";
    } else if (/\b944\b|\b928\b|\b968\b|\b924\b/.test(coreHaystack)) {
      series = "Transaxle Series";
    } else if (/\b914\b/.test(coreHaystack)) {
      series = /\b914\/6\b/.test(coreHaystack) ? "914/6" : "914";
    }
  }

  // D. BMW M3 / M5 / M2 / M4 / M6 / 2002 / 3-Series / 5-Series / Z3 / Z4 / 8-Series
  if (!series && brand === "bmw") {
    if (/\b2002\s*TURBO\b/.test(coreHaystack)) series = "2002 Turbo";
    else if (/\b2002\s*TII\b/.test(coreHaystack)) series = "2002tii";
    else if (/\b2002\b|\b1600\b/.test(coreHaystack)) series = "2002";
    else if (/\bM3\b/.test(coreHaystack)) {
      if (/\bE30\b/.test(fullHaystack) || (year && year >= 1986 && year <= 1991)) series = "E30 M3";
      else if (/\bE36\b/.test(fullHaystack) || (year && year >= 1992 && year <= 1999)) series = "E36 M3";
      else if (/\bE46\b/.test(fullHaystack) || (year && year >= 2000 && year <= 2006)) series = "E46 M3";
      else if (/\bE9[023X]\b/.test(fullHaystack) || (year && year >= 2007 && year <= 2013)) series = "E90/E92/E93 M3";
      else if (/\bF80\b/.test(fullHaystack) || (year && year >= 2014 && year <= 2018)) series = "F80 M3";
      else if (/\bG80\b/.test(fullHaystack) || (year && year >= 2021)) series = "G80 M3";
    } else if (/\bM5\b/.test(coreHaystack)) {
      if (/\bE28\b/.test(fullHaystack) || (year && year >= 1985 && year <= 1988)) series = "E28 M5";
      else if (/\bE34\b/.test(fullHaystack) || (year && year >= 1989 && year <= 1995)) series = "E34 M5";
      else if (/\bE39\b/.test(fullHaystack) || (year && year >= 1998 && year <= 2003)) series = "E39 M5";
      else if (/\bE60\b/.test(fullHaystack) || (year && year >= 2005 && year <= 2010)) series = "E60 M5";
      else if (/\bF10\b/.test(fullHaystack) || (year && year >= 2011 && year <= 2016)) series = "F10 M5";
      else if (/\bF90\b/.test(fullHaystack) || (year && year >= 2018 && year <= 2023)) series = "F90 M5";
      else if (/\bG90\b/.test(fullHaystack) || (year && year >= 2024)) series = "G90 M5";
      else series = "M5 Heritage";
    } else if (/\bM2\b/.test(coreHaystack) && !/\bM235I\b|\bM240I\b/.test(coreHaystack)) {
      series = year && year >= 2023 ? "G87 M2" : "F87 M2";
    } else if (/\bM4\b/.test(coreHaystack) && !/\bM440I\b/.test(coreHaystack)) {
      series = year && year >= 2021 ? "G82/G83 M4" : "F82/F83 M4";
    } else if (/\bM6\b/.test(coreHaystack)) {
      if (year && year <= 1989) series = "E24 M6";
      else if (year && year >= 2005 && year <= 2010) series = "E63/E64 M6";
      else series = "F06/F12/F13 M6";
    } else if (/\b1\s*SERIES\s*M\b|\b1M\b/.test(coreHaystack)) {
      series = "E82 1M";
    } else if (/\bZ3\b|\bM\s+ROADSTER\b|\bM\s+COUPE\b/.test(coreHaystack) && (!year || year <= 2002)) {
      series = /\bCOUPE\b/.test(coreHaystack) ? "E36/8 Z3 Coupe" : "E36/7 Z3 Roadster";
    } else if (/\bZ4\b/.test(coreHaystack)) {
      if (year && year <= 2008) series = "E85/E86 Z4";
      else if (year && year <= 2016) series = "E89 Z4";
      else series = "G29 Z4";
    } else if (/\bZ8\b/.test(coreHaystack)) {
      series = "E52 Z8";
    } else if (/\b8[45]0[A-Z]*\b|\bM8\b/.test(coreHaystack)) {
      series = year && year <= 1999 ? "E31 8-Series" : "G15 8-Series";
    } else if (/\b[3]\d{2}[A-Z]*\b/.test(coreHaystack)) {
      if (year && year <= 1983) series = "E21 3-Series";
      else if (year && year <= 1991) series = "E30 3-Series";
      else if (year && year <= 1999) series = "E36 3-Series";
      else if (year && year <= 2006) series = "E46 3-Series";
      else if (year && year <= 2013) series = "E90/E92 3-Series";
      else if (year && year <= 2018) series = "F30 3-Series";
      else series = "G20 3-Series";
    } else if (/\b[5]\d{2}[A-Z]*\b/.test(coreHaystack)) {
      if (year && year <= 1988) series = "E28 5-Series";
      else if (year && year <= 1995) series = "E34 5-Series";
      else if (year && year <= 2003) series = "E39 5-Series";
      else if (year && year <= 2010) series = "E60 5-Series";
      else if (year && year <= 2016) series = "F10 5-Series";
      else series = "G30 5-Series";
    } else if (/\b[7]\d{2}[A-Z]*\b/.test(coreHaystack)) {
      if (year && year <= 1994) series = "E32 7-Series";
      else if (year && year <= 2001) series = "E38 7-Series";
      else if (year && year <= 2008) series = "E65/E66 7-Series";
      else series = "7-Series";
    }
  }

  // E. Toyota Land Cruiser / Supra / 4Runner / Tacoma / FJ Cruiser / MR2
  if (!series && brand === "toyota") {
    if (/\bLAND\s+CRUISER\b|\bFJ4\d\b|\bFJ55\b|\bFJ6\d\b|\bFJ80\b|\bFZJ80\b|\bUZJ100\b|\bURJ200\b|\bHDJ8\d\b|\bHZJ7\d\b|\bKZJ\d+\b|\bBJ4\d\b|\bBJ7\d\b/.test(coreHaystack)) {
      if (/\bFJ45\b|\bHJ45\b|\bHJ47\b|\bTROOPY\b/.test(fullHaystack)) series = "FJ45 / HJ47 Pickup & Troopy";
      else if (/\bFJ43\b|\bBJ42\b|\bBJ43\b|\bBJ44\b|\bBJ46\b/.test(fullHaystack)) series = "FJ43 / BJ42 Mid-Wheelbase";
      else if (/\bFJ40\b|\bBJ40\b|\bJ40\b/.test(fullHaystack) || (year && year >= 1960 && year <= 1984 && !/\bFJ55\b|\bFJ60\b|\bFJ62\b/.test(fullHaystack))) series = "FJ40 / BJ40 (J40)";
      else if (/\bFJ55\b/.test(fullHaystack)) series = "FJ55 Iron Pig";
      else if (/\bFJ60\b|\bFJ62\b|\bHJ60\b|\bHJ61\b/.test(fullHaystack) || (year && year >= 1981 && year <= 1990 && !/\b70\b|\bBJ7\b|\bHZJ7\b|\bLJ7\b/.test(fullHaystack))) series = "FJ60 / FJ62 (J60 Wagon)";
      else if (/\b[A-Z]{2,3}7\d\b|\b70[-\s]?SERIES\b|\bPRADO\b.*\b7[18]\b/.test(fullHaystack)) series = "J70 Series";
      else if (/\bFJ80\b|\bFZJ80\b|\bHDJ80\b|\bHDJ81\b|\bHZJ80\b|\b80[-\s]?SERIES\b/.test(fullHaystack) || (year && year >= 1991 && year <= 1997 && !/\bPRADO\b|\bKZJ9\b/.test(fullHaystack))) series = "FZJ80 / FJ80 (J80)";
      else if (/\bKZJ9\d\b|\bKDJ9\d\b|\b90[-\s]?SERIES\b/.test(fullHaystack)) series = "J90 Prado";
      else if (/\bUZJ100\b|\bHDJ100\b|\b100[-\s]?SERIES\b/.test(fullHaystack) || (year && year >= 1998 && year <= 2007)) series = "UZJ100 (100-Series)";
      else if (/\bURJ200\b|\bVDJ200\b|\b200[-\s]?SERIES\b/.test(fullHaystack) || (year && year >= 2008 && year <= 2021)) series = "URJ200 (200-Series)";
      else if (/\bJ250\b|\b250[-\s]?SERIES\b/.test(fullHaystack) || (year && year >= 2024)) series = "J250 (250-Series)";
    } else if (/\bSUPRA\b/.test(coreHaystack)) {
      if (/\bA80\b|\bMK4\b|\bMKIV\b|\b2JZ\b/.test(fullHaystack) || (year && year >= 1993 && year <= 2002)) series = "A80 Supra (MkIV)";
      else if (/\bA70\b|\bMK3\b|\bMKIII\b/.test(fullHaystack) || (year && year >= 1986 && year <= 1992)) series = "A70 Supra (MkIII)";
      else if (/\bA60\b|\bMK2\b/.test(fullHaystack) || (year && year <= 1985)) series = "A60 Celica Supra (MkII)";
      else if (/\bA90\b|\bA91\b|\bGR\s+SUPRA\b/.test(fullHaystack) || (year && year >= 2020)) series = "A90 GR Supra (MkV)";
    } else if (/\b4RUNNER\b|\bHILUX\s+SURF\b/.test(coreHaystack)) {
      if (year && year <= 1989) series = "N60 (1st Gen)";
      else if (year && year <= 1995) series = "N120/N130 (2nd Gen)";
      else if (year && year <= 2002) series = "N180 (3rd Gen)";
      else if (year && year <= 2009) series = "N210 (4th Gen)";
      else if (year && year >= 2010) series = "N280 (5th Gen)";
    } else if (/\bTACOMA\b/.test(coreHaystack)) {
      if (year && year <= 2004) series = "1st-Gen Tacoma (N140)";
      else if (year && year <= 2015) series = "2nd-Gen Tacoma (N220)";
      else if (year && year <= 2023) series = "3rd-Gen Tacoma (N300)";
      else series = "4th-Gen Tacoma (N400)";
    } else if (/\bFJ\s+CRUISER\b/.test(coreHaystack)) {
      series = "GSJ15 (FJ Cruiser)";
    } else if (/\bMR2\b/.test(coreHaystack)) {
      if (year && year <= 1989) series = "AW11 MR2";
      else if (year && year <= 1999) series = "SW20 MR2";
      else series = "ZZW30 MR2 Spyder";
    }
  }

  // F. Mercedes-Benz SL / AMG / G-Class / E-Class / S-Class
  if (!series && (brand === "mercedes-benz" || brand === "mercedes")) {
    if (/\b300\s*SL\b|\bW198\b/.test(coreHaystack) && year && year <= 1963) series = "300SL (W198)";
    else if (/\b190\s*SL\b|\bW121\b/.test(coreHaystack)) series = "190SL (W121)";
    else if (/\b230\s*SL\b|\b250\s*SL\b|\b280\s*SL\b|\bW113\b|\bPAGODA\b/.test(coreHaystack) && (!year || year <= 1971)) series = "Pagoda (W113)";
    else if (/\b(?:280|350|380|450|500|560)\s*SL\b|\bR107\b/.test(coreHaystack) && (!year || (year >= 1971 && year <= 1989))) series = "R107 SL (380/450/560SL)";
    else if (/\b(?:300|320|500|600)\s*SL\b|\bSL\s*(?:320|500|600|55|60|70|73)\b|\bR129\b/.test(coreHaystack) && year && year >= 1990 && year <= 2002) series = "R129 SL";
    else if (/\bSL\s*(?:500|550|600|55|63|65)\b|\bR230\b/.test(coreHaystack) && year && year >= 2003 && year <= 2012) series = "R230 SL";
    else if (/\bSL\s*(?:400|450|550|63|65)\b|\bR231\b/.test(coreHaystack) && year && year >= 2013 && year <= 2020) series = "R231 SL";
    else if (/\bG\s*(?:500|550|55|63|65|300|320|350)\b|\b280\s*GE\b|\b300\s*GD\b|\b230\s*GE\b|\bG[-\s]?WAGEN\b|\bG[-\s]?CLASS\b|\bW46[013]\b/.test(coreHaystack)) {
      series = year && year <= 1990 ? "W460 G-Wagen" : "W463 G-Class";
    } else if (/\bE\s*(?:55|63|500|420|430|320|350|300|400)\b|\b500\s*E\b|\bW124\b|\bW210\b|\bW211\b|\bW212\b|\bW213\b/.test(coreHaystack)) {
      if (year && year <= 1995) series = "W124 E-Class";
      else if (year && year <= 2002) series = "W210 E-Class";
      else if (year && year <= 2009) series = "W211 E-Class";
      else if (year && year <= 2016) series = "W212 E-Class";
      else series = "W213 E-Class";
    } else if (/\bC\s*(?:32|36|43|55|63)\b|\b190\s*E\b/.test(coreHaystack)) {
      if (/\b190\s*E\b/.test(coreHaystack)) series = "W201 190E";
      else if (year && year <= 2000) series = "W202 C-Class AMG";
      else if (year && year <= 2007) series = "W203 C-Class AMG";
      else if (year && year <= 2014) series = "W204 C63 AMG";
      else series = "W205 C63 AMG";
    } else if (/\bAMG\s+GT\b|\bSLS\s+AMG\b/.test(coreHaystack)) {
      series = /\bSLS\b/.test(coreHaystack) ? "C197 SLS AMG" : "C190 AMG GT";
    }
  }

  // G. Dodge / Plymouth / RAM / Pontiac / Jaguar
  if (!series && (brand === "dodge" || brand === "plymouth" || brand === "ram")) {
    if (/\bWM[-\s]?300\b/.test(coreHaystack)) series = "Power Wagon WM300";
    else if (/\bPOWER\s+WAGON\b|\bW[-\s]?100\b|\bW[-\s]?150\b|\bW[-\s]?200\b|\bW[-\s]?250\b|\bW[-\s]?300\b/.test(coreHaystack)) series = "Power Wagon (4x4)";
    else if (/\bD[-\s]?100\b|\bD[-\s]?150\b/.test(coreHaystack)) series = "D100 / D150 (1/2-Ton 2WD)";
    else if (/\bD[-\s]?200\b|\bD[-\s]?250\b/.test(coreHaystack)) series = "D200 / D250 (3/4-Ton 2WD)";
    else if (/\bDEMON\b/.test(coreHaystack)) series = "SRT Demon";
    else if (/\bHELLCAT\b/.test(coreHaystack)) series = "SRT Hellcat";
    else if (/\bVIPER\b/.test(coreHaystack)) series = "SRT-10 / Viper";
    else if (/\bTRX\b/.test(coreHaystack)) series = "1500 TRX";
    else if (/\bR\/T\b/.test(coreHaystack)) series = "R/T (Road/Track)";
  }

  if (!series && brand === "pontiac") {
    if (/\bTHE\s+JUDGE\b|\bGTO\s+JUDGE\b/.test(fullHaystack)) series = "GTO The Judge";
    else if (/\bGTO\b/.test(coreHaystack)) series = "GTO";
    else if (/\bSUPER\s+DUTY\b|\bSD[-\s]?455\b/.test(fullHaystack)) series = "Trans Am SD-455";
    else if (/\bTRANS\s+AM\b/.test(coreHaystack)) series = "Firebird Trans Am";
    else if (/\bFORMULA\b/.test(coreHaystack)) series = "Firebird Formula";
  }

  if (!series && brand === "jaguar") {
    if (/\bE[-\s]?TYPE\b|\bXKE\b/.test(coreHaystack)) {
      if (/\bSERIES\s*(?:3|III)\b|\bV12\b/.test(fullHaystack) || (year && year >= 1971)) series = "E-Type Series 3 V12";
      else if (/\bSERIES\s*(?:2|II)\b/.test(fullHaystack) || (year && year >= 1969 && year <= 1970)) series = "E-Type Series 2";
      else series = "E-Type Series 1";
    } else if (/\bXK\s*120\b/.test(coreHaystack)) series = "XK120";
    else if (/\bXK\s*140\b/.test(coreHaystack)) series = "XK140";
    else if (/\bXK\s*150\b/.test(coreHaystack)) series = "XK150";
    else if (/\bF[-\s]?TYPE\b/.test(coreHaystack)) series = "X152 F-Type";
  }

  // H. Honda / Acura, Mazda Miata, Nissan/Datsun, Subaru, Audi, VW, Lexus, Jeep, Land Rover, Rivian, Tesla
  if (!series && (brand === "honda" || brand === "acura")) {
    if (/\bS2000\b/.test(coreHaystack)) {
      series = year && year >= 2004 ? "AP2 S2000" : "AP1 S2000";
    } else if (/\bNSX\b/.test(coreHaystack)) {
      series = year && year >= 2017 ? "NC1 NSX" : "NA1/NA2 NSX";
    } else if (/\bCIVIC\s+TYPE\s+R\b|\bINTEGRA\s+TYPE\s+R\b/.test(coreHaystack)) {
      series = "Type R";
    }
  }

  if (!series && brand === "mazda") {
    if (/\bMIATA\b|\bMX[-\s]?5\b/.test(coreHaystack)) {
      if (/\bNA\b/.test(coreHaystack) || (year && year <= 1997)) series = "NA Miata";
      else if (/\bNB\b/.test(coreHaystack) || (year && year >= 1998 && year <= 2005)) series = "NB Miata";
      else if (/\bNC\b/.test(coreHaystack) || (year && year >= 2006 && year <= 2015)) series = "NC Miata";
      else if (/\bND\b/.test(coreHaystack) || (year && year >= 2016)) series = "ND Miata";
    } else if (/\bRX[-\s]?7\b/.test(coreHaystack)) {
      if (/\bFD\b|\bFD3S\b/.test(fullHaystack) || (year && year >= 1992)) series = "FD3S RX-7";
      else if (/\bFC\b|\bFC3S\b/.test(fullHaystack) || (year && year >= 1986 && year <= 1991)) series = "FC3S RX-7";
      else series = "FB / SA22C RX-7";
    }
  }

  if (!series && brand === "lexus") {
    if (/\bLX\s*450\b/.test(coreHaystack)) series = "FZJ80 (LX 450)";
    else if (/\bLX\s*470\b/.test(coreHaystack)) series = "UZJ100 (LX 470)";
    else if (/\bLX\s*570\b/.test(coreHaystack)) series = "URJ200 (LX 570)";
    else if (/\bLX\s*600\b/.test(coreHaystack)) series = "VJA310 (LX 600)";
    else if (/\bGX\s*470\b/.test(coreHaystack)) series = "UZJ120 (GX 470)";
    else if (/\bGX\s*460\b/.test(coreHaystack)) series = "URJ150 (GX 460)";
    else if (/\bGX\s*550\b/.test(coreHaystack)) series = "J250 (GX 550)";
    else if (/\bLS\s*400\b/.test(coreHaystack)) series = "UCF10/UCF20 (LS 400)";
    else if (/\bLS\s*430\b/.test(coreHaystack)) series = "UCF30 (LS 430)";
    else if (/\bLS\s*460\b/.test(coreHaystack)) series = "USF40 (LS 460)";
    else if (/\bIS\s*300\b/.test(coreHaystack) && year && year <= 2005) series = "XE10 (IS 300)";
    else if (/\bIS\s*F\b/.test(coreHaystack)) series = "USE20 (IS F)";
    else if (/\bLC\s*500\b/.test(coreHaystack)) series = "URZ100 (LC 500)";
  }

  if (!series && brand === "jeep") {
    if (/\bWRANGLER\b/.test(coreHaystack)) {
      if (/\bYJ\b/.test(fullHaystack) || (year && year >= 1987 && year <= 1995)) series = "YJ Wrangler";
      else if (/\bTJ\b|\bLJ\b/.test(fullHaystack) || (year && year >= 1997 && year <= 2006)) series = "TJ Wrangler";
      else if (/\bJK\b|\bJKU\b/.test(fullHaystack) || (year && year >= 2007 && year <= 2018)) series = "JK Wrangler";
      else if (/\bJL\b|\bJLU\b/.test(fullHaystack) || (year && year >= 2018)) series = "JL Wrangler";
    } else if (/\bCHEROKEE\b/.test(coreHaystack) && !/\bGRAND\s+CHEROKEE\b/.test(coreHaystack) && year && year <= 2001) {
      series = "XJ Cherokee";
    } else if (/\bGRAND\s+WAGONEER\b|\bWAGONEER\b/.test(coreHaystack) && year && year <= 1991) {
      series = "SJ Grand Wagoneer";
    }
  }

  if (!series && brand === "land rover") {
    if (/\bDEFENDER\s*90\b|\bNAS\b.*\b90\b|\bD90\b/.test(fullHaystack)) series = "Defender 90";
    else if (/\bDEFENDER\s*110\b|\bD110\b|\b110\b/.test(coreHaystack)) series = "Defender 110";
    else if (/\bDEFENDER\s*130\b|\bD130\b/.test(coreHaystack)) series = "Defender 130";
    else if (/\bRANGE\s+ROVER\s+CLASSIC\b/.test(fullHaystack) || (/\bRANGE\s+ROVER\b/.test(coreHaystack) && year && year <= 1995)) series = "Range Rover Classic";
    else if (/\bP38\b/.test(fullHaystack) || (/\bRANGE\s+ROVER\b/.test(coreHaystack) && !/\bSPORT\b/.test(coreHaystack) && year && year >= 1996 && year <= 2002)) series = "P38A Range Rover";
    else if (/\bL322\b/.test(fullHaystack) || (/\bRANGE\s+ROVER\b/.test(coreHaystack) && !/\bSPORT\b/.test(coreHaystack) && year && year >= 2003 && year <= 2012)) series = "L322 Range Rover";
    else if (/\bL405\b/.test(fullHaystack) || (/\bRANGE\s+ROVER\b/.test(coreHaystack) && !/\bSPORT\b|\bVELAR\b|\bEVOQUE\b/.test(coreHaystack) && year && year >= 2013 && year <= 2021)) series = "L405 Range Rover";
  }

  if (!series && brand === "audi") {
    if (/\bRS\s*6\b|\bRS6\b/.test(coreHaystack)) series = "RS6 Avant";
    else if (/\bRS\s*4\b|\bRS4\b/.test(coreHaystack)) series = "B7 RS4";
    else if (/\bRS\s*3\b|\bRS3\b/.test(coreHaystack)) series = "8V/8Y RS3";
    else if (/\bRS\s*5\b|\bRS5\b/.test(coreHaystack)) series = "RS5";
    else if (/\bRS\s*7\b|\bRS7\b/.test(coreHaystack)) series = "RS7";
    else if (/\bR8\b/.test(coreHaystack)) series = /\bV10\b/.test(fullHaystack) ? "R8 V10" : "R8 V8";
    else if (/\bS4\b/.test(coreHaystack)) {
      if (year && year <= 2002) series = "B5 S4";
      else if (year && year <= 2008) series = "B6/B7 S4";
      else if (year && year <= 2016) series = "B8/B8.5 S4";
      else series = "B9 S4";
    }
  }

  if (!series && brand === "subaru") {
    if (/\bWRX\s+STI\b|\bSTI\b/.test(coreHaystack)) series = "WRX STI";
    else if (/\bWRX\b/.test(coreHaystack)) series = "WRX";
  }

  if (!series && (brand === "nissan" || brand === "datsun")) {
    if (/\bSKYLINE\b|\bGT[-\s]?R\b/.test(coreHaystack)) {
      if (/\bR32\b/.test(fullHaystack) || (year && year >= 1989 && year <= 1994)) series = "R32 Skyline / GT-R";
      else if (/\bR33\b/.test(fullHaystack) || (year && year >= 1995 && year <= 1998)) series = "R33 Skyline / GT-R";
      else if (/\bR34\b/.test(fullHaystack) || (year && year >= 1999 && year <= 2002)) series = "R34 Skyline / GT-R";
      else if (/\bR35\b/.test(fullHaystack) || (year && year >= 2009)) series = "R35 GT-R";
    } else if (/\b240Z\b|\b260Z\b|\b280Z\b|\b280ZX\b|\b300ZX\b/.test(coreHaystack)) {
      if (/\b240Z\b/.test(coreHaystack)) series = "S30 240Z";
      else if (/\b260Z\b/.test(coreHaystack)) series = "S30 260Z";
      else if (/\b280ZX\b/.test(coreHaystack)) series = "S130 280ZX";
      else if (/\b280Z\b/.test(coreHaystack)) series = "S30 280Z";
      else if (/\b300ZX\b/.test(coreHaystack)) series = year && year >= 1990 ? "Z32 300ZX" : "Z31 300ZX";
    }
  }

  if (!series && brand === "rivian") {
    if (/\bR1S\b/.test(coreHaystack)) series = "R1S";
    else if (/\bR1T\b/.test(coreHaystack)) series = "R1T";
  }

  if (!series && brand === "tesla") {
    if (/\bMODEL\s+S\b/.test(coreHaystack)) series = "Model S";
    else if (/\bMODEL\s+3\b/.test(coreHaystack)) series = "Model 3";
    else if (/\bMODEL\s+X\b/.test(coreHaystack)) series = "Model X";
    else if (/\bMODEL\s+Y\b/.test(coreHaystack)) series = "Model Y";
    else if (/\bCYBERTRUCK\b/.test(coreHaystack)) series = "Cybertruck";
    else if (/\bROADSTER\b/.test(coreHaystack)) series = "Roadster";
  }

  // Fallback to existing series if non-generic
  if (!series && input.existingSeries) {
    const es = cleanCabText(input.existingSeries);
    if (es && !/^(Base|Level\s+I|AN|HB|PR|DT)$/i.test(es)) {
      series = es;
    }
  }

  // ── 2. TRIM PACKAGE EXTRACTION ─────────────────────────────────────────────
  // Evaluate specific marquee & multi-axis trims in deterministic priority order
  if (/\bCHEYENNE\s+SUPER\b/.test(fullHaystack)) trim = "Cheyenne Super";
  else if (/\bCHEYENNE\b/.test(fullHaystack) && (brand === "chevrolet" || brand === "gmc")) trim = "Cheyenne";
  else if (/\bSCOTTSDALE\b/.test(fullHaystack) && (brand === "chevrolet" || brand === "gmc")) trim = "Scottsdale";
  else if (/\bCUSTOM\s+DELUXE\b/.test(fullHaystack)) trim = "Custom Deluxe";
  else if (/\bSILVERADO\b/.test(fullHaystack) && (brand === "chevrolet" || brand === "gmc") && !/^SILVERADO$/i.test(rawModel)) trim = "Silverado";
  else if (/\bBIG\s+10\b/.test(fullHaystack)) trim = "Big 10";
  else if (/\b454\s+SS\b/.test(fullHaystack)) trim = "454 SS";
  else if (/\bCST\b|\bCUSTOM\s+SPORT\s+TRUCK\b/.test(fullHaystack)) trim = "CST (Custom Sport Truck)";
  else if (/\bSIERRA\s+CLASSIC\b/.test(fullHaystack)) trim = "Sierra Classic";
  else if (/\bSIERRA\s+GRANDE\b/.test(fullHaystack)) trim = "Sierra Grande";
  else if (/\bHIGH\s+SIERRA\b/.test(fullHaystack)) trim = "High Sierra";
  else if (/\bGENTLEMAN\s+JIM\b/.test(fullHaystack)) trim = "Gentleman Jim";
  else if (/\bDENALI\s+ULTIMATE\b|\bDENALI\b/.test(coreHaystack)) trim = "Denali";
  else if (/\bAT4X\b|\bAT4\b/.test(coreHaystack)) trim = /\bAT4X\b/.test(coreHaystack) ? "AT4X" : "AT4";
  else if (/\bZR2\b/.test(coreHaystack)) trim = "ZR2";
  else if (/\bZ71\b/.test(fullHaystack) && (brand === "chevrolet" || brand === "gmc")) trim = "Z71";
  // Corvette Trims
  else if (brand === "chevrolet" && /\bCORVETTE\b/.test(coreHaystack)) {
    if (/\bZR[-\s]?1\b/.test(coreHaystack)) trim = "ZR1";
    else if (/\bZ06\b/.test(coreHaystack)) trim = "Z06";
    else if (/\bGRAND\s+SPORT\b/.test(coreHaystack)) trim = "Grand Sport";
    else if (/\b3LT\b|\b3LZ\b/.test(fullHaystack)) trim = /\b3LZ\b/.test(fullHaystack) ? "3LZ" : "3LT";
    else if (/\b2LT\b|\b2LZ\b/.test(fullHaystack)) trim = /\b2LZ\b/.test(fullHaystack) ? "2LZ" : "2LT";
    else if (/\b1LT\b|\b1LZ\b/.test(fullHaystack)) trim = /\b1LZ\b/.test(fullHaystack) ? "1LZ" : "1LT";
    else if (/\bZ51\b/.test(fullHaystack)) trim = "Z51";
    else if (/\bSTINGRAY\b|\bSTING\s+RAY\b/.test(coreHaystack)) trim = "Stingray";
  }
  // Porsche Trims
  else if (brand === "porsche") {
    if (/\bWEISSACH\b/.test(fullHaystack)) trim = "Weissach Package";
    else if (/\bGT3\s+RS\b/.test(coreHaystack)) trim = "GT3 RS";
    else if (/\bGT3\s+TOURING\b/.test(coreHaystack)) trim = "GT3 Touring";
    else if (/\bGT3\b/.test(coreHaystack)) trim = "GT3";
    else if (/\bGT2\s+RS\b/.test(coreHaystack)) trim = "GT2 RS";
    else if (/\bGT4\s+RS\b/.test(coreHaystack)) trim = "GT4 RS";
    else if (/\bGT4\b/.test(coreHaystack)) trim = "GT4";
    else if (/\bTURBO\s+S\s+E[-\s]?HYBRID\b/.test(coreHaystack)) trim = "Turbo S E-Hybrid";
    else if (/\bTURBO\s+GT\b/.test(coreHaystack)) trim = "Turbo GT";
    else if (/\bTURBO\s+S\b/.test(coreHaystack)) trim = "Turbo S";
    else if (/\bTURBO\b/.test(coreHaystack)) trim = "Turbo";
    else if (/\bCARRERA\s+RS\b|\bRS\s+AMERICA\b/.test(coreHaystack)) trim = /\bAMERICA\b/.test(coreHaystack) ? "RS America" : "Carrera RS";
    else if (/\bCARRERA\s+4\s+GTS\b/.test(coreHaystack)) trim = "Carrera 4 GTS";
    else if (/\bCARRERA\s+GTS\b/.test(coreHaystack)) trim = "Carrera GTS";
    else if (/\bTARGA\s+4\s+GTS\b/.test(coreHaystack)) trim = "Targa 4 GTS";
    else if (/\bTARGA\s+4S\b/.test(coreHaystack)) trim = "Targa 4S";
    else if (/\bTARGA\s+4\b/.test(coreHaystack)) trim = "Targa 4";
    else if (/\bCARRERA\s+4S\b/.test(coreHaystack)) trim = "Carrera 4S";
    else if (/\bCARRERA\s+S\b/.test(coreHaystack)) trim = "Carrera S";
    else if (/\bCARRERA\s+4\b/.test(coreHaystack)) trim = "Carrera 4";
    else if (/\bCARRERA\s+T\b/.test(coreHaystack)) trim = "Carrera T";
    else if (/\bCARRERA\b/.test(coreHaystack)) trim = "Carrera";
    else if (/\bGTS\s+4\.0\b|\bGTS\b/.test(coreHaystack)) trim = "GTS";
    else if (/\bSPYDER\s+RS\b|\bSPYDER\b/.test(coreHaystack)) trim = "Spyder";
    else if (/\b(?:BOXSTER|CAYMAN|CAYENNE|MACAN|PANAMERA|TAYCAN)\s+4S\b/.test(coreHaystack)) trim = "4S";
    else if (/\b(?:BOXSTER|CAYMAN|CAYENNE|MACAN|PANAMERA)\s+S\b/.test(coreHaystack)) trim = "S";
    else if (/\b(?:BOXSTER|CAYMAN|MACAN)\s+T\b/.test(coreHaystack)) trim = "T";
    else if (/\bDIESEL\b/.test(coreHaystack)) trim = "Diesel";
  }
  // BMW Trims
  else if (brand === "bmw") {
    if (/\bCSL\b/.test(coreHaystack)) trim = "CSL";
    else if (/\b(?:\bM[23458]\b|\b1M\b).*\bCS\b|\bM[23458]\s+CS\b/.test(coreHaystack)) trim = "CS";
    else if (/\bCOMPETITION\s+PACKAGE\b|\bCOMPETITION\b|\bZCP\b/.test(fullHaystack)) trim = "Competition";
    else if (/\bZHP\b/.test(fullHaystack)) trim = "ZHP Performance Package";
    else if (/\bM\s+SPORT\b|\bM[-\s]?TECH\b/.test(fullHaystack) && !/\bM[234568]\b/.test(coreHaystack)) trim = "M Sport";
    else if (/\bM[234568]\b|\bM\s+ROADSTER\b|\bM\s+COUPE\b/.test(coreHaystack)) trim = "M-Power";
    else if (/\bXDRIVE[A-Z0-9]*\b/.test(coreHaystack)) trim = "xDrive";
  }
  // Ford Trims
  else if (brand === "ford") {
    if (/\bRANGER\s+XLT\b/.test(coreHaystack)) trim = "Ranger XLT";
    else if (/\bKING\s+RANCH\b/.test(coreHaystack)) trim = "King Ranch";
    else if (/\bPLATINUM\b/.test(coreHaystack)) trim = "Platinum";
    else if (/\bLARIAT\b/.test(coreHaystack)) trim = "Lariat";
    else if (/\bXLT\b/.test(coreHaystack)) trim = "XLT";
    else if (/\bSVT\s+LIGHTNING\b|\bLIGHTNING\b/.test(coreHaystack)) trim = "SVT Lightning";
    else if (/\bSVT\s+RAPTOR\b|\bRAPTOR\s+R\b|\bRAPTOR\b/.test(coreHaystack)) trim = /\bRAPTOR\s+R\b/.test(coreHaystack) ? "Raptor R" : "Raptor";
    else if (/\bSHELBY\s+GT350R\b/.test(coreHaystack)) trim = "GT350R";
    else if (/\bSHELBY\s+GT350\b/.test(coreHaystack)) trim = "GT350";
    else if (/\bSHELBY\s+GT500\b/.test(coreHaystack)) trim = "GT500";
    else if (/\bBOSS\s+302\b/.test(coreHaystack)) trim = "Boss 302";
    else if (/\bMACH\s+1\b/.test(coreHaystack)) trim = "Mach 1";
    else if (/\bBULLITT\b/.test(coreHaystack)) trim = "Bullitt";
    else if (/\bSVT\s+COBRA\b|\bCOBRA\b/.test(coreHaystack)) trim = "SVT Cobra";
    else if (/\bDARK\s+HORSE\b/.test(coreHaystack)) trim = "Dark Horse";
    else if (/\bGT\s+PREMIUM\b|\bMUSTANG\s+GT\b/.test(coreHaystack)) trim = "GT";
    else if (/\bWILDTRAK\b/.test(coreHaystack)) trim = "Wildtrak";
    else if (/\bBADLANDS\b/.test(coreHaystack)) trim = "Badlands";
    else if (/\bFIRST\s+EDITION\b/.test(coreHaystack)) trim = "First Edition";
    else if (/\bOUTER\s+BANKS\b/.test(coreHaystack)) trim = "Outer Banks";
    else if (/\bBLACK\s+DIAMOND\b/.test(coreHaystack)) trim = "Black Diamond";
    else if (/\bBIG\s+BEND\b/.test(coreHaystack)) trim = "Big Bend";
    else if (/\bEDDIE\s+BAUER\b/.test(coreHaystack)) trim = "Eddie Bauer";
    else if (/\bFOCUS\s+RS\b/.test(coreHaystack)) trim = "RS";
    else if (/\b(?:FOCUS|FIESTA|EXPLORER)\s+ST\b/.test(coreHaystack)) trim = "ST";
  }
  // Toyota Trims
  else if (brand === "toyota") {
    if (/\bTRD\s+PRO\b/.test(fullHaystack)) trim = "TRD Pro";
    else if (/\bTRD\s+OFF[-\s]?ROAD\s+PREMIUM\b|\bTRD\s+OFF[-\s]?ROAD\b/.test(fullHaystack)) trim = "TRD Off-Road";
    else if (/\bTRD\s+SPORT\b/.test(fullHaystack)) trim = "TRD Sport";
    else if (/\bTRD\s+SPECIAL\s+EDITION\b/.test(fullHaystack)) trim = "TRD Special Edition";
    else if (/\bTRAIL\s+TEAMS\b/.test(fullHaystack)) trim = "Trail Teams Special Edition";
    else if (/\bHERITAGE\s+EDITION\b/.test(fullHaystack)) trim = "Heritage Edition";
    else if (/\bFIRST\s+EDITION\b/.test(coreHaystack)) trim = "First Edition";
    else if (/\b1958\b/.test(coreHaystack) && year && year >= 2024) trim = "1958";
    else if (/\bVX\s+LIMITED\b|\bVX\b/.test(fullHaystack)) trim = "VX Limited";
    else if (/\bSR5\b/.test(coreHaystack)) trim = "SR5";
    else if (/\bLIMITED\b/.test(coreHaystack)) trim = "Limited";
    else if (/\bXSE\b/.test(coreHaystack)) trim = "XSE";
    else if (/\bSUPRA\s+RZ\b|\bTURBO\b/.test(coreHaystack) && /\bSUPRA\b/.test(coreHaystack)) trim = /\bRZ\b/.test(coreHaystack) ? "RZ Twin-Turbo" : "Turbo";
  }
  // Mercedes-Benz Trims
  else if (brand === "mercedes-benz" || brand === "mercedes") {
    if (/\bBLACK\s+SERIES\b/.test(coreHaystack)) trim = "AMG Black Series";
    else if (/\b63\s+S\s+AMG\b|\bAMG.*\b63\s+S\b/.test(coreHaystack)) trim = "AMG 63 S";
    else if (/\b(?:C|E|S|SL|CL|CLS|G|GL|GLE|GLS|ML|CLK|SLK)\s*(?:32|36|43|55|63|65)\s*AMG\b|\bAMG\b/.test(coreHaystack)) trim = "AMG";
    else if (/\b4MATIC\b/.test(coreHaystack)) trim = "4MATIC";
  }
  // General Cross-Marque Trims
  if (!trim) {
    if (/\bRUBICON\s+392\b/.test(coreHaystack)) trim = "Rubicon 392";
    else if (/\bRUBICON\b/.test(coreHaystack)) trim = "Rubicon";
    else if (/\bSAHARA\b/.test(coreHaystack)) trim = "Sahara";
    else if (/\bLAUNCH\s+EDITION\b/.test(coreHaystack)) trim = "Launch Edition";
    else if (/\bADVENTURE\s+EDITION\b|\bADVENTURE\b/.test(coreHaystack) && brand === "rivian") trim = "Adventure Edition";
    else if (/\bPLAID\b/.test(coreHaystack)) trim = "Plaid";
    else if (/\bPERFORMANCE\b/.test(coreHaystack) && brand === "tesla") trim = "Performance";
    else if (/\bLONG\s+RANGE\b/.test(coreHaystack) && brand === "tesla") trim = "Long Range";
    else if (/\bQUADRIFOGLIO\b/.test(coreHaystack)) trim = "Quadrifoglio";
    else if (/\bABARTH\b/.test(coreHaystack)) trim = "Abarth";
    else if (/\bJOHN\s+COOPER\s+WORKS\b|\bJCW\b/.test(coreHaystack)) trim = "John Cooper Works";
    else if (/\bCOOPER\s+S\b/.test(coreHaystack)) trim = "Cooper S";
    else if (/\bGRAND\s+TOURING\b/.test(coreHaystack)) trim = "Grand Touring";
    else if (/\bCLUB\b/.test(coreHaystack) && brand === "mazda") trim = "Club";
    else if (/\bTYPE\s+R\b/.test(coreHaystack)) trim = "Type R";
    else if (/\bNISMO\b/.test(coreHaystack)) trim = "NISMO";
    else if (/\bSPEC[-\s]?V\b|\bV[-\s]?SPEC\b/.test(coreHaystack)) trim = "V-Spec";
    else if (/\bGSR\b/.test(coreHaystack)) trim = "GSR";
    else if (/\bPRESTIGE\b/.test(coreHaystack)) trim = "Prestige";
    else if (/\bPREMIUM\s+PLUS\b/.test(coreHaystack)) trim = "Premium Plus";
    else if (/\bAUTOBIOGRAPHY\b/.test(coreHaystack)) trim = "Autobiography";
    else if (/\bWESTMINSTER\b/.test(coreHaystack)) trim = "Westminster";
    else if (/\bSUPERCHARGED\b/.test(coreHaystack) && brand === "land rover") trim = "Supercharged";
    else if (/\bHSE\b/.test(coreHaystack)) trim = "HSE";
    else if (/\bZ\/?28\b/.test(coreHaystack)) trim = "Z/28";
    else if (/\bIROC[-\s]?Z\b/.test(coreHaystack)) trim = "IROC-Z";
    else if (/\bZL1\b/.test(coreHaystack)) trim = "ZL1";
    else if (/\bR\/T\b/.test(coreHaystack)) trim = "R/T";
    else if (/\bSRT[-\s]?8\b|\bSRT8\b/.test(coreHaystack)) trim = "SRT8";
    else if (/\bHELLCAT\b/.test(coreHaystack)) trim = "SRT Hellcat";
  }

  // Fallback to existing trim if non-generic
  if (!trim && input.existingTrim) {
    const et = cleanCabText(input.existingTrim);
    if (et && !/^(Base|470|430|460|570)$/i.test(et) && !et.includes("/")) {
      trim = et;
    }
  }

  // ── 3. BODY STYLE REFINEMENT / EXTRACTION ──────────────────────────────────
  if (/\bSPLIT[-\s]?WINDOW\b/.test(fullHaystack) || (brand === "chevrolet" && /\bCORVETTE\b/.test(coreHaystack) && year === 1963 && /\bCOUPE\b/.test(coreHaystack))) {
    bodyStyle = "Split-Window Coupe";
  } else if (/\bTARGA\b/.test(coreHaystack)) {
    bodyStyle = "Targa";
  } else if (/\bSPEEDSTER\b/.test(coreHaystack)) {
    bodyStyle = "Speedster";
  } else if (/\bROADSTER\b|\bSPYDER\b|\bSPIDER\b/.test(coreHaystack) && (!bodyStyle || /^(Convertible|Coupe)$/i.test(bodyStyle))) {
    bodyStyle = "Roadster";
  } else if (/\bFASTBACK\b|\bSPORTSROOF\b/.test(coreHaystack)) {
    bodyStyle = "Fastback";
  } else if ((!bodyStyle || /^Truck|Pickup$/i.test(bodyStyle)) && /\bSTEPSIDE\b|\bFLARESIDE\b|\bFENDERSIDE\b/.test(fullHaystack)) {
    bodyStyle = /\bFLARESIDE\b/.test(fullHaystack) ? "Flareside Pickup" : "Stepside Pickup";
  } else if ((!bodyStyle || /^Truck|Pickup$/i.test(bodyStyle)) && /\bFLEETSIDE\b|\bSTYLESIDE\b/.test(fullHaystack)) {
    bodyStyle = /\bSTYLESIDE\b/.test(fullHaystack) ? "Styleside Pickup" : "Fleetside Pickup";
  } else if (!bodyStyle) {
    if (/\bCONVERTIBLE\b|\bCABRIOLET\b|\bVOLANTE\b|\bDROPHEAD\b/.test(coreHaystack)) bodyStyle = "Convertible";
    else if (/\bCOUPE\b|\bBERLINETTA\b|\bHARDTOP\b/.test(coreHaystack)) bodyStyle = "Coupe";
    else if (/\bAVANT\b|\bWAGON\b|\bTOURING\b|\bESTATE\b|\bSPORT\s+TURISMO\b|\bCROSS\s+TURISMO\b/.test(coreHaystack)) bodyStyle = "Wagon";
    else if (/\bSPORTBACK\b|\bHATCHBACK\b|\bGRAN\s+COUPE\b/.test(coreHaystack)) bodyStyle = "Hatchback";
    else if (/\bSEDAN\b/.test(coreHaystack)) bodyStyle = "Sedan";
    else if (/\bSUV\b|\bLAND\s+CRUISER\b|\bBRONCO\b|\bWRANGLER\b|\bDEFENDER\b|\bRANGE\s+ROVER\b|\bCAYENNE\b|\bMACAN\b|\b4RUNNER\b|\bFJ\s+CRUISER\b|\bR1S\b|\bLX\s*\d{3}\b|\bGX\s*\d{3}\b|\bG\s*(?:500|550|55|63)\b|\b280\s*GE\b/.test(coreHaystack)) bodyStyle = "SUV";
    else if (/\bTRUCK\b|\bPICKUP\b|\bF[-\s]?[1234]50\b|\bF[-\s]?100\b|\bTACOMA\b|\bTUNDRA\b|\bR1T\b|\bSILVERADO\b|\bSIERRA\b|\bC10\b|\bK10\b/.test(coreHaystack)) bodyStyle = "Truck";
  }

  return {
    normalizedModel,
    series,
    trim,
    body_style: bodyStyle,
  };
}
